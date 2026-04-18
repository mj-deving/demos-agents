#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: scripts/create-worktree.sh <name> [branch]" >&2
  echo "Example: scripts/create-worktree.sh research-pass" >&2
  echo "Example: scripts/create-worktree.sh research-pass codex/research-pass" >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
name="$1"
branch="${2:-$name}"
target_root="$(dirname "$repo_root")/demos-agents-worktrees"
target_path="$target_root/$name"

mkdir -p "$target_root"

if [[ -e "$target_path" ]]; then
  echo "Worktree path already exists: $target_path" >&2
  exit 1
fi

echo "Creating shared Beads worktree at: $target_path"
echo "Branch: $branch"

bd worktree create "$target_path" --branch "$branch"
