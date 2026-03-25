#!/usr/bin/env npx tsx
/**
 * A/B review trial logger — tracks Fabric review_code vs /simplify effectiveness.
 *
 * Appends to ~/.config/demos/review-ab-trial.jsonl and provides summary stats.
 *
 * Usage:
 *   npx tsx scripts/log-review-trial.ts --tool fabric-review --findings 4 --duration 8 --unique "unused import,missing null check" --notes "found real bug"
 *   npx tsx scripts/log-review-trial.ts --summary
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types (exported for testing) ────────────────────

export interface ReviewTrialEntry {
  date: string;
  project: string;
  tier: "surgical" | "standard" | "complex";
  tool: "fabric-review" | "simplify";
  findings_count: number;
  unique_findings: string[];
  duration_minutes: number;
  notes?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ToolSummary {
  sessions: number;
  avgFindings: number;
  avgDuration: number;
  avgFindingsPerMinute: number;
  totalFindings: number;
}

export type SummaryResult = Record<"fabric-review" | "simplify", ToolSummary>;

// ── Validation ──────────────────────────────────────

const VALID_TOOLS = ["fabric-review", "simplify"] as const;
const VALID_TIERS = ["surgical", "standard", "complex"] as const;

export function validateTrialEntry(entry: ReviewTrialEntry): ValidationResult {
  const errors: string[] = [];

  if (!VALID_TOOLS.includes(entry.tool as any)) {
    errors.push("tool must be 'fabric-review' or 'simplify'");
  }
  if (!VALID_TIERS.includes(entry.tier as any)) {
    errors.push("tier must be 'surgical', 'standard', or 'complex'");
  }
  if (typeof entry.findings_count !== "number" || entry.findings_count < 0) {
    errors.push("findings_count must be a non-negative number");
  }
  if (typeof entry.duration_minutes !== "number" || entry.duration_minutes <= 0) {
    errors.push("duration_minutes must be a positive number");
  }
  if (!Array.isArray(entry.unique_findings)) {
    errors.push("unique_findings must be an array");
  }

  return { valid: errors.length === 0, errors };
}

// ── Summary ─────────────────────────────────────────

function emptyToolSummary(): ToolSummary {
  return { sessions: 0, avgFindings: 0, avgDuration: 0, avgFindingsPerMinute: 0, totalFindings: 0 };
}

export function calculateSummary(entries: ReviewTrialEntry[]): SummaryResult {
  const result: SummaryResult = {
    "fabric-review": emptyToolSummary(),
    "simplify": emptyToolSummary(),
  };

  for (const tool of VALID_TOOLS) {
    const toolEntries = entries.filter((e) => e.tool === tool);
    const count = toolEntries.length;
    if (count === 0) continue;

    const totalFindings = toolEntries.reduce((s, e) => s + e.findings_count, 0);
    const totalDuration = toolEntries.reduce((s, e) => s + e.duration_minutes, 0);

    result[tool] = {
      sessions: count,
      avgFindings: totalFindings / count,
      avgDuration: totalDuration / count,
      avgFindingsPerMinute: totalDuration > 0 ? totalFindings / totalDuration : 0,
      totalFindings,
    };
  }

  return result;
}

// ── File I/O ────────────────────────────────────────

const TRIAL_FILE = join(homedir(), ".config", "demos", "review-ab-trial.jsonl");

function readTrialEntries(): ReviewTrialEntry[] {
  if (!existsSync(TRIAL_FILE)) return [];
  const content = readFileSync(TRIAL_FILE, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line));
}

function appendTrialEntry(entry: ReviewTrialEntry): void {
  const dir = join(homedir(), ".config", "demos");
  mkdirSync(dir, { recursive: true });
  appendFileSync(TRIAL_FILE, JSON.stringify(entry) + "\n", { mode: 0o600 });
}

// ── CLI ─────────────────────────────────────────────

function parseCliArgs(): {
  summary: boolean;
  tool?: string;
  findings?: number;
  duration?: number;
  unique?: string;
  tier?: string;
  project?: string;
  notes?: string;
} {
  const args = process.argv.slice(2);
  const result: Record<string, any> = { summary: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--summary") {
      result.summary = true;
    } else if (args[i] === "--tool" && args[i + 1]) {
      result.tool = args[++i];
    } else if (args[i] === "--findings" && args[i + 1]) {
      result.findings = Number(args[++i]);
    } else if (args[i] === "--duration" && args[i + 1]) {
      result.duration = Number(args[++i]);
    } else if (args[i] === "--unique" && args[i + 1]) {
      result.unique = args[++i];
    } else if (args[i] === "--tier" && args[i + 1]) {
      result.tier = args[++i];
    } else if (args[i] === "--project" && args[i + 1]) {
      result.project = args[++i];
    } else if (args[i] === "--notes" && args[i + 1]) {
      result.notes = args[++i];
    }
  }

  return result;
}

async function main(): Promise<void> {
  const cli = parseCliArgs();

  if (cli.summary) {
    const entries = readTrialEntries();
    const summary = calculateSummary(entries);

    console.log("\nA/B Review Trial Summary");
    console.log("=".repeat(50));

    for (const [tool, stats] of Object.entries(summary)) {
      console.log(`\n  ${tool}:`);
      console.log(`    Sessions: ${stats.sessions}`);
      console.log(`    Avg findings: ${stats.avgFindings.toFixed(1)}`);
      console.log(`    Avg duration: ${stats.avgDuration.toFixed(1)} min`);
      console.log(`    Findings/min: ${stats.avgFindingsPerMinute.toFixed(2)}`);
      console.log(`    Total findings: ${stats.totalFindings}`);
    }

    console.log("\n" + "=".repeat(50));
    return;
  }

  // Log mode
  if (!cli.tool || cli.findings === undefined || !cli.duration) {
    console.error("Required: --tool, --findings, --duration");
    console.error("Optional: --unique, --tier, --project, --notes");
    console.error("Or use: --summary");
    process.exit(1);
  }

  const entry: ReviewTrialEntry = {
    date: new Date().toISOString().split("T")[0],
    project: cli.project || "demos-agents",
    tier: (cli.tier || "standard") as ReviewTrialEntry["tier"],
    tool: cli.tool as ReviewTrialEntry["tool"],
    findings_count: cli.findings,
    unique_findings: cli.unique ? cli.unique.split(",").map((s: string) => s.trim()) : [],
    duration_minutes: cli.duration,
    ...(cli.notes ? { notes: cli.notes } : {}),
  };

  const validation = validateTrialEntry(entry);
  if (!validation.valid) {
    console.error("Validation errors:");
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  appendTrialEntry(entry);
  console.log(`Logged: ${entry.tool} | ${entry.findings_count} findings | ${entry.duration_minutes} min`);
}

// Only run CLI when executed directly (not imported by tests)
const isDirectExecution = process.argv[1]?.includes("log-review-trial");
if (isDirectExecution) {
  main().catch((e) => {
    console.error(`FATAL: ${e.message}`);
    process.exit(1);
  });
}
