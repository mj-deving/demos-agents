You are a focused subagent reviewer for a single holistic investigation batch.

Repository root: /home/mj/projects/demos-agents
Blind packet: /home/mj/projects/demos-agents/.desloppify/review_packet_blind.json
Batch index: 17
Batch name: design_coherence
Batch rationale: design_coherence review

DIMENSION TO EVALUATE:

## design_coherence
Are structural design decisions sound — functions focused, abstractions earned, patterns consistent?
Look for:
- Functions doing too many things — multiple distinct responsibilities in one body
- Parameter lists that should be config/context objects — many related params passed together
- Files accumulating issues across many dimensions — likely mixing unrelated concerns
- Deep nesting that could be flattened with early returns or extraction
- Repeated structural patterns that should be data-driven
Skip:
- Functions that are long but have a single coherent responsibility
- Parameter lists where grouping would obscure meaning — do NOT recommend config/context objects or dependency injection wrappers just to reduce parameter count; only group when the grouping has independent semantic meaning
- Files that are large because their domain is genuinely complex, not because they mix concerns
- Nesting that is inherent to the problem (e.g., recursive tree processing)
- Do NOT recommend extracting callable parameters or injecting dependencies for 'testability' — direct function calls are simpler and preferred unless there is a concrete decoupling need

YOUR TASK: Read the code for this batch's dimension. Judge how well the codebase serves a developer from that perspective. The dimension rubric above defines what good looks like. Cite specific observations that explain your judgment.

Mechanical scan evidence — navigation aid, not scoring evidence:
The blind packet contains `holistic_context.scan_evidence` with aggregated signals from all mechanical detectors — including complexity hotspots, error hotspots, signal density index, boundary violations, and systemic patterns. Use these as starting points for where to look beyond the seed files.

Previously flagged issues — navigation aid, not scoring evidence:
Check whether open issues still exist. Do not re-report resolved or deferred items.
If several past issues share a root cause, call that out.

  Still open (2):
    - [open] source-discovery.ts has 4 explicit any types including extractTitles closure
    - [open] engage-heuristics.ts has 2 explicit any types in engagement scoring

  Resolved (17):
    - [false_positive] attestation-executor.ts (119 LOC) is orphaned with zero importers
    - [false_positive] mentions.ts (148 LOC) is orphaned with zero importers
    - [false_positive] transcript.ts (175 LOC) is orphaned with zero importers
    - [false_positive] predictions.ts (391 LOC) is orphaned with zero importers
    - [false_positive] tips.ts (443 LOC) is orphaned with zero importers — largest dead file
    - [false_positive] sse-feed.ts (244 LOC) is orphaned reactive event source with zero importers
    - [false_positive] Entire reactive/ subsystem (~1650 LOC) is orphaned — event-loop.ts, most event-sources, all event-handlers have zero importers
    - [false_positive] tips.ts (443 LOC), predictions.ts (391 LOC), mentions.ts (148 LOC), transcript.ts (175 LOC) in src/lib/ are orphaned with zero importers
    - [false_positive] action-executor.ts is orphaned (320 LOC) with 22-field context interface and has active test suite
    - [fixed] sdk-bridge.ts apiCall catch returns { ok: false, status: 0, data: errorMessage } — callers cannot distinguish error types (note: ApiCallResult now has errorType field for structured error discrimination.)
    - [fixed] publish-pipeline.ts accumulates 6 explicit 'any' types and 8 'as any' casts in data normalization (note: DahrProxy interface replaces (demos as any). normalizeFeedPosts already fixed (previous session). AttestResult.data typed as unknown.)
    - [fixed] tlsn-playwright-bridge.ts has 15 'as any' casts for untyped SDK surface — justified but should have interface (note: DemosExtended interface replaces all 7 (demos as any) casts.)
    - [fixed] signals.ts normalizeSignalTopic and normalizeSignalAlert accept 'any' parameter where API shapes are known (note: normalizeSignalTopic and normalizeSignalAlert now use unknown with Record cast.)
    - [fixed] tlsn-playwright-bridge.ts has 13+ as-any casts for untyped SDK surface
    - [fixed] signals.ts has 4 explicit any types in API response normalization
    - [fixed] ~2600 LOC across 20+ orphaned files with zero importers persist in the codebase
    - [fixed] publish-pipeline.ts has 6 explicit any types in data normalization and API response handling

Explore past review issues:
  desloppify show review --no-budget              # all open review issues
  desloppify show review --status deferred         # deferred issues

Mechanical concern signals — investigate and adjudicate:
Overview (23 signals):
  design_concern: 20 — src/actions/attestation-executor.ts, src/actions/llm.ts, ...
  duplication_design: 1 — src/actions/publish-pipeline.ts
  mixed_responsibilities: 1 — src/actions/action-executor.ts
  systemic_pattern: 1 — src/lib/agent-config.ts

For each concern, read the source code and report your verdict in issues[]:
  - Confirm → full issue object with concern_verdict: "confirmed"
  - Dismiss → minimal object: {concern_verdict: "dismissed", concern_fingerprint: "<hash>"}
    (only these 2 fields required — add optional reasoning/concern_type/concern_file)
  - Unsure → skip it (will be re-evaluated next review)

  - [design_concern] src/actions/attestation-executor.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (119 LOC): zero importers, not an entry point
    fingerprint: 56951e0173d7bbe2
  - [design_concern] src/actions/llm.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x High cyclomatic complexity (>15 branches)
    fingerprint: 90d6b667214e1a11
  - [design_concern] src/lib/mentions.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (148 LOC): zero importers, not an entry point
    fingerprint: 2c54138f0c5c11b9
  - [design_concern] src/lib/network/sdk.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x Catch block returns default object (silent failure)
    fingerprint: d2b0d8fa890b94fe
  - [design_concern] src/lib/pipeline/engage-heuristics.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 2x Explicit `any` types
    fingerprint: 164dc3b3503fa619
  - [design_concern] src/lib/pipeline/signals.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 2x Explicit `any` types
    fingerprint: 99037fdeeada6bb8
  - [design_concern] src/lib/pipeline/source-discovery.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 4x Explicit `any` types
    fingerprint: 66c05d8b32241962
  - [design_concern] src/lib/predictions.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (391 LOC): zero importers, not an entry point
    fingerprint: 113391782ba4882e
  - [design_concern] src/lib/state.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 8x `as any` type casts
    fingerprint: 15c25f166a4753c3
  - [design_concern] src/lib/tips.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (442 LOC): zero importers, not an entry point
    fingerprint: c59f6576bc09e56b
  - [design_concern] src/lib/tlsn-playwright-bridge.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 5x `as any` type casts
    fingerprint: f66bc965a2bac8a7
  - [design_concern] src/lib/transcript.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (175 LOC): zero importers, not an entry point
    fingerprint: 3d0801ef220d2211
  - [design_concern] src/lib/util/extensions.ts
    summary: Design signals from cycles, smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: cycles, smells
    evidence: [smells] 1x Switch without default case
    fingerprint: 62f5f3833bcfe61d
  - [design_concern] src/lib/util/log.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x Explicit `any` types
    fingerprint: a138b17dbf9c0583
  - [design_concern] src/plugins/lifecycle-plugin.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x High cyclomatic complexity (>15 branches)
    fingerprint: 488c0f3f5e5d4f57
  - [design_concern] src/plugins/sc-oracle-plugin.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x `as any` type casts
    fingerprint: 5f858914ea15c390
  - [design_concern] src/plugins/sc-prices-plugin.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x `as any` type casts
    fingerprint: 8328b89fc8a422e5
  - [design_concern] src/reactive/event-sources/sse-feed.ts
    summary: Design signals from orphaned, smells
    question: Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, smells
    evidence: [orphaned] Orphaned file (244 LOC): zero importers, not an entry point
    fingerprint: c7b250c38e95483b
  - [design_concern] src/toolkit/guards/pay-spend-cap.ts
    summary: Design signals from smells
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells
    evidence: [smells] 1x Magic numbers (>1000 in logic)
    fingerprint: 3494325a4886bdf9
  - [design_concern] src/toolkit/sdk-bridge.ts
    summary: Design signals from smells, structural
    question: Review the flagged patterns — are they design problems that need addressing, or acceptable given the file's role?
    evidence: Flagged by: smells, structural
    evidence: File size: 917 lines
    fingerprint: 2973c470c1119c80
  - [duplication_design] src/actions/publish-pipeline.ts
    summary: Duplication pattern — assess if extraction is warranted
    question: Is the duplication worth extracting into a shared utility, or is it intentional variation?
    evidence: Flagged by: dupes, smells
    evidence: [smells] 6x Explicit `any` types
    fingerprint: f9cc9607cbc7cd87
  - [mixed_responsibilities] src/actions/action-executor.ts
    summary: Issues from 3 detectors — may have too many responsibilities
    question: This file has issues across 3 dimensions (orphaned, props, smells). Is it trying to do too many things, or is this complexity inherent to its domain? Is this file truly dead, or is it used via a non-import mechanism (dynamic import, CLI entry point, plugin)?
    evidence: Flagged by: orphaned, props, smells
    evidence: [props] Bloated context: ActionExecutorContext (21 fields)
    fingerprint: 8402699e80d43225
  - [systemic_pattern] src/lib/agent-config.ts
    summary: 6 files share the same problem pattern (smells, structural)
    question: These 6 files all have the same combination of issues (smells, structural). Is this a systemic pattern that should be addressed at the architecture level (shared base class, framework change, lint rule), or are these independent issues that happen to look similar?
    evidence: Affected files: src/lib/agent-config.ts, src/lib/pipeline/signal-detection.ts, src/lib/sources/catalog.ts, src/lib/sources/matcher.ts, src/lib/sources/providers/declarative-engine.ts, src/toolkit/sdk-bridge.ts
    evidence: Shared detectors: smells, structural
    fingerprint: ac32950677f7ed98

RELEVANT FINDINGS — explore with CLI:
These detectors found patterns related to this dimension. Explore the findings,
then read the actual source code.

  desloppify show cycles --no-budget      # 1 findings
  desloppify show dupes --no-budget      # 1 findings
  desloppify show orphaned --no-budget      # 7 findings
  desloppify show props --no-budget      # 1 findings
  desloppify show smells --no-budget      # 134 findings
  desloppify show structural --no-budget      # 6 findings
  desloppify show unused --no-budget      # 32 findings

Report actionable issues in issues[]. Use concern_verdict and concern_fingerprint
for findings you want to confirm or dismiss.

Phase 1 — Observe:
1. Read the blind packet's `system_prompt` — scoring rules and calibration.
2. Study the dimension rubric (description, look_for, skip).
3. Review the existing characteristics list — which are settled? Which are positive? What needs updating?
4. Explore the codebase freely. Use scan evidence, historical issues, and mechanical findings as navigation aids.
5. Adjudicate mechanical concern signals (confirm/dismiss with fingerprint).
6. Augment the characteristics list via context_updates: positive patterns (positive: true), neutral characteristics, design insights.
7. Collect defects for issues[].
8. Respect scope controls: exclude files/directories marked by `exclude`, `suppress`, or non-production zone overrides.
9. Output a Phase 1 summary: list ALL characteristics for this dimension (existing + new, mark [+] for positive) and all defects collected. This is your consolidated reference for Phase 2.

Phase 2 — Judge (after Phase 1 is complete):
10. Keep issues and scoring scoped to this batch's dimension.
11. Return 0-10 issues for this batch (empty array allowed).
12. For design_coherence, use evidence from `holistic_context.scan_evidence.signal_density` — files where multiple mechanical detectors fired. Investigate what design change would address multiple signals simultaneously. Check `scan_evidence.complexity_hotspots` for files with high responsibility cluster counts.
13. Workflow integrity checks: when reviewing orchestration/queue/review flows,
14. xplicitly look for loop-prone patterns and blind spots:
15. - repeated stale/reopen churn without clear exit criteria or gating,
16. - packet/batch data being generated but dropped before prompt execution,
17. - ranking/triage logic that can starve target-improving work,
18. - reruns happening before existing open review work is drained.
19. If found, propose concrete guardrails and where to implement them.
20. Complete `dimension_judgment`: write dimension_character (synthesizing characteristics and defects) then score_rationale. Set the score LAST.
21. Output context_updates with your Phase 1 observations. Use `add` with a clear header (5-10 words) and description (1-3 sentences focused on WHY, not WHAT). Positive patterns get `positive: true`. New insights can be `settled: true` when confident. Use `settle` to promote existing unsettled insights. Use `remove` for insights no longer true. Omit context_updates if no changes.
22. Do not edit repository files.
23. Return ONLY valid JSON, no markdown fences.

Scope enums:
- impact_scope: "local" | "module" | "subsystem" | "codebase"
- fix_scope: "single_edit" | "multi_file_refactor" | "architectural_change"

Output schema:
{
  "batch": "design_coherence",
  "batch_index": 17,
  "assessments": {"<dimension>": <0-100 with one decimal place>},
  "dimension_notes": {
    "<dimension>": {
      "evidence": ["specific code observations"],
      "impact_scope": "local|module|subsystem|codebase",
      "fix_scope": "single_edit|multi_file_refactor|architectural_change",
      "confidence": "high|medium|low",
      "issues_preventing_higher_score": "required when score >85.0",
      "sub_axes": {"abstraction_leverage": 0-100, "indirection_cost": 0-100, "interface_honesty": 0-100, "delegation_density": 0-100, "definition_directness": 0-100, "type_discipline": 0-100}  // required for abstraction_fitness when evidence supports it; all one decimal place
    }
  },
  "dimension_judgment": {
    "<dimension>": {
      "dimension_character": "2-3 sentences characterizing the overall nature of this dimension, synthesizing both positive characteristics and defects",
      "score_rationale": "2-3 sentences explaining the score, referencing global anchors"
    }  // required for every assessed dimension; do not omit
  },
  "issues": [{
    "dimension": "<dimension>",
    "identifier": "short_id",
    "summary": "one-line defect summary",
    "related_files": ["relative/path.py"],
    "evidence": ["specific code observation"],
    "suggestion": "concrete fix recommendation",
    "confidence": "high|medium|low",
    "impact_scope": "local|module|subsystem|codebase",
    "fix_scope": "single_edit|multi_file_refactor|architectural_change",
    "root_cause_cluster": "optional_cluster_name_when_supported_by_history",
    "concern_verdict": "confirmed|dismissed  // for concern signals only",
    "concern_fingerprint": "abc123  // required when dismissed; copy from signal fingerprint",
    "reasoning": "why dismissed  // optional, for dismissed only"
  }],
  "retrospective": {
    "root_causes": ["optional: concise root-cause hypotheses"],
    "likely_symptoms": ["optional: identifiers that look symptom-level"],
    "possible_false_positives": ["optional: prior concept keys likely mis-scoped"]
  },
  "context_updates": {
    "<dimension>": {
      "add": [{"header": "short label", "description": "why this is the way it is", "settled": true|false, "positive": true|false}],
      "remove": ["header of insight to remove"],
      "settle": ["header of insight to mark as settled"],
      "unsettle": ["header of insight to unsettle"]
    }  // omit context_updates entirely if no changes
  }
}

// context_updates example:
{
  "naming_quality": {
    "add": [
      {
        "header": "Short utility names in base/file_paths.py",
        "description": "rel(), loc() are deliberately terse \u2014 high-frequency helpers where brevity aids readability at call sites. Full names would add noise without improving clarity.",
        "settled": true,
        "positive": true
      }
    ],
    "settle": [
      "Snake case convention"
    ]
  }
}
