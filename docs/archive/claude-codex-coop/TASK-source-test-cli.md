# Codex Review: Source Testing CLI (Design Review)

## Context

We have 46 active + 92 quarantined sources in `sources/catalog.json`, 11 declarative YAML provider specs, and a full fetch+parse pipeline. But no way to test individual sources for health outside the session loop. When a source goes down or changes its API, we only discover it during a live session.

PR7 adds a standalone CLI tool `tools/source-test.ts` that probes sources for health: fetch → parse → score. It reports which sources are alive, which adapters work, and flags issues.

## Design

### New file: `tools/source-test.ts`

A CLI tool following existing conventions (`--agent`, `--env`, `--pretty`, `--json`).

**Commands:**
```bash
# Test a single source by ID
npx tsx tools/source-test.ts --source coingecko-bitcoin --pretty

# Test all active sources for an agent
npx tsx tools/source-test.ts --agent sentinel --pretty

# Test all sources matching a provider
npx tsx tools/source-test.ts --provider hn-algolia --pretty

# Test quarantined sources (check if they recovered)
npx tsx tools/source-test.ts --quarantined --agent sentinel --pretty

# Output JSON for automation
npx tsx tools/source-test.ts --agent sentinel --json
```

**Per-source test flow:**
1. Look up source in catalog → get SourceRecordV2
2. Get provider adapter via `getProviderAdapter(source.provider)`
3. If no adapter → report `NO_ADAPTER`
4. Resolve a test URL (use source.url with default/sample variables)
5. Fetch via `fetchSource()` with rate limits
6. If fetch fails → report `FETCH_FAILED` with error
7. Parse via `adapter.parseResponse()` → get EvidenceEntry[]
8. If parse fails → report `PARSE_FAILED` with error
9. Report `OK` with entry count, sample titles, latency

**Output format (pretty):**
```
Source Health Report (sentinel, 46 sources)
──────────────────────────────────────────
✓ coingecko-bitcoin       OK      230ms  12 entries
✓ hn-algolia-top          OK      180ms   8 entries
✗ github-trending         FETCH   502    -
✗ defillama-tvl           PARSE   0 entries (empty response)
⊘ pubmed-search           NO_ADAPTER
──────────────────────────────────────────
Summary: 38 OK, 4 FETCH, 2 PARSE, 2 NO_ADAPTER
```

**Output format (JSON):**
```json
{
  "agent": "sentinel",
  "timestamp": "2026-03-14T...",
  "results": [
    {
      "sourceId": "coingecko-bitcoin",
      "provider": "coingecko",
      "status": "OK",
      "latencyMs": 230,
      "entryCount": 12,
      "sampleTitles": ["Bitcoin", "..."],
      "error": null
    }
  ],
  "summary": { "ok": 38, "fetch_failed": 4, "parse_failed": 2, "no_adapter": 2 }
}
```

### Dependencies (all existing)
- `tools/lib/sources/catalog.ts` — `loadCatalog()`, `buildAgentSourceView()`, `SourceRecordV2`
- `tools/lib/sources/fetch.ts` — `fetchSource()`
- `tools/lib/sources/providers/index.ts` — `getProviderAdapter()`
- `tools/lib/sources/providers/types.ts` — `EvidenceEntry`
- `tools/lib/agent-config.ts` — `loadAgentConfig()`, `resolveAgentName()`

### URL resolution for testing
Sources have URL templates with variables like `{asset}`, `{symbol}`, `{query}`. For testing, we need sensible defaults. Strategy:
- Use a `testDefaults` map: `{ asset: "bitcoin", symbol: "BTC", query: "AI", topic: "technology" }`
- Or: read the source's `topicAliases[0]` to derive a test query
- The CLI accepts `--vars "asset=ethereum,symbol=ETH"` to override

### Rate limiting
- Reuse existing `fetchSource()` rate limiting (token bucket per provider)
- Add `--delay <ms>` flag for batch testing (default 200ms between sources)
- Add `--parallel <n>` flag for concurrent fetches (default 1, max 5)

## Test Contracts

### source-test.test.ts

**Core test function (testSource):**
- `testSource` returns OK status when fetch+parse succeed with entries
- `testSource` returns FETCH_FAILED when fetchSource throws
- `testSource` returns FETCH_FAILED when fetchSource returns ok=false
- `testSource` returns PARSE_FAILED when adapter.parseResponse throws
- `testSource` returns PARSE_FAILED when adapter returns 0 entries
- `testSource` returns NO_ADAPTER when getProviderAdapter returns null
- `testSource` records latency in milliseconds
- `testSource` includes sample titles (max 3) from parsed entries

**URL resolution:**
- resolveTestUrl replaces template variables with defaults
- resolveTestUrl uses source topicAliases for query variables
- resolveTestUrl accepts custom variable overrides

**Filtering:**
- filterSources by sourceId returns single match
- filterSources by provider returns all matching sources
- filterSources by agent returns agent's active source view
- filterSources with --quarantined returns quarantined sources only

**CLI output:**
- pretty format includes status icon, source ID, status, latency, entry count
- json format includes all fields from SourceTestResult
- summary counts are correct

## Questions for Review

Q1: Should `testSource` be exported as a reusable function from a lib module (e.g., `tools/lib/sources/health.ts`), or keep it all in the CLI file? I lean toward a separate lib module so session-runner could eventually use it for runtime health checks.

Q2: For URL template resolution, should we store test defaults per-provider in the YAML specs (a new `testDefaults:` field), or use a hardcoded map in the CLI? YAML specs are more maintainable but adds spec complexity.

Q3: Should the CLI auto-save results to a file (e.g., `~/.sentinel/source-health.json`) for trending over time, or keep it pure stdout for now?

Q4: Rate limiting: should batch mode respect the existing per-provider rate limits (which could make a full test take minutes), or use a separate "testing" bucket with higher limits?

Q5: Should PARSE_FAILED with 0 entries be a separate status from PARSE_FAILED with an exception? Zero entries from a valid response might mean "source is up but has no data for this query" — which is different from a broken parser.

## Files to Read

```bash
cat tools/lib/sources/catalog.ts
cat tools/lib/sources/fetch.ts
cat tools/lib/sources/providers/index.ts
cat tools/lib/sources/providers/types.ts
cat sources/catalog.json | head -100
cat tools/lib/agent-config.ts
# Example YAML spec:
cat tools/lib/sources/providers/specs/coingecko.yaml
```

## Output Format

Write findings to `claude-codex-coop/REVIEW-source-test-cli.md`. Answer Q1-Q5. Flag any missing test contracts. Do NOT modify source code.
