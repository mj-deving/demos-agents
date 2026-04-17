#!/usr/bin/env npx tsx

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { PACKAGE_ROOT } from "./_shared.js";

interface CommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: node --import tsx ./scripts/check-npm-publish.ts

Runs the package structural checks, verifies npm registry auth, and reports
whether the package name already exists on npm. Emits an explicit release
decision for the current environment.

Output: JSON publish-preflight report
Exit codes:
  0 = package checks passed and npm auth is available
  1 = package checks failed or npm auth is missing
`);
  process.exit(0);
}

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };

const buildCheck = runCommand("npm", ["run", "build"]);
const packageCheck = buildCheck.ok
  ? runCommand("npm", ["run", "check:package"])
  : {
      ok: false,
      exitCode: buildCheck.exitCode,
      stdout: buildCheck.stdout,
      stderr: buildCheck.stderr,
    };
const npmWhoami = runCommand("npm", ["--workspaces=false", "whoami", "--registry", "https://registry.npmjs.org"]);
const npmView = runCommand("npm", [
  "--workspaces=false",
  "view",
  packageJson.name,
  "version",
  "--json",
  "--registry",
  "https://registry.npmjs.org",
]);

const authOk = npmWhoami.ok;
const publishedVersion = parseJsonMaybe(npmView.stdout);
const registryMissing = /E404|not in this registry|Not Found - GET/i.test(
  `${npmView.stdout}\n${npmView.stderr}`,
);
const packageExists =
  npmView.ok && typeof publishedVersion === "string" && publishedVersion.length > 0;
const releaseDecision = packageCheck.ok
  ? authOk
    ? packageExists
      ? "ready_with_existing_registry_entry"
      : "ready_for_first_publish"
    : "blocked_npm_auth_missing"
  : "blocked_package_checks_failed";
const nextAction =
  releaseDecision === "ready_for_first_publish"
    ? "Authenticate to npm if needed, then publish omniweb-toolkit@0.1.0."
    : releaseDecision === "ready_with_existing_registry_entry"
      ? `Authenticate to npm, then verify version strategy against published ${publishedVersion}.`
      : releaseDecision === "blocked_npm_auth_missing"
        ? "Run `npm login --registry https://registry.npmjs.org` in the publishing environment, then rerun this check."
        : "Fix package validation failures before attempting a publish.";

const report = {
  ok: buildCheck.ok && packageCheck.ok && authOk,
  checkedAt: new Date().toISOString(),
  package: {
    name: packageJson.name,
    version: packageJson.version,
  },
  releaseDecision,
  nextAction,
  checks: {
    packageCheck: {
      ok: buildCheck.ok && packageCheck.ok,
      exitCode: buildCheck.ok ? packageCheck.exitCode : buildCheck.exitCode,
      command: buildCheck.ok ? "npm run check:package" : "npm run build",
      error: buildCheck.ok
        ? (packageCheck.ok ? undefined : compactError(packageCheck.stderr || packageCheck.stdout))
        : compactError(buildCheck.stderr || buildCheck.stdout),
    },
    npmAuth: {
      ok: authOk,
      username: authOk ? npmWhoami.stdout.trim() : undefined,
      command: "npm whoami --registry https://registry.npmjs.org",
      error: authOk ? undefined : describeNpmAuthError(npmWhoami.stderr || npmWhoami.stdout),
    },
    registryPackage: {
      ok: npmView.ok || registryMissing,
      exists: packageExists,
      nameAvailable: !packageExists,
      publishedVersion: packageExists ? publishedVersion : undefined,
      command: `npm view ${packageJson.name} version --json`,
      error: npmView.ok || registryMissing ? undefined : compactError(npmView.stderr || npmView.stdout),
    },
  },
  blockers: [
    ...(buildCheck.ok && packageCheck.ok ? [] : ["package_check_failed"]),
    ...(authOk ? [] : ["npm_auth_missing"]),
  ],
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    env: process.env,
  });

  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseJsonMaybe(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function compactError(input: string): string | undefined {
  const line = input
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0 && !part.startsWith("npm warn Ignoring workspaces"));
  return line || undefined;
}

function describeNpmAuthError(input: string): string | undefined {
  if (/E401|Unauthorized/i.test(input)) {
    return "Not authenticated with npm registry";
  }
  return compactError(input);
}
