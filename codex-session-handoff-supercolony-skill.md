# Codex Session Handoff: SuperColony Skill Audit And Refactor

Date: 2026-04-14  
Workspace: `/home/mj/projects/demos-agents`  
Primary scope: `packages/supercolony-toolkit` and related SuperColony research material

## Purpose

This document is the single-session handoff for Claude. It summarizes:

- what Codex researched
- what Codex changed
- what was verified live
- what remains open
- how these changes should be handled in git

## User Request Sequence

The session started from a request to audit the SuperColony skill guide material, separate the research from the user-facing docs, and then create a second standalone document recommending how to improve the skill according to official AgentSkills conventions, especially progressive disclosure.

After that, the user approved the next step: actually implement the refactor in the package so the skill bundle itself followed that architecture.

## High-Level Outcome

Three kinds of work were completed:

1. Standalone audit and research documents were created.
2. The `supercolony-toolkit` skill package was refactored so `SKILL.md` became a lean activation router and `GUIDE.md` became a methodology companion.
3. Deterministic validation scripts and routed reference files were added, then verified against live SuperColony behavior on 2026-04-14.
4. A second follow-up pass added package-complete AgentSkills metadata, output templates, and improved eval coverage so the lean skill structure is enforced.
5. A third integrity pass removed stale packaging behavior, updated onboarding/reference consistency, and corrected playbook category drift.
6. A fourth pass converted older `docs/` content into compatibility stubs, added routing/source-boundary eval coverage, and made the package-level `npm run check:*` commands work successfully in this environment.
7. A fifth pass focused on release integrity: split live checks into smoke vs detailed paths, made smoke-check failures report structured DNS/network diagnostics, removed the last stale fixed-count metadata claims, and rebuilt the package so shipped artifacts matched the new source wording.

## Research Performed

### Local package and repo files reviewed

- `packages/supercolony-toolkit/SKILL.md`
- `packages/supercolony-toolkit/GUIDE.md`
- `packages/supercolony-toolkit/README.md`
- `packages/supercolony-toolkit/src/index.ts`
- `packages/supercolony-toolkit/src/colony.ts`
- `packages/supercolony-toolkit/src/hive.ts`
- `scripts/colony-state-reader.ts`

### Official live resources fetched

- `https://supercolony.ai/llms.txt`
- `https://supercolony.ai/llms-full.txt`
- `https://supercolony.ai/openapi.json`
- `https://supercolony.ai/.well-known/ai-plugin.json`
- `https://supercolony.ai/.well-known/agents.json`
- `https://supercolony.ai/.well-known/agent.json`
- `https://supercolony.ai/supercolony-skill.md`

### Official GitHub sources reviewed

- `TheSuperColony/supercolony-agent-starter`
- `TheSuperColony/supercolony-mcp`
- `TheSuperColony/langchain-supercolony`
- org listings for `TheSuperColony` and `kynesyslabs`

### AgentSkills sources reviewed

- `agentskills/agentskills` README
- AgentSkills specification
- AgentSkills best-practices guidance
- AgentSkills "what are skills" docs
- `anthropics/skills` README

## Main Research Findings

### 1. Official source layers are inconsistent

There is not one single authoritative SuperColony surface:

- `openapi.json` and `llms-full.txt` describe a smaller machine-readable core
- `supercolony-skill.md` documents a broader surface
- live behavior exposes some routes beyond the smaller core
- some resources advertised in discovery material returned `404`

This means package docs must keep source provenance explicit instead of flattening all sources into one truth.

### 2. Categories are drift-prone

The audit confirmed that category coverage differs across sources:

- `llms-full.txt` documented 7 categories
- `supercolony-skill.md` documented 9
- live behavior on 2026-04-14 showed 10 active categories:
  - `ACTION`
  - `ALERT`
  - `ANALYSIS`
  - `FEED`
  - `OBSERVATION`
  - `OPINION`
  - `PREDICTION`
  - `QUESTION`
  - `SIGNAL`
  - `VOTE`

### 3. `agent.json` and `agents.json` are distinct

The audit confirmed:

- `/.well-known/agent.json` is the A2A-style agent card
- `/.well-known/agents.json` is the broader capability manifest

The local docs should not conflate them.

### 4. SuperColony now has two meaningful integration paths

- zero-config read-oriented integrations such as MCP / LangChain / starter tooling
- wallet-backed direct execution through SDK or local runtime

This package primarily serves the second path, but the skill docs now explicitly distinguish those access modes.

### 5. The official starter guidance emphasizes live participation

The starter guidance added important interaction-loop behavior that was underrepresented in the local skill docs:

- SSE / stream-first participation
- reply and reaction logic
- reconnect and stale filtering
- tx-hash deduplication
- prompt-injection hygiene

That drove the methodology refactor.

## Documents Created During This Session

### Standalone audit and research docs

- [codex-skill-guide-audit-report.md](/home/mj/projects/demos-agents/codex-skill-guide-audit-report.md)
- [research-supercolony-skill-sources.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/docs/research-supercolony-skill-sources.md)
- [skill-improvement-recommendations.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/docs/skill-improvement-recommendations.md)

### New reference files added to the skill package

- [platform-surface.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/references/platform-surface.md)
- [categories.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/references/categories.md)
- [discovery-and-manifests.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/references/discovery-and-manifests.md)
- [live-endpoints.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/references/live-endpoints.md)
- [scoring-and-leaderboard.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/references/scoring-and-leaderboard.md)
- [interaction-patterns.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/references/interaction-patterns.md)
- [toolkit-guardrails.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/references/toolkit-guardrails.md)

### New validation / research scripts added to the skill package

- [scripts/_shared.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/scripts/_shared.ts)
- [scripts/check-discovery-drift.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/scripts/check-discovery-drift.ts)
- [scripts/check-live-categories.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/scripts/check-live-categories.ts)
- [scripts/check-endpoint-surface.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/scripts/check-endpoint-surface.ts)
- [scripts/leaderboard-snapshot.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/scripts/leaderboard-snapshot.ts)
- [scripts/skill-self-audit.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/scripts/skill-self-audit.ts)

### New AgentSkills metadata and assets

- [agents/openai.yaml](/home/mj/projects/demos-agents/packages/supercolony-toolkit/agents/openai.yaml)
- [assets/post-template-analysis.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/assets/post-template-analysis.md)
- [assets/post-template-prediction.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/assets/post-template-prediction.md)
- [assets/reply-template.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/assets/reply-template.md)
- [assets/agent-loop-skeleton.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/assets/agent-loop-skeleton.ts)

### Additional package-alignment changes

- [TOOLKIT.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/TOOLKIT.md) was rewritten as a compact onboarding file aligned to the new reference layer.
- [references/ecosystem-guide.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/references/ecosystem-guide.md) was rewritten to be source-boundary aware rather than carrying stale network metrics.
- [references/capabilities-guide.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/references/capabilities-guide.md) was rewritten as a stable action inventory aligned to the current package surface.
- the playbooks and strategy schema were updated to use `FEED` instead of the stale `NEWS` category.
- the legacy `docs/` copies for attestation, capabilities, ecosystem, and primitives were converted into short compatibility stubs that point to the canonical `references/` content.
- package metadata and playbook intros were cleaned up to remove stale fixed-count claims such as hardcoded agent counts and method/domain counts.

### Discovery snapshot added

- [docs/research/supercolony-discovery/agent.json](/home/mj/projects/demos-agents/docs/research/supercolony-discovery/agent.json)

### Session handoff doc

- [codex-session-handoff-supercolony-skill.md](/home/mj/projects/demos-agents/codex-session-handoff-supercolony-skill.md)

## Files Modified During This Session

### Refactored

- [SKILL.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/SKILL.md)
- [GUIDE.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/GUIDE.md)
- [README.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/README.md)
- [package.json](/home/mj/projects/demos-agents/packages/supercolony-toolkit/package.json)
- [evals/run-evals.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/evals/run-evals.ts)
- [evals/evals.json](/home/mj/projects/demos-agents/packages/supercolony-toolkit/evals/evals.json)
- [scripts/skill-self-audit.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/scripts/skill-self-audit.ts)
- [TOOLKIT.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/TOOLKIT.md)
- [references/response-shapes.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/references/response-shapes.md)
- [playbooks/strategy-schema.yaml](/home/mj/projects/demos-agents/packages/supercolony-toolkit/playbooks/strategy-schema.yaml)
- [playbooks/market-analyst.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/playbooks/market-analyst.md)
- [playbooks/research-agent.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/playbooks/research-agent.md)
- [playbooks/engagement-optimizer.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/playbooks/engagement-optimizer.md)
- [docs/attestation-pipeline.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/docs/attestation-pipeline.md)
- [docs/capabilities-guide.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/docs/capabilities-guide.md)
- [docs/ecosystem-guide.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/docs/ecosystem-guide.md)
- [docs/primitives/README.md](/home/mj/projects/demos-agents/packages/supercolony-toolkit/docs/primitives/README.md)
- [scripts/_shared.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/scripts/_shared.ts)
- [scripts/check-live.sh](/home/mj/projects/demos-agents/packages/supercolony-toolkit/scripts/check-live.sh)
- [src/colony.ts](/home/mj/projects/demos-agents/packages/supercolony-toolkit/src/colony.ts)

### Refactor intent

#### `SKILL.md`

Changed from a long mixed-purpose reference into a lean activation router:

- explicit source-boundary section
- default workflow
- access-path split
- compact method index
- high-value gotchas
- explicit "load this file when..." progressive-disclosure routing
- deterministic script entrypoint list

Final size after refactor: 138 lines

#### `GUIDE.md`

Changed from a mixed API/methodology doc into a behavior guide:

- perceive / decide / act / engage loop
- prompt design from state
- reply and reaction rules
- prompt-injection hygiene
- anti-patterns
- score interpretation guidance
- explicit pointers to deeper references

Final size after refactor: 223 lines

#### `README.md`

Changed to reflect the new package architecture:

- package layers
- where to start
- useful scripts
- standalone audit material

#### `package.json`

Added script entries:

- `check:evals`
- `check:package`
- `check:categories`
- `check:discovery`
- `check:endpoints`
- `check:live`
- `check:live:detailed`
- `check:skill`
- `snapshot:leaderboard`

Also updated package publishing scope so `agents/` and `assets/` are included in package files.

On the third pass, the old `prepack` behavior that copied `docs/*.md` back into `references/` was removed. This was important because it would have overwritten the new reference layer at publish time.

On the fourth pass, the package scripts were normalized to `node --import tsx ...` entrypoints so `npm run check:skill`, `npm run check:evals`, and `npm run check:package` all execute successfully in this environment.

On the fifth pass, `check:live` was intentionally split:

- `check:live` is now a shell-curl smoke test with structured diagnostics
- `check:live:detailed` remains the more detailed TypeScript probe path

This was necessary because detailed live networking behavior varies by environment.

#### `agents/openai.yaml`

Added UI-facing AgentSkills metadata:

- display name
- short description
- default prompt that explicitly invokes `$omniweb-toolkit`
- implicit invocation policy

#### `assets/`

Added concrete templates and a starter scaffold:

- analysis post template
- prediction post template
- reply template
- minimal agent loop skeleton

These are referenced from `SKILL.md`, `GUIDE.md`, and `README.md` so the package now has actual execution scaffolds rather than only prose guidance.

#### `evals/run-evals.ts`

Updated the eval runner so it matches the new lean-skill architecture:

- validates namespaced methods against the package API surface instead of assuming every method string must appear verbatim in `SKILL.md`
- adds a `skill-architecture` eval that checks:
  - reference routing from `SKILL.md`
  - script routing from `SKILL.md`
  - deeper routing from `GUIDE.md`
  - existence and correctness of `agents/openai.yaml`

#### `scripts/skill-self-audit.ts`

Expanded the self-audit to enforce:

- asset discoverability
- existence of `agents/openai.yaml`
- presence of `$omniweb-toolkit` in the default prompt
- current `TOOLKIT.md` links
- removal of stale `NEWS` category use in playbooks
- package file-list coverage for `agents/`, `assets/`, `references/`, and `scripts/`
- absence of `prepack` logic that overwrites `references/`
- confirmation that canonical `references/*.md` files keep complete frontmatter
- confirmation that legacy `docs/` copies remain short compatibility stubs

#### `scripts/_shared.ts` and `scripts/check-live.sh`

The live-check path was made more operationally honest:

- `_shared.ts` now contains a best-effort curl fallback path for environments where native fetch fails
- `check-live.sh` provides a shell-curl smoke test that always prints structured JSON
- when live probes return status `0`, the smoke test now reports explicit curl exit/error diagnostics instead of failing as unreadable stderr noise
- `check-live.sh` is now surfaced from `SKILL.md` and `README.md` and counted by the package self-audit as part of the maintained script surface

In this sandboxed environment, `check:live` still fails non-zero because DNS is blocked, but it now fails clearly and usefully.

#### `TOOLKIT.md`

Rewritten as a compact onboarding document that now points at `SKILL.md`, `GUIDE.md`, and the new routed reference set instead of the older copied-doc layout.

#### Playbooks and strategy schema

Updated to replace stale `NEWS` category usage with `FEED`, aligning the package archetypes with the audited category set.

#### Legacy docs compatibility layer

Older published docs were converted into short redirect stubs:

- `docs/attestation-pipeline.md`
- `docs/capabilities-guide.md`
- `docs/ecosystem-guide.md`
- `docs/primitives/README.md`

This preserves existing links without keeping a second stale canon alive.

#### Eval suite

`evals/evals.json` and `evals/run-evals.ts` were expanded to cover:

- category-routing behavior
- discovery-manifest routing
- toolkit-guardrail routing
- source-boundary routing
- existence and discoverability of referenced companion files

#### Source and build artifacts

- `src/colony.ts` was updated to remove the last stale fixed-count toolkit comment
- the package was rebuilt so the shipped `dist/` declarations no longer carry that stale count

## Verification Performed

### Structural verification

Ran:

- `npx tsx scripts/skill-self-audit.ts`
- `npm run check:skill`
- `npm run build`

Result:

- passed
- confirmed frontmatter exists
- confirmed line counts are under the desired threshold
- confirmed no broken relative links
- confirmed one-level reference discipline
- confirmed references and scripts are discoverable from `SKILL.md`
- confirmed assets are discoverable from `SKILL.md` or `GUIDE.md`
- confirmed `agents/openai.yaml` exists and is wired correctly
- confirmed `TOOLKIT.md` no longer points at stale copied-doc paths
- confirmed playbooks no longer use the obsolete `NEWS` category
- confirmed package metadata no longer contains a `prepack` step that overwrites `references/`
- confirmed legacy `docs/` copies are short compatibility stubs
- confirmed canonical reference files keep the expected frontmatter
- confirmed rebuilt artifacts no longer carry the stale fixed-count wording
- confirmed `TOOLKIT.md` no longer points at stale copied-doc paths
- confirmed playbooks no longer use the obsolete `NEWS` category
- confirmed package metadata no longer contains a `prepack` step that overwrites `references/`

### Script entrypoint verification

Confirmed each new script supports `--help` and returns structured usage text:

- `check-discovery-drift.ts`
- `check-live-categories.ts`
- `check-endpoint-surface.ts`
- `leaderboard-snapshot.ts`
- `skill-self-audit.ts`

### Eval verification

Ran:

- `npx tsx evals/run-evals.ts --summary`
- `npm run check:evals`
- `npm run check:package`

Initial state after the first refactor:

- `14` pass
- `11` warn
- `0` fail

Cause:

- the old eval runner assumed namespaced methods had to appear literally in the lean `SKILL.md`
- that assumption no longer fit the progressive-disclosure design

After the follow-up eval/metadata pass:

- `26` pass
- `0` warn
- `0` fail

That status remained green after the third integrity pass.

After adding routing/source-boundary evals:

- `30` pass
- `0` warn
- `0` fail

That status remained green after the fifth release-integrity pass.

### Live-check verification

Ran:

- `npm run check:live`

Result in this environment:

- exits non-zero
- now prints structured JSON instead of raw curl noise
- clearly reports `curlExit: 6` and DNS resolution failure
- includes diagnostics explaining that status `0` usually indicates blocked outbound networking rather than package drift

Interpretation:

- the smoke check is operationally improved
- the environment remains network-constrained for package-level live checks
- this is now visible and actionable rather than ambiguous

### Package check status at end of session

Current green checks:

- `npm run check:skill`
- `npm run check:evals`
- `npm run check:package`

Current expected constrained check:

- `npm run check:live`
  It emits structured diagnostics, but still exits non-zero in this sandbox due DNS/network restriction rather than package inconsistency.

### Live drift verification

Ran:

- `npx tsx scripts/check-discovery-drift.ts`

First result:

- exposed a real repository omission: `docs/research/supercolony-discovery/agent.json` did not exist yet

Fix applied:

- added the missing committed snapshot

Second result:

- all 5 discovery resources matched live on 2026-04-14

### Live endpoint verification

Ran:

- `npx tsx scripts/check-endpoint-surface.ts`

Result:

- matched expected live surface
- confirmed live `200` responses for key audited routes
- confirmed expected `404` responses for discovery-advertised but missing resources such as:
  - `/api/capabilities`
  - `/api/rate-limits`
  - `/api/changelog`
  - `/api/agents/onboard`
  - `/api/errors`
  - `/api/mcp/tools`
  - `/api/stream-spec`
  - `/.well-known/mcp.json`

### Live category verification

Ran:

- `npx tsx scripts/check-live-categories.ts --limit 10`

Result:

- confirmed all 10 active categories listed above
- confirmed `VOTE` is live

## Live Colony State Observed During Session

Using the existing repo tooling and authenticated reads, Codex observed:

- total posts: `274,766`
- total agents: `221`
- registered agents: `197`
- posts last 24h: `11,021`
- active agents last 24h: `61`
- attestation rate: `59.77%`
- active signals: `30`
- leaderboard global average: `76.8`

Top agent snapshot observed during research included:

- `murrow`
- `hamilton`
- `gutenberg`
- `snowden`

Recent higher-performing category mix leaned heavily toward `ANALYSIS`, with smaller pockets of `PREDICTION`, `OBSERVATION`, `ALERT`, and `ACTION`.

## Important Implementation Notes For Claude

- The core architectural change is complete. Claude should not re-expand `SKILL.md` into a full reference manual.
- New detail should go into `references/` or `scripts/`, then be routed from `SKILL.md`.
- The package now treats provenance as first-class:
  - package behavior
  - official machine-readable surface
  - official human-oriented guides
  - live observed behavior
- The new scripts are intended to prevent future prose drift.

## Known Limits / Open Next Steps

No blocking issues remain from this session, but Claude could reasonably continue with:

- tightening or trimming existing older reference files so they match the new reference style
- adding `agents/openai.yaml` if the package should expose richer UI metadata for skill lists
- adding small assets or templates if concrete post/reply skeletons are desired
- adding evals that explicitly check progressive disclosure, trigger quality, and source-boundary discipline

The first two of those are now done:

- templates/assets were added
- eval coverage now includes architecture checks

Remaining reasonable follow-up work for Claude is mainly:

- polish older reference files to match the new reference style
- decide whether to add more explicit eval cases for source-boundary correctness

The older highest-risk mismatches have already been addressed:

- stale `TOOLKIT.md`
- stale `NEWS` category in playbooks
- stale packaging overwrite behavior
- stale non-bundled audit-tool references in `response-shapes.md`
- stale duplicated `docs/` canon
- missing runnable package-level check commands
- stale shipped fixed-count metadata
- unreadable live-check failures under constrained networking

## GitOps Recommendation

This session touched a meaningful but coherent slice of the repo. The right GitOps move is to isolate and commit only the SuperColony skill refactor work, not unrelated untracked files in the repo root.

### Recommended branch

Create a dedicated branch, for example:

```bash
git checkout -b codex/supercolony-skill-progressive-disclosure
```

### Recommended staging scope

Stage only these paths:

```bash
git add \
  codex-skill-guide-audit-report.md \
  codex-session-handoff-supercolony-skill.md \
  docs/research/supercolony-discovery/agent.json \
  packages/supercolony-toolkit/SKILL.md \
  packages/supercolony-toolkit/GUIDE.md \
  packages/supercolony-toolkit/README.md \
  packages/supercolony-toolkit/package.json \
  packages/supercolony-toolkit/agents/openai.yaml \
  packages/supercolony-toolkit/assets/ \
  packages/supercolony-toolkit/docs/research-supercolony-skill-sources.md \
  packages/supercolony-toolkit/docs/skill-improvement-recommendations.md \
  packages/supercolony-toolkit/docs/attestation-pipeline.md \
  packages/supercolony-toolkit/docs/capabilities-guide.md \
  packages/supercolony-toolkit/docs/ecosystem-guide.md \
  packages/supercolony-toolkit/docs/primitives/README.md \
  packages/supercolony-toolkit/evals/evals.json \
  packages/supercolony-toolkit/evals/run-evals.ts \
  packages/supercolony-toolkit/references/ \
  packages/supercolony-toolkit/src/colony.ts \
  packages/supercolony-toolkit/scripts/
```

Do not stage unrelated untracked files currently visible in `git status`, such as:

- `agents/reference/scores.jsonl`
- `codex-full-review.md`
- `codex-pre-publish-review.md`
- `codex-sdk-investigate.md`
- `scorecard.png`
- `scripts/auth-refresh.ts`

### Recommended commit shape

If you want one clean commit, use:

```bash
git commit -m "docs(supercolony-toolkit): refactor skill for progressive disclosure"
```

If you want better reviewability, split into 3 commits:

1. research and audit artifacts
2. skill/package doc refactor
3. validation scripts and discovery snapshot

Suggested messages:

```bash
git commit -m "docs(supercolony): add audit and research handoff"
git commit -m "docs(supercolony-toolkit): refactor skill for progressive disclosure"
git commit -m "chore(supercolony-toolkit): add drift and self-audit scripts"
```

### Recommended PR framing

Open a PR that explicitly says:

- this is a documentation-architecture refactor, not a runtime behavior change
- the package now follows AgentSkills progressive-disclosure conventions
- live verification scripts were added to reduce future documentation drift
- one missing discovery snapshot, `agent.json`, was added after the new drift script exposed the omission

### Recommendation for Claude continuation

When handing this to Claude, ask it to:

1. review the handoff doc first
2. review the two standalone docs
3. inspect the new `SKILL.md` routing model
4. decide whether to polish references/evals/assets or stop at the current refactor

That will prevent Claude from redoing the already-completed audit work.

## Final Session Status

The requested work is complete:

- standalone research doc: done
- standalone improvement doc: done
- in-package progressive-disclosure refactor: done
- deterministic validation scripts: done
- live verification against current SuperColony behavior: done

No commits were created during this session.
