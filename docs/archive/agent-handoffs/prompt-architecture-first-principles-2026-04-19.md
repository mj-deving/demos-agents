# Prompt Architecture: First-Principles Design Memo

Date: 2026-04-19
Status: design/planning artifact, no code changes

---

## 1. Findings First

### The system has 10 irreducible layers. Only the research archetype has all 10.

| Layer | What it answers | Research | Market | Engagement |
|-------|----------------|----------|--------|------------|
| 1. Skeleton | What sections does every prompt have? | Yes (`ColonyPromptPacket`) | Yes | Yes |
| 2. Archetype | What kind of analyst am I? | Yes (role, edge) | Yes | Yes |
| 3. Strategy | What should I write about? | Yes (opportunity derivation + portfolio ranking) | Partial (opportunity derivation only) | Partial |
| 4. Topic-family | What data matters for this topic? | Yes (source profiles, 6 families) | No (implicit in divergence type) | No |
| 5. Data-semantic | What does each metric mean and NOT mean? | Partial (brief pre-interprets; no dictionary) | No | No |
| 6. Evidence | What are the actual numbers? | Yes (evidence summaries, derived metrics) | Partial (price + divergence only) | Partial (post + reactions only) |
| 7. Colony context | What has the colony said? | Yes (colony substrate, self-history, linked themes) | No | Partial (post reactions only) |
| 8. Claim contract | What am I allowed to claim? | Yes (dossier falseInferenceGuards + allowedThesisSpace) | No | No |
| 9. Output contract | What shape for the output? | Yes (category, confidence style, success criteria) | Yes | Yes |
| 10. Quality gate | Did the output respect claim bounds? | Yes (6 family-specific slip patterns + 4 generic checks) | Generic only | Generic only |

**This is the core problem.** The research archetype developed organically to ~740 lines because it discovered it needed all 10 layers. The market (230 lines) and engagement (~200 lines) are missing layers 4, 5, 7, 8, and 10. Rather than copying research's approach, we need to extract these layers into a composable architecture.

### Three specific architectural debts

1. **No data-semantic layer exists anywhere.** The brief builder (`buildFundingStructureBrief`, etc.) pre-interprets metrics into prose (`anomalySummary` like "Funding is negative (-120 bps), the mark/index spread is..."). But there's no structured dictionary that says "fundingRateBps: measures the 8-hour annualized cost of holding a long perpetual position; does NOT predict price direction (Presto Research: R-squared ~0)." The literature-backed claim limits from the family audits live in human-readable memo files, not in machine-usable form.

2. **Claim contracts are hardcoded strings in TypeScript.** The dossier `falseInferenceGuards` are arrays of literal English sentences inside `research-family-dossiers.ts`. They're correct (the audit confirmed this), but they're not composable, not testable as data, and not reusable across archetypes.

3. **The quality gate divergence is growing.** Research has 6 family-specific slip pattern arrays + 4 generic checks + semantic evidence grounding + evidence-value overlap checks. Market and engagement have only the generic `checkPublishQuality`. The oracle-divergence audit found this gap explicitly — the market draft has no guards against "the market is wrong" overclaiming.

---

## 2. Diagnosis of Current Architecture

### What currently works well

- **`ColonyPromptPacket<TInput>`** is a good generic skeleton. The 7 sections (archetype, role, edge, input, instruction, constraints, output) are sufficient. The problem isn't the shape; it's the *content selection* that fills it.
- **`deriveResearchSourceProfile()`** is a clean topic-family classifier. It takes a topic string, infers the asset, matches term lists, and returns a typed source profile with expected metrics and source IDs. This pattern should generalize.
- **`ResearchFamilyDossier`** (baseline, focus, falseInferenceGuards) is the right abstraction for claim contracts. It just needs to become a typed data structure loaded from configuration, not hardcoded in the brief builder.
- **`buildResearchBrief()`** correctly computes the brief from the dossier + live metric values. The `anomalySummary`, `allowedThesisSpace`, and `invalidationFocus` fields are genuinely useful for scoping the LLM's reasoning.
- **`ResearchColonySubstrate`** is a good pattern for colony context assembly. It extracts signal summary, supporting/dissenting takes, cross-references, and recent related posts into a structured object the prompt can consume.
- **The quality gate architecture** (base gate + archetype-specific checks + family-specific slip patterns) is a sound layered defense. It just needs to be applied consistently.

### What currently fails

- **Market and engagement are prompt-first, not plan-first.** The research pipeline is: derive opportunity → build source profile → fetch evidence → compute brief → build colony substrate → assemble prompt → generate → quality gate. The market pipeline is: derive opportunity → assemble prompt → generate → generic gate. There's no plan between the opportunity and the prompt.

- **Brief builders conflate data interpretation with claim scoping.** `buildFundingStructureBrief()` both interprets the data ("Funding is negative") and scopes the claim ("Write about positioning stress only if..."). These should be separate operations: data interpretation should be deterministic, claim scoping should come from the family contract.

- **The linked-themes system is ad hoc.** `buildLinkedResearchContext()` uses hardcoded keyword matching (`mentions("absorption", "bitcoin absorption", "btc absorption")`) to attach themes. This should be a routing table or a typed mapping, not string matching in a function body.

- **`inferDirection` in market-opportunities.ts has a dangerous cascade.** It takes the first non-null from agentDirection → marketDirection → signal → price, and calls this `recommendedDirection`. The cascade can produce contradictory results when the sources disagree — which is exactly the situation (a divergence) that triggered the opportunity.

- **The `edge` field in ColonyPromptPacket is misused.** In the research archetype, `edge` describes the analytical advantage ("Depth over speed"). In the market archetype, `edge` describes a tradeable advantage ("Surface the live edge") — which the oracle-divergence audit found is not defensible from the data. The field means different things in different archetypes.

### What is wrongly living in prompts

| Current location | What it is | Where it should live |
|-----------------|-----------|---------------------|
| `research-family-dossiers.ts` dossier strings | Claim contracts per family | Typed data structure loaded from config |
| `research-draft.ts` slip pattern regexes | Quality gate rules per family | Quality gate config, not prompt builder |
| `research-draft.ts` `buildResearchAnalysisAngle()` | Topic-dependent angle selection | Strategy/planning layer before prompt |
| `research-family-dossiers.ts` brief builders | Data interpretation + claim scoping | Separate: interpretation is deterministic, scoping is from contract |
| `market-draft.ts` prompt packet `edge` array | Framing claims about the data | Should be controlled by claim contract, not hardcoded in prompt builder |
| `research-family-dossiers.ts` `buildLinkedResearchContext()` | Cross-theme routing | Typed routing table or graph |
| `market-opportunities.ts` `inferDirection` | Direction recommendation | Should expose both sides of disagreement, not flatten to one recommendation |

### What is too implicit and should be explicit

| Currently implicit | Should be | Why |
|-------------------|----------|-----|
| What each metric measures | Structured metric dictionary with `means` and `doesNotMean` fields | The family audits generated this knowledge; it's in memos, not in code |
| Which claims require which metrics | Typed claim → evidence requirements | Currently only known from reading the brief builder code |
| How severity/confidence maps to claim strength | Typed severity → claim-bound mapping | Currently opaque (severity scoring in market-opportunities.ts) |
| When a metric is stale or missing | Metric freshness / completeness annotations | Currently the brief says "unresolved" but doesn't change claim bounds |
| What the colony substrate means for claim scoping | Typed colony-context → claim modifier | Currently only research uses colony substrate at all |

---

## 3. First-Principles Design Proposal

### The core design principle

**The prompt is a rendering layer, not the planning layer.** All decisions about what data matters, what claims are allowed, and what the thesis space should be must be made *before* the prompt is assembled. The prompt's job is to present these pre-computed decisions to the LLM in a legible way.

This means:
- The strategy/planning layer decides *what to write about* and *what data supports it*
- The topic-family layer decides *what claims are defensible* from that data
- The data-semantic layer annotates *what each metric means*
- The prompt skeleton *presents* all of this to the model
- The quality gate *verifies* the model respected the claim bounds

### The seven-layer architecture

```
┌──────────────────────────────────────────────────────────┐
│  Layer 1: SKELETON                                        │
│  ColonyPromptPacket<TInput>                               │
│  Generic across all archetypes and families               │
│  archetype | role | edge | input | instruction |          │
│  constraints | output                                     │
└──────────────────────────────────────────────────────────┘
                              ↑ rendered from
┌──────────────────────────────────────────────────────────┐
│  Layer 2: ARCHETYPE CONFIG                                │
│  One per archetype (research, market, engagement)         │
│  Provides: role, edge, output shape, confidence style,    │
│  success criteria, system prompt                          │
│  Does NOT contain: data selection, claim bounds, metrics  │
└──────────────────────────────────────────────────────────┘
                              ↑ composed with
┌──────────────────────────────────────────────────────────┐
│  Layer 3: TOPIC-FAMILY CONTRACT                           │
│  One per family (funding, ETF, spot, network,             │
│  stablecoin, VIX, oracle-divergence, ...)                 │
│  Provides:                                                │
│    - expectedMetrics: what data this family uses          │
│    - claimBounds: { defensible[], blocked[], requires[] } │
│    - metricSemantics: per-metric { means, doesNotMean }   │
│    - qualityChecks: family-specific slip patterns         │
│  Loadable from config, not hardcoded in TypeScript        │
└──────────────────────────────────────────────────────────┘
                              ↑ applied to
┌──────────────────────────────────────────────────────────┐
│  Layer 4: EVIDENCE PACKET                                 │
│  Assembled by the planning layer, not the prompt builder  │
│  Contains: values, derivedMetrics, sources, freshness     │
│  Each metric annotated with its semantic from the         │
│  topic-family contract                                    │
└──────────────────────────────────────────────────────────┘
                              ↑ contextualized by
┌──────────────────────────────────────────────────────────┐
│  Layer 5: COLONY CONTEXT                                  │
│  Colony substrate + self-history + linked themes          │
│  Applied to ALL archetypes, not just research             │
│  Provides: what has been said, who agrees/dissents,       │
│  what the agent itself said last time                     │
└──────────────────────────────────────────────────────────┘
                              ↑ scoped by
┌──────────────────────────────────────────────────────────┐
│  Layer 6: CLAIM CONTRACT (computed, not hardcoded)        │
│  = topic-family.claimBounds filtered by what metrics      │
│    are actually present and fresh in the evidence packet  │
│  Produces:                                                │
│    - allowedThesisSpace (what you may write about)        │
│    - invalidationFocus (what would break the thesis)      │
│    - blockedClaims (what you must NOT write)              │
│    - missingForStronger (what data would enable more)     │
└──────────────────────────────────────────────────────────┘
                              ↑ verified by
┌──────────────────────────────────────────────────────────┐
│  Layer 7: QUALITY GATE                                    │
│  = generic checks (length, meta-leak, evidence overlap)   │
│  + archetype checks (style, angle grounding)              │
│  + family checks (slip patterns from topic-family)        │
│  Runs AFTER LLM output, BEFORE publish                    │
└──────────────────────────────────────────────────────────┘
```

### What changes from current architecture

1. **Topic-family contracts become data, not code.** Instead of `FUNDING_STRUCTURE_DOSSIER` as a const object in a TypeScript file, the dossier becomes a structured data file (YAML, JSON, or a typed registry) that includes metric semantics, claim bounds, and quality check patterns. This is where the family audit findings get encoded as machine-usable doctrine.

2. **The brief builder becomes generic.** Instead of `buildFundingStructureBrief()`, `buildStablecoinSupplyBrief()`, etc., there's one `buildBrief(dossier, evidencePacket, colonyContext)` function that computes the brief from the contract and the data. Family-specific interpretation (like "describe range location" for spot-momentum) becomes a typed formatter in the contract, not a function in the brief builder.

3. **Market and engagement get the same layer stack.** The market archetype gets a topic-family contract for `oracle-divergence` (from the oracle-divergence audit). The engagement archetype gets a contract for `reply-synthesis`, `reaction-selection`, etc. They don't need to replicate research's code — they need to use the same layer architecture with their own contracts.

4. **Colony context becomes universal.** `ResearchColonySubstrate` already does the right thing — extract signal summary, takes, dissent, cross-references. This should be available to all archetypes, not just research. The market archetype currently ignores colony context entirely; it should at least know what the colony has already said about the asset.

5. **Quality gates compose from layers.** Instead of each draft builder assembling its own quality checks inline, the gate is composed: generic checks (from `checkPublishQuality`) + archetype checks (from the archetype config) + family checks (from the topic-family contract). The market draft's lack of family-specific gates becomes a config gap, not a code gap.

---

## 4. Recommended Layer Model (Detailed)

### Layer 1: Skeleton (`ColonyPromptPacket<TInput>`)

**Keep as-is.** The current shape is good. The 7 fields (archetype, role, edge, input, instruction, constraints, output) cover everything a model needs. `renderColonyPromptPacket()` is a clean serializer.

One change: rename `edge` to `analyticalStance` or `perspective` to avoid the "tradeable edge" misinterpretation the oracle-divergence audit flagged.

### Layer 2: Archetype Config

**Extract from draft builders into typed configuration.**

```typescript
interface ArchetypeConfig {
  name: string;
  role: string[];
  perspective: string[];  // was "edge"
  systemPrompt: string;
  outputCategory: string;
  confidenceStyle: string;
  outputShape: string[];
  successCriteria: string[];
  maxTokens: number;
  modelTier: "fast" | "standard" | "premium";
}
```

Currently hardcoded in `buildResearchPromptPacket()`, `buildMarketPromptPacket()`, `buildEngagementPromptPacket()`. Should be loaded from a registry.

### Layer 3: Topic-Family Contract

**The key new abstraction. This is where the family audit doctrine becomes machine-usable.**

```typescript
interface TopicFamilyContract {
  family: string;
  displayName: string;

  // What data this family uses
  expectedMetrics: string[];
  primarySourceIds: string[];
  supportingSourceIds: string[];

  // What each metric means (the data-semantic layer)
  metricSemantics: Record<string, {
    means: string;
    doesNotMean: string;
    source: string;  // e.g. "Binance Futures Premium Index"
  }>;

  // Claim bounds (the claim contract)
  claimBounds: {
    defensible: string[];     // what you may claim from this data
    blocked: string[];        // what you must NOT claim (falseInferenceGuards)
    requiresExtra: Array<{    // claims that need additional evidence
      claim: string;
      requiredMetric: string;
      reason: string;
    }>;
  };

  // Dossier context (brief building inputs)
  baseline: string[];
  focus: string[];

  // Quality gate patterns
  slipPatterns: Array<{
    pattern: string;  // regex source
    detail: string;
  }>;

  // Linked theme routing
  themeRoutes?: Array<{
    key: string;
    label: string;
    triggerKeywords: string[];
    reason: string;
  }>;
}
```

This is the single structure where family audit findings live as data. When we audit a new family (like oracle-divergence), the deliverable is a new `TopicFamilyContract` — not a new brief builder function.

### Layer 4: Evidence Packet (annotated)

**Extend `ResearchEvidenceSummary` to carry semantic annotations.**

The current `ResearchEvidenceSummary` has `values: Record<string, string>` and `derivedMetrics: Record<string, string>`. The annotated version would pair each metric with its semantic from the topic-family contract:

```typescript
interface AnnotatedMetric {
  key: string;
  value: string;
  means: string;       // from TopicFamilyContract.metricSemantics
  doesNotMean: string;  // from TopicFamilyContract.metricSemantics
  fresh: boolean;       // is this metric from the current fetch?
}
```

This annotation is computed deterministically — no LLM needed. It makes the prompt legible to weaker models because each number comes with its meaning.

### Layer 5: Colony Context (universal)

**Generalize `ResearchColonySubstrate` for all archetypes.**

The market archetype should know: what has the colony already said about BTC? Is there dissent? What's the reaction pattern? Currently it ignores this entirely. The engagement archetype should know: what's the conversation around this post?

The colony substrate interface already handles this — it just needs to be wired into market and engagement draft builders.

### Layer 6: Claim Contract (computed at prompt time)

**The claim contract is the intersection of the topic-family contract and the available evidence.**

```typescript
function computeClaimContract(
  familyContract: TopicFamilyContract,
  availableMetrics: string[],
  evidenceFreshness: Record<string, boolean>,
): ComputedClaimContract {
  return {
    allowedThesisSpace: /* derived from familyContract.claimBounds.defensible
                          filtered by which metrics are actually present */,
    blockedClaims: familyContract.claimBounds.blocked,
    weakenedClaims: /* claims that require metrics we don't have */,
    invalidationFocus: /* derived from which metrics are present */,
    missingForStronger: /* familyContract.claimBounds.requiresExtra
                          filtered by what's missing */,
  };
}
```

This is the key computation that currently happens implicitly inside brief builders. Making it explicit means the prompt gets a clear "you may claim X, you may not claim Y, and if you had Z you could claim more."

### Layer 7: Quality Gate (composed)

**Three-tier composition:**

```typescript
function composeQualityGate(
  archetype: ArchetypeConfig,
  familyContract: TopicFamilyContract,
): QualityGateFn {
  return (text, evidenceSummary, supportingEvidence) => {
    const base = checkPublishQuality(text, ...);           // generic
    const archetypeChecks = checkArchetypeQuality(text, archetype);  // per-archetype
    const familyChecks = checkFamilyQuality(text, familyContract);   // per-family
    return mergeGateResults(base, archetypeChecks, familyChecks);
  };
}
```

The family-specific slip patterns come from `TopicFamilyContract.slipPatterns` — so when we add oracle-divergence, the audit memo's recommended patterns become configuration, not new code.

---

## 5. Proposed Packet Architecture

### The prompt is rendered, not built

Instead of each archetype having its own `buildXxxPromptPacket()` function with ad hoc content selection, the prompt is assembled generically from the layer stack:

```
archetype config   →  role, perspective, output shape
                  +
topic-family       →  baseline, focus, blocked claims
                  +
evidence packet    →  annotated metrics with semantics
                  +
colony context     →  substrate, self-history, linked themes
                  +
claim contract     →  allowedThesisSpace, invalidationFocus, blockedClaims
                  ↓
ColonyPromptPacket<TInput>  →  renderColonyPromptPacket()  →  LLM call
```

### The `TInput` type becomes generic

Instead of `ResearchPromptInput`, `MarketPromptInput`, `EngagementPromptInput` as separate types, there's one `PromptInput` that all archetypes use:

```typescript
interface PromptInput {
  topic: string;
  analysisAngle: string;
  brief: {
    family: string;
    baselineContext: string[];
    focusNow: string[];
    blockedClaims: string[];
    anomalySummary: string;
    allowedThesisSpace: string;
    invalidationFocus: string;
    linkedThemes: Array<{ key: string; label: string; reason: string }>;
    domainContext: string[];
    substrateSummary: string | null;
    previousCoverageDelta: string | null;
  };
  evidence: {
    primarySourceName: string | null;
    primarySourceUrl: string;
    fetchedAt: string;
    annotatedMetrics: AnnotatedMetric[];
    supportingSources: Array<{
      source: string;
      url: string;
      fetchedAt: string;
      annotatedMetrics: AnnotatedMetric[];
    }>;
  };
  colonyContext: {
    situation: string;
    signalSummary: ColonySignalSummary;
    supportingTakes: ColonyTake[];
    dissentingTake: ColonyTake | null;
    recentRelatedPosts: RecentContextPost[];
    selfHistory: SelfHistorySummary | null;
  };
  claimContract: {
    allowedThesisSpace: string;
    invalidationFocus: string;
    blockedClaims: string[];
    missingForStronger: string[];
  };
}
```

This is a superset — some fields may be null for simpler archetypes (engagement doesn't need `annotatedMetrics`). But the shape is consistent, so any archetype can use colony context, claim contracts, or evidence as needed.

---

## 6. Prompt Skeleton Proposal

### Research archetype skeleton (high level)

```
ROLE: Deep research analyst writing colony-facing ANALYSIS posts.
PERSPECTIVE: Depth over speed. Synthesize the strongest signal. Surface tension.

BRIEF:
  Family: [family name]
  Baseline: [what is boring/normal for this family]
  Focus: [what matters this cycle]
  What changed: [anomaly summary with real numbers]
  Thesis space: [what you may write about]
  Invalidation: [what breaks the thesis]
  Blocked: [what you must NOT claim]

EVIDENCE:
  [For each metric]:
    [key]: [value]
    Means: [what this metric measures]
    Does not mean: [what it does NOT measure]

COLONY CONTEXT:
  Signal: [direction, confidence, agent count]
  Supporting takes: [snippets]
  Dissent: [snippet or none]
  Recent: [what the colony has already covered]
  Self-history: [what this agent said last time]

INSTRUCTION: Write one standalone ANALYSIS post...
CONSTRAINTS: [composable list from archetype + family + claim contract]
OUTPUT: [category, confidence style, shape, success criteria]
```

### Market archetype skeleton (high level)

```
ROLE: Quantitative market analyst publishing attested colony analysis.
PERSPECTIVE: Speed and precision. Translate observations into concrete reads.

BRIEF:
  Family: oracle-divergence
  Baseline: [A divergence is descriptive, not predictive]
  Focus: [What the two sides actually say]
  What changed: [divergence description with severity]
  Thesis space: [Frame as open question, not direction call]
  Invalidation: [What resolves the divergence]
  Blocked: [No "market is wrong"; no "edge"; no agent count as signal]

EVIDENCE:
  divergence.severity: [value]
    Means: internal grading of disagreement magnitude
    Does not mean: calibrated probability or validated signal strength
  price.change24h: [value]
    Means: 24-hour spot price change from exchange
    Does not mean: confirmation or rejection of agent sentiment

COLONY CONTEXT:
  [Same structure as research, but applied to the divergence asset]

INSTRUCTION: Write one standalone ANALYSIS post about the observed dislocation...
CONSTRAINTS: [composable list]
OUTPUT: [category, confidence style, shape, success criteria]
```

---

## 7. What Should Move Out of Prompts into Strategy/Planning

### Move to strategy/planning layer (before prompt)

| Currently in prompt logic | Move to | Reason |
|--------------------------|---------|--------|
| `buildResearchAnalysisAngle()` in research-draft.ts | Strategy layer (topic → angle mapping) | Angle selection is a planning decision, not a prompt-time computation |
| `buildLinkedResearchContext()` in research-family-dossiers.ts | Theme routing table in topic-family contract | Currently uses ad hoc keyword matching; should be config |
| `inferDirection()` in market-opportunities.ts | Expose both sides instead of flattening | The cascade hides disagreement; the prompt needs both perspectives |
| Severity → score mapping in market-opportunities.ts | Document severity methodology upstream, or expose magnitude | Currently opaque; scoring without methodology is cargo-cult |
| `describeRangeLocation()` in research-family-dossiers.ts | Metric formatter registry | Currently a function in the dossier file; should be a registered formatter |

### Move to configuration (not TypeScript)

| Currently in code | Move to | Reason |
|------------------|---------|--------|
| Dossier const objects in research-family-dossiers.ts | TopicFamilyContract data files | Adding a family shouldn't require writing a new TypeScript function |
| Slip pattern regex arrays in research-draft.ts | Quality gate config in TopicFamilyContract | Same — adding patterns shouldn't mean editing the draft builder |
| Metric interpretation in brief builders | MetricSemantics in TopicFamilyContract | The family audit produced this knowledge; it should be structured data |

---

## 8. Risks and Tradeoffs

### Risk: Over-abstraction

The current system works. The research archetype produces quality posts that pass sophisticated quality gates. Extracting everything into a 7-layer architecture could introduce complexity that doesn't earn its keep.

**Mitigation:** The first move should be extracting topic-family contracts as data, not rewriting the brief builders. If contracts-as-data works for the next 2-3 families (oracle-divergence, any new research family), the full architecture earns its keep. If it doesn't, we've only moved data out of code — no harm done.

### Risk: Weaker models can't use the semantic annotations

Adding "Means: X / Does not mean: Y" annotations to every metric makes the prompt longer. Weaker models may not benefit from the extra context.

**Mitigation:** The annotations should be optional — the contract specifies them, but the prompt renderer can include or omit them based on the model tier. "Standard" models get annotations; "premium" models may not need them; "fast" models get only the top 3 metrics with annotations.

### Risk: Generic PromptInput is too loose

A single `PromptInput` type that all archetypes use could become a "god object" where every field is optional and the type conveys no information.

**Mitigation:** The type should be a union of required and optional fields per archetype. Better: the archetype config declares which `PromptInput` fields it requires, and the prompt builder validates at build time that the required fields are populated.

### Risk: Config-driven contracts lose the expressiveness of code

Brief builders like `buildFundingStructureBrief()` contain real logic — conditional anomaly summaries, metric-dependent thesis space, spread direction descriptions. Moving these to config means either (a) the config language needs to be expressive enough, or (b) some logic stays in code as registered formatters.

**Mitigation:** Use registered formatters. The topic-family contract specifies metric semantics, claim bounds, and slip patterns as data. But each family can register a `formatBrief(contract, evidence): Brief` function for the computed parts (anomaly summary, conditional thesis space). The registry is typed and testable; it's just not inline in the brief builder.

### Tradeoff: Flexibility vs. complexity

The current system is simple but inconsistent (research has everything, market has little). The proposed system is consistent but more complex. The tradeoff is worth it only if:
1. New families can be added by writing a contract + formatter, not by writing a new draft builder
2. Market and engagement get claim-bound quality without duplicating research's code
3. The family audits' doctrine becomes machine-enforceable, not just documented

---

## 9. Recommended Phased Rollout

### Phase 1: Extract topic-family contracts as data (lowest risk, highest value)

- Define `TopicFamilyContract` interface
- Extract the 6 existing research dossiers into contract data files
- Create the oracle-divergence contract from the audit memo
- Existing brief builders consume contracts instead of hardcoded consts
- No change to ColonyPromptPacket shape or prompt rendering

### Phase 2: Add metric semantics to contracts

- Encode the family audit's "means / does not mean" findings per metric
- Add `AnnotatedMetric` type
- Research brief builder includes annotations when model tier warrants it
- Validate that annotated prompts produce better drafts on standard-tier models

### Phase 3: Generalize colony context

- Extract `ResearchColonySubstrate` into a generic `ColonySubstrate` builder
- Wire it into market-draft and engagement-draft
- Market archetype now knows what the colony has said about the divergence asset

### Phase 4: Compose quality gates from contracts

- Extract slip patterns from research-draft.ts into contract data
- Build `composeQualityGate(archetype, familyContract)` function
- Market and engagement archetypes get family-specific quality gates from their contracts
- The oracle-divergence audit's recommended slip patterns ship as config

### Phase 5: Generic prompt builder

- Replace `buildResearchPromptPacket()`, `buildMarketPromptPacket()`, `buildEngagementPromptPacket()` with one `buildPromptPacket(archetype, familyContract, evidence, colonyContext, claimContract)`
- Each archetype retains its config (role, perspective, output shape)
- The brief computation becomes generic with registered formatters for family-specific logic
- The three `*-draft.ts` files shrink to LLM call + quality gate wrappers

---

## 10. Concrete Next Implementation Steps for Codex

### Immediate (can start now, no design risk)

1. **Define `TopicFamilyContract` interface** in a new file `packages/omniweb-toolkit/src/topic-family-contract.ts`
2. **Extract the 6 research dossiers** into `TopicFamilyContract` objects (funding-structure, etf-flows, spot-momentum, network-activity, stablecoin-supply, vix-credit)
3. **Create the oracle-divergence contract** from `docs/archive/agent-handoffs/oracle-divergence-claim-audit-2026-04-19.md`
4. **Wire the existing `dossierForFamily()` function** to load from contracts instead of hardcoded consts
5. **Move slip patterns** from `research-draft.ts` arrays into the contracts
6. **Add the oracle-divergence slip patterns** from the audit memo to the new contract

### Near-term (Phase 2-3, low risk)

7. **Add `metricSemantics` to the funding-structure contract** as a pilot (the audit has the content)
8. **Generalize `ResearchColonySubstrate`** to a `ColonySubstrate` that market-draft.ts can use
9. **Add a `buildBrief(contract, evidence)` generic function** alongside the existing family-specific builders (don't replace them yet)

### Medium-term (Phase 4-5, moderate risk)

10. **Build `composeQualityGate()`** and wire it into market-draft.ts
11. **Replace the 3 prompt packet builders** with one generic builder + archetype configs
12. **Add registered formatters** for family-specific brief logic (range location, spread direction, etc.)

---

## 11. Candidate Doctrine

These three conclusions are durable enough to encode as project-level principles:

### Candidate Doctrine 1: The prompt is a rendering layer, not the planning layer

All decisions about what data matters, what claims are allowed, and what the thesis space should be must happen *before* the prompt is assembled. The prompt's job is to present pre-computed decisions legibly. Code that makes analytical decisions during prompt assembly is in the wrong layer.

**Why this is durable:** This principle holds regardless of model capability, archetype count, or family count. A smarter model can reason better from a good plan; it doesn't need less planning.

### Candidate Doctrine 2: Claim bounds are data, not prose

The claim contract for each topic family (what's defensible, what's blocked, what requires extra evidence) must be a structured data object, not hardcoded strings in TypeScript functions. Adding a new family should mean writing a contract, not writing a new brief builder.

**Why this is durable:** The family audits proved that claim bounds come from domain expertise and literature, not from code. Encoding them as code couples domain knowledge to implementation — every time domain understanding improves, a developer has to edit TypeScript.

### Candidate Doctrine 3: Every metric needs a semantic contract

When a metric appears in a prompt, the model should know what it measures and what it does NOT measure. This semantic annotation should come from a typed dictionary in the topic-family contract, not from ad hoc prose in the brief builder. The annotation is what prevents a model from over-interpreting a number.

**Why this is durable:** This is the root cause finding from both family audits. The most dangerous overclaiming happens when a model sees a number without understanding its provenance or limitations. No amount of "do not claim X" instructions can substitute for "this number means Y and does NOT mean Z."

---

## 12. What I Would Change First If Forced to Implement Tomorrow

1. **Define `TopicFamilyContract` interface** (1 file, ~50 lines)
2. **Create `oracle-divergence` contract** from the audit memo (1 file, ~80 lines)
3. **Add oracle-divergence slip patterns** to market-draft.ts quality gate (the audit memo has 4 ready-to-use patterns)
4. **Wire colony substrate** into market-draft.ts so the market archetype knows what the colony already said

These four changes address the highest-risk gap (market archetype has no claim bounds) with the least architectural disruption. Everything else can follow incrementally.

---

## Methodology

This memo was produced through:
- Complete code read of all 3 archetype draft pipelines (research-draft.ts, market-draft.ts, engagement-draft.ts)
- Complete code read of the supporting modules (colony-prompt.ts, research-family-dossiers.ts, research-source-profile.ts, research-colony-substrate.ts, research-opportunities.ts, market-opportunities.ts, minimal-agent.ts)
- Complete code read of archetype starter assets (research-agent-starter.ts, market-analyst-starter.ts)
- First-principles decomposition (Deconstruct → Challenge → Reconstruct)
- Cross-reference with the two family audit memos (research families + oracle-divergence)
- Package docs review (AGENTS.md, SKILL.md, TOOLKIT.md)
