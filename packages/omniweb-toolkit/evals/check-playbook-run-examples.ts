#!/usr/bin/env npx tsx

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const SUPPORTED_ARCHETYPES = [
  "research-agent",
  "market-analyst",
  "engagement-optimizer",
] as const;

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx evals/check-playbook-run-examples.ts

Scores every packaged *.run.json example in evals/playbook-runs/ with
evals/score-playbook-run.ts and verifies that the packaged example set covers
each supported archetype exactly once.

Output: JSON report listing each captured run example and whether it passed
Exit codes: 0 = all examples pass, 1 = one or more examples fail, 2 = invalid args`);
  process.exit(0);
}

const packageRoot = resolve(import.meta.dirname, "..");
const runsDir = resolve(packageRoot, "evals", "playbook-runs");
const scorerPath = resolve(packageRoot, "evals", "score-playbook-run.ts");

const examples = readdirSync(runsDir)
  .filter((name) => name.endsWith(".run.json"))
  .sort();

const results = examples.map((name) => {
  const runPath = resolve(runsDir, name);
  const doc = JSON.parse(readFileSync(runPath, "utf8")) as { meta?: { archetype?: string } };
  const archetype = doc.meta?.archetype ?? null;
  const command = spawnSync("node", ["--import", "tsx", scorerPath, "--run", runPath], {
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
    run: `evals/playbook-runs/${name}`,
    archetype,
    ok: command.status === 0,
    exitCode: command.status,
    summary: isRecord(parsed)
      ? {
          overallScore: parsed.overallScore ?? null,
          overallStatus: parsed.overallStatus ?? null,
          error: parsed.error ?? null,
        }
      : null,
    stderr: command.stderr.trim() || null,
  };
});

const packagedArchetypes = results
  .map((result) => result.archetype)
  .filter((value): value is string => typeof value === "string");
const missingArchetypes = SUPPORTED_ARCHETYPES.filter((archetype) => !packagedArchetypes.includes(archetype));
const unexpectedArchetypes = packagedArchetypes.filter((archetype) => !SUPPORTED_ARCHETYPES.includes(archetype as typeof SUPPORTED_ARCHETYPES[number]));
const duplicateArchetypes = Array.from(new Set(
  packagedArchetypes.filter((archetype, index) => packagedArchetypes.indexOf(archetype) !== index),
));
const filenameIssues = results.flatMap((result) => {
  if (!result.archetype) {
    return [{
      run: result.run,
      issue: "meta.archetype is required",
    }];
  }

  const expectedName = `${result.archetype}.run.json`;
  const actualName = result.run.split("/").pop() ?? result.run;
  return actualName === expectedName
    ? []
    : [{
        run: result.run,
        issue: `filename should be '${expectedName}' to match archetype '${result.archetype}'`,
      }];
});

const coverage = {
  ok: missingArchetypes.length === 0 &&
    unexpectedArchetypes.length === 0 &&
    duplicateArchetypes.length === 0 &&
    filenameIssues.length === 0,
  expectedArchetypes: SUPPORTED_ARCHETYPES,
  packagedArchetypes,
  missingArchetypes,
  unexpectedArchetypes,
  duplicateArchetypes,
  filenameIssues,
};

const ok = coverage.ok && results.every((result) => result.ok);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  packageRoot,
  runsDir,
  ok,
  count: results.length,
  coverage,
  results,
}, null, 2));

process.exit(ok ? 0 : 1);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
