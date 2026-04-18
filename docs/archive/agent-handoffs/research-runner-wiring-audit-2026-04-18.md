---
summary: Audit of whether live runner paths exercise the research hardening from PRs #145 and #147 — finding two completely separate execution worlds.
read_when: debugging research pipeline wiring, planning session runner integration, or evaluating whether hardening work reaches live execution
---

# Research Runner Wiring Audit — 2026-04-18

## TL;DR

**The repo has two completely separate execution paths that share zero imports.** The session runner (`cli/session-runner.ts`) and the research-agent-starter (`packages/omniweb-toolkit/assets/research-agent-starter.ts`) operate in different worlds. All research hardening work (PRs #145, #147, and the full research-* module family) lives exclusively on the starter/package path. The session runner path has never imported any package-level research module.

---

## Finding 1: Two Execution Worlds (Confidence: CERTAIN)

### Path A: Session Runner (`cli/session-runner.ts`)
- **Entry:** `npx tsx cli/session-runner.ts --agent sentinel --pretty`
- **Call chain:** `cli/session-runner.ts` → `cli/v3-loop.ts` → `cli/v3-strategy-bridge.ts` → `cli/publish-executor.ts`
- **Evidence layer:** `src/toolkit/sources/policy.ts` (preflight), `src/toolkit/sources/matcher.ts` (post-generation match)
- **Strategy:** `agents/sentinel/strategy.yaml` via `cli/v3-strategy-bridge.ts`
- **Quality gates:** `src/toolkit/publish/quality-gate.ts` (text length, category validation only)
- **Does NOT import:** Any `packages/omniweb-toolkit/` module, any `research-*` module, `buildResearchDraft`, `checkResearchDraftQuality`, `buildResearchBrief`, `runMinimalAgentLoop`

### Path B: Research Agent Starter (`packages/omniweb-toolkit/assets/research-agent-starter.ts`)
- **Entry:** Direct execution as script, or via OpenClaw/registry skill bundles
- **Call chain:** `research-agent-starter.ts` → `omniweb-toolkit/agent` exports → `runMinimalAgentLoop()` → `observe()` → `buildResearchDraft()` → `checkResearchDraftQuality()`
- **Evidence layer:** `research-evidence.ts` (semantic classification), `research-source-profile.ts` (family detection)
- **Strategy:** Implicit in `deriveResearchOpportunities()` — opportunity ranking, family filtering, self-history skip
- **Quality gates:** `checkResearchDraftQuality()` which includes semantic-evidence-grounding, family-dossier-grounding, evidence-value-overlap, meta-leak, style, and contextual-grounding checks
- **Does NOT import:** Any `cli/` module, any `src/lib/sources/` module, `v3-strategy-bridge`, `publish-executor`

### Verification Method
```
grep -r "omniweb-toolkit\|research-draft\|research-evidence\|research-family\|buildResearchDraft\|checkResearchDraftQuality\|buildResearchBrief" cli/ src/
→ No files found (zero matches across both directories)
```

---

## Finding 2: PR #145 (Semantic Evidence Gate) — NOT on Session Runner Path (Confidence: CERTAIN)

**PR #145 files changed:** `packages/omniweb-toolkit/src/research-draft.ts`, `packages/omniweb-toolkit/src/research-evidence.ts`, `tests/packages/research-draft.test.ts`

**What it adds:**
- `classifyResearchEvidenceSemanticClass()` in `research-evidence.ts:120-165` — classifies evidence as market/macro/liquidity/metadata/generic
- `checkSemanticEvidenceGrounding()` in `research-draft.ts:554-586` — rejects metadata-shaped or generic primary evidence
- Called inside `checkResearchDraftQuality()` at `research-draft.ts:452`

**Call site:** `checkResearchDraftQuality()` → called from `buildResearchDraft()` at `research-draft.ts:235,253` → called from the research-agent-starter's `observe()` at `research-agent-starter.ts:647`

**Session runner path:** The session runner uses `src/toolkit/publish/quality-gate.ts:checkPublishQuality()` which checks text length and category only. It does NOT call `checkResearchDraftQuality()` or `checkSemanticEvidenceGrounding()`.

**Conclusion:** PR #145's semantic evidence gate is exercised only by the research-agent-starter, never by the session runner.

---

## Finding 3: PR #147 (Substrate + History Summaries) — NOT on Session Runner Path (Confidence: CERTAIN)

**PR #147 files changed:** `packages/omniweb-toolkit/src/research-draft.ts`, `packages/omniweb-toolkit/src/research-evidence.ts`, `packages/omniweb-toolkit/src/research-family-dossiers.ts`, `tests/packages/research-draft.test.ts`

**What it adds:**
- `substrateSummary: string | null` field on `ResearchBrief` interface (`research-family-dossiers.ts:28`)
- `previousCoverageDelta: string | null` field on `ResearchBrief` interface (`research-family-dossiers.ts:29`)
- `summarizeColonySubstrate()` at `research-family-dossiers.ts:189` — compact text summary of colony context
- `summarizePreviousCoverageDelta()` — compact text summary of what changed since last same-topic/same-family post
- Both populated in `buildResearchBrief()` at `research-family-dossiers.ts:184-185`

**Call site:** `buildResearchBrief()` → called from `buildResearchPromptPacket()` at `research-draft.ts:285+` → called from `buildResearchDraft()` → called from research-agent-starter's `observe()`

**Session runner path:** The session runner builds its own prompt in `cli/publish-executor.ts` via `generatePost()` from `src/actions/llm.ts`. It does not use `buildResearchBrief()` or `ResearchBrief` at all.

**Conclusion:** PR #147's substrate and history summaries are exercised only by the research-agent-starter, never by the session runner.

---

## Finding 4: PR #145 and #147 Merge Status (Confidence: CERTAIN)

**Both PRs are OPEN, not merged to main.**

- `origin/main` HEAD: `a9e7294` (toolkit: fix package-integrity drift for indexing probe, PR #148)
- PR #145 commit `f60893c` and PR #147 commit `4b57bc1` are on branch `codex/research-brief-substrate-history` only
- The local working tree branched from this Codex branch, so the changes are visible locally but NOT on main

---

## Finding 5: Starter ↔ Bundle Drift — RESOLVED (Confidence: CERTAIN)

PR #148 (merged) fixed the drift between:
- `packages/omniweb-toolkit/assets/research-agent-starter.ts`
- `packages/omniweb-toolkit/agents/openclaw/research-agent/skills/omniweb-research-agent/starter.ts`
- `packages/omniweb-toolkit/agents/registry/omniweb-research-agent/starter.ts`

All three files are byte-identical as of main HEAD. No drift exists.

---

## Finding 6: The Research-Agent-Starter IS Correctly Wired (Confidence: HIGH)

Within its own execution world, the research-agent-starter correctly exercises:
1. **Family detection:** `deriveResearchOpportunities()` → `deriveResearchSourceProfile()` → unsupported families skipped (line 347)
2. **Attestation plan:** Checked at line 393 — no-plan = skip
3. **Evidence fetch:** `fetchResearchEvidenceSummary()` with primary + supporting (line 436)
4. **Self-history delta:** `buildResearchSelfHistory()` + `buildResearchEvidenceDelta()` (lines 524-535)
5. **No-change skip:** Lines 537-590 — same topic, no meaningful delta → skip
6. **Self-coverage skip:** Lines 592-645 — `selfHistory.skipSuggested` → skip
7. **Draft generation:** `buildResearchDraft()` (line 647) which internally calls `buildResearchBrief()` and `checkResearchDraftQuality()`
8. **Source match verification:** `matchResearchDraftToPlan()` (line 703)
9. **State persistence:** `publishHistory` updated in `nextState` (line 813)

The starter is a complete, well-tested research pipeline. The problem is that the session runner doesn't use it.

---

## The Central Architectural Gap

| Aspect | Session Runner | Research Starter |
|--------|---------------|-----------------|
| Entrypoint | `cli/session-runner.ts` | `packages/omniweb-toolkit/assets/research-agent-starter.ts` |
| Loop | V3 strategy bridge | `runMinimalAgentLoop()` |
| Source policy | `src/toolkit/sources/policy.ts` | `research-source-profile.ts` (family detection) |
| Evidence validation | `src/toolkit/sources/matcher.ts` (match score ≥9) | `checkSemanticEvidenceGrounding()` (class ≠ metadata/generic) |
| Quality gate | `src/toolkit/publish/quality-gate.ts` (text length only) | `checkResearchDraftQuality()` (7 checks incl. family baseline, meta-leak) |
| Self-dedup | `src/toolkit/colony/dedup.ts` (bigram/FTS5) | `buildResearchSelfHistory()` (family-aware, evidence delta) |
| Colony context | `src/toolkit/colony/state-extraction.ts` | `buildResearchColonySubstrate()` |
| Strategy | `agents/sentinel/strategy.yaml` | Implicit in opportunity ranking |
| PR #145 coverage | NO | YES |
| PR #147 coverage | NO | YES |
| Can run standalone | YES (primary live runner) | YES (self-contained script) |

---

## Ranked Next Steps

### Priority 1: Decide the Runtime Model
1. **Decision needed:** Is the research-agent-starter the intended live runner for research, or should the session runner gain research capabilities?
   - If the starter IS the live runner → the session runner doesn't need to change, and the hardening is correctly placed
   - If the session runner should also do research → the session runner needs to import and use the package research modules
   - This is an architectural decision, not a bug

### Priority 2: If Session Runner Should Do Research
2. **Import `buildResearchDraft` into publish-executor** — replace the generic `generatePost()` call with the family-aware research pipeline for PUBLISH actions whose topics match a supported research family
3. **Import `checkResearchDraftQuality` as the quality gate** — replace `checkPublishQuality` with the 7-check research quality gate for research-family topics
4. **Import `buildResearchSelfHistory`** — add family-aware self-dedup to the strategy bridge's PUBLISH decision path
5. **Import `deriveResearchSourceProfile`** — use family detection to route topics to the research pipeline vs the generic publish pipeline

### Priority 3: If Research Starter IS the Live Runner
6. **Merge PRs #145 and #147** — they are correctly placed for the starter path
7. **Document the two-world architecture** — make explicit that `cli/session-runner.ts` is the sentinel loop and the research-agent-starter is the research loop
8. **Add a CI entrypoint test** — verify the research-agent-starter can import and initialize without errors

### Priority 4: Regardless of Decision
9. **Create a bead for the architectural decision** — "decide whether session runner and research starter are parallel execution paths or should converge"
10. **Add integration test for research quality gate** — end-to-end test from opportunity → draft → quality gate → pass/fail with real evidence
