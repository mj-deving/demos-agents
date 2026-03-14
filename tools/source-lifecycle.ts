#!/usr/bin/env npx tsx
/**
 * Source Lifecycle CLI — evaluate and apply status transitions.
 *
 * Runs health tests on sources, updates ratings, and evaluates the
 * lifecycle state machine to recommend promotions/degradations.
 *
 * Usage:
 *   npx tsx tools/source-lifecycle.ts check --pretty           # dry-run all
 *   npx tsx tools/source-lifecycle.ts apply --pretty           # apply transitions
 *   npx tsx tools/source-lifecycle.ts check --quarantined --pretty  # promotions only
 *   npx tsx tools/source-lifecycle.ts check --provider coingecko --pretty
 *   npx tsx tools/source-lifecycle.ts check --json
 */

import { resolve } from "node:path";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { loadCatalog, type SourceRecordV2, type SourceStatus } from "./lib/sources/catalog.js";
import { testSource, filterSources } from "./lib/sources/health.js";
import {
  evaluateTransition,
  updateRating,
  applyTransitions,
  type TransitionResult,
} from "./lib/sources/lifecycle.js";

// ── Arg Parsing ──────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0]; // "check" or "apply"

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

if (!command || !["check", "apply"].includes(command)) {
  console.error("Usage: source-lifecycle.ts <check|apply> [--quarantined] [--provider NAME] [--pretty] [--json]");
  process.exit(1);
}

const provider = getFlag("provider");
const quarantined = hasFlag("quarantined");
const pretty = hasFlag("pretty");
const json = hasFlag("json");
const agent = getFlag("agent");
const delayMs = parseInt(getFlag("delay") || "200", 10);

// ── Load Catalog ─────────────────────────────────────

const catalogPath = resolve(import.meta.dirname || ".", "../sources/catalog.json");
const catalog = loadCatalog(catalogPath);

if (!catalog) {
  console.error("Failed to load catalog from", catalogPath);
  process.exit(1);
}

// ── Filter Sources ───────────────────────────────────

let allSources = catalog.sources as SourceRecordV2[];

if (agent) {
  allSources = allSources.filter((s) => {
    const agents = s.scope?.agents || s.scope?.importedFrom || [];
    return agents.some((a: string) => a.toLowerCase() === agent.toLowerCase());
  });
}

const sources = filterSources(allSources, { provider, quarantined });

if (sources.length === 0) {
  console.error("No sources matched the filter criteria.");
  process.exit(1);
}

// ── Run Lifecycle Check ──────────────────────────────

const transitionIcons: Record<string, string> = {
  active: "↑",
  degraded: "↓",
  stale: "⊘",
  deprecated: "✗",
};

async function runLifecycleCheck(): Promise<{
  transitions: TransitionResult[];
  updatedSources: SourceRecordV2[];
}> {
  const transitions: TransitionResult[] = [];
  const updatedSources: SourceRecordV2[] = [];

  for (const source of sources) {
    // Step 1: Test source health
    const testResult = await testSource(source);

    // Step 2: Update rating based on test result
    const withUpdatedRating = updateRating(source, testResult);

    // Step 3: Evaluate transition based on updated state
    const transition = evaluateTransition(withUpdatedRating, testResult);
    transitions.push(transition);
    updatedSources.push(withUpdatedRating);

    // Pretty-print transitions as they happen
    if (pretty && transition.newStatus !== null) {
      const icon = transitionIcons[transition.newStatus] || "?";
      const id = transition.sourceId.padEnd(30);
      const arrow = `${transition.currentStatus} → ${transition.newStatus}`;
      console.log(`  ${icon} ${id} ${arrow.padEnd(25)} ${transition.reason}`);
    }

    // Delay between sources
    if (sources.indexOf(source) < sources.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return { transitions, updatedSources };
}

async function main(): Promise<void> {
  const label = quarantined ? "quarantined" : provider ? `provider: ${provider}` : "all";

  if (pretty) {
    console.log(`\nSource Lifecycle ${command === "apply" ? "Apply" : "Check"} (${label}, ${sources.length} sources)`);
    console.log("─".repeat(80));
  }

  const { transitions, updatedSources } = await runLifecycleCheck();

  // Summary
  const changes = transitions.filter((t) => t.newStatus !== null);
  const statusCounts: Record<string, number> = {};
  for (const t of changes) {
    const key = `${t.currentStatus}→${t.newStatus}`;
    statusCounts[key] = (statusCounts[key] || 0) + 1;
  }

  if (pretty) {
    console.log("─".repeat(80));
    if (changes.length === 0) {
      console.log("No transitions needed.");
    } else {
      const parts = Object.entries(statusCounts).map(([k, v]) => `${v} ${k}`);
      console.log(`Summary: ${parts.join(", ")}. ${sources.length - changes.length} unchanged.`);
    }
  }

  if (json) {
    console.log(JSON.stringify({
      command,
      label,
      timestamp: new Date().toISOString(),
      evaluated: sources.length,
      transitions: changes,
      summary: statusCounts,
    }, null, 2));
  }

  // Apply transitions if command is "apply" and there are changes
  if (command === "apply" && changes.length > 0) {
    // Apply to full catalog (not just filtered sources)
    const fullSources = catalog!.sources as SourceRecordV2[];

    // First apply rating updates from health tests
    const ratingMap = new Map<string, SourceRecordV2>();
    for (const s of updatedSources) ratingMap.set(s.id, s);

    const withRatings = fullSources.map((s) => ratingMap.get(s.id) || s);

    // Then apply status transitions
    const withTransitions = applyTransitions(withRatings, changes);

    // Atomic write: temp file + rename
    const tmpPath = catalogPath + ".tmp";
    const catalogData = {
      ...catalog,
      generatedAt: new Date().toISOString(),
      sources: withTransitions,
    };
    writeFileSync(tmpPath, JSON.stringify(catalogData, null, 2) + "\n");
    renameSync(tmpPath, catalogPath);

    if (pretty) {
      console.log(`\nApplied ${changes.length} transitions to ${catalogPath}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(2);
});
