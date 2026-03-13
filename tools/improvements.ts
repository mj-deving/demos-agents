#!/usr/bin/env npx tsx
/**
 * Pending Improvements CRUD — Sentinel Phase 2 tool
 *
 * Maps to strategy.yaml REVIEW phase + AGENT.yaml selfImprovement section.
 * Manages the lifecycle: proposed → approved → applied → verified.
 * Hard errors on invalid state transitions.
 *
 * Storage: single JSON envelope at ~/.sentinel-improvements.json
 *   { version, nextSession, nextSequence, items[] }
 *
 * Usage:
 *   npx tsx tools/improvements.ts <command> [flags]
 *
 * Commands:
 *   list                     List all improvements
 *   propose <desc>           Propose a new improvement
 *   approve <id>             Approve a proposed improvement
 *   apply <id>               Mark as applied (implementation done)
 *   verify <id>              Verify with evidence
 *   reject <id> <reason>     Reject an improvement
 *   session                  Show/increment current session number
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { info, setLogAgent } from "./lib/sdk.js";
import { resolveAgentName, loadAgentConfig } from "./lib/agent-config.js";

// ── Constants ──────────────────────────────────────

const DEFAULT_FILE = resolve(homedir(), ".sentinel-improvements.json");

// ── Types ──────────────────────────────────────────

interface HistoryEntry {
  action: string;
  timestamp: string;
  detail?: string;
}

interface Improvement {
  id: string;
  session: number;
  timestamp: string;
  source: string;
  description: string;
  target: string;
  status: "proposed" | "approved" | "applied" | "verified" | "rejected";
  evidence: string[];
  history: HistoryEntry[];
}

interface ImprovementsFile {
  version: number;
  nextSession: number;
  nextSequence: Record<string, number>;
  items: Improvement[];
}

// ── Valid Transitions ──────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  proposed: ["approved", "rejected"],
  approved: ["applied"],
  applied: ["verified", "rejected"],
};

function assertTransition(current: string, target: string, id: string): void {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.includes(target)) {
    console.error(`[improvements] ERROR: Invalid transition ${current} → ${target} for ${id}`);
    console.error(`  Valid transitions from "${current}": ${allowed ? allowed.join(", ") : "none (terminal state)"}`);
    process.exit(1);
  }
}

// ── File I/O ───────────────────────────────────────

function loadFile(filePath: string): ImprovementsFile {
  if (!existsSync(filePath)) {
    return { version: 1, nextSession: 1, nextSequence: {}, items: [] };
  }
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!data.version || !Array.isArray(data.items)) {
      throw new Error("Invalid improvements file format — missing version or items array");
    }
    // Ensure nextSequence exists (forward compat for older files)
    if (!data.nextSequence || typeof data.nextSequence !== "object") {
      data.nextSequence = {};
    }
    if (!data.nextSession || typeof data.nextSession !== "number") {
      data.nextSession = 1;
    }
    return data;
  } catch (err: any) {
    if (err.message.includes("Invalid improvements")) throw err;
    throw new Error(`Failed to parse ${filePath}: ${err.message}`);
  }
}

function saveFile(data: ImprovementsFile, filePath: string): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

// ── ID Generation ──────────────────────────────────

function nextId(data: ImprovementsFile, session: number): string {
  const key = String(session);
  const seq = (data.nextSequence[key] || 0) + 1;
  data.nextSequence[key] = seq;
  return `IMP-${session}-${seq}`;
}

// ── Arg Parsing ────────────────────────────────────

function parseArgs(): { command: string; positional: string[]; flags: Record<string, string> } {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  let command = "";

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
    } else if (!command) {
      command = args[i];
    } else {
      positional.push(args[i]);
    }
  }

  return { command, positional, flags };
}

function printHelp(): void {
  console.log(`
Pending Improvements CRUD — Sentinel REVIEW phase tool

USAGE:
  npx tsx tools/improvements.ts <command> [flags]

COMMANDS:
  list                     List all improvements
  propose <desc>           Propose a new improvement
  approve <id>             Approve a proposed improvement
  apply <id>               Mark as applied
  verify <id>              Verify with evidence
  reject <id> <reason>     Reject an improvement
  session                  Show current session number
  session next             Increment session number

FLAGS:
  --agent NAME             Agent name (default: sentinel)
  --file PATH              Improvements file (default: ~/.{agent}-improvements.json)
  --status STATUS          Filter list (proposed/approved/applied/verified/rejected)
  --evidence TEXT          Evidence text for propose/verify
  --target TEXT            Target file/system for propose
  --source TEXT            Source question (Q1-Q4) for propose
  --session N              Override session number for propose
  --pretty                 Human-readable output
  --json                   Compact single-line JSON output
  --help, -h               Show this help

EXAMPLES:
  npx tsx tools/improvements.ts list --pretty
  npx tsx tools/improvements.ts propose "Add --max flag to react script" --evidence "49 reactions last session" --target "react-to-posts.ts" --source "Q2"
  npx tsx tools/improvements.ts approve IMP-7-1
  npx tsx tools/improvements.ts verify IMP-7-1 --evidence "5 reactions vs 49 last session"
  npx tsx tools/improvements.ts reject IMP-7-2 "Not reproducible"
  npx tsx tools/improvements.ts session next
`);
}

// ── Commands ───────────────────────────────────────

function cmdList(data: ImprovementsFile, flags: Record<string, string>): void {
  let items = data.items;
  if (flags["status"]) {
    items = items.filter(i => i.status === flags["status"]);
  }

  output({ session: data.nextSession, total: data.items.length, filtered: items.length, items }, flags);
}

function cmdPropose(
  data: ImprovementsFile,
  description: string,
  flags: Record<string, string>,
  filePath: string
): void {
  if (!description) {
    console.error("[improvements] ERROR: propose requires a description argument");
    process.exit(1);
  }
  const evidence = flags["evidence"];
  const target = flags["target"];
  if (!evidence || !target) {
    console.error("[improvements] ERROR: propose requires --evidence and --target flags");
    process.exit(1);
  }

  const session = flags["session"] ? parseInt(flags["session"], 10) : data.nextSession;
  if (!Number.isFinite(session) || session < 1) {
    console.error("[improvements] ERROR: invalid session number");
    process.exit(1);
  }

  const id = nextId(data, session);
  const now = new Date().toISOString();

  const item: Improvement = {
    id,
    session,
    timestamp: now,
    source: flags["source"] || "",
    description,
    target,
    status: "proposed",
    evidence: [evidence],
    history: [{ action: "proposed", timestamp: now }],
  };

  data.items.push(item);
  saveFile(data, filePath);
  info(`Proposed ${id}: "${description}"`);
  output(item, flags);
}

function cmdTransition(
  data: ImprovementsFile,
  id: string,
  targetStatus: "approved" | "applied" | "verified" | "rejected",
  flags: Record<string, string>,
  positional: string[],
  filePath: string
): void {
  if (!id) {
    console.error(`[improvements] ERROR: ${targetStatus} requires an improvement ID`);
    process.exit(1);
  }

  const item = data.items.find(i => i.id === id);
  if (!item) {
    console.error(`[improvements] ERROR: improvement ${id} not found`);
    process.exit(1);
  }

  assertTransition(item.status, targetStatus, id);

  // Require evidence for verify, reason for reject
  if (targetStatus === "verified" && !flags["evidence"]) {
    console.error("[improvements] ERROR: verify requires --evidence flag");
    process.exit(1);
  }
  if (targetStatus === "rejected" && !positional[0] && !flags["reason"]) {
    console.error("[improvements] ERROR: reject requires a reason argument or --reason flag");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const detail = targetStatus === "rejected"
    ? (positional.join(" ") || flags["reason"] || "")
    : targetStatus === "verified"
      ? (flags["evidence"] || "")
      : undefined;

  if (targetStatus === "verified" && flags["evidence"]) {
    item.evidence.push(flags["evidence"]);
  }

  item.status = targetStatus;
  item.history.push({ action: targetStatus, timestamp: now, detail });

  saveFile(data, filePath);
  info(`${id} → ${targetStatus}${detail ? ": " + detail : ""}`);
  output(item, flags);
}

function cmdSession(data: ImprovementsFile, positional: string[], flags: Record<string, string>, filePath: string): void {
  if (positional[0] === "next") {
    data.nextSession++;
    saveFile(data, filePath);
    info(`Session incremented to ${data.nextSession}`);
  }
  output({ currentSession: data.nextSession, date: new Date().toISOString().slice(0, 10) }, flags);
}

// ── Output ─────────────────────────────────────────

function output(data: any, flags: Record<string, string>): void {
  if (flags["pretty"] === "true") {
    prettyPrint(data);
  } else if (flags["json"] === "true") {
    console.log(JSON.stringify(data));
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

function prettyPrint(data: any): void {
  // Single item
  if (data.id && data.status) {
    const item = data as Improvement;
    console.log(`\n  ${item.id} [${item.status.toUpperCase()}] (session ${item.session})`);
    console.log(`    ${item.description}`);
    console.log(`    Target: ${item.target}`);
    if (item.source) console.log(`    Source: ${item.source}`);
    console.log(`    Evidence: ${item.evidence.join("; ")}`);
    console.log(`    History: ${item.history.map(h => h.action).join(" → ")}`);
    console.log();
    return;
  }

  // Session info
  if (data.currentSession !== undefined) {
    console.log(`\n  Current session: ${data.currentSession} (${data.date})\n`);
    return;
  }

  // List
  if (data.items !== undefined) {
    console.log(`\nIMPROVEMENTS — Session ${data.session} (${data.total} total, ${data.filtered} shown)\n`);
    if (data.items.length === 0) {
      console.log("  (none)\n");
      return;
    }

    // Group by status
    const groups: Record<string, Improvement[]> = {};
    for (const item of data.items as Improvement[]) {
      if (!groups[item.status]) groups[item.status] = [];
      groups[item.status].push(item);
    }

    const statusOrder = ["proposed", "approved", "applied", "verified", "rejected"];
    for (const status of statusOrder) {
      const items = groups[status];
      if (!items || items.length === 0) continue;
      console.log(`  ${status.toUpperCase()} (${items.length}):`);
      for (const item of items) {
        console.log(`    ${item.id}: ${item.description}`);
        console.log(`      Target: ${item.target} | Evidence: ${item.evidence[0] || "none"}`);
      }
      console.log();
    }
  }
}

// ── Main ───────────────────────────────────────────

function main(): void {
  const { command, positional, flags } = parseArgs();
  const agentName = resolveAgentName(flags);
  setLogAgent(agentName);
  const config = loadAgentConfig(agentName);
  const filePath = flags["file"]
    ? resolve(flags["file"].replace(/^~/, homedir()))
    : config.paths.improvementsFile;

  if (!command) {
    printHelp();
    process.exit(1);
  }

  const data = loadFile(filePath);

  switch (command) {
    case "list":
      cmdList(data, flags);
      break;
    case "propose":
      cmdPropose(data, positional[0] || "", flags, filePath);
      break;
    case "approve":
      cmdTransition(data, positional[0] || "", "approved", flags, positional.slice(1), filePath);
      break;
    case "apply":
      cmdTransition(data, positional[0] || "", "applied", flags, positional.slice(1), filePath);
      break;
    case "verify":
      cmdTransition(data, positional[0] || "", "verified", flags, positional.slice(1), filePath);
      break;
    case "reject":
      cmdTransition(data, positional[0] || "", "rejected", flags, positional.slice(1), filePath);
      break;
    case "session":
      cmdSession(data, positional, flags, filePath);
      break;
    default:
      console.error(`[improvements] ERROR: unknown command "${command}"`);
      printHelp();
      process.exit(1);
  }
}

main();
