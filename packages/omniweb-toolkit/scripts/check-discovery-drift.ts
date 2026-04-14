#!/usr/bin/env npx tsx
/**
 * check-discovery-drift.ts — Compare live discovery resources against committed snapshots.
 *
 * AgentSkills spec: non-interactive, structured output, --help, deterministic.
 *
 * Output: JSON report to stdout.
 * Exit codes: 0 = all resources match, 1 = drift or fetch problem, 2 = invalid args.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_BASE_URL,
  DEFAULT_SNAPSHOT_DIR,
  fetchText,
  getNumberArg,
  getStringArg,
  hasFlag,
  normalizeBody,
} from "./_shared.js";

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/check-discovery-drift.ts [--base-url URL] [--snapshot-dir PATH] [--timeout-ms N]

Options:
  --base-url URL      SuperColony base URL (default: ${DEFAULT_BASE_URL})
  --snapshot-dir PATH Snapshot directory (default: ${DEFAULT_SNAPSHOT_DIR})
  --timeout-ms N      Request timeout in milliseconds (default: 15000)
  --help, -h          Show this help

Output: JSON report comparing live resources against committed snapshots
Exit codes: 0 = all match, 1 = drift or fetch error, 2 = invalid args`);
  process.exit(0);
}

const baseUrl = getStringArg(args, "--base-url") ?? DEFAULT_BASE_URL;
const snapshotDir = resolve(getStringArg(args, "--snapshot-dir") ?? DEFAULT_SNAPSHOT_DIR);
const timeoutMs = getNumberArg(args, "--timeout-ms") ?? 15_000;

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("Error: --timeout-ms must be a positive number");
  process.exit(2);
}

if (!existsSync(snapshotDir)) {
  console.error(`Error: snapshot directory not found: ${snapshotDir}`);
  process.exit(2);
}

const resources = [
  { path: "/llms-full.txt", snapshot: "llms-full.txt" },
  { path: "/openapi.json", snapshot: "openapi.json" },
  { path: "/.well-known/ai-plugin.json", snapshot: "ai-plugin.json" },
  { path: "/.well-known/agents.json", snapshot: "agents.json" },
  { path: "/.well-known/agent.json", snapshot: "agent.json" },
];

const checkedAt = new Date().toISOString();
const results = [];

for (const resource of resources) {
  const snapshotPath = resolve(snapshotDir, resource.snapshot);
  const snapshotExists = existsSync(snapshotPath);
  const snapshotBody = snapshotExists ? readFileSync(snapshotPath, "utf8") : "";
  const live = await fetchText(resource.path, { baseUrl, timeoutMs });

  const normalizedSnapshot = snapshotExists
    ? normalizeBody(resource.snapshot, snapshotBody)
    : null;
  const normalizedLive = live.status !== 0
    ? normalizeBody(resource.snapshot, live.body)
    : null;

  const status = !snapshotExists
    ? "missing_snapshot"
    : live.status === 0
      ? "fetch_failed"
      : normalizedSnapshot === normalizedLive
        ? "match"
        : "drift";

  results.push({
    path: resource.path,
    snapshot: snapshotPath,
    httpStatus: live.status,
    status,
    error: live.error,
  });
}

const ok = results.every((result) => result.status === "match");

console.log(JSON.stringify({
  checkedAt,
  baseUrl,
  snapshotDir,
  ok,
  resources: results,
}, null, 2));

process.exit(ok ? 0 : 1);
