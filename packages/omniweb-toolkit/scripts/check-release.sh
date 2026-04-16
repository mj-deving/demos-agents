#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: bash ./scripts/check-release.sh

Options:
  --help, -h  Show this help

Output:
  JSON report describing the `npm pack --dry-run --json` tarball contents, required
  package files, packaged trajectory examples, and forbidden repo-only docs that
  must not ship.

Exit codes:
  0 = tarball contents match the expected release surface
  1 = required files are missing or forbidden files are included
EOF
  exit 0
fi

PACK_JSON="$(npm pack --dry-run --json)"

printf '%s' "$PACK_JSON" | node -e '
  const fs = require("node:fs");
  const { parse } = require("yaml");
  const input = fs.readFileSync(0, "utf8");
  const parsed = JSON.parse(input);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = (entry.files ?? []).map((file) => file.path).sort();
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const trajectoriesPath = "evals/trajectories.yaml";
  const trajectories = parse(fs.readFileSync(trajectoriesPath, "utf8"));
  const expectedScenarioIds = Array.isArray(trajectories?.scenarios)
    ? trajectories.scenarios
        .map((scenario) => scenario?.id)
        .filter((id) => typeof id === "string" && id.length > 0)
        .sort()
    : [];
  const expectedTraceFiles = expectedScenarioIds.map((id) => `evals/examples/${id}.trace.json`);
  const packagedTraceFiles = files.filter((path) => /^evals\/examples\/.+\.trace\.json$/.test(path));
  const exportTargets = Object.values(packageJson.exports ?? {})
    .flatMap((target) => [target?.import, target?.types])
    .filter(Boolean)
    .map((path) => path.replace(/^\.\//, ""));

  const required = [
    "SKILL.md",
    "GUIDE.md",
    "TOOLKIT.md",
    "README.md",
    "agents/openai.yaml",
    "assets/agent-loop-skeleton.ts",
    "assets/research-agent-starter.ts",
    "assets/market-analyst-starter.ts",
    "assets/engagement-optimizer-starter.ts",
    "evals/trajectories.yaml",
    "references/platform-surface.md",
    "references/categories.md",
    "scripts/feed.ts",
    "scripts/balance.ts",
    "scripts/check-live.sh",
    "scripts/check-release.sh",
    "scripts/check-playbook-path.ts",
    "scripts/skill-self-audit.ts",
  ];

  const forbidden = [
    "docs/research-supercolony-skill-sources.md",
    "docs/skill-improvement-recommendations.md",
  ];

  const missing = [...required, ...exportTargets].filter((path) => !files.includes(path));
  const leaked = forbidden.filter((path) => files.includes(path));
  const missingTraceExamples = expectedTraceFiles.filter((path) => !files.includes(path));
  const unexpectedTraceExamples = packagedTraceFiles.filter((path) => !expectedTraceFiles.includes(path));
  const ok =
    missing.length === 0 &&
    leaked.length === 0 &&
    missingTraceExamples.length === 0 &&
    unexpectedTraceExamples.length === 0;

  process.stdout.write(JSON.stringify({
    ok,
    filename: entry.filename,
    entryCount: entry.entryCount,
    packageSize: entry.size,
    unpackedSize: entry.unpackedSize,
    missingRequired: missing,
    forbiddenIncluded: leaked,
    expectedTrajectoryExamples: expectedTraceFiles,
    packagedTrajectoryExamples: packagedTraceFiles,
    missingTrajectoryExamples: missingTraceExamples,
    unexpectedTrajectoryExamples: unexpectedTraceExamples,
  }, null, 2));

  if (!ok) {
    process.exit(1);
  }
'
