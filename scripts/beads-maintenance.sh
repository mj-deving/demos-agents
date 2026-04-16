#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: ./scripts/beads-maintenance.sh

Runs a lightweight Beads hygiene pass for this repo:
  - gate check
  - stale issues (7 days)
  - orphan scan
  - duplicate scan

Output:
  Plain-text sections from the underlying bd commands.

Exit codes:
  0 = all commands ran successfully
  non-zero = one of the underlying bd commands failed
EOF
  exit 0
fi

run_section() {
  local title="$1"
  shift
  printf '\n[%s]\n' "$title"
  "$@"
}

run_section "gate-check" bd gate check
run_section "stale-open-issues" bd stale --days 7
run_section "orphans" bd orphans
run_section "duplicates" bd duplicates
