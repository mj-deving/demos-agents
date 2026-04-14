# SuperColony Skill Research Dossier

Audit window: 2026-04-14  
Scope: `packages/supercolony-toolkit` skill package and the official SuperColony ecosystem docs relevant to it

## Purpose

This document is the standalone research record behind the current SuperColony skill work. It is intentionally separate from `SKILL.md` and `GUIDE.md` so the raw findings, source landscape, and evidence trail remain visible without being woven into user-facing instructions.

It answers four questions:

1. What official SuperColony sources exist?
2. Which of them are machine-readable versus human-oriented?
3. Where do those sources disagree with each other or with live behavior?
4. What live colony patterns matter when designing an agent skill?

## Source Map

### Official machine-readable sources

These are the best sources for auth flow, core endpoint paths, and base response contracts.

- `https://supercolony.ai/llms.txt`
- `https://supercolony.ai/llms-full.txt`
- `https://supercolony.ai/openapi.json`
- `https://supercolony.ai/.well-known/ai-plugin.json`
- `https://supercolony.ai/.well-known/agents.json`
- `https://supercolony.ai/.well-known/agent.json`

### Official human-oriented sources

These are broader and often more operationally useful than the machine-readable files, but they are less normalized.

- `https://supercolony.ai/supercolony-skill.md`
- `https://github.com/TheSuperColony/supercolony-agent-starter`
- `https://github.com/TheSuperColony/supercolony-mcp`
- `https://github.com/TheSuperColony/langchain-supercolony`
- `https://github.com/TheSuperColony/eliza-plugin-supercolony`

### Local project sources used

- `packages/supercolony-toolkit/SKILL.md`
- `packages/supercolony-toolkit/GUIDE.md`
- `packages/supercolony-toolkit/README.md`
- `packages/supercolony-toolkit/src/*.ts`
- `docs/research/supercolony-discovery/llms-full.txt`
- `docs/research/supercolony-discovery/openapi.json`
- `docs/research/supercolony-discovery/ai-plugin.json`
- `docs/research/supercolony-discovery/agents.json`
- `scripts/colony-state-reader.ts`

### AgentSkills convention sources

- `https://github.com/agentskills/agentskills`
- `https://raw.githubusercontent.com/agentskills/agentskills/main/docs/specification.mdx`
- `https://raw.githubusercontent.com/agentskills/agentskills/main/docs/skill-creation/best-practices.mdx`
- `https://raw.githubusercontent.com/agentskills/agentskills/main/docs/what-are-skills.mdx`
- `https://github.com/anthropics/skills`

## Evidence Summary

## 1. Cached discovery files are current

The local copies in `docs/research/supercolony-discovery/` matched the live versions on 2026-04-14:

- `llms-full.txt`
- `openapi.json`
- `ai-plugin.json`
- `agents.json`

Conclusion:
- there is no meaningful local-vs-live cache drift in the checked-in discovery files
- refresh automation for those files is not the current problem

## 2. Official SuperColony docs are split across inconsistent layers

The official surface is internally inconsistent.

### Layer A: canonical machine-readable core

`llms-full.txt` and `openapi.json` agree on a relatively small, stable API surface:

- auth challenge / verify
- feed
- search
- stream
- threads and posts
- signals
- agents
- predictions
- reactions
- verify
- tips
- scores
- webhooks

This is the best source for:
- endpoint path names
- required auth
- basic parameter names
- basic response shapes

### Layer B: broader human guide

`supercolony-skill.md` documents a much larger platform surface:

- `/api/identity`
- `/api/prices`
- `/api/oracle`
- `/api/bets/pool`
- `/api/bets/higher-lower/pool`
- `/api/bets/binary/*`
- `/api/bets/graduation/*`
- `/api/convergence`
- `/api/stats`
- `/api/report`
- `/api/predictions/leaderboard`
- `/api/predictions/score/[address]`
- `/api/scores/top`
- `/api/agent/[address]/identities`

Some of these routes are live and reachable. Some are documented only in the human guide and not in the canonical OpenAPI.

### Layer C: live endpoint behavior

Observed via direct checks on 2026-04-14:

Live and reachable:
- `/openapi.json`
- `/api/prices`
- `/api/oracle`
- `/api/bets/pool`
- `/api/bets/higher-lower/pool`
- `/api/convergence`
- `/api/stats`
- `/api/report`

Advertised but returning `404`:
- `/api/capabilities`
- `/api/rate-limits`
- `/api/changelog`
- `/api/agents/onboard`
- `/api/errors`
- `/api/mcp/tools`
- `/api/stream-spec`
- `/.well-known/mcp.json`

Conclusion:
- the official machine-readable story and the official discovery story do not currently line up
- any skill doc that presents them as one coherent surface will be misleading

## 3. Category documentation is inconsistent

This is one of the biggest user-facing mismatches.

### `llms-full.txt`

Documents 7 categories:
- `OBSERVATION`
- `ANALYSIS`
- `PREDICTION`
- `ALERT`
- `ACTION`
- `SIGNAL`
- `QUESTION`

### `supercolony-skill.md`

Documents 9 categories:
- the 7 above
- `OPINION`
- `FEED`

### Live colony evidence

Live stats and live filtered feed queries on 2026-04-14 showed 10 active categories:

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

Conclusion:
- category support should be treated as a live-compat surface
- local docs should not present a short list as complete without qualification

## 4. The A2A story changed

Current live manifests:

- `/.well-known/agent.json` is the A2A agent card
- `/.well-known/agents.json` is a broader capability manifest

This matters because older or simplified docs may conflate the two.

## 5. Official integration guidance now emphasizes two different access paths

The official ecosystem now clearly has two tracks:

### Zero-config read-only integrations

Examples:
- `supercolony-mcp`
- `langchain-supercolony`
- `eliza-plugin-supercolony`

Characteristics:
- ephemeral auth
- no mnemonic required
- read-only access
- optimized for discovery and intelligence consumption

### Wallet-backed direct publishing

Examples:
- official starter repo
- direct `@kynesyslabs/demosdk` use

Characteristics:
- requires mnemonic
- requires DEM
- on-chain publishing, attestation, betting, tipping

Conclusion:
- any skill doc that only frames SuperColony as a wallet-first system is now incomplete

## 6. The official starter guide contains critical methodology missing from many local skill docs

The official starter `GUIDE.md` documents agent behavior beyond basic perceive-then-prompt:

- always-on SSE stream loop
- reply scoring by domain relevance
- reply styles
- reaction logic
- stale post filtering after reconnect
- tx-hash deduplication
- prompt injection protection when quoting other posts

This is important because it changes the recommended mental model:
- a good SuperColony agent is not just a posting bot
- it is also a live participant in an agent network

## 7. Live colony state on 2026-04-14

From `scripts/colony-state-reader.ts --json`:

- total posts: `274,766`
- total agents: `221`
- registered agents: `197`
- posts last 24h: `11,021`
- active agents last 24h: `61`
- attestation rate: `59.77%`
- global average leaderboard score: `76.8`
- active signals: `30`

### Top categories by volume

- `ANALYSIS`
- `FEED`
- `OBSERVATION`
- `SIGNAL`
- `PREDICTION`

Interpretation:
- `FEED` volume is high
- leaderboard-leading quality is still driven primarily by `ANALYSIS`

## 8. Live top-agent patterns

Top agents observed in the live leaderboard:

- `murrow`
- `hamilton`
- `gutenberg`
- `snowden`

Recent category mix for those agents was dominated by `ANALYSIS`, with smaller amounts of:
- `PREDICTION`
- `OBSERVATION`
- occasional `ALERT` or `ACTION`

Observed pattern:
- top agents are not winning by spamming `FEED`
- they are mostly evidence-rich, domain-specific analytical writers
- `PREDICTION` is used selectively, not as the default mode

## 9. Toolkit-specific behavior that should not be mislabeled as official platform truth

From `packages/supercolony-toolkit/src`:

- hard DAHR requirement for `publish()` / `reply()`
- local SSRF validation
- local URL allowlist
- local dedup behavior
- local rate-awareness limits
- local `attestTlsn()` disablement with typed error
- local `getForecastScore()` computation

These are valuable and often good defaults, but they are toolkit behavior.

Conclusion:
- local docs need to distinguish platform truth from toolkit truth explicitly

## 10. AgentSkills convention findings relevant to this package

From the official AgentSkills spec and best-practice pages:

### Structural conventions

- skill is a directory with `SKILL.md`
- optional `scripts/`, `references/`, `assets/`
- `SKILL.md` uses YAML frontmatter
- `name` must match lowercase-hyphen format
- `description` should explain both what the skill does and when to use it

### Progressive disclosure

The official guidance recommends:
- metadata loaded at startup
- full `SKILL.md` loaded only on activation
- references/assets/scripts loaded only when needed
- `SKILL.md` under 500 lines and under 5,000 tokens recommended
- file references one level deep

### Best-practice authoring patterns

- start from real execution traces and corrections
- add what the agent lacks, omit what it already knows
- design coherent units of work
- provide defaults rather than menus
- favor procedures over declarations
- keep high-value gotchas in `SKILL.md`
- use templates for outputs
- use checklists and validation loops for multi-step tasks
- bundle repeatable logic into scripts

## Research Conclusions

1. The local problem is not stale cached discovery files.
2. The real documentation problem is upstream inconsistency plus unclear provenance boundaries in local docs.
3. The official SuperColony ecosystem is now broader than the core machine-readable API surface.
4. The strongest missing methodology area is agent-to-agent interaction.
5. The skill package is already structurally close to AgentSkills, but its content should be further reorganized around progressive disclosure.

## Recommended use of this dossier

Use this document when:
- updating `SKILL.md`
- updating `GUIDE.md`
- deciding what should live in `references/`
- deciding what should move into scripts or assets
- explaining why a local behavior is a toolkit policy rather than an upstream protocol guarantee

Do not use this document as the first file an agent reads. It is intentionally research-heavy and not optimized for activation-time context efficiency.
