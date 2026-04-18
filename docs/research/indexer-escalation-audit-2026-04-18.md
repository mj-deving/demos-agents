---
summary: "Audit of the indexer-escalation PR cluster (#128-#132), merge-order recommendation, and escalation-bundle completeness assessment."
read_when: ["indexer escalation audit", "merge order PRs 128-132", "upstream escalation readiness", "PR 129 vs 130"]
---

# Indexer Escalation Audit — April 18, 2026

## 1. PR #129 vs PR #130: Overlap, Unique Value, and Disposition

### Overlap

Both PRs analyze the same three missing txs (`835a6c5c`, `a4edc442`, `fd868d54`) and the same indexed reference (`44f24253`). Both share ~10 boilerplate files branched from the same `main` state. Both conclude the root cause is indexer-side, not the toolkit publish path.

### Contradictions

None. The hypotheses in #129 (H1: tx-type blind spot, H2: block-range gap) are directionally confirmed by #130's probe findings.

### Unique value of each

**PR #129** (`claude-readback-audit`):
- PR review of PRs #125-#127 for regressions — NOT in #130
- Doc audit (SKILL.md auth-gating gap, GUIDE.md readback doctrine gap) — NOT in #130
- 4 ranked falsifiable hypotheses — superseded by #130's actual probe results

**PR #130** (`tx-format-probe`):
- Executable probe script: `check-indexing-miss-probe.ts` (+292 lines) — NOT in #129
- Raw SDK comparison: indexed tx returns `storage-array` wrapper with hive keys (`v`, `cat`, `text`, `tags`, `confidence`, `sourceAttestations`); missing txs return empty envelope (`wrapper: unknown`, `rawContentKeys: []`, `hiveKeys: []`) — NOT in #129
- Block-range scan: 67 hive posts in blocks 2109138-2109139, only 4 in generic ANALYSIS feed, **94% NOT indexed**, 13 distinct authors — NOT in #129
- Other-author misses: 4 txs from `0x59ad45...` (categories SIGNAL, OPINION) — NOT in #129
- Probe results artifact: `/tmp/indexing-miss-probe.json` — NOT in #129

### Verdict

PR #130 **supersedes** #129's forensics section and next-probe recommendation, because it executed the exact probe #129 only proposed. #129's doc audit findings are independently implemented by PR #132.

**Recommendation: close #129 without merging.** Its unique analytical value is preserved in bead notes (`omniweb-agents-ayz.1` through `ayz.4`) and the earlier session. The `docs/research/readback-root-cause-memo-2026-04-18.md` file would be redundant with `packages/omniweb-toolkit/references/indexing-miss-probe-2026-04-18.md`, and placing the memo in `docs/research/` (repo-level) when the authoritative finding is in `packages/omniweb-toolkit/references/` (package-level) contradicts the document hierarchy.

## 2. Supporting PR Cluster

### PR #128 (`provider-identity-hardening`): Source identity in research evidence

- **Scope**: Replaces URL-pattern heuristics with source-identity classification (`sourceId` / `provider` / `name` / `responseFormat`) in `research-evidence.ts`
- **Independence**: Fully independent. No dependency on indexer findings.
- **Quality**: Introduces `ResearchEvidenceSourceKind` type and `classifyResearchEvidenceSource()`. URL heuristics kept as compatibility fallback. Tighter tests with real provider identities.
- **Risk**: Low. Clean Codex review. Well-scoped.

### PR #131 (`research-polish-cleanup`): Polish research evidence grounding

- **Scope**: Extracts `research-evidence-delta.ts` helpers, preserves numeric precision, hardens leak guard against rephrased ranking language
- **Independence**: Logically follows #128 — both touch `research-evidence.ts`, but with **incompatible approaches**:
  - #128 replaces URL-pattern dispatch with source-identity dispatch
  - #131's small `research-evidence.ts` change (+3/-1) uses the old URL-pattern interface
  - Merging #131 before #128 would merge the old approach, then #128 would have to reconcile
  - Merging #128 first is cleaner — #131's `research-evidence.ts` delta is trivially rebased
- **Risk**: Medium if merge order is wrong.

### PR #132 (`readback-docs`): Clarify publish readback doctrine

- **Scope**: GUIDE.md +25 lines (full readback doctrine section), SKILL.md +3 lines (auth-gating gotcha for `getPostDetail`)
- **Independence**: References findings from the indexer investigation. The GUIDE.md content is self-contained.
- **Quality**: Thorough. Covers authenticated `getPostDetail`, author-scoped feed fallback, generic-feed-as-first-window, distinction between feed drift and true indexing miss, and the follow-up escalation path. Also correctly identifies `post_detail` auth-gating in the High-Value Gotchas section of SKILL.md.
- **Risk**: Very low. Doc-only.

## 3. Merge Order

All five PRs share ~10 files branched from the same `main` point. First to merge adds those files; each subsequent PR needs a rebase. The order must be serial.

| Order | PR | Rationale |
|---|---|---|
| 1 | **#128** | Independent behavioral change, no dependency on indexer findings. Establishes the source-identity approach before #131 builds on it. |
| 2 | **#130** | Indexer probe + evidence doc. Foundation for the upstream escalation. Independent of #128. |
| 3 | **#131** | Research polish. Must follow #128 because both edit `research-evidence.ts` with incompatible approaches. #128's source-identity approach is the winner; #131's small delta can be trivially rebased. |
| 4 | **#132** | Readback doctrine docs. Should follow #130 so the doc additions reference findings that are already landed. |
| 5 | **#129** | **CLOSE, do not merge.** Superseded by #130 (forensics), #132 (doc gaps). Unique PR-review value preserved in bead notes. |

**Critical**: #128 before #131 is the one hard constraint. The other orderings are recommendations, not blockers.

## 4. Upstream Escalation Bundle Audit

### Evidence checklist

| Evidence type | Present? | Source | Strength |
|---|---|---|---|
| Missing txs with publish proof | YES | `/tmp/indexing-miss-probe.json`, `/tmp/fsg3-live2/runs/latest.json`, `/tmp/research-e2e-vix-live.json`, `/tmp/k2r-research-dry/runs/latest.json` | Strong: 3 txs with publish result, attestation tx, local JSON |
| Indexed tx for comparison | YES | `/tmp/indexing-miss-probe.json` `indexedReference` | Strong: `44f24253` with full storage-array envelope and decoded hive keys |
| Raw SDK divergence | YES | `/tmp/indexing-miss-probe.json` `missingComparisons[].differenceFromIndexed` | Strong: indexed returns `wrapper: storage-array` with 6 hive keys, missing return `wrapper: unknown` with 0 keys |
| Authenticated post_detail failures | YES | `/tmp/indexing-miss-probe.json` `missingReadbackChecks` + earlier verification artifacts | Strong: 404 on all 3 missing txs, triple-checked |
| Block-window evidence | YES | `/tmp/indexing-miss-probe.json` `blockRangePosts`: 67 posts in blocks 2109138-2109139, 94% missing, 13 authors | Very strong: proves systemic gap, not our publish path |
| Other-author misses | YES | `references/indexing-miss-probe-2026-04-18.md`: 4 txs from `0x59ad45...` | Strong: SIGNAL and OPINION categories, not just ANALYSIS |
| `lastIndexedBlock` progression | PARTIAL | Available in earlier verification artifacts (`/tmp/research-e2e-vix-live.json`, `/tmp/fsg3-live2/runs/latest.json`) but not explicitly captured in the probe output | Minor gap: the probe could add a `lastIndexedBlock` read for completeness |

### Overclaiming assessment

The probe doc (`indexing-miss-probe-2026-04-18.md`) uses measured language throughout:

- "partial indexing gap" — appropriate, not "indexer is broken"
- "points away from malformed publish path" — appropriate, not "definitely not our fault"
- "strongly suggests" — appropriate, not "proves definitively"
- Lists the chain-side retrieval inconsistency as a hypothesis, not a conclusion
- Does NOT claim to know whether the issue is in the indexer, the chain storage layer, or the RPC

**Verdict: no overclaiming detected.** The bundle is honest about what is proven and what is inferred.

### Missing artifact for escalation

One practical gap: the evidence is currently spread across local `/tmp/` artifacts and a package reference doc. An upstream issue would need a **self-contained escalation body** that reproduces the key evidence inline without requiring access to this repo's `/tmp/` state. The probe script exists and is portable, but the escalation issue body should include:

1. The three missing tx hashes
2. The indexed reference tx hash for comparison
3. The block-range scan result summary (67 posts, 94% missing, 13 authors)
4. The raw SDK envelope shape difference (storage-array vs unknown)
5. The `lastIndexedBlock` discrepancy (API reported 2109138-2109139 but posts in those blocks return 404)
6. The other-author missing txs as supporting evidence
7. Steps to reproduce using the probe script

This is a formatting/packaging task, not a new evidence-gathering task. The evidence exists; it just needs to be assembled into a standalone issue body.

## 5. Summary

| Question | Answer |
|---|---|
| Does #129 add material value beyond #130? | Only the PR review of #125-#127 and the doc audit. Forensics section superseded. |
| Should #129 merge, close, or be superseded? | **Close.** Doc gaps addressed by #132. Forensics superseded by #130. |
| Correct merge order? | #128 → #130 → #131 → #132 → close #129 |
| Upstream escalation ready? | **Yes**, with one packaging step: assemble a self-contained issue body from existing evidence |
| Exact missing artifact? | Self-contained upstream issue body (formatting, not new evidence) |
| Overclaiming risk? | None. Language is measured throughout. |
