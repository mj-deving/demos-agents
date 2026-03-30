# Roadmap: Measurement-First (v2, 2026-03-30)

> **Status:** Active — supersedes `roadmap-unified.md` and all prior workstream plans.
> **Derived from:** First-principles reevaluation + Codex review + Fabric design review.
> **Visual brief:** `~/.claude/diagrams/demos-agents-strategic-brief.html` (downstream rendering).

## Core Principle

**You can't improve what you can't measure.** Every improvement loop in this system is suspect until instrumented. Measure first, then build what makes sentinel's posts better. Everything else waits until it's needed.

## Context

First-principles analysis (2026-03-30) revealed:

- 75+ planned items accumulated across 13 sessions for 1 active agent (sentinel)
- Zero baseline quality metrics exist — every improvement claim is currently unfalsifiable
- "Matcher is the bottleneck" is inference from symptoms (threshold dropped 50→10), not measurement
- Source pipeline fetches succeed at 98.6% but fetch success ≠ evidence relevance
- No second consumer of the toolkit exists — architecture migration has no customer
- SuperColony API is dead (NXDOMAIN since 2026-03-26) — chain-only is permanent
- SDK verticals (StorageProgram, DemosWork, L2PS) are externally blocked with no fix timeline
- Reactive mode has 20 files already built — what's deferred is production deploy, not engineering
- 81 archived sources are a cheaper revival pool than writing new specs

### Review findings integrated

- **Codex commit review:** Dynamic `import()` boundary violations detected and fixed (ADR-0014)
- **Codex strategic brief review:** No baseline metrics, LLM cost/security unaddressed, H1 overscoped, reactive mode mischaracterized, 81 archived sources overlooked, keep list incomplete
- **Fabric design review (review_design + analyze_claims):** B+ overall. "Matcher is bottleneck" rated B (well-argued but unmeasured). "No customer for migration" rated A. H1 overscoped with two competing workstreams. LLM prompt injection risk unaddressed.

## Four Horizons (condition-triggered)

### H0 — Measure What Exists
**Status:** Active — instrumentation shipped (commit 3b55f3e), baseline capture in progress

**Foundation:** Session transcripts already exist (`src/lib/transcript.ts`, `cli/transcript-query.ts`, shipped 2026-03-24). JSONL event logger is wired into session-runner with 6 emit points (session-start/complete, phase-start/complete/error). `TranscriptMetrics` already tracks: gate pass/fail, attestation success/failed, per-phase latency, LLM calls, signals detected, reactions.

**Progress:**

- [x] **Match-level instrumentation** (commit `3b55f3e`, 2026-03-30) — `MatchScoreDetail` type added: per-axis scores (topic_relevance, body_match, metrics_overlap, metadata_match), composite, threshold, passed, candidate_sources, selected_source. Wired into matcher.ts pipeline, emitted to transcript JSONL.

- [x] **Source relevance tracking** (commit `3b55f3e`, 2026-03-30) — `SourceRelevanceEntry` type added: source_name, fetch_success, evidence_entries_found, evidence_relevance_score. Distinguishes "source is up" from "source is useful."

- [x] **Claim extraction quality logging** (commit `3b55f3e`, 2026-03-30) — `ClaimExtractionDetail` type added: claims[], extraction_method (regex/llm), claim_count. Logs what the matcher is working with.

- [ ] **Capture baseline from 5-10 real sessions** — Session 49 completed 2026-03-30 (1/5 minimum). Instrumentation confirmed working: MatchScoreDetail (per-axis), ClaimExtractionDetail (82 claims via LLM), SourceRelevanceEntry all captured. Early finding: body_match scores are 0-7 out of 25 possible — metadata carries the weight. Need 4+ more sessions.

- [ ] **Diagnose the actual bottleneck with data** — Is it the matcher scoring? Source evidence relevance? Claim extraction quality? Topic selection? The threshold dropping 50→10 is a symptom — data identifies the root cause.

**Trigger to start H1:** Baseline captured from ≥5 sessions. Root cause of quality issues identified with data, not assumption.

### H1a — Fix the Confirmed Bottleneck
**Status:** Parked (trigger: H0 complete)
**Estimated:** 1-2 sessions

4. **Fix whatever H0 data identifies** — Targeted fix based on data, not assumption. Likely the matcher, but let data decide. If matcher:
   - Calibrate scoring weights against real match data
   - Add LLM-assisted claim extraction (requires: cost estimate per session, 30s phase budget analysis, prompt injection security review for untrusted source content)
   - Threshold tuning with data-backed rationale

5. **Measure improvement** — Run 5+ sessions with the fix. Compare against H0 baseline on the same metrics.

**Rollback clause:** If post-fix metrics are worse than H0 baseline on any primary metric (match scores, gate pass rate, engagement), revert and re-diagnose before proceeding. Improvement is not assumed to be monotonic.

**Trigger to start H1b:** H1a metrics show ≥15% improvement in median match score OR ≥20% improvement in gate pass rate over H0 baseline. These thresholds are initial — adjust based on what H0 data reveals about variance.

### H1b — Colony Awareness
**Status:** Parked (trigger: H1a shows improvement)
**Estimated:** 1-2 sessions

6. **Build chain-only colony census** — Map who's active, what topics get engagement, which niches are underserved. Uses existing chain methods: `getHivePosts`, `getHiveReactionsByAuthor`, `getRepliesTo`. Must define minimum viable census: what network activity level makes census-driven topic selection better than current approach? Spike test RPC rate limits before building.

7. **Wire colony signals into topic selection** — Stop publishing blind. Use census data for topic selection. Measure impact against H0 baseline.

**Trigger to start H2:** H1b ships. Post-H1b metrics show measurable improvement over H0 baseline (engagement increase or topic diversity improvement).

### H2 — Iterate & Expand
**Status:** Parked (trigger: H1 + measurable improvement)
**Estimated:** Ongoing

8. **Measure improvement against baseline** — Compare H1a+H1b metrics to H0 baseline. Did match scores improve? Did gate pass rates change? Did engagement increase? If not, diagnose why before expanding.

9. **Auto-tune calibration** — Use transcript data to adjust confidence predictions. EMA smoothing (alpha=0.3), bounded offset ([-5,+15]), age-out after 20 sessions.

10. **Expand source catalog** — First: audit 81 archived sources for quick revival (cheaper than new specs). Then add new sources in underserved topic areas identified by colony census.

### H3 — Scale When Needed
**Status:** Parked (trigger: real second consumer or second agent)

11. **Toolkit packaging** — Extract @demos-agents/core as publishable package. Move files, remove 12 deprecated shims, set up proper exports.

12. **Agent composition** — Replace hook registration with skill-loader. Internalize plugin logic into plugin files. Phase 0 prerequisite (2-3 sessions) + Phases A-D.

13. **Reactive mode (production deploy)** — 20 files of reactive infrastructure already exist (`src/reactive/`, `cli/event-runner.ts`, 4 event sources, 6 handlers, generic `EventLoop<TAction>`). What's deferred is the operational decision to run it in production.

**Triggers (any one):** A real second consumer needs the toolkit (OpenClaw, ElizaOS). A real second agent needs to run. Chain event volume justifies real-time response over cron.

## Explicitly Deferred

| Item | Reason | Trigger to resume |
|------|--------|-------------------|
| Architecture migration Phase 2-4 | No consumer. Sentinel works on current structure. | Real second consumer |
| Agent composition framework | Only one agent exists. session-runner works. | Second agent needs to run |
| Export adapters (OpenClaw, ElizaOS) | Speculative. No active work on either. | Marius starts building one |
| Reactive mode production deploy | Cron works. 20 files already built. | Engagement data shows latency matters |
| Multi-agent Skill-Dojo clusters | Multiple prerequisite triggers not met | WS2 + WS4 triggers |
| SDK-blocked verticals | StorageProgram, DemosWork, L2PS bugs. Externally blocked. | KyneSys fixes |
| Desloppify target 85 | Currently 81.2. Diminishing returns. New H0/H1 code must not regress below 81.2. | Feature-driven, not standalone |
| Unified skill roadmap tiers 2-3 | Blocked on SDK bugs | KyneSys fixes |

## Explicitly Kept

| Item | Why |
|------|-----|
| Improvement loop (auto-tune) | Independent, zero-risk, directly helps calibration. Part of H2. |
| Source health automation | Already built and running. Maintains 98.6% pipeline health. |
| TDD discipline | 2022 tests, 138 suites. Non-negotiable. |
| Chain-only principle | Non-negotiable. Proven correct by API death. |
| Security-first principle (ADR-0007) | Real money on mainnet. executeChainTx() mandatory. |
| SDK interaction guidelines | 14 rules at `.ai/guides/sdk-interaction-guidelines.md`. Mandatory. |
| New code goes in toolkit/ paths | Prevents increasing migration debt during H1/H2. |
| ADR convention | Keep documenting decisions. Stop planning unriggered work. |
| Architecture enforcement (ADR-0014) | Boundary test + placement rules + ADR auto-discovery. |
| Reactive infrastructure maintenance | 20 files need test coverage even while deploy is deferred. |

## Supersedes

- `docs/roadmap-unified.md` — Superseded by this document (skill roadmap tiers are deferred)
- `docs/phase5-agent-composition-plan.md` — Deferred to H3
- `docs/design-toolkit-architecture.md` — Packaging deferred to H3
- Memory: `project_four_workstreams_plan.md` — WS2-4 deferred
- Memory: `project_toolkit_architecture.md` — Packaging deferred
- Memory: `project_pr5_matcher_hardening.md` — Now H1 item 4, gated by H0 data
