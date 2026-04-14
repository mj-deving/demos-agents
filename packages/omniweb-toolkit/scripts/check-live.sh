#!/usr/bin/env bash
set -uo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage: bash ./scripts/check-live.sh

Options:
  --help, -h  Show this help

Environment:
  SUPERCOLONY_API_URL or SUPERCOLONY_API   Base URL to probe (default: https://supercolony.ai)
  SUPERCOLONY_LIVE_TIMEOUT_SECONDS         Per-request curl timeout in seconds (default: 15)

Output:
  JSON smoke-check report for discovery resources, audited endpoints, stats categories,
  and network diagnostics when probes fail with status 0.

Exit codes:
  0 = all probes matched expected status codes
  1 = one or more probes failed or the environment blocked outbound access
EOF
  exit 0
fi

BASE_URL="${SUPERCOLONY_API_URL:-${SUPERCOLONY_API:-https://supercolony.ai}}"
TIMEOUT_SECONDS="${SUPERCOLONY_LIVE_TIMEOUT_SECONDS:-15}"

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

probe_status() {
  local path="$1"
  local tmp_out tmp_err
  tmp_out="$(mktemp)"
  tmp_err="$(mktemp)"

  set +e
  curl -L -sS --max-time "$TIMEOUT_SECONDS" -o /dev/null -w '%{http_code}' "${BASE_URL}${path}" >"$tmp_out" 2>"$tmp_err"
  local curl_exit=$?
  set -e

  local http_code stderr_text
  http_code="$(cat "$tmp_out")"
  stderr_text="$(cat "$tmp_err")"
  rm -f "$tmp_out" "$tmp_err"

  if [[ -z "$http_code" || "$http_code" == "000" ]]; then
    http_code="0"
  fi

  printf '%s|%s|%s' "$http_code" "$curl_exit" "$stderr_text"
}

probe_body() {
  local path="$1"
  local tmp_out tmp_err
  tmp_out="$(mktemp)"
  tmp_err="$(mktemp)"

  set +e
  curl -L -sS --max-time "$TIMEOUT_SECONDS" "${BASE_URL}${path}" >"$tmp_out" 2>"$tmp_err"
  local curl_exit=$?
  set -e

  local stdout_text stderr_text
  stdout_text="$(cat "$tmp_out")"
  stderr_text="$(cat "$tmp_err")"
  rm -f "$tmp_out" "$tmp_err"

  printf '%s\n__CURL_EXIT__=%s\n__CURL_ERR__=%s' "$stdout_text" "$curl_exit" "$stderr_text"
}

check_match() {
  local path="$1"
  local expected="$2"
  local probe
  probe="$(probe_status "$path")"

  local actual="${probe%%|*}"
  local rest="${probe#*|}"
  local curl_exit="${rest%%|*}"
  local curl_error="${rest#*|}"

  local match=false
  if [[ "$actual" == "$expected" ]]; then
    match=true
  fi

  printf '{"path":"%s","expected":"%s","actual":"%s","match":%s,"curlExit":%s,"curlError":"%s"}\n' \
    "$path" \
    "$expected" \
    "$actual" \
    "$match" \
    "$curl_exit" \
    "$(json_escape "$curl_error")"

  [[ "$match" == true ]]
}

main() {
  set -e

  local overall_ok=true

  local discovery_lines=""
  for path in \
    "/llms-full.txt" \
    "/openapi.json" \
    "/.well-known/ai-plugin.json" \
    "/.well-known/agents.json" \
    "/.well-known/agent.json"
  do
    if ! line="$(check_match "$path" "200")"; then
      overall_ok=false
    fi
    discovery_lines+="${line}"$'\n'
  done

  local endpoint_lines=""
  for path in \
    "/api/feed?limit=1:200" \
    "/api/stats:200" \
    "/api/oracle:200" \
    "/api/prices?assets=BTC:200" \
    "/api/convergence:200" \
    "/api/report:200" \
    "/api/capabilities:404" \
    "/api/rate-limits:404" \
    "/api/changelog:404" \
    "/api/agents/onboard:404" \
    "/api/errors:404" \
    "/api/mcp/tools:404" \
    "/api/stream-spec:404" \
    "/.well-known/mcp.json:404"
  do
    local endpoint="${path%%:*}"
    local expected="${path##*:}"
    if ! line="$(check_match "$endpoint" "$expected")"; then
      overall_ok=false
    fi
    endpoint_lines+="${line}"$'\n'
  done

  local stats_probe stats_json curl_exit_marker curl_error_marker stats_body stats_exit stats_error categories_json
  stats_probe="$(probe_body "/api/stats")"
  curl_exit_marker=$'\n__CURL_EXIT__='
  curl_error_marker=$'\n__CURL_ERR__='
  stats_body="${stats_probe%%$curl_exit_marker*}"
  stats_exit="${stats_probe#*$curl_exit_marker}"
  stats_exit="${stats_exit%%$curl_error_marker*}"
  stats_error="${stats_probe#*$curl_error_marker}"

  if [[ "$stats_exit" == "0" && -n "$stats_body" ]]; then
    categories_json="$(printf '%s' "$stats_body" | node -e '
      const input = require("node:fs").readFileSync(0, "utf8");
      const parsed = JSON.parse(input);
      const categories = (parsed.content?.categories ?? []).map((entry) => entry.category).filter(Boolean).sort();
      process.stdout.write(JSON.stringify(categories));
    ')"
  else
    categories_json="[]"
    overall_ok=false
  fi

  local diagnostics='[]'
  if printf '%s%s' "$discovery_lines" "$endpoint_lines" | grep -q '"actual":"0"'; then
    diagnostics='["One or more live probes returned status 0. In constrained environments this usually indicates blocked DNS or outbound network access rather than package drift."]'
  fi

  printf '{\n'
  printf '  "checkedAt": "%s",\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf '  "baseUrl": "%s",\n' "$BASE_URL"
  printf '  "ok": %s,\n' "$overall_ok"
  printf '  "mode": "shell-curl-smoke",\n'
  printf '  "discovery": [\n%s  ],\n' "$(printf '%s' "$discovery_lines" | sed '/^$/d;s/^/    /; $!s/$/,/')"
  printf '  "endpoints": [\n%s  ],\n' "$(printf '%s' "$endpoint_lines" | sed '/^$/d;s/^/    /; $!s/$/,/')"
  printf '  "statsCategories": %s,\n' "$categories_json"
  printf '  "statsFetch": {"curlExit": %s, "curlError": "%s"},\n' "$stats_exit" "$(json_escape "$stats_error")"
  printf '  "diagnostics": %s\n' "$diagnostics"
  printf '}\n'

  if [[ "$overall_ok" != true ]]; then
    exit 1
  fi
}

main "$@"
