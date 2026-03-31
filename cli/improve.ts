#!/usr/bin/env npx tsx
/**
 * Improve Skill — On-demand observation processor
 *
 * Reads observations.jsonl, groups by fingerprint into issues,
 * classifies via LLM, proposes improvements, and integrates
 * with the existing improvements.ts tracker.
 *
 * NOT a loop phase — invoked manually when operator wants to improve.
 *
 * Usage:
 *   npx tsx tools/improve.ts --agent sentinel --pretty
 *   npx tsx tools/improve.ts --agent sentinel --since 5 --pretty
 *   npx tsx tools/improve.ts --agent sentinel --unresolved --pretty
 *   npx tsx tools/improve.ts --agent sentinel --trace obs-15-1773404767-0ee4
 *   npx tsx tools/improve.ts --agent sentinel --auto-apply --dry-run --pretty
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { info, setLogAgent } from "../src/lib/network/sdk.js";
import { resolveAgentName, loadAgentConfig } from "../src/lib/agent-config.js";
import { resolveProvider } from "../src/lib/llm/llm-provider.js";
import type { Observation, ObservationType } from "../src/lib/pipeline/observe.js";

// ── Types ──────────────────────────────────────────

type IssueCategory = "CODE-FIX" | "GUARDRAIL" | "STRATEGY" | "INFO";

interface Issue {
  fingerprint: string;
  type: ObservationType;
  observations: Observation[];
  count: number;
  firstSeen: string;
  lastSeen: string;
  sessions: number[];
  category?: IssueCategory;
  proposal?: string;
  resolved: boolean;
}

interface ClassifyResult {
  category: IssueCategory;
  proposal: string;
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
Improve Skill — On-demand observation processor

USAGE:
  npx tsx tools/improve.ts [flags]

FLAGS:
  --agent NAME           Agent name (default: sentinel)
  --since N              Only include observations from last N sessions (default: all)
  --unresolved           Only show unresolved observations
  --trace OBS_ID         Show observation history for a specific observation ID
  --auto-apply           Auto-propose improvements for CODE-FIX and GUARDRAIL issues
  --dry-run              Show what would be proposed without writing to improvements tracker
  --env PATH             Path to .env file (default: .env in cwd)
  --pretty               Human-readable output
  --json                 Compact JSON output
  --help, -h             Show this help

EXAMPLES:
  npx tsx tools/improve.ts --agent sentinel --pretty
  npx tsx tools/improve.ts --agent sentinel --since 5 --pretty
  npx tsx tools/improve.ts --agent sentinel --unresolved --pretty
  npx tsx tools/improve.ts --agent sentinel --trace obs-15-1773404767-0ee4
  npx tsx tools/improve.ts --agent sentinel --auto-apply --dry-run --pretty
`);
}

// ── Observation I/O ────────────────────────────────

function loadObservations(agentName: string): Observation[] {
  const obsPath = resolve(homedir(), `.${agentName}`, "observations.jsonl");
  if (!existsSync(obsPath)) return [];

  const lines = readFileSync(obsPath, "utf-8").split("\n").filter(Boolean);
  const observations: Observation[] = [];
  for (const line of lines) {
    try {
      observations.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }
  return observations;
}

function saveObservations(agentName: string, observations: Observation[]): void {
  const obsPath = resolve(homedir(), `.${agentName}`, "observations.jsonl");
  const content = observations.map(o => JSON.stringify(o)).join("\n") + "\n";
  writeFileSync(obsPath, content);
}

// ── Fingerprinting ─────────────────────────────────

/**
 * Normalize observation text for fingerprint grouping.
 * Strips numbers, URLs, hashes, and lowercases — groups observations
 * that differ only in specific values.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, "<url>")      // URLs
    .replace(/[0-9a-f]{8,}/g, "<hash>")           // hex hashes
    .replace(/\d+(\.\d+)?/g, "<n>")               // numbers
    .replace(/obs-[^\s]+/g, "<obs-id>")            // observation IDs
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(obs: Observation): string {
  return `${obs.type}::${normalizeText(obs.text)}`;
}

// ── Grouping ───────────────────────────────────────

function groupIntoIssues(observations: Observation[], windowSessions?: number): Issue[] {
  const groups = new Map<string, Observation[]>();

  for (const obs of observations) {
    const fp = fingerprint(obs);
    const existing = groups.get(fp) || [];
    existing.push(obs);
    groups.set(fp, existing);
  }

  const issues: Issue[] = [];
  for (const [fp, obsGroup] of groups) {
    const sessions = [...new Set(obsGroup.map(o => o.session))].sort((a, b) => a - b);

    // Window filter: only include if any observation is within the session window
    if (windowSessions !== undefined) {
      const maxSession = Math.max(...observations.map(o => o.session));
      const minAllowed = maxSession - windowSessions + 1;
      if (!sessions.some(s => s >= minAllowed)) continue;
    }

    const resolved = obsGroup.every(o => o.resolved !== null);

    issues.push({
      fingerprint: fp,
      type: obsGroup[0].type,
      observations: obsGroup.sort((a, b) => a.ts.localeCompare(b.ts)),
      count: obsGroup.length,
      firstSeen: obsGroup.reduce((min, o) => o.ts < min ? o.ts : min, obsGroup[0].ts),
      lastSeen: obsGroup.reduce((max, o) => o.ts > max ? o.ts : max, obsGroup[0].ts),
      sessions,
      resolved,
    });
  }

  // Sort by count descending (most frequent issues first), then by recency
  return issues.sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));
}

// ── LLM Classification ────────────────────────────

async function classifyIssue(issue: Issue, envPath?: string): Promise<ClassifyResult> {
  const provider = resolveProvider(envPath);
  if (!provider) {
    // Fallback: heuristic classification without LLM
    return heuristicClassify(issue);
  }

  const exampleTexts = issue.observations
    .slice(0, 5)
    .map(o => `  [${o.ts}] session=${o.session} phase=${o.phase}: ${o.text}`)
    .join("\n");

  const prompt = `You are classifying an agent observation issue. The issue has occurred ${issue.count} time(s) across sessions [${issue.sessions.join(", ")}].

Type: ${issue.type}
Fingerprint: ${issue.fingerprint}
Example observations:
${exampleTexts}

Classify this issue into exactly ONE category and propose a fix:

Categories:
- CODE-FIX: A bug or code issue that can be fixed with a specific code change
- GUARDRAIL: A missing safety check, timeout, or validation that should be added
- STRATEGY: A strategic decision about agent behavior (requires operator approval)
- INFO: Informational observation, no action needed

Respond in this exact JSON format (no markdown, no extra text):
{"category": "CODE-FIX|GUARDRAIL|STRATEGY|INFO", "proposal": "specific actionable description of what to change"}`;

  try {
    const response = await provider.complete(prompt, {
      system: "You are a concise technical analyst. Respond only with the requested JSON.",
      maxTokens: 256,
      modelTier: "fast",
    });

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonStr = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    const validCategories: IssueCategory[] = ["CODE-FIX", "GUARDRAIL", "STRATEGY", "INFO"];
    if (!validCategories.includes(parsed.category)) {
      return heuristicClassify(issue);
    }

    return {
      category: parsed.category,
      proposal: String(parsed.proposal || "No proposal"),
    };
  } catch {
    return heuristicClassify(issue);
  }
}

function heuristicClassify(issue: Issue): ClassifyResult {
  // Simple heuristic when LLM is unavailable
  if (issue.type === "error") {
    const text = issue.observations[0].text.toLowerCase();
    if (text.includes("timeout")) {
      return { category: "GUARDRAIL", proposal: `Recurring timeout (${issue.count}x): investigate infrastructure or increase timeout` };
    }
    if (text.includes("http") || text.includes("status")) {
      return { category: "CODE-FIX", proposal: `HTTP error pattern (${issue.count}x): add error handling or fix source URL` };
    }
    return { category: "CODE-FIX", proposal: `Recurring error (${issue.count}x): ${issue.observations[0].text}` };
  }
  if (issue.type === "inefficiency") {
    return { category: "STRATEGY", proposal: `Inefficiency detected (${issue.count}x): ${issue.observations[0].text}` };
  }
  if (issue.type === "source-issue") {
    return { category: "GUARDRAIL", proposal: `Source issue (${issue.count}x): ${issue.observations[0].text}` };
  }
  return { category: "INFO", proposal: issue.observations[0].text };
}

// ── Improvements Integration ───────────────────────

import { isDuplicate, type ImprovementsFile } from "../src/lib/improvement-utils.js";

function loadImprovements(agentName: string): ImprovementsFile {
  const filePath = resolve(homedir(), `.${agentName}-improvements.json`);
  if (!existsSync(filePath)) {
    return { version: 1, nextSession: 1, nextSequence: {}, items: [] };
  }
  const data = JSON.parse(readFileSync(filePath, "utf-8"));
  if (!data.version || !Array.isArray(data.items)) {
    throw new Error(`Malformed improvements file at ${filePath} — missing version or items array. Fix manually or delete to reset.`);
  }
  if (!data.nextSequence) data.nextSequence = {};
  return data;
}

function saveImprovements(agentName: string, data: ImprovementsFile): void {
  const filePath = resolve(homedir(), `.${agentName}-improvements.json`);
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function proposeImprovement(
  data: ImprovementsFile,
  issue: Issue,
  category: IssueCategory
): string | null {
  const description = issue.proposal || issue.observations[0].text;

  // Dedup check — skip if an active item with the same normalized description exists
  const { duplicate, existingId } = isDuplicate(data.items, description);
  if (duplicate) return null;

  const session = data.nextSession;
  const key = String(session);
  const seq = (data.nextSequence[key] || 0) + 1;
  data.nextSequence[key] = seq;
  const id = `IMP-${session}-${seq}`;

  data.items.push({
    id,
    session,
    timestamp: new Date().toISOString(),
    source: `improve:${category}`,
    description: issue.proposal || issue.observations[0].text,
    target: issue.observations[0].source || "unknown",
    status: "proposed",
    evidence: [
      `${issue.count} observations across sessions [${issue.sessions.join(", ")}]`,
      `First seen: ${issue.firstSeen}`,
      `Last seen: ${issue.lastSeen}`,
      `Fingerprint: ${issue.fingerprint}`,
    ],
    history: [{ action: "proposed", timestamp: new Date().toISOString(), detail: `improve skill auto-classified as ${category}` }],
  });

  return id;
}

// ── Resolution ─────────────────────────────────────

function markResolved(observations: Observation[], issue: Issue, improvementId: string): void {
  const resolved = new Date().toISOString();
  for (const obs of observations) {
    if (issue.observations.some(io => io.id === obs.id)) {
      obs.resolved = `${resolved}::${improvementId}`;
    }
  }
}

// ── Output ─────────────────────────────────────────

function formatIssue(issue: Issue, index: number, pretty: boolean): string {
  if (!pretty) return JSON.stringify(issue);

  const lines: string[] = [];
  const status = issue.resolved ? "✅ RESOLVED" : "⚠️  OPEN";
  lines.push(`  ${index + 1}. [${status}] ${issue.type.toUpperCase()} (${issue.count}x, sessions ${issue.sessions.join(",")})`);
  lines.push(`     Fingerprint: ${issue.fingerprint.slice(0, 80)}`);
  if (issue.category) {
    lines.push(`     Category: ${issue.category}`);
  }
  if (issue.proposal) {
    lines.push(`     Proposal: ${issue.proposal}`);
  }
  lines.push(`     Latest: ${issue.observations[issue.observations.length - 1].text.slice(0, 120)}`);
  return lines.join("\n");
}

// ── Commands ───────────────────────────────────────

async function cmdDefault(
  agentName: string,
  flags: Record<string, string>
): Promise<void> {
  const pretty = flags["pretty"] === "true";
  const jsonOutput = flags["json"] === "true";
  const since = flags["since"] ? parseInt(flags["since"], 10) : undefined;
  const unresolvedOnly = flags["unresolved"] === "true";
  const autoApply = flags["auto-apply"] === "true";
  const dryRun = flags["dry-run"] === "true";
  const envPath = flags["env"] || resolve(process.cwd(), ".env");

  const allObservations = loadObservations(agentName);
  if (allObservations.length === 0) {
    if (pretty) console.log("  No observations found. Run a session first.");
    else console.log(JSON.stringify({ issues: [], total: 0 }));
    return;
  }

  // Filter for display/classification — keep allObservations intact for saving
  let filtered = allObservations;
  if (since !== undefined) {
    const maxSession = Math.max(...allObservations.map(o => o.session));
    const minSession = maxSession - since + 1;
    filtered = filtered.filter(o => o.session >= minSession);
  }
  if (unresolvedOnly) {
    filtered = filtered.filter(o => o.resolved === null);
  }

  // Group into issues
  const issues = groupIntoIssues(filtered, since);

  if (issues.length === 0) {
    if (pretty) console.log("  No issues found.");
    else console.log(JSON.stringify({ issues: [], total: 0 }));
    return;
  }

  // Classify each issue via LLM
  info(`Classifying ${issues.length} issue(s)...`);
  for (const issue of issues) {
    const result = await classifyIssue(issue, envPath);
    issue.category = result.category;
    issue.proposal = result.proposal;
  }

  // Display results
  if (pretty) {
    console.log(`\n  Improve Report — ${agentName}`);
    console.log(`  ${filtered.length} observations → ${issues.length} issue(s)\n`);

    for (let i = 0; i < issues.length; i++) {
      console.log(formatIssue(issues[i], i, true));
    }

    const byCat = { "CODE-FIX": 0, "GUARDRAIL": 0, "STRATEGY": 0, "INFO": 0 };
    for (const issue of issues) {
      if (issue.category) byCat[issue.category]++;
    }
    console.log(`\n  Summary: ${byCat["CODE-FIX"]} code-fix, ${byCat["GUARDRAIL"]} guardrail, ${byCat["STRATEGY"]} strategy, ${byCat["INFO"]} info`);
  } else if (jsonOutput) {
    console.log(JSON.stringify({ total: issues.length, issues }));
  } else {
    console.log(JSON.stringify({ total: issues.length, issues }, null, 2));
  }

  // Auto-apply: propose improvements for actionable categories
  if (autoApply) {
    const actionable = issues.filter(i => i.category === "CODE-FIX" || i.category === "GUARDRAIL");
    if (actionable.length === 0) {
      if (pretty) console.log("\n  No actionable issues (CODE-FIX or GUARDRAIL) to propose.");
      return;
    }

    const improvements = loadImprovements(agentName);
    const proposed: string[] = [];

    for (const issue of actionable) {
      if (issue.resolved) continue; // already resolved

      if (dryRun) {
        if (pretty) console.log(`\n  [DRY-RUN] Would propose: ${issue.category} — ${issue.proposal}`);
        continue;
      }

      const id = proposeImprovement(improvements, issue, issue.category!);
      if (!id) {
        if (pretty) console.log(`  Skipped: could not propose improvement for ${issue.category}`);
        continue;
      }
      markResolved(allObservations, issue, id);
      proposed.push(id);
      if (pretty) console.log(`\n  Proposed ${id}: ${issue.category} — ${issue.proposal}`);
    }

    if (!dryRun && proposed.length > 0) {
      saveImprovements(agentName, improvements);
      saveObservations(agentName, allObservations);
      if (pretty) console.log(`\n  ✓ ${proposed.length} improvement(s) proposed: ${proposed.join(", ")}`);
    }
  }
}

function cmdTrace(agentName: string, obsId: string, pretty: boolean): void {
  const observations = loadObservations(agentName);
  const target = observations.find(o => o.id === obsId);

  if (!target) {
    console.error(`Observation ${obsId} not found`);
    process.exit(1);
  }

  // Find all related observations (same fingerprint)
  const fp = fingerprint(target);
  const related = observations.filter(o => fingerprint(o) === fp);

  if (pretty) {
    console.log(`\n  Trace: ${obsId}`);
    console.log(`  Fingerprint: ${fp}`);
    console.log(`  Related observations: ${related.length}\n`);

    for (const obs of related) {
      const marker = obs.id === obsId ? "→" : " ";
      const resolved = obs.resolved ? ` [resolved: ${obs.resolved}]` : "";
      console.log(`  ${marker} ${obs.id} | session=${obs.session} phase=${obs.phase} | ${obs.text.slice(0, 100)}${resolved}`);
    }
  } else {
    console.log(JSON.stringify({ target, fingerprint: fp, related }, null, 2));
  }
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const { flags } = parseArgs();
  const agentName = resolveAgentName(flags);
  setLogAgent(agentName);

  const pretty = flags["pretty"] === "true";

  // Trace mode
  if (flags["trace"]) {
    cmdTrace(agentName, flags["trace"], pretty);
    return;
  }

  // Default: classify and report
  await cmdDefault(agentName, flags);
}

main().catch((err) => {
  console.error(`[improve] FATAL: ${err.message}`);
  process.exit(1);
});
