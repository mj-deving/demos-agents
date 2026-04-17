#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: bash ./scripts/check-imports.sh

Output:
  JSON report describing whether the built ESM entrypoints can be imported
  under plain Node.js without a custom loader.

Exit codes:
  0 = all checked entrypoints imported successfully
  1 = one or more entrypoints failed to import
EOF
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
export PACKAGE_ROOT

node --input-type=module <<'EOF'
const packageRoot = process.env.PACKAGE_ROOT;

const checks = [
  {
    id: "main",
    path: new URL(`file://${packageRoot}/dist/index.js`).href,
    expect: ["connect"],
  },
  {
    id: "agent",
    path: new URL(`file://${packageRoot}/dist/agent.js`).href,
    expect: [
      "getDefaultMinimalStateDir",
      "runMinimalAgentCycle",
      "runMinimalAgentLoop",
      "runAgentLoop",
      "defaultObserve",
      "buildColonyStateFromFeed",
    ],
  },
  {
    id: "types",
    path: new URL(`file://${packageRoot}/dist/types.js`).href,
    expect: [],
  },
];

const results = [];
let ok = true;

for (const check of checks) {
  try {
    const mod = await import(check.path);
    const missing = check.expect.filter((key) => !(key in mod));
    const exported = Object.keys(mod).sort();
    results.push({ id: check.id, ok: missing.length === 0, exported, missing });
    if (missing.length > 0) ok = false;
  } catch (error) {
    ok = false;
    const err = error instanceof Error ? error : new Error(String(error));
    results.push({
      id: check.id,
      ok: false,
      exported: [],
      missing: check.expect,
      error: {
        name: err.name,
        message: err.message,
      },
    });
  }
}

process.stdout.write(`${JSON.stringify({ ok, results }, null, 2)}\n`);
if (!ok) process.exit(1);
EOF
