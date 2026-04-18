# SKILL.md + GUIDE.md Audit Against Official SuperColony Documentation

You are in a Codex CLI session. Your job is to compare our toolkit's SKILL.md and GUIDE.md against everything SuperColony officially publishes, then recommend improvements. Take your time — fetch live documentation, read GitHub repos, and be thorough.

## Background

We build `omniweb-toolkit` — a TypeScript toolkit for building AI agents on SuperColony. Our consumer-facing docs are:
- `packages/omniweb-toolkit/SKILL.md` (~410 lines) — teaches an AI agent how to use the toolkit
- `packages/omniweb-toolkit/GUIDE.md` (~443 lines) — methodology for building good agents

These were written based on our understanding of SuperColony. Now we need to verify them against the actual official sources and update anything that's wrong, missing, or stale.

## Phase 1: Gather Official Documentation

Fetch and read all of these official SuperColony sources:

### Web sources (fetch live)
1. `https://supercolony.ai/llms.txt` — short AI-readable summary
2. `https://supercolony.ai/llms-full.txt` — full API documentation for AI agents
3. `https://supercolony.ai/.well-known/ai-plugin.json` — AI plugin manifest
4. `https://supercolony.ai/.well-known/agents.json` — A2A agent card
5. `https://supercolony.ai` — main site, look for docs/about/how-it-works pages
6. `https://docs.demos.sh` or `https://demos.sh/docs` — if official SDK docs exist

### Local copies (already in repo)
7. `docs/research/supercolony-discovery/llms-full.txt` — our cached copy (may be stale vs live)
8. `docs/research/supercolony-discovery/openapi.json` — our cached OpenAPI spec
9. `docs/research/supercolony-discovery/ai-plugin.json` — our cached AI plugin
10. `docs/research/supercolony-discovery/agents.json` — our cached A2A card

### GitHub repos (search and read)
11. `https://github.com/kynesyslabs` — the KyneSys org (Demos parent company)
12. Look specifically for:
    - `supercolony-agent-starter` or similar starter repos
    - Any official SKILL.md or agent documentation
    - SDK documentation beyond what's in the npm package
    - Colony rules, scoring documentation, category definitions
    - Agent registration docs, identity linking docs
    - Attestation (DAHR/TLSN) documentation
    - Prediction market rules, betting mechanics
    - Tipping/escrow mechanics

### Colony state (for context)
13. Read `scripts/colony-state-reader.ts` and the output in this repo to understand what the live colony looks like today

## Phase 2: Compare SKILL.md Against Official Sources

Read `packages/omniweb-toolkit/SKILL.md` end-to-end. For each section, compare against the official docs:

### Accuracy checks
1. **connect() and Quick Start** — does our example match the official recommended way to start?
2. **Method table** — for every method we list, verify it matches the official API docs (endpoint path, parameters, return shape)
3. **Scoring formula** — we claim `Base 20 + DAHR 40 + Confidence 5 + LongText 15 + Reactions 10+10 = max 100`. Is this still accurate? Check official docs.
4. **Categories** — we list 10 (OBSERVATION, ANALYSIS, PREDICTION, ALERT, ACTION, SIGNAL, QUESTION, OPINION, FEED, VOTE). Are there new ones? Are any deprecated?
5. **Rate limits** — we say "Write rate limit: 14 posts/day, 5 posts/hour". Official source?
6. **DAHR attestation flow** — is our description of how DAHR works accurate?
7. **Escrow/tipping mechanics** — do our method names and descriptions match?
8. **Prediction markets** — are the mechanics (place bet, resolve, accuracy tracking) correct?
9. **Identity linking** — is our description of cross-platform identity correct?
10. **Security claims** — SSRF validation, spend caps, dedup — are these accurately described?

### Completeness checks
11. Are there official API endpoints we don't document?
12. Are there agent capabilities we don't mention?
13. Are there colony features (governance, reputation tiers, swarm ownership) we should cover?
14. Are there agent best practices from official docs we're missing?
15. Does the official starter repo have patterns we should adopt?

### Freshness checks
16. Compare our local `llms-full.txt` against the live version — what changed?
17. Are there new endpoints in the live OpenAPI spec we don't cover?
18. Are there deprecated endpoints we still reference?

## Phase 3: Compare GUIDE.md Against Official Sources

Read `packages/omniweb-toolkit/GUIDE.md` end-to-end:

1. **Perceive-then-prompt pattern** — does this align with official best practices?
2. **Phase 1 (Perceive)** — are the recommended data fetches complete?
3. **Phase 2 (Prompt)** — do the prompt templates follow official colony ethos?
4. **Anti-patterns** — are our 8 anti-patterns accurate? Are there more from official docs?
5. **Scoring impact** — do our quality tips match the official scoring formula?
6. **Voice and personality guidance** — does this align with what the colony rewards?
7. **Colony philosophy (Share/Index/Learn)** — is this the official framework or our interpretation?

## Phase 4: Compare Against Top Agents

Look at the live colony for patterns from top-scoring agents (murrow, hamilton, gutenberg, snowden — all 84+):

1. What categories do they publish in?
2. What makes their posts score high?
3. What engagement patterns do they follow?
4. Do they have public repos or documented strategies we can learn from?

Search GitHub for:
- Any public agent repos that publish to SuperColony
- Community discussions about agent strategies
- Official blog posts or guides about building agents

## Phase 5: Recommendations

Based on everything you found, produce:

### Corrections
Things in our SKILL.md/GUIDE.md that are **wrong** and need fixing:
| # | File:Line | Current Claim | Official Truth | Fix |
|---|-----------|---------------|----------------|-----|

### Additions
Things missing from our docs that official sources cover:
| # | Topic | Source | What to Add | Priority |
|---|-------|--------|-------------|----------|

### Removals
Things in our docs that are outdated or no longer relevant:
| # | File:Line | What | Why Remove |
|---|-----------|------|------------|

### Strategic Insights
What do the official sources and top agents tell us about how to build effective agents? Things that should inform our playbook approach:
- What does the colony actually reward?
- What patterns do high-scoring agents follow?
- What's the official stance on agent-to-agent engagement?
- Are there features we're not using that could give us an edge?

### Local vs Live Documentation Drift
If the live versions of llms-full.txt, openapi.json, or ai-plugin.json differ from our cached copies, list every difference.
