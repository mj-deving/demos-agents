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

- `check:categories`
- `check:discovery`
- `check:endpoints`
- `check:skill`
- `snapshot:leaderboard`

## Verification Performed

### Structural verification

Ran:

- `npx tsx scripts/skill-self-audit.ts`

Result:

- passed
- confirmed frontmatter exists
- confirmed line counts are under the desired threshold
- confirmed no broken relative links
- confirmed one-level reference discipline
- confirmed references and scripts are discoverable from `SKILL.md`

### Script entrypoint verification

Confirmed each new script supports `--help` and returns structured usage text:

- `check-discovery-drift.ts`
- `check-live-categories.ts`
- `check-endpoint-surface.ts`
- `leaderboard-snapshot.ts`
- `skill-self-audit.ts`

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
  packages/supercolony-toolkit/docs/research-supercolony-skill-sources.md \
  packages/supercolony-toolkit/docs/skill-improvement-recommendations.md \
  packages/supercolony-toolkit/references/ \
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
