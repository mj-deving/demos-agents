# Oracle-Divergence Research Family Claim Audit — Literature-Backed

Date: 2026-04-19
Bead: omniweb-agents-wn4
Scope: analysis/doc only, no product code edits

This memo audits the planned `oracle-divergence` research family against (a) what the oracle packet actually contains, (b) what claims are defensible per the academic literature, (c) what claims are too strong, causal, or speculative, (d) what extra metrics would be needed for stronger claims, and (e) what doctrine wording should replace sloppy wording.

---

## Summary of Top Findings

1. **"Oracle" is a misnomer.** In blockchain contexts, "oracle" means verified external data feeds with multi-source aggregation and manipulation resistance (BIS Bulletin 76). The system's divergence data is aggregated agent sentiment — calling it an "oracle" implies objectivity and verification rigor that the data does not possess.

2. **Agent consensus is likely a single opinion counted N times.** LLM model pairs show 60% error agreement (vs 33% random baseline), and larger/more accurate models have the *most* correlated errors (arXiv 2506.07962). Without model heterogeneity, `agentCount` overstates the informational content of the consensus.

3. **"The market is wrong" is never defensible from this packet.** No published paper supports overriding price with sentiment as a standalone signal. The literature treats sentiment as a contrarian indicator *at extremes*, meaning "the crowd is wrong" at extremes — the opposite of "our agents are right" (Sockin & Xiong, NBER WP 26816).

4. **Divergence severity has no standard definition.** The system's severity levels (low/medium/high) are opaque — no documented methodology for how they are computed upstream. Grading divergence by magnitude has empirical support (Fear & Greed Index extremes), but the current implementation exposes no magnitude or threshold data.

5. **The market-draft prompt packet uses "edge" language that overstates what the data supports.** "Surface the live edge", "the market edge", "actionable read" imply tradeable alpha. The literature shows sentiment-price divergence has weak and contested predictive power.

6. **No family-specific quality gates exist yet.** The research families (funding-structure, stablecoin-supply, etc.) each have `falseInferenceGuards`, `BASELINE_SLIP_PATTERNS`, and dossier layers. The market draft pipeline uses only the generic `checkPublishQuality` gate — no divergence-specific slip patterns, no dossier, no guards against overclaiming.

---

## Area 1: What the Oracle Divergence Packet Actually Contains

### OracleDivergence object (`types.ts:421-432`)

| Field | Type | Provenance | Notes |
|-------|------|-----------|-------|
| `type` | string | Server-computed | e.g. "agents_vs_market" — only known type |
| `asset` | string | Server-computed | Ticker symbol |
| `description` | string | Server-generated | Free-text, no structured format |
| `severity` | "low" \| "medium" \| "high" | Server-computed | Opaque — no documented methodology |
| `details.agentDirection` | string? | From consensus | "bearish", "bullish", etc. |
| `details.marketDirection` | string? | From price data | "higher", "lower", etc. |
| `details.agentConfidence` | number? | From consensus | Poorly calibrated — see findings below |
| `details.marketSignal` | string? | Unknown | Rarely populated |

### Broader OracleResult context (`types.ts:446-461`)

The full oracle response also includes:
- **Per-asset sentiment**: direction, score, agentCount, confidence, topPosts
- **Sentiment timeline**: Array of `{ t, score, postCount }` over time
- **Predictions**: pending count, resolved count, accuracy (nullable)
- **Polymarket entries**: question, outcomeYes/No probabilities, volume, liquidity
- **Overall sentiment**: direction, score, agentCount, topAssets

The divergence pipeline currently consumes only the `divergences[]` array and ignores the sentiment timeline, prediction accuracy, and Polymarket data.

### MarketOpportunity derived fields (`market-opportunities.ts:56-68`)

- `kind`: "oracle_divergence" | "signal_price_mismatch" | "stale_divergence"
- `score`: severity-based (high=85, medium=74, low=60) + signal bonus + attestation adjustments
- `recommendedDirection`: inferred via cascading fallback (agentDirection → marketDirection → signal → price change)
- `matchingFeedPosts`, `lastSeenAt`: feed coverage context

---

## Area 2: What Claims Are Defensible

### Defensible primitives (literature-supported)

1. **A measurable sentiment-price dislocation exists.** Sentiment-price divergence is a documented phenomenon in crypto markets. Multiple studies confirm that social/aggregated sentiment frequently diverges from concurrent price action (Pano & Kashef 2020, *Journal of Computational Science*; Sockin & Xiong, NBER WP 26816).

2. **The divergence is a descriptive observation, not a forecast.** It is defensible to say "agents lean bearish while price is moving higher" as a factual description of two data points that disagree.

3. **Extreme divergences may carry contrarian signal.** The Fear & Greed Index literature shows contrarian strategies at extremes (below 25 or above 55) outperformed buy-and-hold by ~30% annually. This supports treating high-severity divergences with more attention — but as a contrarian indicator, not a directional one.

4. **The divergence may resolve in either direction.** The literature is explicit: sentiment-price divergences do not reliably resolve in favor of either side (Gottschlich & Funk 2025, *Electronic Markets*). Framing the divergence as "an open question" rather than "the agents are right" is defensible.

5. **Polymarket data, if used, adds a different signal class.** Prediction markets are reasonably well-calibrated (Brier score ~0.187 per Reichenbach & Walther 2025), but only in liquid markets (>$100K volume = 84% accuracy; <$10K = 61%). Noting that prediction market odds agree or disagree with agent sentiment is defensible.

### Defensible framing language

- "Agent consensus and observed price are pulling in different directions"
- "A measurable sentiment-price dislocation exists for [asset]"
- "The divergence is descriptive — it flags disagreement, not who is right"
- "Extreme dislocations historically carry contrarian signal but resolve unpredictably"

---

## Area 3: What Claims Are Too Strong / Causal / Speculative

### Claims the system currently makes or enables that are not supported

| Claim / Framing | Where in Code | Problem per Literature |
|----------------|---------------|----------------------|
| "exceeds the market playbook publish threshold" | `market-opportunities.ts:121` rationale string | Implies a validated threshold exists. Severity scoring is opaque. |
| "surface the live edge before it gets crowded" | `market-draft.ts:135` edge array | "Edge" implies tradeable alpha. Sentiment-price divergence has weak, contested predictive power. |
| "one actionable read" | `market-draft.ts:136` edge array | "Actionable" implies the divergence resolves predictably. It does not. |
| "the market edge and why it matters now" | `market-draft.ts:184` output shape | Same "edge" problem — the packet describes disagreement, not an edge. |
| `recommendedDirection: "higher" \| "lower"` | `market-opportunities.ts:67, 257-279` | A recommendation implies the system knows which side is right. The cascading fallback (agentDirection → marketDirection → signal → price) may produce contradictory results. |
| "conviction should match the observed numbers and divergence severity" | `market-draft.ts:182` confidenceStyle | Treating opaque severity as a calibrated confidence anchor is circular. |
| High severity → score 85 | `market-opportunities.ts:281-289` severityScore | Treats severity as a validated signal strength. No documentation of how severity is computed. |
| "agents lean bearish while spot and funding remain elevated" (test fixture) | `market-opportunities.test.ts:20-25` | Defensible as description, but the test's `description` field reads like a thesis, not an observation. |
| `agentConfidence` as signal bonus | `market-opportunities.ts:303-306` signalBonus | LLM-stated confidence is systematically overconfident. RLHF models saying "80% confident" are correct ~50% of the time (arXiv 2410.06707). |

### The "market is wrong" problem

The prompt packet's `edge` framing and `recommendedDirection` field together create a structure where the LLM is incentivized to write "the market is wrong because the agents say..." This is never defensible from this packet:

- No published paper supports overriding price with sentiment as a standalone signal (Sockin & Xiong, NBER WP 26816)
- The correct interpretation is "a dislocation exists that historically resolves unpredictably but may carry contrarian signal at extremes"
- The `recommendedDirection` field should either be removed or renamed to something like `agentLean` or `sentimentLean` to avoid implying a recommendation

### The model homogeneity problem

The `agentCount` field in overall sentiment creates an illusion of diverse consensus. The literature is clear:

- LLM model pairs show 60% error agreement vs 33% random baseline (arXiv 2506.07962)
- **2 heterogeneous agents outperform 16 homogeneous agents** (arXiv 2602.03794)
- Without documented model diversity (different architectures, providers, training data), `agentCount` is meaningless as a signal quality metric
- The system should not present "N agents agree" as stronger evidence than "1 agent says" unless model independence is verified

---

## Area 4: What Extra Metrics Would Be Needed

### To make the divergence actionable (not just descriptive)

| Missing Metric | Why Needed | Source |
|---------------|-----------|--------|
| Divergence resolution history | Track how past divergences resolved — did agents or price "win"? | Required for any predictive claim |
| Agent model diversity score | Measure effective independent channels (K* metric) | arXiv 2602.03794 |
| Per-model calibration data | Recalibrate `agentConfidence` against actual outcomes | arXiv 2410.06707 |
| Severity computation methodology | Document how low/medium/high is computed | Currently opaque |
| Sentiment timeline integration | Use `sentimentTimeline` to show if divergence is growing, shrinking, or stable | Available in OracleResult but unused |
| Prediction accuracy track record | Use `predictions.accuracy` to weight agent credibility | Available in OracleResult but unused |
| Polymarket odds context | Cross-reference with `polymarketOdds` for an independent signal class | Available in OracleResult but unused |
| Agent data independence audit | Verify agents don't consume each other's outputs | Fed 2025 financial stability concern |

### To make Polymarket data usable

| Missing Metric | Why Needed | Source |
|---------------|-----------|--------|
| Market volume threshold | Only markets >$100K are reliable (84% vs 61% accuracy) | Reichenbach & Walther 2025 |
| Liquidity depth | Thin markets are manipulation-vulnerable; effects persist 60+ days | Rasooly & Rozzi 2025 |
| Time-to-resolution | Binary markets near resolution are better calibrated | Wolfers & Zitzewitz, NBER WP 12200 |

---

## Area 5: Safe Doctrine Wording (Implementable by Codex)

### Recommended dossier for oracle-divergence family

```typescript
const ORACLE_DIVERGENCE_DOSSIER: ResearchFamilyDossier = {
  family: "oracle-divergence",
  baseline: [
    "A sentiment-price divergence is descriptive, not predictive — it flags disagreement, not who is right.",
    "Agent consensus from similar models may reflect one opinion repeated, not independent views.",
    "Divergence severity is an internal grading, not a calibrated probability or a validated signal.",
  ],
  focus: [
    "Focus on what the two sides of the divergence actually say — agents lean X while price does Y.",
    "Explain whether the divergence is growing, stable, or narrowing if timeline data supports it.",
    "Frame the thesis as an open question rather than a directional call.",
  ],
  falseInferenceGuards: [
    "Do not claim that agents being bearish while price is up means the market is wrong.",
    "Do not claim that agents being bullish while price is down means the market is underpricing the opportunity.",
    "Do not treat divergence severity as a confidence level or a probability.",
    "Do not treat agent count as evidence of independent agreement unless model diversity is documented.",
    "Do not use the word 'edge' to describe the divergence — it implies tradeable alpha that the data does not support.",
  ],
};
```

### Recommended prompt packet language replacements

| Current Wording | Location | Replacement |
|----------------|----------|-------------|
| "surface the live edge before it gets crowded" | `market-draft.ts:135` | "Surface the measurable dislocation and frame it as an open question" |
| "Translate divergences into one actionable read" | `market-draft.ts:136` | "Translate divergences into one concrete observation with a stated invalidation condition" |
| "the market edge and why it matters now" | `market-draft.ts:184` | "the observed dislocation and why it is worth watching now" |
| "conviction should match the observed numbers and divergence severity" | `market-draft.ts:182` | "measured and agnostic; frame the dislocation without taking a side" |
| "Reads like a trader's edge summary" | `market-draft.ts:188` | "Reads like a market observation, not a direction call" |

### Recommended `inferDirection` change

The current `inferDirection` function (`market-opportunities.ts:257-279`) cascades through agentDirection → marketDirection → signal → price to produce a `recommendedDirection`. This should be renamed to `sentimentLean` or `agentLean` — the word "recommended" implies the system endorses the direction. Alternatively, separate `agentLean` and `marketLean` fields would make the disagreement explicit rather than flattening it into one recommendation.

### Recommended slip patterns for Codex to implement

```typescript
const ORACLE_DIVERGENCE_SLIP_PATTERNS: Array<{ pattern: RegExp; detail: string }> = [
  {
    pattern: /\b(?:agents?|oracle|consensus)\b.{0,60}\b(?:right|correct|accurate)\b.{0,40}\b(?:market|price)\b.{0,40}\b(?:wrong|mispriced|incorrect)\b/i,
    detail: "claims agents are right and the market is wrong — not defensible from sentiment data alone",
  },
  {
    pattern: /\bedge\b.{0,40}\b(?:divergence|mismatch|dislocation)\b|\b(?:divergence|mismatch|dislocation)\b.{0,40}\bedge\b/i,
    detail: "describes the divergence as a tradeable edge — sentiment-price divergence has weak predictive power",
  },
  {
    pattern: /\b(?:high|elevated)\s+severity\b.{0,60}\b(?:means|proves|confirms|guarantees)\b/i,
    detail: "treats divergence severity as proof of a specific outcome — severity grading is opaque and uncalibrated",
  },
  {
    pattern: /\b(?:\d+|multiple|several)\s+agents?\s+agree\b.{0,60}\b(?:means|proves|confirms|strong signal)\b/i,
    detail: "treats agent count as evidence of independent agreement — LLM models have 60% correlated errors",
  },
];
```

---

## The "Oracle" Naming Question

The family name "oracle-divergence" inherits the API endpoint naming. In blockchain contexts, "oracle" means verified external data feeds with multi-source aggregation and cryptographic attestation (BIS Bulletin 76, Duley et al. 2023). The system's divergence data is aggregated LLM agent sentiment — it has none of these properties.

**Recommendation:** The dossier and all doctrine language should explicitly note that "oracle" is the API endpoint name, not a claim about the data's reliability. The research family should be internally understood as "sentiment-divergence" even if the API name stays.

---

## Sources

### Sentiment-Price Divergence
- Pano & Kashef 2020: Twitter sentiment Granger-causes returns — https://www.sciencedirect.com/science/article/abs/pii/S104244312030072X
- Sockin & Xiong: cryptocurrencies and sentiment (NBER WP 26816) — https://www.nber.org/system/files/working_papers/w26816/w26816.pdf
- NBER WP 31317: retail dominance in crypto — https://www.nber.org/system/files/working_papers/w31317/w31317.pdf
- Gottschlich & Funk 2025: crowd signals (Electronic Markets) — https://link.springer.com/article/10.1007/s12525-025-00815-6
- Vidal-Tomas et al.: herding in crypto — https://arxiv.org/pdf/1806.11348
- Chang et al. 2020: extreme sentiment predictive power (Journal of Behavioral Finance)

### Agent Consensus and LLM Calibration
- Correlated errors in LLMs (arXiv 2506.07962) — https://arxiv.org/html/2506.07962
- Agent scaling via diversity (arXiv 2602.03794) — https://arxiv.org/html/2602.03794v1
- LLM confidence calibration (arXiv 2410.06707) — https://arxiv.org/html/2410.06707v1
- QA-Calibration (ICLR 2025) — https://assets.amazon.science/6d/70/c50b2eb141d3bcf1565e62b60211/qa-calibration-of-language-model-confidence-scores.pdf
- Multi-agent deliberation calibration (arXiv 2404.09127) — https://arxiv.org/html/2404.09127v3
- Ante 2025: AI agents in DeFi (Technological Forecasting) — https://www.sciencedirect.com/science/article/pii/S0040162526001460
- Fed 2025: financial stability implications of generative AI — https://www.federalreserve.gov/econres/feds/files/2025090pap.pdf

### Prediction Markets
- Wolfers & Zitzewitz: prediction market accuracy (NBER WP 12200) — https://www.nber.org/papers/w12200
- Reichenbach & Walther 2025: Polymarket calibration (SSRN 5910522) — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5910522
- Atanasov et al. 2017: markets vs. expert consensus (Management Science) — https://pubsonline.informs.org/doi/10.1287/mnsc.2015.2374
- Rasooly & Rozzi 2025: prediction market manipulation (arXiv) — https://arxiv.org/html/2503.03312v1
- BIS Bulletin 76: blockchain oracles (2023) — https://www.bis.org/publ/bisbull76.htm

### Regulatory
- IOSCO: AI in capital markets — https://www.iosco.org/library/pubdocs/pdf/IOSCOPD788.pdf

---

## Code References

| File | Lines | What |
|------|-------|------|
| `src/toolkit/supercolony/types.ts` | 421-432 | `OracleDivergence` type definition |
| `src/toolkit/supercolony/types.ts` | 446-461 | `OracleResult` full response shape |
| `src/toolkit/supercolony/api-schemas.ts` | 29-55 | `OracleResultSchema` Zod validation |
| `packages/omniweb-toolkit/src/market-opportunities.ts` | 30-41 | `MarketOracleDivergenceInput` |
| `packages/omniweb-toolkit/src/market-opportunities.ts` | 56-68 | `MarketOpportunity` (includes `recommendedDirection`) |
| `packages/omniweb-toolkit/src/market-opportunities.ts` | 112-130 | `oracle_divergence` opportunity creation |
| `packages/omniweb-toolkit/src/market-opportunities.ts` | 257-279 | `inferDirection` cascading fallback |
| `packages/omniweb-toolkit/src/market-opportunities.ts` | 281-289 | `severityScore` (high=85, medium=74, low=60) |
| `packages/omniweb-toolkit/src/market-opportunities.ts` | 303-306 | `signalBonus` from confidence |
| `packages/omniweb-toolkit/src/market-draft.ts` | 128-193 | `buildMarketPromptPacket` — prompt with "edge" language |
| `packages/omniweb-toolkit/src/market-draft.ts` | 97 | Quality gate — generic only, no family-specific guards |
| `packages/omniweb-toolkit/src/market-draft.ts` | 217-224 | `clampConfidence` — uses severity as confidence anchor |
| `packages/omniweb-toolkit/references/response-shapes.md` | 265 | "Most actionable field — usually empty" comment |
| `packages/omniweb-toolkit/references/response-shapes.md` | 287-298 | `OracleDivergence` reference shape |
| `tests/packages/market-opportunities.test.ts` | 1-123 | Market opportunities test suite |
| `tests/packages/market-draft.test.ts` | 1-145 | Market draft test suite |

---

## Methodology

Three parallel literature research agents searched for:
- Published academic papers (NBER, BIS, SSRN, arXiv, ICLR)
- Serious market research (Electronic Markets, Journal of Computational Science, Management Science)
- Regulatory publications (Fed, IOSCO, BIS)
- AI/ML calibration research (arXiv, Amazon Science)

Evidence quality and contestation are noted per finding. Market folklore was excluded unless backed by a peer-reviewed or institutional source.
