# Codex Review: Phase 3 — Sources Extraction (Design Review)

## Context

This is a **design review** (not code review) for Phase 3 of the unified loop architecture v2. Phase 3 extracts source-related concerns from the core loop into a standalone `tools/lib/sources/` module with two API boundaries (runtime vs admin).

**Plan reference:** `Plans/unified-loop-architecture-v2.md` (Phase 3 section, lines 406-420)

Phases 0A, 0B, 1, and 2 are all implemented and committed. Phase 3 is next. We need you to review the plan's Phase 3 specifics and identify gaps, ambiguities, or risks before implementation begins.

## Current State (What Exists Today)

### Source-related files to extract:

1. **`tools/lib/attestation-policy.ts`** (261 lines)
   - `SourceRecord` interface: `{ name, url, topics?, tlsn_safe?, dahr_safe?, max_response_kb?, note? }`
   - `loadSourceRegistry(path)` — loads YAML, returns `SourceRecord[]`
   - `selectSourceForTopic(topic, sources, method)` — token overlap matching, returns best source + resolved URL
   - `preflight(topic, sources, config)` — pre-LLM check for source availability
   - `resolveAttestationPlan(topic, config)` — determines TLSN vs DAHR based on agent config
   - `isHighSensitivityTopic(topic, keywords)` — keyword matching helper
   - Helper functions: `tokenizeTopic`, `sourceTopicTokens`, `fillUrlTemplate`, `inferAssetAlias`, `extractTopicVars`

2. **`tools/lib/source-discovery.ts`** (349 lines)
   - `generateCandidateUrls(topic)` — creates candidate URLs from known API patterns (HN, GitHub, CoinGecko)
   - `scoreContentRelevance(topic, responseBody, responseOk)` — 0-100 content match scoring
   - `discoverSourceForTopic(topic, method, timeoutMs)` — orchestrates discovery
   - `persistSourceToRegistry(registryPath, source)` — appends to YAML

3. **Three YAML registries:**
   - `agents/sentinel/sources-registry.yaml` — 50+ sources
   - `agents/crawler/sources-registry.yaml` — 100+ sources
   - `agents/pioneer/sources-registry.yaml` — 17 sources
   - Format: `{ version: 1, description: string, sources: SourceRecord[] }`
   - Each has agent-specific source selections and notes

### How session-runner.ts uses sources today:

```typescript
// In runGateAutonomous():
const sources = loadSourceRegistry(agentConfig.paths.sourcesRegistry);
const preflightResult = preflight(suggestion.topic, sources, agentConfig);
// If preflight fails → discoverSourceForTopic() → persistSourceToRegistry()

// In runPublishAutonomous():
const sources = loadSourceRegistry(agentConfig.paths.sourcesRegistry);
const preflightResult = preflight(suggestion.topic, sources, agentConfig);
// Same discovery fallback pattern
const plan = resolveAttestationPlan(gp.topic, agentConfig);
let requiredSelection = selectSourceForTopic(gp.topic, sources, plan.required);
```

### V2 loop (from Phase 2):
- `KNOWN_EXTENSIONS = ["calibrate", "sources", "observe"]` in state.ts
- `loop.extensions: [calibrate, sources, observe]` declared in all 3 persona.yaml files
- Extension hooks are **placeholders** — no loading/invocation mechanism exists yet

## What Phase 3 Plan Says

From the unified plan:

```
1. Create tools/lib/sources/ directory structure:
   - index.ts — runtime API: preflight(), match() (read-path only)
   - admin.ts — maintenance API: discover(), test(), updateRatings() (mutating)
   - policy.ts — from attestation-policy.ts
   - discovery.ts — from source-discovery.ts
   - catalog.ts — JSON catalog + inverted index (registry-v2 Phase 1)
2. Migrate 3 YAML registries → unified catalog.json
3. Wire source extension hooks into new core loop (preflight before draft, match after draft)
4. Update session-runner.ts to use source extension runtime API only
5. Ensure admin API is never imported in session-runner.ts
```

## What Needs Review (Specific Questions)

### Q1: catalog.json Record Schema

The plan mentions "JSON catalog + inverted index" but never defines the record shape. The current `SourceRecord` has 7 fields. The plan's canonical `SourceStatus` enum adds lifecycle states. The Codex review findings added `timeout`, `retry config`, `trustTier`.

**Please propose a concrete `SourceRecordV2` schema** that:
- Extends current `SourceRecord` with status, lifecycle, and rating fields
- Supports all 3 agents' sources in one catalog (how to handle agent-specificity?)
- Is backward-compatible enough for the YAML fallback (plan step: "Load YAML if catalog.json missing")

### Q2: Inverted Index Design

"Inverted index" is mentioned once, never specified. Questions:
- What keys? Topic tokens → source names? Tags → source IDs?
- In-memory or file-backed? Rebuilt on load or persisted?
- How does it interact with the current `tokenizeTopic` + `sourceTopicTokens` matching?

### Q3: Agent-Specific Sources in Unified Catalog

Currently each agent has its own YAML with curated sources. Sentinel has 50+, crawler 100+, pioneer 17. Some overlap, some don't.
- Does catalog.json contain ALL sources with an `agents: string[]` field?
- Or separate catalogs per agent?
- How does `loadSourceRegistry(agentConfig.paths.sourcesRegistry)` call site change?

### Q4: Import Graph — What Moves, What Stays

`attestation-policy.ts` has two concerns:
1. **Source concerns:** `SourceRecord`, `loadSourceRegistry`, `selectSourceForTopic`, `preflight`, `tokenizeTopic`, helpers
2. **Attestation concerns:** `resolveAttestationPlan`, `isHighSensitivityTopic`, `AttestationPlan` type

**Question:** Does `resolveAttestationPlan` move to `sources/policy.ts` or stay in `attestation-policy.ts`? It's called by session-runner and by `preflight()`. If it stays, `sources/policy.ts` needs to import from `attestation-policy.ts`. If it moves, session-runner needs to update its import.

**Please produce a concrete import graph** showing:
- What moves to which file in `sources/`
- What stays in `attestation-policy.ts` (if anything)
- What re-exports are needed for backward compat during migration
- How session-runner.ts imports change

### Q5: Extension Hook Wiring

The v2 loop has `KNOWN_EXTENSIONS = ["calibrate", "sources", "observe"]` and persona.yaml declares them, but **no extension loading/invocation mechanism exists**. Phase 2 hardcodes calibrate (calls runAudit) and observe (calls initObserver). There's no generic extension interface.

**Questions:**
- Should Phase 3 implement a generic extension interface? Or just hardcode `sources` like calibrate?
- If generic: what's the interface? `{ beforeSense?, beforeDraft?, afterDraft?, afterPublish? }`
- Where in `runV2Loop` do the source hooks fire? (The plan says "preflight before draft, match after draft" but which specific lines?)

### Q6: match() API — Post-Generation Source Verification

The plan introduces `match(postText, postTags)` as a new runtime API (find source that substantiates the post). This doesn't exist today. The current flow is: select source → attest → publish.

**Questions:**
- Does `match()` replace `selectSourceForTopic()` or supplement it?
- What does `match()` return? `{ source, url, confidence }?`
- If match fails post-generation, what happens? Skip publish? Use preflight source anyway?
- Is this the "two-pass matching" from Codex review finding #13?

### Q7: Migration Safety

The plan says "Fallback to old YAML loading during transition."
- How is the fallback triggered? Missing catalog.json? A flag?
- During migration, do both YAML and catalog.json exist simultaneously?
- What's the migration script? Manual? Automated?
- Can an agent run with YAML while another runs with catalog.json?

## Files to Read

```bash
# The unified plan (Phase 3 section + source canonical data)
cat Plans/unified-loop-architecture-v2.md

# Current source files
cat tools/lib/attestation-policy.ts
cat tools/lib/source-discovery.ts

# YAML registries (check first 30 lines of each for structure)
head -30 agents/sentinel/sources-registry.yaml
head -30 agents/crawler/sources-registry.yaml
head -30 agents/pioneer/sources-registry.yaml

# Session runner — source usage
grep -n "source\|preflight\|selectSource\|loadSource\|discovery\|attestation-policy\|source-discovery" tools/session-runner.ts

# V2 state types
grep -n "KNOWN_EXTENSIONS\|Extension\|sources" tools/lib/state.ts

# Agent configs — extension declarations
grep -A5 "extensions" agents/*/persona.yaml

# Source registry v2 subplan
cat Plans/source-registry-v2.md
```

## Output Format

For each question (Q1-Q7), provide:
- **Answer:** Concrete proposal (code/schema/diagram where applicable)
- **Rationale:** Why this approach over alternatives
- **Risks:** What could go wrong
- **Dependencies:** What else needs to change

Then provide overall findings as:
- **P0 (Critical):** Blockers that must be resolved before implementation
- **P1 (High):** Design gaps that will cause rework if not addressed
- **P2 (Medium):** Edge cases and ambiguities
- **P3 (Low):** Suggestions and nice-to-haves

**Final deliverable:** An updated Phase 3 implementation spec with concrete steps, file-by-file changes, and schema definitions — ready for someone to implement without ambiguity.
