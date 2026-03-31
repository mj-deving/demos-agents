#!/usr/bin/env npx tsx
/**
 * Source Scan CLI — Phase 2 of intent-driven scanning.
 *
 * Standalone CLI tool that selects sources by intent, fetches data,
 * detects signals, and optionally outputs gate suggestions.
 *
 * Usage:
 *   npx tsx cli/source-scan.ts --agent sentinel --pretty
 *   npx tsx cli/source-scan.ts --agent sentinel --intent "check crypto for big moves" --pretty
 *   npx tsx cli/source-scan.ts --agent sentinel --domain crypto --pretty
 *   npx tsx cli/source-scan.ts --agent sentinel --dry-run --pretty
 *   npx tsx cli/source-scan.ts --agent sentinel --json
 */

import { homedir } from "node:os";
import { resolve } from "node:path";
import { resolveAgentName, loadAgentConfig } from "../src/lib/agent-config.js";
import { loadAgentSourceView } from "../src/lib/sources/catalog.js";
import { fetchSource } from "../src/lib/sources/fetch.js";
import { getProviderAdapter } from "../src/lib/sources/providers/index.js";
import {
  detectSignals,
  loadBaselines,
  saveBaselines,
  updateBaseline,
  type BaselineStore,
  type DetectedSignal,
} from "../src/lib/pipeline/signal-detection.js";
import {
  type ScanIntent,
  deriveIntentsFromTopics,
  selectSourcesByIntent,
  signalsToSuggestions,
} from "../src/lib/pipeline/source-scanner.js";
import type { EvidenceEntry } from "../src/lib/sources/providers/types.js";

// ── Arg Parsing ──────────────────────────────────────

const args = process.argv.slice(2);

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const agentFlag = getFlag("agent");
const intentText = getFlag("intent");
const domainFilter = getFlag("domain");
const maxSourcesFlag = getFlag("max-sources");
const minStrengthFlag = getFlag("min-strength");
const dryRun = hasFlag("dry-run");
const pretty = hasFlag("pretty");
const json = hasFlag("json");

// ── Main ──────────────────────────────────────────────

async function main() {
  const agentName = resolveAgentName(agentFlag ? { agent: agentFlag } : undefined);
  const config = loadAgentConfig(agentName);
  const sourceView = loadAgentSourceView(agentName as any, config.paths.sourceCatalog, config.paths.sourcesRegistry, config.sourceRegistryMode);
  const maxSources = maxSourcesFlag ? parseInt(maxSourcesFlag, 10) : 10;
  const minStrength = minStrengthFlag ? parseFloat(minStrengthFlag) : 0.3;

  // Build intents
  let intents: ScanIntent[];

  if (intentText) {
    // Explicit intent from CLI
    intents = [{
      description: intentText,
      domains: domainFilter ? [domainFilter] : [],
      topics: intentText.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2),
      signals: [
        { type: "change" as const, metric: "*", threshold: 5 },
      ],
      maxSources,
    }];
  } else if (domainFilter) {
    // Domain-only scan
    intents = [{
      description: `Scan ${domainFilter} sources`,
      domains: [domainFilter],
      topics: [],
      signals: [{ type: "change" as const, metric: "*", threshold: 5 }],
      maxSources,
    }];
  } else {
    // Derive from agent persona topics
    const topics = config.topics ?? { primary: [], secondary: [] };
    intents = deriveIntentsFromTopics(topics);
  }

  if (pretty) {
    console.log(`\n🔍 Source Scan — Agent: ${agentName}`);
    console.log(`   Intents: ${intents.length}`);
    console.log(`   Max sources: ${maxSources}`);
    console.log(`   Min strength: ${minStrength}`);
    if (dryRun) console.log(`   Mode: DRY RUN`);
    console.log("");
  }

  // Load baselines
  const baselinePath = resolve(homedir(), ".config", "demos", `baselines-${agentName}.json`);
  const baselineStore = loadBaselines(baselinePath);

  // Track all signals across intents
  const allSignals: DetectedSignal[] = [];
  let totalFetched = 0;
  let totalBaselinesUpdated = 0;

  for (const intent of intents) {
    if (pretty) {
      console.log(`📋 Intent: ${intent.description}`);
      console.log(`   Domains: ${intent.domains.join(", ") || "(any)"}`);
      console.log(`   Topics: ${intent.topics.join(", ") || "(any)"}`);
    }

    // Select sources
    const sources = selectSourcesByIntent(intent, sourceView);

    if (pretty) {
      console.log(`   Sources matched: ${sources.length}`);
    }

    if (sources.length === 0) {
      if (pretty) console.log(`   ⚠️  No sources match this intent\n`);
      continue;
    }

    // Fetch and detect for each source
    for (const source of sources) {
      try {
        // Fetch
        const fetchResult = await fetchSource(source.url, source);

        if (!fetchResult.ok || !fetchResult.response) {
          if (pretty) console.log(`   ❌ ${source.name}: fetch failed (${fetchResult.error})`);
          continue;
        }

        totalFetched++;

        // Parse response via adapter
        const adapter = getProviderAdapter(source.provider);
        let entries: EvidenceEntry[] = [];

        if (adapter && adapter.supports(source)) {
          const parsed = adapter.parseResponse(source, fetchResult.response);
          entries = parsed.entries;
        }

        if (entries.length === 0) {
          if (pretty) console.log(`   ⚠️  ${source.name}: no entries parsed`);
          continue;
        }

        // Detect signals
        const signals = detectSignals(entries, intent.signals, baselineStore, {
          source,
          fetchResult,
          fetchedAt: new Date().toISOString(),
          minSignalStrength: minStrength,
        });

        if (signals.length > 0) {
          allSignals.push(...signals);
          if (pretty) {
            console.log(`   🔔 ${source.name}: ${signals.length} signal(s)`);
            for (const s of signals) {
              console.log(`      • [${s.rule.type}] ${s.summary} (strength: ${s.strength.toFixed(2)})`);
            }
          }
        } else if (pretty) {
          console.log(`   ✅ ${source.name}: ${entries.length} entries, no signals`);
        }

        // Update baselines
        for (const entry of entries) {
          if (!entry.metrics) continue;
          for (const [metricKey, rawValue] of Object.entries(entry.metrics)) {
            const value = typeof rawValue === "string" ? parseFloat(rawValue) : rawValue;
            if (isNaN(value)) continue;
            updateBaseline(baselineStore, source.id, metricKey, value, new Date().toISOString());
            totalBaselinesUpdated++;
          }
        }
      } catch (err) {
        if (pretty) console.log(`   ❌ ${source.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (pretty) console.log("");
  }

  // Save baselines
  if (!dryRun && totalBaselinesUpdated > 0) {
    saveBaselines(baselinePath, baselineStore);
  }

  // Sort all signals by strength
  allSignals.sort((a, b) => b.strength - a.strength);

  // Convert to suggestions
  const suggestions = dryRun ? [] : signalsToSuggestions(allSignals, minStrength);

  // Output
  const result = {
    agent: agentName,
    intents: intents.length,
    sourcesFetched: totalFetched,
    signalsDetected: allSignals.length,
    suggestions: suggestions.length,
    baselinesUpdated: totalBaselinesUpdated,
    dryRun,
    signals: allSignals.map(s => ({
      source: s.source.name,
      type: s.rule.type,
      metric: s.rule.metric,
      strength: s.strength,
      currentValue: s.currentValue,
      baselineValue: s.baselineValue,
      changePercent: s.changePercent,
      summary: s.summary,
    })),
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (pretty) {
    console.log("─".repeat(50));
    console.log(`📊 Summary`);
    console.log(`   Sources fetched: ${totalFetched}`);
    console.log(`   Signals detected: ${allSignals.length}`);
    console.log(`   Suggestions generated: ${suggestions.length}`);
    console.log(`   Baselines updated: ${totalBaselinesUpdated}`);

    if (allSignals.length > 0) {
      console.log(`\n🏆 Top Signals:`);
      for (const s of allSignals.slice(0, 5)) {
        console.log(`   ${s.strength.toFixed(2)} │ [${s.rule.type}] ${s.summary}`);
      }
    }

    if (suggestions.length > 0) {
      console.log(`\n📝 Gate Suggestions:`);
      for (const s of suggestions.slice(0, 5)) {
        console.log(`   ${s.priority.toFixed(2)} │ [${s.category}] ${s.topic}`);
      }
    }
  }
}

main().catch(err => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
