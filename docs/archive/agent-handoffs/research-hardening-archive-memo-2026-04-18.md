---
summary: Archaeology of proven research hardening patterns across the repo — what to reuse, revive, or avoid for the next hardening wave after PR #143 and #144.
read_when: planning research evidence hardening, source normalization, or family-specific guardrails work
---

# Research Hardening Archive Memo — 2026-04-18

## Purpose

PR #143 (prefer source exports over stale dist) and PR #144 (skip unsupported research families earlier) fix the gross fallback problems. This memo catalogs **proven patterns already in the repo** for the next hardening wave: semantic evidence validation, source normalization, family-specific guardrails, colony substrate hydration, self-history deltas, and anti-generic-source doctrine.

---

## 1. Source Normalization — REUSE DIRECTLY

These patterns are battle-tested, production-stable, and well-tested.

### 1a. URL Pattern Normalization
- **File:** `src/toolkit/sources/catalog.ts:241-255`
- **Function:** `normalizeUrlPattern(url)` — strips protocol, trailing slashes, sorts query params, neutralizes template variables (`{id}` → `{VAR}`)
- **Tests:** `tests/sources/catalog-direct.test.ts:342-370`
- **Status:** Proven. Used for deduplication across the entire catalog.

### 1b. Deterministic Source ID Generation
- **File:** `src/toolkit/sources/catalog.ts:299-308`
- **Function:** `generateSourceId(provider, normalizedUrlPattern)` — `{provider}-{8-char-hex-hash}`
- **Status:** Proven. Foundation of the catalog identity system.

### 1c. V1→V2 Source Record Conversion
- **File:** `src/toolkit/sources/catalog.ts:320-386`
- **Function:** `normalizeSourceRecord(v1, importedFrom, timestamp)` — infers provider, normalizes URL pattern, generates ID, sets defaults
- **Status:** Proven. Used during YAML migration.

### 1d. Topic Tokenization
- **File:** `src/toolkit/sources/catalog.ts:211-232`
- **Functions:** `tokenizeTopic(text)`, `sourceTopicTokens(source)` — canonical lowercase split
- **Status:** Proven. Used by policy.ts, matcher.ts, and all index lookups.

### 1e. Topic-to-Domain Vocabulary Expansion
- **File:** `src/toolkit/sources/topic-vocabulary.ts`
- **Functions:** `expandTopicToDomains(tokens, knownDomainTags)`, `fuzzyMatchDomainTags(token, knownTags)`
- **Status:** Proven. Three-layer expansion: direct → curated vocabulary → fuzzy stem matching.

---

## 2. Anti-Generic-Source Doctrine — REUSE DIRECTLY

### 2a. Adapter Registration Gate (Codex P0.2)
- **File:** `src/toolkit/sources/policy.ts:40-45, 99-107`
- **Function:** `hasRegisteredAdapter(source)` — returns false if `provider === "generic"` or no adapter found
- **Gate:** Active/degraded sources without a registered non-generic adapter are rejected from runtime
- **Status:** Proven. This is the core defense against off-topic generic evidence.

### 2b. Generic Adapter as Quarantine Fallback Only
- **File:** `src/lib/sources/providers/generic.ts` (or `src/toolkit/providers/generic.ts`)
- **Pattern:** Generic adapter's `supports()` only returns true for `quarantined` sources
- **Status:** Proven. Enforces adapter completeness before runtime use.

### 2c. Provider Adapter System
- **File:** `src/lib/sources/providers/index.ts`
- **Pattern:** Declarative YAML specs loaded at init; registry maps provider → adapter
- **Interface:** `supports()`, `buildCandidates()`, `validateCandidate()`, `parseResponse()`
- **Status:** Proven. The mechanism-layer replacement for hand-written URL templates.

---

## 3. Semantic Evidence Validation — REUSE DIRECTLY

### 3a. Two-Pass Matching System (Preflight → Generate → Match)
- **Preflight:** `src/toolkit/sources/policy.ts:340-412` — no-network check for source availability
- **Match:** `src/toolkit/sources/matcher.ts:692-877` — post-generation draft-evidence alignment

### 3b. Match Scoring Architecture (0-100, threshold 9)
- **File:** `src/toolkit/sources/matcher.ts:36, 439-530`
- **Axes:** title match (0-25), body match (0-25), topic overlap (0-20), metrics overlap (0-15), source metadata (0-15)
- **Threshold history:** 50 → 30 → 10 → 9 (production-calibrated; DAHR attestation proves provenance, match is secondary sanity check)
- **Status:** Proven. Well-calibrated through production testing.

### 3c. Claim Extraction (Regex + Optional LLM)
- **File:** `src/toolkit/sources/matcher.ts:87-183`
- **Functions:** `extractClaims(postText, postTags)` (regex), `extractClaimsLLM(postText, postTags, llm)` (LLM-assisted)
- **Pattern:** LLM claims merged on top of regex claims; falls back to regex-only when LLM unavailable
- **Status:** Proven. Dual-mode extraction.

### 3d. Cross-Source Diversity Scoring
- **File:** `src/toolkit/sources/matcher.ts:393-416`
- **Function:** `calculateDiversityBonus(scoredCandidates)` — +5 pts per claim corroborated by 2+ sources, capped at 15
- **Status:** Proven. Applied only to contributing candidates.

### 3e. Body Match with LLM Fallback
- **File:** `src/toolkit/sources/matcher.ts:193-311`
- **Functions:** `scoreBodyMatchHeuristic(claims, entries)`, `scoreBodyMatchLLM(claims, entries, llm)`
- **Pattern:** LLM scoring first, falls back to heuristic regex matching on failure
- **Status:** Proven.

---

## 4. Colony Evidence Pipeline — REUSE DIRECTLY

### 4a. Available Evidence Computation
- **File:** `src/toolkit/colony/available-evidence.ts`
- **Function:** `computeAvailableEvidence(db, catalogSources, now)`
- **Pattern:** Circuit breaker (≥3 consecutive failures → skip), freshness gate (age > TTL → skip), richness scoring (log-interpolated response size → 0-100)
- **Status:** Proven.

### 4b. Strategy-Driven Observe Router
- **File:** `src/toolkit/observe/observe-router.ts`
- **Function:** `strategyObserve(toolkit, config, sourceDeps?)` — two evidence streams (colony Learn + external Share) merged in parallel
- **Pattern:** Single-fetch architecture with prefetched data; extractors run on shared prefetch results
- **Status:** Proven. The backbone of the observe phase.

### 4c. Learn-First Observe
- **File:** `src/toolkit/observe/learn-first-observe.ts`
- **Function:** `learnFirstObserve(toolkit, ourAddress, strategyPath?, sourceDeps?)` — wraps strategyObserve with colony state building
- **Status:** Proven. Used by all templates.

---

## 5. Deduplication — REUSE DIRECTLY

### 5a. Self-Dedup (Did We Already Post This?)
- **File:** `src/toolkit/colony/dedup.ts:197-238`
- **Function:** `checkSelfDedup(db, claim, ourAddress, windowHours=12)` — direct DB query + bigram similarity (threshold 0.4)
- **Status:** Proven.

### 5b. Colony-Wide Claim Dedup
- **File:** `src/toolkit/colony/dedup.ts:138-190`
- **Function:** `checkClaimDedup(db, claim, opts?)` — two-phase: FTS5 phrase retrieval → bigram Jaccard post-filter (threshold 0.3)
- **Status:** Proven.

### 5c. Semantic Dedup (Vector-Based)
- **File:** `src/toolkit/colony/dedup.ts:248-280`
- **Function:** `checkSemanticDedup(db, claim, opts?)` — cosine distance via embeddings (threshold 0.3), async
- **Status:** Proven but depends on embedding availability. Falls back gracefully.

### 5d. Topic Similarity
- **File:** `src/toolkit/colony/dedup.ts:69-101`
- **Function:** `computeTopicSimilarity(topicA, topicB)` — weighted unigram (45%) + bigram (55%) overlap coefficient
- **Status:** Proven. Pure function, no DB required.

---

## 6. Family-Specific Research System — REUSE DIRECTLY (Package Layer)

These are newer package-level modules. They represent the most sophisticated research hardening patterns in the repo.

### 6a. Research Family Detection
- **File:** `packages/omniweb-toolkit/src/research-source-profile.ts`
- **Type:** `ResearchTopicFamily` — 6 supported families + "unsupported"
- **Function:** `deriveResearchSourceProfile(topic)` — keyword-based classification → source mapping
- **Families:** funding-structure, etf-flows, spot-momentum, network-activity, stablecoin-supply, vix-credit
- **Status:** Proven. Each family maps to specific source IDs and expected metrics.

### 6b. Family-Specific Dossiers & Guardrails
- **File:** `packages/omniweb-toolkit/src/research-family-dossiers.ts`
- **Type:** `ResearchBrief` — baseline context, focus points, false inference guards, anomaly summary, allowed thesis space, invalidation focus, linked themes
- **Per-Family Build Functions:** `buildVixCreditBrief()`, `buildFundingStructureBrief()`, `buildEtfFlowsBrief()`, `buildSpotMomentumBrief()`, `buildStablecoinSupplyBrief()`
- **Status:** Proven. Each family has specific metric-driven brief generation and linked theme detection.

### 6c. Baseline Slip Detection
- **File:** `packages/omniweb-toolkit/src/research-draft.ts:150-227`
- **Patterns:** Family-specific regex patterns that detect when the LLM falls back to restating baseline facts as thesis
- **Examples:**
  - Stablecoin: treating "still at $1" as insight
  - Funding: treating negative rate alone as bearish proof
  - VIX: treating elevated VIX as proof of crash
- **Status:** Proven. Quality gate checks these after LLM generation.

---

## 7. Self-History / Prior-Post Delta — REUSE DIRECTLY (Package Layer)

### 7a. Research Self-History Summary
- **File:** `packages/omniweb-toolkit/src/research-self-history.ts`
- **Function:** `buildResearchSelfHistory(opts)` — finds last same-topic and same-family posts, computes evidence deltas, determines repeat risk
- **Skip Logic:** high risk (same topic, no material change in 7d → skip); high risk (same family, no material change in 24h → skip)
- **Status:** Proven. Tests at `tests/packages/research-self-history.test.ts`.

### 7b. Evidence Delta Tracking
- **File:** `packages/omniweb-toolkit/src/research-evidence-delta.ts`
- **Function:** `buildResearchEvidenceDelta(previous, current)` — computes absolute and percent changes for numeric evidence values
- **Thresholds:** 1% percent change OR 0.001 absolute change
- **Status:** Proven.

---

## 8. Colony Substrate Hydration — REUSE DIRECTLY (Package Layer)

### 8a. Colony Substrate Structure
- **File:** `packages/omniweb-toolkit/src/research-colony-substrate.ts`
- **Type:** `ResearchColonySubstrate` — signal summary, supporting takes (≤3), dissenting take, cross-references, reaction summary, recent related posts (≤3)
- **Function:** `buildResearchColonySubstrate(opportunity, allPosts)`
- **Status:** Proven. Wired into research draft prompt packet.

### 8b. Colony State Extraction (Older Pattern)
- **File:** `src/toolkit/colony/state-extraction.ts`
- **Function:** `extractColonyState(db, options)` — activity, gaps, threads, agents, valuable posts
- **Status:** Proven. This is the older, broader colony state function used by the V3 loop generally. The research-colony-substrate module is the newer, research-specific refinement.

---

## 9. Mistakes We Are Repeating / Should Avoid

### 9a. Contaminated Branch Pattern
- **PR #128** (closed) → clean re-cut as **PR #133** (merged): source identity in research evidence
- **PR #131** (closed) → clean re-cut as **PR #137** (merged): research evidence grounding
- **Lesson:** When a branch carries problematic merge history, cut a fresh branch from `main` rather than trying to fix the old one. Comments explicitly say "stale ancestry."

### 9b. Meta-Leak Detection Is Iterative
- **PR #112** caught obvious leaks (scoring, attestation workflow language)
- **PR #137** extended guards for rephrased variants ("high score", "underrepresented") — the LLM paraphrases internal metadata
- **Lesson:** Leak guard patterns need ongoing expansion as the LLM finds new ways to surface internals.

### 9c. Match Threshold Over-Calibration
- Threshold was lowered from 50 → 30 → 10 → 9 through production testing
- **Risk:** Further lowering defeats the purpose of the sanity check. The current 9 is intentionally minimal because DAHR attestation proves provenance.
- **Lesson:** Don't lower the threshold again — instead improve evidence quality at the source level.

### 9d. Readback Divergence (Unsolved)
- **PR #122** proved live publish+attestation but readback remained delayed (~41s)
- **PR #125** (open) documents the divergence
- **PR #126** (open) adds author-feed fallback as mitigation
- **Lesson:** This is a platform constraint, not a code bug. Don't design around instant readback.

---

## 10. Integration Gaps — What Is NOT Yet Wired

### 10a. Package Research Modules → Session Runner
The entire `packages/omniweb-toolkit/src/research-*.ts` family of modules is **well-designed and tested** but its integration into the live session runner (`cli/session-runner.ts`) may be partial or indirect. Specifically:

- `research-source-profile.ts` — family detection is used but family → source mapping may not be fully integrated with the live catalog pipeline
- `research-self-history.ts` — wired via PR #123, but publish history persistence (where are `ResearchPublishHistoryEntry` records stored between sessions?) needs verification
- `research-colony-substrate.ts` — wired via PR #120, but fullness of hydration depends on colony DB population
- `research-family-dossiers.ts` — builds the brief, but integration with the prompt packet in the live session runner needs verification
- `research-draft.ts` — quality gate with baseline slip patterns may not be called in the live publish executor path

### 10b. Families Without Live Candidates
Per `packages/omniweb-toolkit/references/research-e2e-matrix-2026-04-18.md`:
- **Draft-ready:** spot-momentum, stablecoin-supply, vix-credit
- **No live candidate:** funding-structure, etf-flows, network-activity
- These families have dossiers and guardrails but no live evidence sources producing data right now.

### 10c. Network-Activity Family Has No Dossier
- Unlike the other 5 families, `network-activity` falls through to `GENERIC_DOSSIER` in `research-family-dossiers.ts`
- No baseline rules, false inference guards, or linked themes for this family yet.

---

## 11. Ranked Next Coding Steps (After PR #143 and #144)

### Priority 1: Wire Package Research Modules Into Session Runner
1. **Verify research-self-history persistence** — ensure `ResearchPublishHistoryEntry` records survive between sessions (colony DB or state file)
2. **Verify research-family-dossiers integration** — confirm brief-building is called in the live publish path, not just in tests
3. **Verify baseline slip quality gate** — confirm `checkResearchDraftQuality()` is called post-LLM-generation in the live executor

### Priority 2: Expand Family Coverage
4. **Add network-activity dossier** — create baseline rules, false inference guards, and linked themes analogous to other 5 families
5. **Activate funding-structure sources** — verify `binance-futures-btc` and `binance-futures-oi-btc` are in the catalog as active sources with working adapters
6. **Activate etf-flows sources** — verify `btcetfdata-current-btc` is in the catalog with a working adapter

### Priority 3: Strengthen Evidence Quality
7. **Expand meta-leak guard patterns** — add more paraphrase variants beyond what PR #137 caught
8. **Add evidence freshness to research brief** — include time-since-fetch in the anomaly summary so the LLM knows how stale the data is
9. **Cross-source corroboration for research** — adapt the diversity bonus from `matcher.ts` to the research pipeline

### Priority 4: Operational Hardening
10. **Readback verification** — land PR #125 (document divergence) and PR #126 (author-feed fallback)
11. **End-to-end research trajectory tests** — add evals for each supported family from opportunity → draft → quality gate → publish
12. **VIX adapter robustness** — the `vix-adapter.ts` CSV parser is fragile; verify the CBOE JSON migration (PR #122) is fully wired

---

## Appendix: File Reference Quick-Index

| Domain | Key File | Lines |
|--------|----------|-------|
| Source normalization | `src/toolkit/sources/catalog.ts` | 211-386 |
| Anti-generic doctrine | `src/toolkit/sources/policy.ts` | 40-107 |
| Evidence matching | `src/toolkit/sources/matcher.ts` | 36-877 |
| Topic vocabulary | `src/toolkit/sources/topic-vocabulary.ts` | 1-138 |
| Available evidence | `src/toolkit/colony/available-evidence.ts` | 1-85 |
| Colony state | `src/toolkit/colony/state-extraction.ts` | 1-290 |
| Deduplication | `src/toolkit/colony/dedup.ts` | 1-291 |
| Observe router | `src/toolkit/observe/observe-router.ts` | 1-316 |
| Family detection | `packages/omniweb-toolkit/src/research-source-profile.ts` | 1-240 |
| Family dossiers | `packages/omniweb-toolkit/src/research-family-dossiers.ts` | 1-519 |
| Self-history | `packages/omniweb-toolkit/src/research-self-history.ts` | 1-120 |
| Evidence delta | `packages/omniweb-toolkit/src/research-evidence-delta.ts` | 1-66 |
| Colony substrate | `packages/omniweb-toolkit/src/research-colony-substrate.ts` | 1-126 |
| Draft + quality gate | `packages/omniweb-toolkit/src/research-draft.ts` | 1-390 |
| VIX adapter | `src/toolkit/sources/vix-adapter.ts` | 1-37 |
| Publish executor | `cli/publish-executor.ts` | 1-148+ |
| Publish helpers | `cli/publish-helpers.ts` | 1-200+ |
| Sentinel strategy | `agents/sentinel/strategy.yaml` | 1-132 |
