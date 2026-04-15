#!/usr/bin/env npx tsx
/**
 * check-trajectory-examples.ts — Verify that packaged trajectory example traces score successfully.
 *
 * Output: JSON report to stdout.
 * Exit codes: 0 = all examples pass, 1 = one or more examples fail, 2 = invalid args
 */

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx evals/check-trajectory-examples.ts

Checks every packaged *.trace.json example in evals/examples/ by scoring it with
evals/run-trajectories.ts.

Output: JSON report listing each example trace and whether it passed
Exit codes: 0 = all examples pass, 1 = one or more examples fail, 2 = invalid args`);
  process.exit(0);
}

const packageRoot = resolve(import.meta.dirname, "..");
const examplesDir = resolve(packageRoot, "evals", "examples");
const runnerPath = resolve(packageRoot, "evals", "run-trajectories.ts");

const traces = readdirSync(examplesDir)
  .filter((name) => name.endsWith(".trace.json"))
  .sort();

const results = traces.map((name) => {
  const tracePath = resolve(examplesDir, name);
  const traceDoc = JSON.parse(readFileSync(tracePath, "utf8")) as { scenarios?: Array<{ id?: string }> };
  const scenarioIds = Array.isArray(traceDoc.scenarios)
    ? traceDoc.scenarios
        .map((scenario) => scenario.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const scenarioResults = scenarioIds.map((scenarioId) => runTrace(tracePath, scenarioId));

  return {
    trace: `evals/examples/${name}`,
    ok: scenarioResults.length > 0 && scenarioResults.every((result) => result.ok),
    scenarioIds,
    results: scenarioResults,
  };
});

const ok = results.every((result) => result.ok);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  packageRoot,
  ok,
  count: results.length,
  results,
}, null, 2));

process.exit(ok ? 0 : 1);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runTrace(tracePath: string, scenarioId: string) {
  const command = spawnSync("node", ["--import", "tsx", runnerPath, "--trace", tracePath, "--scenario", scenarioId], {
    cwd: packageRoot,
    encoding: "utf8",
  });

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(command.stdout || "null");
  } catch {
    parsed = null;
  }

  return {
    scenarioId,
    ok: command.status === 0,
    exitCode: command.status,
    summary: isRecord(parsed)
      ? {
          overallScore: parsed.overallScore ?? null,
          overallStatus: parsed.overallStatus ?? null,
        }
      : null,
    stderr: command.stderr.trim() || null,
  };
}
