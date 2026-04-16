#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";
import { PACKAGE_ROOT } from "./_shared.js";

type JourneyStatus = "pass" | "degraded" | "fail";

interface JourneyResult {
  id: string;
  title: string;
  status: JourneyStatus;
  ok: boolean;
  exitCode: number;
  command: string[];
  rationale: string;
  summary: unknown;
  stdout: string;
  stderr: string;
}

const args = process.argv.slice(2);
const includeReleaseGate = !args.includes("--skip-release-gate");

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/check-consumer-journeys.ts [options]

Options:
  --skip-release-gate   Skip the npm publish/install gate summary
  --help, -h            Show this help

Output: JSON summary of the maintained outside-in consumer journey drills
Exit codes: 0 = all required journey paths passed, 1 = one or more required paths failed, 2 = invalid args`);
  process.exit(0);
}

if (args.some((arg) => !["--skip-release-gate", "--help", "-h"].includes(arg))) {
  console.error(`Error: unsupported arguments: ${args.filter((arg) => !["--skip-release-gate", "--help", "-h"].includes(arg)).join(" ")}`);
  process.exit(2);
}

const journeyResults: JourneyResult[] = [
  runPlaybookJourney(
    "research-agent",
    "Research agent publish journey",
    ["node", "--import", "tsx", "./scripts/check-playbook-path.ts", "--archetype", "research-agent"],
  ),
  runPlaybookJourney(
    "market-analyst",
    "Market analyst publish-first journey",
    ["node", "--import", "tsx", "./scripts/check-playbook-path.ts", "--archetype", "market-analyst"],
  ),
  runPlaybookJourney(
    "engagement-optimizer",
    "Engagement optimizer curation journey",
    ["node", "--import", "tsx", "./scripts/check-playbook-path.ts", "--archetype", "engagement-optimizer"],
  ),
  runCapturedExamplesJourney(),
];

if (includeReleaseGate) {
  journeyResults.push(runReleaseGateJourney());
}

const counts = journeyResults.reduce(
  (acc, result) => {
    acc[result.status] += 1;
    return acc;
  },
  { pass: 0, degraded: 0, fail: 0 } as Record<JourneyStatus, number>,
);

const ok = journeyResults.every((result) =>
  result.id === "first-external-consumer"
    ? result.status !== "fail"
    : result.status === "pass",
);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  packageRoot: PACKAGE_ROOT,
  ok,
  launchReady: counts.fail === 0 && counts.degraded === 0,
  counts,
  results: journeyResults,
}, null, 2));

process.exit(ok ? 0 : 1);

function runPlaybookJourney(
  id: string,
  title: string,
  command: string[],
): JourneyResult {
  const result = runCommand(command);
  const parsed = tryParseJson(result.stdout);
  const status: JourneyStatus = result.exitCode === 0 ? "pass" : "fail";
  return {
    id,
    title,
    status,
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    command,
    rationale:
      status === "pass"
        ? "The maintained archetype path completed successfully against current live state."
        : "The maintained archetype path failed and needs investigation before the journey can be treated as current.",
    summary: parsed ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runCapturedExamplesJourney(): JourneyResult {
  const command = ["node", "--import", "tsx", "./evals/check-playbook-run-examples.ts"];
  const result = runCommand(command);
  const parsed = tryParseJson(result.stdout);
  const status: JourneyStatus = result.exitCode === 0 ? "pass" : "fail";
  return {
    id: "captured-playbook-runs",
    title: "Captured archetype run scorer",
    status,
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    command,
    rationale:
      status === "pass"
        ? "The stricter captured-run scorer still passes for all shipped archetypes."
        : "One or more captured run examples failed the stricter scorer.",
    summary: parsed ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runReleaseGateJourney(): JourneyResult {
  const command = ["node", "--import", "tsx", "./scripts/check-npm-publish.ts"];
  const result = runCommand(command);
  const parsed = tryParseJson(result.stdout) as
    | {
        releaseDecision?: string;
        checks?: {
          packageCheck?: { ok?: boolean };
        };
      }
    | null;

  let status: JourneyStatus = result.exitCode === 0 ? "pass" : "fail";
  let rationale =
    status === "pass"
      ? "The npm publish gate is clear, so the first external consumer install path is not blocked at the registry layer."
      : "The external consumer install path is blocked or failed during the npm publish gate.";

  if (parsed?.releaseDecision === "blocked_npm_auth_missing" && parsed.checks?.packageCheck?.ok) {
    status = "degraded";
    rationale =
      "The checked-out package path is healthy, but the first registry install is still blocked by missing npm auth in the publishing environment.";
  }

  return {
    id: "first-external-consumer",
    title: "First external consumer install gate",
    status,
    ok: status !== "fail",
    exitCode: result.exitCode,
    command,
    rationale,
    summary: parsed ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runCommand(command: string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(command[0], command.slice(1), {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
