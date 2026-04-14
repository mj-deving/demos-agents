# SuperColony Skill Improvement Recommendations

Status: standalone design document  
Audience: maintainers of `packages/supercolony-toolkit`  
Primary goal: improve the skill package as an AgentSkills-compliant artifact, not just as a documentation set

## Why This Document Exists

`SKILL.md` and `GUIDE.md` are user-facing assets. This document is different: it is an implementation plan for how I would improve the skill package itself after reviewing:

- the official SuperColony source landscape
- live colony behavior
- the current toolkit docs and code
- the official AgentSkills specification
- the AgentSkills best-practice guidance for progressive disclosure and skill authoring

This document is deliberately opinionated. It is not a neutral audit.

## Executive Recommendation

I would stop treating the current package as "a single skill with a couple of companion docs" and instead treat it as a proper AgentSkills bundle with:

1. a much leaner `SKILL.md`
2. a more activation-oriented `GUIDE.md`
3. a deliberate `references/` information architecture
4. a few deterministic scripts for repeated validation tasks
5. a small set of templates / assets for output patterns
6. evaluation cases that explicitly test activation quality, progressive disclosure, and live-surface drift

The package is already structurally close to AgentSkills. The main gap is content architecture.

## AgentSkills Conventions That Matter Here

From the AgentSkills spec and best-practices guidance, the most relevant conventions are:

### 1. Progressive disclosure

The official guidance expects:
- metadata at startup
- full `SKILL.md` only on activation
- supporting files only when needed

Implication for this package:
- `SKILL.md` should contain only the instructions that are useful on nearly every activation
- everything else should move to targeted references or scripts

### 2. Lean activation surface

The spec recommends:
- `SKILL.md` under 500 lines
- under 5,000 tokens recommended
- one-level-deep file references

Current state:
- `SKILL.md`: `557` lines
- `GUIDE.md`: `562` lines

Interpretation:
- both documents are doing too much
- the problem is not just length, but mixed purpose

### 3. Give defaults, not menus

AgentSkills best practices explicitly recommend picking a default approach and mentioning alternatives briefly.

Implication here:
- use one default source of truth per topic
- use one default category strategy per example
- use one default read path and one default publish path per workflow

### 4. Keep gotchas where the agent will need them

The best-practice doc is very clear: high-value gotchas belong in `SKILL.md` if the agent is likely to miss them before it knows to look elsewhere.

Implication here:
- provenance boundaries are a gotcha
- category inconsistency is a gotcha
- A2A card vs `agents.json` is a gotcha
- wallet-backed vs zero-config integration is a gotcha

These should stay in `SKILL.md`, but briefly.

### 5. Use scripts for repeated logic

If the same validation or extraction logic keeps getting reconstructed by the agent, AgentSkills guidance recommends bundling it as a script.

Implication here:
- drift checks
- live surface snapshots
- category verification
- maybe source-map generation

should become scripts, not prose.

## What I Would Change

## A. Redesign the skill package around explicit layers

I would make the package architecture express four distinct layers:

1. `SKILL.md`
   Activation-time routing and core instructions

2. `GUIDE.md`
   Methodology for building good agents

3. `references/`
   On-demand technical and conceptual detail

4. `scripts/`
   Deterministic validation and research helpers

The current package has these pieces, but the role boundaries are blurry.

## B. Shrink `SKILL.md` aggressively

### Target

- `SKILL.md` under 400 lines
- ideally under 3,500 tokens

### What should stay in `SKILL.md`

Only the content that is useful almost every time the skill activates:

- trigger / purpose / scope
- source-boundary warning
- default connection model
- minimal quick start
- category caution
- short discovery map
- a compact method index
- 5-10 high-value gotchas
- explicit directions for what to load next

### What should leave `SKILL.md`

Move out:
- long method tables
- large response-shape explanations
- extended prediction-market walkthroughs
- rich strategy advice
- detailed ecosystem exposition
- long-form scoring discussion
- implementation caveats that only matter in specific branches

### Desired shape

I would restructure `SKILL.md` roughly like this:

1. Frontmatter
2. What this skill is for
3. Source boundaries
4. Default workflow
5. Core methods you will usually need
6. High-value gotchas
7. When to load each companion file
8. Minimal examples

That shape aligns better with activation-time utility than the current encyclopedic form.

## C. Turn `GUIDE.md` into a real methodology companion

Right now `GUIDE.md` is informative, but it still mixes:
- methodology
- local heuristics
- some platform facts

I would make it explicitly about agent design, not API reference.

### Keep in `GUIDE.md`

- perceive-then-prompt
- stateful deltas
- skip logic
- prompt structure
- reply / reaction loop
- voice guidance
- anti-patterns
- quality examples

### Move out of `GUIDE.md`

- anything that reads like API contract
- anything that is mainly endpoint enumeration
- details that belong in `references/`

### One important change

I would keep the interaction loop section and expand it a bit more, because this is the biggest methodological gap the official starter guide exposed.

## D. Rebuild `references/` around load triggers

AgentSkills best practices say progressive disclosure only works if the agent is told *when* to load each file.

This is the biggest structural improvement I would make.

### Recommended reference map

I would create these files:

- `references/platform-surface.md`
  What is official machine-readable, what is official human guide, what is observed live, what is toolkit behavior

- `references/categories.md`
  Category matrix across `llms-full.txt`, `supercolony-skill.md`, and live colony evidence

- `references/discovery-and-manifests.md`
  `llms.txt`, `llms-full.txt`, OpenAPI, plugin manifest, `agent.json`, `agents.json`, advertised-but-missing resources

- `references/live-endpoints.md`
  Broader live routes outside the core OpenAPI surface

- `references/response-shapes.md`
  Keep this, but trim it so it stays a true reference file

- `references/scoring-and-leaderboard.md`
  Separate scoring formula, leaderboard interpretation, and prediction-score notes

- `references/interaction-patterns.md`
  SSE, replies, reactions, reconnect logic, prompt-injection hygiene

- `references/toolkit-guardrails.md`
  SSRF, allowlist, dedup, local rate awareness, DAHR hard gate, TLSN runtime caveat

### Required trigger language in `SKILL.md`

For progressive disclosure to work, `SKILL.md` should include lines like:

- "Load `references/categories.md` if you need the full category matrix or category conflict details."
- "Load `references/toolkit-guardrails.md` if a publish, attest, or URL-validation workflow fails."
- "Load `references/interaction-patterns.md` when building a streaming / reply-capable agent."
- "Load `references/live-endpoints.md` if you need routes beyond the core OpenAPI."

Without these trigger cues, references become a dumping ground rather than a context-saving system.

## E. Add deterministic scripts for recurring research and validation

This is the most underused part of the current package.

### Scripts I would add

1. `scripts/check-discovery-drift.ts`
   Compare live `llms-full.txt`, `openapi.json`, `ai-plugin.json`, `agents.json`, `agent.json` against expected snapshots

2. `scripts/check-live-categories.ts`
   Query live stats/feed and print active categories

3. `scripts/check-endpoint-surface.ts`
   Verify which advertised endpoints are live, which are auth-gated, and which are `404`

4. `scripts/leaderboard-snapshot.ts`
   Pull top agents and summarize category mix / score / reactions

5. `scripts/skill-self-audit.ts`
   Validate package-specific AgentSkills hygiene:
   - `SKILL.md` line count
   - required frontmatter
   - broken relative file references
   - one-level-deep path discipline
   - references actually mentioned from `SKILL.md`

### Why these scripts matter

Right now the most fragile parts of the skill are:
- live-surface drift
- category drift
- discovery-manifest drift
- documentation provenance drift

These are better handled by repeatable checks than by prose.

## F. Introduce templates and assets where structure matters

The AgentSkills best-practice guidance recommends templates for output formats.

For this package, I would add:

- `assets/post-template-analysis.md`
- `assets/post-template-prediction.md`
- `assets/reply-template.md`
- `assets/agent-loop-skeleton.ts`

These should not all be in `SKILL.md`. They should be referenced when needed.

### Example

Instead of embedding a large output schema block in the middle of `GUIDE.md`, I would prefer:

- a short note in `GUIDE.md`
- a pointer to `assets/post-template-analysis.md`

This reduces activation-time noise while preserving a concrete pattern.

## G. Improve the frontmatter description for better activation quality

AgentSkills says the `description` should explain both what the skill does and when to use it, with keywords that help activation.

The current description is strong, but I would optimize it for trigger precision.

### What I would emphasize

- publishing attested SuperColony posts
- reading colony signals and live feed data
- wallet-backed Demos actions
- identity, escrow, and chain actions
- not for generic web scraping or arbitrary blockchain tasks

### What I would avoid

- too much detail that reads like body content
- long lists of every capability if they reduce trigger clarity

In other words:
- frontmatter should be activation-friendly
- the body should be execution-friendly

## H. Make provenance a first-class concept in the package

This is specific to this skill, not generic AgentSkills advice.

The package should define and reuse a standard vocabulary:

- **Official machine-readable**
- **Official human guide**
- **Observed live behavior**
- **Toolkit behavior**

I would use those labels consistently across:
- `SKILL.md`
- `GUIDE.md`
- `references/`
- future research docs

That reduces a core failure mode: the agent mistaking local runtime behavior for official platform truth.

## I. Create a clear "what to read next" path

The current package has many good docs but weak navigation logic.

I would add an explicit routing section near the bottom of `SKILL.md`:

| Need | Load |
|------|------|
| Build a posting agent | `GUIDE.md` |
| Understand categories and drift | `references/categories.md` |
| Debug publish / attest failures | `references/toolkit-guardrails.md` |
| Use broader official endpoints | `references/live-endpoints.md` |
| Understand response fields | `references/response-shapes.md` |
| Understand scoring | `references/scoring-and-leaderboard.md` |
| Build stream/reply logic | `references/interaction-patterns.md` |

This is textbook progressive disclosure.

## J. Add evaluation cases specifically for the skill as a skill

The package already has evals, but I would extend them to cover AgentSkills behavior, not just runtime behavior.

### Evals I would add

1. Activation precision
   Does the frontmatter description trigger on SuperColony tasks and avoid false positives?

2. Progressive-disclosure routing
   When asked about categories, does the agent reach for the correct reference file?

3. Provenance discipline
   Does the agent distinguish official platform behavior from toolkit behavior?

4. Interaction methodology
   When asked to build a full agent, does it include stream / reply / react loops rather than just a posting loop?

5. Drift resilience
   When categories or endpoints differ across documents, does the agent surface the ambiguity rather than hallucinate a single answer?

## Proposed Package Structure

This is the concrete file layout I would aim for:

```text
packages/supercolony-toolkit/
├── SKILL.md
├── GUIDE.md
├── README.md
├── references/
│   ├── response-shapes.md
│   ├── platform-surface.md
│   ├── categories.md
│   ├── discovery-and-manifests.md
│   ├── live-endpoints.md
│   ├── scoring-and-leaderboard.md
│   ├── interaction-patterns.md
│   └── toolkit-guardrails.md
├── scripts/
│   ├── feed.ts
│   ├── balance.ts
│   ├── check-discovery-drift.ts
│   ├── check-live-categories.ts
│   ├── check-endpoint-surface.ts
│   ├── leaderboard-snapshot.ts
│   └── skill-self-audit.ts
├── assets/
│   ├── post-template-analysis.md
│   ├── post-template-prediction.md
│   ├── reply-template.md
│   └── agent-loop-skeleton.ts
└── evals/
    ├── evals.json
    └── trajectories.yaml
```

## What I Would Not Do

To be explicit, I would not:

1. Keep adding more detail to `SKILL.md`
   That fights the AgentSkills model rather than using it.

2. Merge the research back into the activation docs
   Research documents are important, but they are poor activation surfaces.

3. Present one source as fully canonical when the upstream docs disagree
   This creates brittle agent behavior.

4. Put every edge case into `GUIDE.md`
   Most detailed edge cases belong in references or scripts.

5. Treat every official endpoint as equally important for activation
   The activation surface should be shaped around the common path.

## Ordered Implementation Plan

If I were doing the improvement work end-to-end, I would do it in this order:

### Phase 1: Content architecture

1. Shrink `SKILL.md` below 500 lines
2. Define routing triggers to companion files
3. Split out the new reference files

### Phase 2: Deterministic support

4. Add the live-surface validation scripts
5. Add the self-audit script for AgentSkills hygiene
6. Add output templates in `assets/`

### Phase 3: Evaluation

7. Add activation / routing / provenance evals
8. Add category-drift and endpoint-drift evals
9. Add one full-agent eval that expects stream/reply/react behavior

### Phase 4: Maintenance

10. Document the update policy:
    - what to trust when sources conflict
    - how to refresh live research
    - when to change `SKILL.md` versus `references/`

## Bottom Line

The package does not mainly need more content. It needs better context economics.

Per AgentSkills conventions, the right fix is:
- leaner activation docs
- sharper routing
- more just-in-time references
- deterministic scripts for repeated checks
- evaluations that test the skill as a skill, not only the toolkit as code

If this package adopts that structure, it will become:
- easier for agents to activate correctly
- cheaper in context
- more robust to SuperColony documentation drift
- easier for maintainers to evolve without bloating `SKILL.md`
