#!/usr/bin/env bash
set -euo pipefail

tmp_json="$(mktemp)"
trap 'rm -f "$tmp_json"' EXIT

cat > "$tmp_json" <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "validate" }
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_linear_history": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF

gh api \
  -X PUT \
  repos/mj-deving/omniweb-agents/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input "$tmp_json"
