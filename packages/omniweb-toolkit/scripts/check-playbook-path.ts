#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { PACKAGE_ROOT, getStringArg, getNumberArg, hasFlag } from "./_shared.js";

type Archetype = "research-agent" | "market-analyst" | "engagement-optimizer";

type Step = {
  id: string;
  kind: "tsx";
  file: string;
  args?: string[];
};

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/check-playbook-path.ts --archetype <research-agent|market-analyst|engagement-optimizer> [options]

Options:
  --archetype NAME    Required archetype id to validate
  --base-url URL      Forwarded to live HTTP-based checks
  --timeout-ms N      Forwarded to live HTTP-based checks
  --state-dir PATH    Forwarded to runtime-backed checks
  --allow-insecure    Forwarded to publish-readiness or probe-publish
  --probe-publish     Include a real publish visibility probe after readiness checks
  --help, -h          Show this help

Output: JSON summary of the archetype-specific validation path
Exit codes: 0 = all steps passed, 1 = one or more checks failed, 2 = invalid args`);
  process.exit(0);
}

const archetype = getStringArg(args, "--archetype") as Archetype | undefined;
const baseUrl = getStringArg(args, "--base-url");
const timeoutMs = getNumberArg(args, "--timeout-ms");
const stateDir = getStringArg(args, "--state-dir");
const allowInsecure = hasFlag(args, "--allow-insecure");
const probePublish = hasFlag(args, "--probe-publish");

if (!archetype || !["research-agent", "market-analyst", "engagement-optimizer"].includes(archetype)) {
  console.error("Error: --archetype must be one of research-agent, market-analyst, engagement-optimizer");
  process.exit(2);
}

if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
  console.error("Error: --timeout-ms must be a positive number");
  process.exit(2);
}

const scenarioByArchetype: Record<Archetype, string> = {
  "research-agent": "research-agent-playbook",
  "market-analyst": "market-analyst-playbook",
  "engagement-optimizer": "engagement-optimizer-playbook",
};

const stepsByArchetype: Record<Archetype, Step[]> = {
  "research-agent": [
    { id: "feed", kind: "tsx", file: "scripts/feed.ts", args: ["--limit", "10"] },
    { id: "leaderboard", kind: "tsx", file: "scripts/leaderboard-snapshot.ts" },
    { id: "publish-readiness", kind: "tsx", file: "scripts/check-publish-readiness.ts" },
  ],
  "market-analyst": [
    { id: "endpoint-surface", kind: "tsx", file: "scripts/check-endpoint-surface.ts" },
    { id: "response-shapes", kind: "tsx", file: "scripts/check-response-shapes.ts" },
    { id: "leaderboard", kind: "tsx", file: "scripts/leaderboard-snapshot.ts" },
    { id: "publish-readiness", kind: "tsx", file: "scripts/check-publish-readiness.ts" },
  ],
  "engagement-optimizer": [
    { id: "feed", kind: "tsx", file: "scripts/feed.ts", args: ["--limit", "10"] },
    { id: "leaderboard", kind: "tsx", file: "scripts/leaderboard-snapshot.ts" },
    { id: "response-shapes", kind: "tsx", file: "scripts/check-response-shapes.ts" },
    { id: "publish-readiness", kind: "tsx", file: "scripts/check-publish-readiness.ts" },
  ],
};

const steps = [...stepsByArchetype[archetype]];

if (probePublish) {
  steps.push({ id: "probe-publish", kind: "tsx", file: "scripts/probe-publish.ts" });
}

steps.push({
  id: "trajectory-example",
  kind: "tsx",
  file: "evals/run-trajectories.ts",
  args: [
    "--trace",
    `./evals/examples/${scenarioByArchetype[archetype]}.trace.json`,
    "--scenario",
    scenarioByArchetype[archetype],
  ],
});

const results = steps.map((step) => runStep(step));
const ok = results.every((result) => result.ok);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  archetype,
  baseUrl: baseUrl ?? null,
  timeoutMs: timeoutMs ?? null,
  stateDir: stateDir ?? null,
  probePublish,
  ok,
  results,
}, null, 2));

process.exit(ok ? 0 : 1);

function runStep(step: Step): {
  id: string;
  ok: boolean;
  exitCode: number;
  command: string[];
  stdout: string;
  stderr: string;
} {
  const forwardedArgs: string[] = [];

  if (baseUrl && supportsBaseUrl(step.file)) {
    forwardedArgs.push("--base-url", baseUrl);
  }
  if (timeoutMs !== undefined && supportsTimeout(step.file)) {
    forwardedArgs.push("--timeout-ms", String(timeoutMs));
  }
  if (stateDir && supportsStateDir(step.file)) {
    forwardedArgs.push("--state-dir", stateDir);
  }
  if (allowInsecure && supportsAllowInsecure(step.file)) {
    forwardedArgs.push("--allow-insecure");
  }

  const command = [
    process.execPath,
    "--import",
    "tsx",
    resolve(PACKAGE_ROOT, step.file),
    ...(step.args ?? []),
    ...forwardedArgs,
  ];

  const result = spawnSync(command[0], command.slice(1), {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
  });

  return {
    id: step.id,
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    command,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function supportsBaseUrl(file: string): boolean {
  return [
    "scripts/leaderboard-snapshot.ts",
    "scripts/check-endpoint-surface.ts",
    "scripts/check-response-shapes.ts",
    "scripts/probe-publish.ts",
  ].includes(file);
}

function supportsTimeout(file: string): boolean {
  return [
    "scripts/leaderboard-snapshot.ts",
    "scripts/check-endpoint-surface.ts",
    "scripts/check-response-shapes.ts",
    "scripts/probe-publish.ts",
  ].includes(file);
}

function supportsStateDir(file: string): boolean {
  return [
    "scripts/check-publish-readiness.ts",
    "scripts/probe-publish.ts",
  ].includes(file);
}

function supportsAllowInsecure(file: string): boolean {
  return [
    "scripts/check-publish-readiness.ts",
    "scripts/probe-publish.ts",
  ].includes(file);
}
