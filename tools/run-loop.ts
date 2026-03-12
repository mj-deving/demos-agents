#!/usr/bin/env npx tsx
/**
 * Lean autonomous orchestrator.
 *
 * Runs multiple agent sessions from a schedule string:
 *   --schedule sentinel:1,crawler:2
 *
 * Design:
 * - Sequential execution with per-session crash isolation
 * - JSON handoff between SCAN -> GATE -> PUBLISH
 * - Optional dry-run mode for planning/validation without side effects
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { runTool } from "./lib/subprocess.js";
import { loadAgentConfig } from "./lib/agent-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ── Types ──────────────────────────────────────────

interface ScheduleItem {
  agent: string;
  count: number;
}

interface SessionRun {
  agent: string;
  runIndex: number;
  status: "dry-run" | "ok" | "failed";
  phases: {
    audit?: string;
    scan?: string;
    engage?: string;
    gate?: string;
    publish?: string;
    verify?: string;
  };
  topics: string[];
  txHashes: string[];
  error?: string;
}

interface LoopOutput {
  timestamp: string;
  dryRun: boolean;
  schedule: ScheduleItem[];
  runs: SessionRun[];
  summary: {
    total: number;
    ok: number;
    dryRun: number;
    failed: number;
    published: number;
  };
}

// ── Arg Parsing ────────────────────────────────────

function parseArgs(): { flags: Record<string, string> } {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    }
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }

  return { flags };
}

function printHelp(): void {
  console.log(`
Run Loop — Lean Autonomous Orchestrator

USAGE:
  npx tsx tools/run-loop.ts --schedule sentinel:1,crawler:2 [flags]

FLAGS:
  --schedule SPEC    Required schedule spec: agent:count[,agent:count...]
  --env PATH         Path to .env file (default: .env)
  --dry-run          Plan only, no tool execution
  --pretty           Human-readable output
  --json             Compact single-line JSON output
  --help, -h         Show this help

EXAMPLES:
  npx tsx tools/run-loop.ts --schedule sentinel:1 --dry-run --pretty
  npx tsx tools/run-loop.ts --schedule sentinel:1,crawler:2 --env ~/.config/demos/credentials --json
`);
}

function parseSchedule(spec: string): ScheduleItem[] {
  if (!spec || !spec.trim()) {
    throw new Error("--schedule is required (e.g. sentinel:1,crawler:2)");
  }

  const items = spec.split(",").map((p) => p.trim()).filter(Boolean);
  if (items.length === 0) {
    throw new Error("Invalid --schedule: no items");
  }

  const parsed: ScheduleItem[] = [];
  for (const item of items) {
    const m = item.match(/^([a-z0-9-]+):(\d+)$/i);
    if (!m) {
      throw new Error(`Invalid schedule item "${item}" (expected agent:count)`);
    }
    const agent = m[1].toLowerCase();
    const count = Number(m[2]);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      throw new Error(`Invalid count for ${agent}: ${m[2]} (must be 1-20)`);
    }
    parsed.push({ agent, count });
  }

  return parsed;
}

// ── Helpers ────────────────────────────────────────

async function runJson(toolPath: string, args: string[]): Promise<any> {
  const result = await runTool(toolPath, args, {
    cwd: REPO_ROOT,
    timeout: 240_000,
  });

  const stdout = result.stdout.trim();
  if (!stdout) return {};

  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`${toolPath} returned non-JSON output`);
  }
}

function extractTopics(scan: any, fallbackTopics: string[]): string[] {
  const topics: string[] = [];

  const safe = (raw: string): string | null => {
    const t = raw.trim();
    if (!t) return null;
    // Guard subprocess arg parsing: "--help" as a topic would be parsed as a flag.
    if (t.startsWith("-")) return null;
    if (/[\r\n\0]/.test(t)) return null;
    if (t.length > 160) return null;
    return t;
  };

  const heatTopic = scan?.heat?.topic;
  if (typeof heatTopic === "string" && heatTopic.trim()) {
    const t = safe(heatTopic);
    if (t) topics.push(t);
  }

  const gaps = Array.isArray(scan?.gaps?.topics) ? scan.gaps.topics : [];
  for (const g of gaps) {
    if (typeof g === "string" && g.trim()) {
      const t = safe(g);
      if (t) topics.push(t);
    }
  }

  if (topics.length === 0) {
    for (const ft of fallbackTopics.slice(0, 3)) {
      const t = safe(ft);
      if (t) topics.push(t);
    }
  }

  const dedup: string[] = [];
  const seen = new Set<string>();
  for (const t of topics) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(t);
  }

  return dedup.slice(0, 3);
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const { flags } = parseArgs();

  const schedule = parseSchedule(flags["schedule"] || "");
  const envPath = flags["env"] || resolve(process.cwd(), ".env");
  const dryRun = flags["dry-run"] === "true";
  const pretty = flags["pretty"] === "true";
  const jsonMode = flags["json"] === "true";

  const runs: SessionRun[] = [];

  for (const item of schedule) {
    for (let i = 1; i <= item.count; i++) {
      const run: SessionRun = {
        agent: item.agent,
        runIndex: i,
        status: dryRun ? "dry-run" : "ok",
        phases: {},
        topics: [],
        txHashes: [],
      };

      runs.push(run);

      if (dryRun) {
        const cfg = loadAgentConfig(item.agent);
        run.topics = extractTopics({}, cfg.topics.primary);
        run.phases.audit = "planned";
        run.phases.scan = "planned";
        run.phases.engage = "planned";
        run.phases.gate = "planned";
        run.phases.publish = "planned";
        run.phases.verify = "planned";
        continue;
      }

      try {
        const cfg = loadAgentConfig(item.agent);

        const audit = await runJson("tools/audit.ts", ["--agent", item.agent, "--env", envPath, "--json"]);
        run.phases.audit = `ok (${audit?.stats?.total_entries ?? 0} entries)`;

        const scan = await runJson("tools/room-temp.ts", ["--agent", item.agent, "--env", envPath, "--json"]);
        run.phases.scan = `ok (${scan?.activity?.level || "unknown"})`;

        const engage = await runJson("tools/engage.ts", ["--agent", item.agent, "--env", envPath, "--max", String(cfg.engagement.maxReactionsPerSession), "--json"]);
        run.phases.engage = `ok (${engage?.reactions_cast ?? 0} reactions)`;

        const topics = extractTopics(scan, cfg.topics.primary);
        run.topics = topics;

        const tempDir = mkdtempSync(resolve(tmpdir(), "run-loop-"));
        const scanPath = resolve(tempDir, "scan.json");
        const scanCachePath = resolve(tempDir, "scan-cache.json");
        const gatedPath = resolve(tempDir, "gated.json");

        try {
          writeFileSync(scanPath, JSON.stringify(scan));
          writeFileSync(scanCachePath, JSON.stringify({ phases: { scan: { result: scan } } }));
          writeFileSync(gatedPath, JSON.stringify({ gated: [] }));

          // Re-run gate from JSON cache to preserve scan->gate->publish handoff explicitly.
          const gatedFinal: Array<{ topic: string; category: "ANALYSIS"; gateSummary: any }> = [];
          for (const topic of topics) {
            const gate = await runJson("tools/gate.ts", [
              "--agent", item.agent,
              "--topic", topic,
              "--category", "ANALYSIS",
              "--scan-cache", scanCachePath,
              "--env", envPath,
              "--json",
            ]);
            const fail = Number(gate?.summary?.fail || 0);
            if (fail === 0) {
              gatedFinal.push({ topic, category: "ANALYSIS", gateSummary: gate?.summary || {} });
            }
          }
          writeFileSync(gatedPath, JSON.stringify({ gated: gatedFinal }));
          run.phases.gate = `ok (${gatedFinal.length}/${topics.length} passed)`;

          if (gatedFinal.length === 0) {
            run.phases.publish = "skipped (no gated topics)";
            run.phases.verify = "skipped (no tx)";
            continue;
          }

          const publish = await runJson("tools/publish.ts", [
            "--agent", item.agent,
            "--gated-file", gatedPath,
            "--scan-file", scanPath,
            "--env", envPath,
            "--json",
          ]);

          const txHashes = Array.isArray(publish?.results)
            ? publish.results.filter((r: any) => r?.status === "published" && r?.txHash).map((r: any) => String(r.txHash))
            : [];

          run.txHashes = txHashes;
          run.phases.publish = `ok (${txHashes.length} published)`;

          if (txHashes.length > 0) {
            const verify = await runJson("tools/verify.ts", [
              ...txHashes,
              "--agent", item.agent,
              "--env", envPath,
              "--json",
            ]);
            run.phases.verify = `ok (${verify?.summary?.verified ?? 0}/${verify?.summary?.total ?? txHashes.length})`;
          } else {
            run.phases.verify = "skipped (no tx)";
          }
        } finally {
          rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (err: any) {
        run.status = "failed";
        run.error = err.message;
      }
    }
  }

  const output: LoopOutput = {
    timestamp: new Date().toISOString(),
    dryRun,
    schedule,
    runs,
    summary: {
      total: runs.length,
      ok: runs.filter((r) => r.status === "ok").length,
      dryRun: runs.filter((r) => r.status === "dry-run").length,
      failed: runs.filter((r) => r.status === "failed").length,
      published: runs.reduce((sum, r) => sum + r.txHashes.length, 0),
    },
  };

  if (pretty) {
    console.log("\n" + "═".repeat(72));
    console.log(`  RUN LOOP ${dryRun ? "(dry-run)" : ""}`);
    console.log("═".repeat(72));
    for (const r of runs) {
      console.log(`  - ${r.agent} #${r.runIndex}: ${r.status}`);
      if (r.topics.length > 0) console.log(`    topics: ${r.topics.join(", ")}`);
      if (r.txHashes.length > 0) console.log(`    tx: ${r.txHashes.map((t) => `${t.slice(0, 12)}...`).join(", ")}`);
      if (r.error) console.log(`    error: ${r.error}`);
    }
    console.log(`\n  Summary: ${output.summary.ok} ok, ${output.summary.dryRun} dry-run, ${output.summary.failed} failed, ${output.summary.published} published`);
    console.log("═".repeat(72));
  } else if (jsonMode) {
    console.log(JSON.stringify(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }

  if (!dryRun && output.summary.failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[run-loop] ERROR: ${err.message}`);
  process.exit(1);
});
