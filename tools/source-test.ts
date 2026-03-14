#!/usr/bin/env npx tsx
/**
 * Source Testing CLI — probe sources for health.
 *
 * Tests individual sources or batches using the full adapter pipeline:
 *   supports() → buildCandidates() → validateCandidate() → fetch → parse
 *
 * Usage:
 *   npx tsx tools/source-test.ts --source coingecko-2a7ea372 --pretty
 *   npx tsx tools/source-test.ts --agent sentinel --pretty
 *   npx tsx tools/source-test.ts --provider hn-algolia --pretty
 *   npx tsx tools/source-test.ts --quarantined --pretty
 *   npx tsx tools/source-test.ts --agent sentinel --json
 */

import { resolve } from "node:path";
import { loadCatalog, type SourceRecordV2 } from "./lib/sources/catalog.js";
import {
  testSource,
  filterSources,
  type SourceTestResult,
  type SourceTestStatus,
} from "./lib/sources/health.js";

// ── Arg Parsing ──────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const sourceId = getFlag("source");
const agent = getFlag("agent");
const provider = getFlag("provider");
const quarantined = hasFlag("quarantined");
const pretty = hasFlag("pretty");
const json = hasFlag("json");
const delayMs = parseInt(getFlag("delay") || "200", 10);
const varsArg = getFlag("vars");

// Parse custom variables: "asset=ethereum,symbol=ETH"
const customVars: Record<string, string> = {};
if (varsArg) {
  for (const pair of varsArg.split(",")) {
    const [key, value] = pair.split("=");
    if (key && value) customVars[key.trim()] = value.trim();
  }
}

// ── Load Catalog ─────────────────────────────────────

const catalogPath = resolve(import.meta.dirname || ".", "../sources/catalog.json");
const catalog = loadCatalog(catalogPath);

if (!catalog) {
  console.error("Failed to load catalog from", catalogPath);
  process.exit(1);
}

// ── Filter Sources ───────────────────────────────────

const sources = filterSources(catalog.sources as SourceRecordV2[], {
  sourceId,
  provider,
  quarantined,
});

if (sources.length === 0) {
  console.error("No sources matched the filter criteria.");
  if (sourceId) console.error(`  --source "${sourceId}" not found. Catalog uses hashed IDs (e.g., coingecko-2a7ea372).`);
  process.exit(1);
}

// ── Run Tests ────────────────────────────────────────

const statusIcons: Record<SourceTestStatus, string> = {
  OK: "✓",
  EMPTY: "○",
  FETCH_FAILED: "✗",
  PARSE_FAILED: "✗",
  NO_ADAPTER: "⊘",
  UNRESOLVED_VARS: "?",
};

async function runTests(): Promise<SourceTestResult[]> {
  const results: SourceTestResult[] = [];

  for (const source of sources) {
    const result = await testSource(source, customVars);
    results.push(result);

    // Pretty-print as we go
    if (pretty) {
      const icon = statusIcons[result.status];
      const id = result.sourceId.padEnd(30);
      const status = result.status.padEnd(12);
      const latency = result.latencyMs > 0 ? `${result.latencyMs}ms` : "-";
      const entries = result.entryCount > 0 ? `${result.entryCount} entries` : result.error || "";
      console.log(`  ${icon} ${id} ${status} ${latency.padEnd(8)} ${entries}`);
    }

    // Delay between sources to be kind to APIs
    if (sources.indexOf(source) < sources.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}

async function main(): Promise<void> {
  const label = agent ? `agent: ${agent}` : provider ? `provider: ${provider}` : sourceId ? `source: ${sourceId}` : quarantined ? "quarantined" : "all active";

  if (pretty) {
    console.log(`\nSource Health Report (${label}, ${sources.length} sources)`);
    console.log("─".repeat(80));
  }

  const results = await runTests();

  // Summary
  const summary: Record<SourceTestStatus, number> = {
    OK: 0,
    EMPTY: 0,
    FETCH_FAILED: 0,
    PARSE_FAILED: 0,
    NO_ADAPTER: 0,
    UNRESOLVED_VARS: 0,
  };
  for (const r of results) summary[r.status]++;

  if (pretty) {
    console.log("─".repeat(80));
    const parts: string[] = [];
    if (summary.OK > 0) parts.push(`${summary.OK} OK`);
    if (summary.EMPTY > 0) parts.push(`${summary.EMPTY} EMPTY`);
    if (summary.FETCH_FAILED > 0) parts.push(`${summary.FETCH_FAILED} FETCH`);
    if (summary.PARSE_FAILED > 0) parts.push(`${summary.PARSE_FAILED} PARSE`);
    if (summary.NO_ADAPTER > 0) parts.push(`${summary.NO_ADAPTER} NO_ADAPTER`);
    if (summary.UNRESOLVED_VARS > 0) parts.push(`${summary.UNRESOLVED_VARS} UNRESOLVED`);
    console.log(`Summary: ${parts.join(", ")}`);
  }

  if (json) {
    console.log(JSON.stringify({
      label,
      timestamp: new Date().toISOString(),
      results,
      summary,
    }, null, 2));
  }

  // Exit with error code if any failures
  const failures = summary.FETCH_FAILED + summary.PARSE_FAILED + summary.UNRESOLVED_VARS;
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
