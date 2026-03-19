/**
 * Source migration CLI — converts per-agent YAML registries to unified catalog.json.
 *
 * Reads sources-registry.yaml from each agent, deduplicates by provider + normalized
 * urlPattern, and emits a single catalog.json file with SourceRecordV2 records.
 *
 * Usage:
 *   npx tsx tools/source-migrate.ts \
 *     --sentinel agents/sentinel/sources-registry.yaml \
 *     --crawler agents/crawler/sources-registry.yaml \
 *     --pioneer agents/pioneer/sources-registry.yaml \
 *     --out sources/catalog.json \
 *     --emit-agent-configs
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  loadYamlRegistry,
  normalizeSourceRecord,
  normalizeUrlPattern,
  inferProvider,
  type SourceRecordV2,
  type SourceCatalogFileV2,
  type AgentName,
} from "./lib/sources/catalog.js";

// ── CLI Parsing ─────────────────────────────────────

const { values: flags } = parseArgs({
  options: {
    sentinel: { type: "string" },
    crawler: { type: "string" },
    pioneer: { type: "string" },
    out: { type: "string", default: "config/sources/catalog.json" },
    "emit-agent-configs": { type: "boolean", default: false },
    pretty: { type: "boolean", default: false },
  },
  strict: false,
});

// ── Migration Logic ─────────────────────────────────

interface MigrationReport {
  totalV1Records: number;
  uniqueV2Records: number;
  duplicatesRemoved: number;
  perAgent: Record<string, { total: number; unique: number; shared: number }>;
  collisions: Array<{ id: string; agents: string[]; names: string[] }>;
}

function migrate(): void {
  const agentPaths: Array<{ agent: AgentName; path: string }> = [];
  if (typeof flags.sentinel === "string") agentPaths.push({ agent: "sentinel", path: flags.sentinel });
  if (typeof flags.crawler === "string") agentPaths.push({ agent: "crawler", path: flags.crawler });
  if (typeof flags.pioneer === "string") agentPaths.push({ agent: "pioneer", path: flags.pioneer });

  if (agentPaths.length === 0) {
    console.error("Error: specify at least one agent YAML registry (--sentinel, --crawler, --pioneer)");
    process.exit(1);
  }

  const now = new Date().toISOString();

  // Load all V1 records with agent provenance
  const allRecords: Array<{ record: SourceRecordV2; agent: AgentName }> = [];
  for (const { agent, path } of agentPaths) {
    if (!existsSync(path)) {
      console.error(`Warning: ${path} does not exist — skipping ${agent}`);
      continue;
    }
    const v1Records = loadYamlRegistry(path);
    console.log(`  ${agent}: ${v1Records.length} sources loaded from ${path}`);
    for (const v1 of v1Records) {
      allRecords.push({ record: normalizeSourceRecord(v1, agent, now), agent });
    }
  }

  // Deduplicate by provider + normalized urlPattern
  const dedupeKey = (r: SourceRecordV2) => `${r.provider}::${r.urlPattern}`;
  const merged = new Map<string, { record: SourceRecordV2; agents: Set<AgentName> }>();

  for (const { record, agent } of allRecords) {
    const key = dedupeKey(record);
    if (merged.has(key)) {
      const existing = merged.get(key)!;
      existing.agents.add(agent);
      // Merge scope
      if (!existing.record.scope.importedFrom.includes(agent)) {
        existing.record.scope.importedFrom.push(agent);
      }
      if (existing.record.scope.agents && !existing.record.scope.agents.includes(agent)) {
        existing.record.scope.agents.push(agent);
      }
      // Merge topics
      const existingTopics = new Set(existing.record.topics || []);
      for (const t of record.topics || []) {
        if (!existingTopics.has(t)) {
          existing.record.topics = [...(existing.record.topics || []), t];
        }
      }
      // Merge domain tags
      const existingTags = new Set(existing.record.domainTags);
      for (const t of record.domainTags) {
        if (!existingTags.has(t)) {
          existing.record.domainTags.push(t);
        }
      }
      // Prefer TLSN/DAHR safe if either source has it
      if (record.tlsn_safe) existing.record.tlsn_safe = true;
      if (record.dahr_safe) existing.record.dahr_safe = true;
    } else {
      merged.set(key, { record: { ...record }, agents: new Set([agent]) });
    }
  }

  // Build catalog
  const sources: SourceRecordV2[] = [];
  const collisions: MigrationReport["collisions"] = [];

  for (const [, { record, agents }] of merged) {
    // Set scope based on agent count
    if (agents.size > 1) {
      record.scope.visibility = "scoped";
      record.scope.agents = [...agents];
    }
    sources.push(record);
  }

  // Check for ID collisions (different sources that hash to same ID)
  const idMap = new Map<string, SourceRecordV2[]>();
  for (const source of sources) {
    if (!idMap.has(source.id)) idMap.set(source.id, []);
    idMap.get(source.id)!.push(source);
  }
  for (const [id, records] of idMap) {
    if (records.length > 1) {
      collisions.push({
        id,
        agents: records.flatMap((r) => r.scope.importedFrom),
        names: records.map((r) => r.name),
      });
      // Disambiguate by appending index
      for (let i = 1; i < records.length; i++) {
        records[i].id = `${id}-${i}`;
      }
    }
  }

  const catalog: SourceCatalogFileV2 = {
    version: 2,
    generatedAt: now,
    aliasesVersion: 1,
    sources,
  };

  // Write catalog
  const outPath = resolve(typeof flags.out === "string" ? flags.out : "config/sources/catalog.json");
  const outDir = dirname(outPath);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(catalog, null, 2), "utf-8");

  // Build report
  const report: MigrationReport = {
    totalV1Records: allRecords.length,
    uniqueV2Records: sources.length,
    duplicatesRemoved: allRecords.length - sources.length,
    perAgent: {},
    collisions,
  };

  for (const { agent } of agentPaths) {
    const agentTotal = allRecords.filter((r) => r.agent === agent).length;
    const agentUnique = sources.filter((s) => s.scope.importedFrom.includes(agent)).length;
    const shared = sources.filter(
      (s) => s.scope.importedFrom.includes(agent) && s.scope.importedFrom.length > 1
    ).length;
    report.perAgent[agent] = { total: agentTotal, unique: agentUnique, shared };
  }

  // Print report
  console.log(`\n  Migration complete:`);
  console.log(`    Total V1 records: ${report.totalV1Records}`);
  console.log(`    Unique V2 records: ${report.uniqueV2Records}`);
  console.log(`    Duplicates removed: ${report.duplicatesRemoved}`);
  for (const [agent, stats] of Object.entries(report.perAgent)) {
    console.log(`    ${agent}: ${stats.total} → ${stats.unique} (${stats.shared} shared)`);
  }
  if (collisions.length > 0) {
    console.log(`\n  ⚠️ ${collisions.length} ID collision(s) resolved by suffix:`);
    for (const c of collisions) {
      console.log(`    ${c.id}: ${c.names.join(", ")}`);
    }
  }
  console.log(`\n  Catalog written to: ${outPath}`);

  // Emit agent configs
  if (flags["emit-agent-configs"]) {
    for (const { agent } of agentPaths) {
      const configPath = resolve(`agents/${agent}/source-config.yaml`);
      if (existsSync(configPath)) {
        console.log(`  ⚠️ ${configPath} already exists — skipping`);
        continue;
      }
      const yaml = [
        `agent: ${agent}`,
        `minRating: 0`,
        `allowStatuses:`,
        `  - active`,
        `  - degraded`,
        `maxCandidatesPerTopic: 5`,
      ].join("\n") + "\n";
      writeFileSync(configPath, yaml, "utf-8");
      console.log(`  Created: ${configPath}`);
    }
  }

  if (flags.pretty) {
    console.log(`\n  Full report:\n${JSON.stringify(report, null, 2)}`);
  }
}

// ── Main ────────────────────────────────────────────

migrate();
