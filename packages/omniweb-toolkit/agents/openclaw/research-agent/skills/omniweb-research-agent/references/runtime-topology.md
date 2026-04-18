---
summary: "Runtime topology for omniweb-toolkit: which agent paths run through the package minimal runtime versus the older V3 session-runner world, and which path is canonical for research hardening."
read_when: ["runtime topology", "session runner vs package runtime", "canonical research runtime", "research starter", "v3 strategy bridge"]
---

# Runtime Topology

Use this file when the question is not "what can the package do?" but "which runtime path actually executes which logic?"

## Two Runtime Worlds

This repo currently contains two valid but separate execution paths:

1. **Package minimal-runtime world**
   - entrypoints such as the package archetype starters (`assets/research-agent-starter.ts`, `assets/market-analyst-starter.ts`, and `assets/engagement-optimizer-starter.ts`)
   - shared runtime in `src/minimal-agent.ts`
   - package-level research logic in:
     - `src/research-draft.ts`
     - `src/research-evidence.ts`
     - `src/research-family-dossiers.ts`
     - `src/research-self-history.ts`

2. **Legacy V3 session-runner world**
   - `cli/session-runner.ts`
   - `cli/v3-loop.ts`
   - `src/actions/publish-pipeline.ts`
   - older source policy / matcher / gate flow under `src/toolkit/` and `src/lib/`

These worlds can publish similar content, but they do not currently share one common research-execution layer.

## Canonical Research Path

For research-agent work, the **canonical runtime is the package minimal-runtime path**, specifically:

- `assets/research-agent-starter.ts`
- the exported and packaged copies of that starter

That is where the current research hardening lives, including:

- family-specific source profiles
- evidence summaries and derived metrics
- semantic evidence classification
- family dossier grounding rules
- self-history and prior-coverage delta
- substrate-aware prompt packets

If the task is to improve the research agent itself, start there.

## What The Session Runner Is

The V3 session runner remains a separate runtime with its own strategy bridge and source pipeline. Treat it as:

- the sentinel / legacy operator runtime
- a separate execution world that may later absorb shared policy
- **not** the default place to land package research-agent improvements

Do not assume that a change to the package research starter automatically changes `cli/session-runner.ts`, and do not assume the reverse either.

## Practical Rule

If the work is:

- **research-agent quality, family logic, prompt packet, evidence semantics, self-history, or research-specific skip logic**
  - change the package research runtime

- **sentinel session orchestration, V3 hooks, older source matcher wiring, or session oversight behavior**
  - change the session-runner world

## Convergence Rule

Only converge the two worlds deliberately.

If a piece of research logic now needs to benefit both runtimes:

1. identify the smallest reusable policy layer
2. extract it into a shared package/toolkit boundary on purpose
3. wire both runtimes to that shared layer

Do **not** duplicate logic across both paths casually, and do **not** assume the session runner is the hidden consumer of package research starters.
