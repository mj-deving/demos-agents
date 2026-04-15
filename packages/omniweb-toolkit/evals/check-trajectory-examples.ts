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
import { parse } from "yaml";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx evals/check-trajectory-examples.ts

Checks every packaged *.trace.json example in evals/examples/ by scoring it with
evals/run-trajectories.ts and verifying that the packaged example set covers
the maintained scenarios in evals/trajectories.yaml.

Output: JSON report listing each example trace and whether it passed
Exit codes: 0 = all examples pass, 1 = one or more examples fail, 2 = invalid args`);
  process.exit(0);
}

const packageRoot = resolve(import.meta.dirname, "..");
const examplesDir = resolve(packageRoot, "evals", "examples");
const runnerPath = resolve(packageRoot, "evals", "run-trajectories.ts");
const trajectoriesPath = resolve(packageRoot, "evals", "trajectories.yaml");
const spec = parse(readFileSync(trajectoriesPath, "utf8")) as { scenarios?: Array<{ id?: string }> };
const expectedScenarioIds = Array.isArray(spec.scenarios)
  ? spec.scenarios
      .map((scenario) => scenario.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
      .sort()
  : [];

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

const packagedScenarioEntries = results.flatMap((result) =>
  result.scenarioIds.map((scenarioId) => ({
    scenarioId,
    trace: result.trace,
  })),
);
const packagedScenarioIds = packagedScenarioEntries
  .map((entry) => entry.scenarioId)
  .sort();
const duplicateScenarioIds = Array.from(new Set(
  packagedScenarioIds.filter((id, index) => packagedScenarioIds.indexOf(id) !== index),
));
const duplicateCoverage = duplicateScenarioIds.map((scenarioId) => ({
  scenarioId,
  traces: packagedScenarioEntries
    .filter((entry) => entry.scenarioId === scenarioId)
    .map((entry) => entry.trace),
}));
const missingScenarioIds = expectedScenarioIds.filter((id) => !packagedScenarioIds.includes(id));
const unexpectedScenarioIds = packagedScenarioIds.filter((id) => !expectedScenarioIds.includes(id));
const coverage = {
  ok: missingScenarioIds.length === 0 && unexpectedScenarioIds.length === 0 && duplicateCoverage.length === 0,
  expectedScenarioCount: expectedScenarioIds.length,
  packagedScenarioCount: packagedScenarioIds.length,
  expectedScenarioIds,
  packagedScenarioIds,
  missingScenarioIds,
  unexpectedScenarioIds,
  duplicateCoverage,
};

const ok = results.every((result) => result.ok) && coverage.ok;

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  packageRoot,
  trajectoriesPath,
  ok,
  count: results.length,
  coverage,
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
          error: parsed.error ?? null,
          overallScore: parsed.overallScore ?? null,
          overallStatus: parsed.overallStatus ?? null,
          validationOk: isRecord(parsed.validation) ? parsed.validation.ok ?? null : null,
        }
      : null,
    stderr: command.stderr.trim() || null,
  };
}
