# Research Quality-Gate Pattern Audit

Date: 2026-04-19
Scope: review/research — pattern reliability, false-positive/false-negative analysis
Method: systematic regex testing against crafted positive, negative, and edge-case strings

---

## 1. Findings First

### The core problem: regex cannot understand negation

Every confirmed false positive shares one root cause: **the patterns match trigger words regardless of whether they appear in an assertion or a disclaimer.** When a good draft says "positive net flow does not confirm broad institutional demand," the pattern sees `positive net flow` + `confirms` + `broad institutional demand` and rejects. It cannot distinguish "X proves Y" from "X does not prove Y."

This is structural, not fixable by regex tuning. The current approach of `.{0,80}` distance-bounded keyword matching is fundamentally unable to handle negation. Any pattern that tries to catch "A means B" will also catch "A does not mean B."

### Summary of verified issues

| Issue | Family | Type | Severity |
|-------|--------|------|----------|
| Negated breadth caveat falsely rejected | etf-flows | False positive | High |
| Negated risk-on caveat falsely rejected | stablecoin-supply | False positive | High |
| ANY mention of peg near $1 rejected, even as background | stablecoin-supply | False positive | High |
| "Funding alone/by itself" rejected even when disclaiming | funding-structure | False positive | High |
| "Not a credit spread" rejected same as "credit spread" | vix-credit | False positive | High |
| "Price cannot validate" rejected same as "price validates" | network-activity | False positive | Medium |
| Many valid divergence phrasings not recognized | spot-momentum | False negative | High |
| Many overclaiming constructions not caught | spot-momentum | False negative | High |

---

## 2. Confirmed True Positives from Current Patterns

The patterns correctly catch these bad drafts (verified by testing):

| Pattern | Bad draft caught | Family |
|---------|-----------------|--------|
| ETF `etf-1` | "Positive net flow proves broad institutional demand is coming back to crypto." | etf-flows |
| ETF `etf-2` | "The total holdings show fresh demand is building across the ETF complex." | etf-flows |
| Funding `fund-1` | "Negative funding by itself proves downside here." | funding-structure |
| Funding `fund-2` | "Negative funding proves a squeeze is coming because shorts are too crowded." | funding-structure |
| Funding `fund-2` | "Negative funding means a reversal is inevitable here." | funding-structure |
| Stablecoin `sc-5` | "Supply growth shows bullish fuel building in the stablecoin complex." | stablecoin-supply |
| Stablecoin `sc-5` | "Stablecoin issuance means risk-on is coming back." | stablecoin-supply |
| Network `net-4` | "Price is absorbing the network load cleanly, confirming healthy throughput." | network-activity |
| Network `net-4` | "The market validates congestion is real because price has not dropped." | network-activity |
| VIX `vix-1` | "High VIX proves a crash is coming." | vix-credit |

**The patterns work well when the overclaim is stated directly and affirmatively.** The problem is only with negated/caveated usage and with under-coverage of alternative phrasings.

---

## 3. False-Positive Risk by Family

### stablecoin-supply — Highest Risk

**Pattern `sc-1` (peg-thesis)** at `research-draft.ts:152`:
```
/\b(?:still|sits|holding|staying|exactly|right at|near|around)\s+\$?1(?:\.0+)?\b/i
```

This is the broadest and most problematic pattern. It matches ANY mention of the peg being near $1, even when used as background context or in a disclaimer.

Falsely rejected (verified):
- "The peg still near 1.00 is background context while the real signal is supply acceleration."
- "With the peg holding around 1.00, supply dynamics become the primary focus."
- "The peg near 1.00 does not by itself prove anything about reserve health."

These are *exactly* the kind of well-framed drafts the dossier asks for: treating the peg as background context, not as the thesis. The gate punishes the behavior the prompt requests.

**Pattern `sc-3` (peg-proves)** at `research-draft.ts:160`:
Similarly rejects caveated mentions where the peg is mentioned alongside "means" or "proves" — even when negated.

### funding-structure — Medium-High Risk

**Pattern `fund-3` (alone)** at `research-draft.ts:179`:
```
/\bfunding\b.{0,60}\b(?:by itself|alone)\b/i
```

This rejects ANY sentence containing "funding" within 60 chars of "alone" or "by itself" — including:
- "Funding alone is not the thesis, but when combined with rising OI it raises squeeze risk." (FALSELY REJECTED)
- "Treating funding by itself as directional would be wrong." (FALSELY REJECTED)

These are correctly caveated analyses that explicitly disclaim the isolated interpretation. The pattern penalizes the draft for doing what the dossier requires.

### etf-flows — Medium Risk

**Pattern `etf-1` (broad-demand)** at `research-draft.ts:201`:
```
/\bpositive net flow\b.{0,80}\b(?:proves|means|shows|confirms)\b.{0,60}\b(?:broad|strong|durable)\s+institutional demand\b/i
```

Falsely rejected (verified):
- "While positive net flow shows some demand, it does not confirm broad institutional demand." (FALSELY REJECTED)
- "Even though positive net flow means something, it does not mean durable institutional demand on its own." (FALSELY REJECTED)

Correctly passed:
- "Positive net flow does not prove broad institutional demand without issuer breadth." (CORRECTLY PASSED — the "does not prove" breaks the trigger chain because "does not" is between the matched words)

This inconsistency is particularly dangerous: whether a negated sentence passes depends on *word order*, not on *meaning*.

### vix-credit — Medium Risk

**Pattern `vix-2` (credit-spread)** at `research-draft.ts:244`:
```
/\bcredit spread\b/i
```

This is the bluntest pattern in the system. It rejects ANY mention of "credit spread" — including:
- "The bill-note spread is a term spread, not a credit spread." (FALSELY REJECTED)
- "This is not a credit spread in the corporate sense." (FALSELY REJECTED)

This means the LLM cannot even explain what the spread IS NOT. The gate blocks the very disclaimer the dossier requires.

### network-activity — Medium Risk

**Pattern `net-4` (price-validates-load)** at `research-draft.ts:228`:
Rejects "Whether price absorbs the load is not observable from block data alone" — a correct methodological caveat that happens to contain the trigger words "price absorbs ... load."

---

## 4. False-Negative Risk by Family

### spot-momentum — Highest Risk

The current spot patterns at `research-draft.ts:184-201` only catch overclaiming that uses specific connector phrases: "therefore", "so", "which means", "that means."

**Missed (verified):**
- "BTC has rallied hard this week and the move speaks for itself — clearly bullish." (NOT CAUGHT)
- "Price is up so the bear thesis is dead." (NOT CAUGHT — "so" is present but no "bullish/constructive/uptrend" follows)
- "The weekly candle is green, which means the bulls are in control." (NOT CAUGHT — "bulls are in control" not in the target set)
- "Bitcoin gained 5% this week, confirming the uptrend is intact." (NOT CAUGHT — "confirming" is not in the connector set)

The pattern is too narrow: it requires `[price term] + [direction word] + [specific connector] + [specific conclusion]`. Real LLM overclaiming uses a much wider variety of connectors and conclusions.

### divergence/sentiment topics — High Risk

The `DIVERGENCE_CONTEXT_PATTERNS` at `research-draft.ts:115-122` recognize only 6 cues: "divergence", "mismatch", "disconnect", "despite", "even as", "while."

**Missed (verified):**
- "The bearish colony sentiment is being contradicted by spot price action." (NOT RECOGNIZED — "contradicted" not in set)
- "Colony positioning diverges from the observed tape." (NOT RECOGNIZED — "diverges" not in set, only "divergence")
- "Agents lean bearish but the tape says otherwise." (NOT RECOGNIZED — "but" not in set)
- "Colony conviction is bearish, yet price is resolving higher." (NOT RECOGNIZED — "yet" not in set)
- "The signal says down but the market says up." (NOT RECOGNIZED — "but" not in set)

This means valid divergence drafts using natural language are rejected by `checkContextualGrounding` for failing to "clearly name the signal-vs-market mismatch" — even when they name it clearly using different words.

### network-activity — Medium Risk

The network slip patterns focus on "more transactions proves adoption" and "hashrate proves healthy" but do not catch subtler overclaiming like:
- "The throughput surge validates that network usage is genuine." (throughput alone cannot distinguish usage from spam)
- "Active network metrics confirm the demand thesis." (confirmation language without the specific trigger words)

---

## 5. Recommended Pattern Design Rules

### Rule 1: Regex patterns should only match affirmative overclaims

A pattern should fire when the text **asserts** the overclaim. It should NOT fire when the text **denies** the overclaim. Since regex cannot reliably detect negation, the practical rule is:

**Design patterns to match the specific assertive construction, not just the keyword proximity.**

Bad (current):
```
/\bfunding\b.{0,60}\b(?:by itself|alone)\b/i
```
This catches "funding alone" regardless of context.

Better:
```
/\bfunding\b.{0,60}\b(?:by itself|alone)\b.{0,60}\b(?:is|tells|shows|proves|means|confirms|justifies)\b/i
```
This requires the "alone" to be followed by an affirmative verb. "Funding alone is not the thesis" still risks a match on "is," so...

Best:
```
/\bfunding\s+(?:by itself|alone)\s+(?:is enough|tells us|shows|proves|means|confirms|justifies)\b/i
```
Tight proximity with affirmative verbs, no negation-agnostic distance wildcards.

### Rule 2: Distance-bounded wildcards (`.{0,80}`) are the primary brittleness source

The `.{0,80}` pattern matches anything between two keyword anchors regardless of intervening negation, qualifiers, or sentence boundaries. Rules:

- **Max 40 chars** for distance-bounded wildcards, not 80
- **Always require an affirmative verb** between the trigger and the conclusion
- **Exclude common negation prefixes** where possible: add negative lookahead `(?!.*\bnot\b)` only when the pattern structure supports it cleanly
- **Prefer tight multi-word phrases** over loose keyword proximity

### Rule 3: Blunt keyword bans need an exception path

The VIX `credit spread` pattern and stablecoin `near $1` pattern are too blunt. They ban keywords that a good draft legitimately needs.

**Design rule:** If a pattern bans a term that a well-written caveat would also use, add a structural exception. Options:
- **Negation prefix exception:** Don't match if the phrase is preceded by "not a", "is not", "does not", "rather than"
- **Context clause:** Only match if followed by an affirmative interpretation word

For `credit spread`:
```
/\bcredit spread\b(?!.*\bnot a credit spread\b)/i  // negative lookahead
```
Or better — only match when "credit spread" is used affirmatively:
```
/\bthe\s+credit spread\s+(?:is|shows|confirms|indicates|widening|tightening)\b/i
```

### Rule 4: Divergence recognition should be additive, not exclusive

The `DIVERGENCE_CONTEXT_PATTERNS` should include all natural-language divergence vocabulary, not a minimal set:

Add: "contradicted", "contradicts", "refuted", "refutes", "yet", "but", "however", "opposed", "opposite", "conflicting", "at odds", "disagrees", "contrary", "inconsistent"

### Rule 5: When regex cannot distinguish good from bad, use structural checks instead

For the stablecoin `sc-1` pattern (any mention of peg near $1), regex is the wrong tool. The problem isn't that the draft mentions the peg — it's that the draft makes the peg **the thesis** instead of background. This requires structural analysis, not keyword matching:

- Does the draft have a thesis that is NOT about the peg?
- Does the draft mention supply dynamics, liquidity conditions, or another primary signal?
- Is the peg mention in a subordinate clause rather than the topic sentence?

These are better checked by the prompt constraints + a semantic check (does the brief's `anomalySummary` topic appear in the draft?) than by banning peg mentions entirely.

---

## 6. Exact Implementation Suggestions for Codex

### Priority 1: Fix the negation false positives (all families)

For each pattern that currently uses `.{0,80}` distance-bounded matching:

**Funding `fund-3` (alone)** — `research-draft.ts:179`:
```typescript
// BEFORE (falsely rejects negated caveats):
{ pattern: /\bfunding\b.{0,60}\b(?:by itself|alone)\b/i }

// AFTER (requires affirmative assertion after "alone"):
{ pattern: /\bfunding\s+(?:alone|by itself)\s+(?:is enough|tells us|proves|means|shows|confirms|explains|justifies|says|predicts)\b/i }
```
SHOULD PASS: "Funding alone is not the thesis" / "Treating funding by itself as directional would be wrong"
SHOULD FAIL: "Funding alone tells us the market is bearish" / "Funding by itself shows the downside setup"

**VIX `vix-2` (credit-spread)** — `research-draft.ts:244`:
```typescript
// BEFORE (rejects any mention including disclaimers):
{ pattern: /\bcredit spread\b/i }

// AFTER (only match affirmative use, not disclaimers):
{ pattern: /(?<!\bnot a\s)(?<!\brather than a\s)\bcredit spread\b(?!\s+(?:is not|in the corporate sense))/i }
```
Or the simpler approach — match only when "credit spread" is the subject:
```typescript
{ pattern: /\b(?:the|this|a)\s+credit spread\s+(?:is|shows|confirms|indicates|suggests|points to)\b/i }
```
SHOULD PASS: "not a credit spread" / "is a term spread, not a credit spread"
SHOULD FAIL: "the credit spread is widening" / "a credit spread suggests stress"

**ETF `etf-1` (broad-demand)** — `research-draft.ts:201`:
```typescript
// BEFORE:
{ pattern: /\bpositive net flow\b.{0,80}\b(?:proves|means|shows|confirms)\b.{0,60}\b(?:broad|strong|durable)\s+institutional demand\b/i }

// AFTER (add negative lookahead for common negation):
{ pattern: /\bpositive net flow\b(?!.{0,20}\b(?:does not|do not|doesn't|cannot|is not)\b).{0,60}\b(?:proves|means|shows|confirms)\b.{0,40}\b(?:broad|strong|durable)\s+institutional demand\b/i }
```
SHOULD PASS: "Positive net flow does not confirm broad institutional demand"
SHOULD FAIL: "Positive net flow proves broad institutional demand"

### Priority 2: Fix the stablecoin peg-as-background false positive

**Stablecoin `sc-1` (peg-thesis)** — `research-draft.ts:152`:
```typescript
// BEFORE (bans any mention of peg near $1):
{ pattern: /\b(?:still|sits|holding|staying|exactly|right at|near|around)\s+\$?1(?:\.0+)?\b/i }

// RECOMMENDED: Remove this pattern entirely.
// Replace with the narrower sc-3 and sc-4 patterns which already catch
// the specific overclaim (peg proves health/bullishness).
// The dossier explicitly asks drafts to mention peg as background context.
```

If a broad peg-mention pattern is still desired, restrict it to topic-sentence position:
```typescript
// Only match when peg-near-$1 is in the FIRST sentence (thesis position):
{ pattern: /^[^.]*\b(?:still|sits|holding|staying)\s+(?:at\s+)?\$?1(?:\.0+)?[^.]*\./i }
```

### Priority 3: Expand divergence recognition

**`DIVERGENCE_CONTEXT_PATTERNS`** — `research-draft.ts:115-122`:
```typescript
// BEFORE:
const DIVERGENCE_CONTEXT_PATTERNS = [
  /\bdivergence\b/i,
  /\bmismatch\b/i,
  /\bdisconnect\b/i,
  /\bdespite\b/i,
  /\beven as\b/i,
  /\bwhile\b/i,
];

// AFTER:
const DIVERGENCE_CONTEXT_PATTERNS = [
  /\bdiverg(?:ence|es|ing)\b/i,
  /\bmismatch\b/i,
  /\bdisconnect\b/i,
  /\bdespite\b/i,
  /\beven as\b/i,
  /\bwhile\b/i,
  /\bcontradicted?\b/i,
  /\byet\b/i,
  /\bhowever\b/i,
  /\bat odds\b/i,
  /\bconflicting\b/i,
  /\binconsistent\b/i,
  /\brefut(?:es|ed|ing)\b/i,
];
```

### Priority 4: Widen spot-momentum overclaim coverage

**`SPOT_BASELINE_SLIP_PATTERNS`** — `research-draft.ts:184-201`:

Add patterns for common overclaiming constructions that don't use "therefore/so/which means":
```typescript
// Additional spot slip patterns:
{
  pattern: /\b(?:price|bitcoin|btc)\b.{0,50}\b(?:up|gained|rallied|climbed)\b.{0,40}\b(?:clearly|obviously|undeniably)\s+(?:bullish|constructive)\b/i,
  detail: "uses a price move with certainty language as the thesis without range or signal context",
},
{
  pattern: /\b(?:price|bitcoin|btc)\b.{0,50}\b(?:up|gained|rallied|climbed)\b.{0,40}\bconfirming\s+(?:the\s+)?(?:uptrend|bullish|bull case)\b/i,
  detail: "treats a price move as 'confirming' a directional thesis without explaining what specifically was confirmed",
},
```

### Priority 5: Add negation-handling utility (future)

For the medium-term, create a shared utility:
```typescript
function isNegatedInContext(text: string, matchIndex: number, matchLength: number): boolean {
  const prefix = text.slice(Math.max(0, matchIndex - 30), matchIndex).toLowerCase();
  return /\b(?:not|no|doesn't|does not|do not|don't|cannot|can't|isn't|is not|never|neither|without)\s*$/.test(prefix);
}
```

This lets patterns first match, then check if the match is preceded by negation within 30 characters. Apply to any pattern that currently has false-positive risk.

---

## 7. Candidate Doctrine

### Candidate Doctrine 1: Patterns should only match affirmative overclaims

Quality-gate regex patterns must be designed to match the **assertive form** of an overclaim, not just keyword proximity. A pattern that catches "X proves Y" but also catches "X does not prove Y" is unreliable and should be rewritten or replaced. When regex cannot distinguish assertion from disclaimer, use a structural check instead.

### Candidate Doctrine 2: Remove blunt keyword bans; require affirmative verb anchors

Never ban a term that a well-written caveat would need. The VIX "credit spread" ban and stablecoin "near $1" ban block the very language the dossier asks for. Every slip pattern should require an **affirmative verb anchor** (proves, means, shows, confirms, guarantees) adjacent to the overclaim, not just the presence of the dangerous term.

### Candidate Doctrine 3: Expand recognition patterns to natural-language breadth

The divergence and spot gates are too narrow. A gate that only recognizes 6 divergence keywords or 4 connector phrases will fail on natural language from diverse models. Recognition patterns (what SHOULD be present) need to be generous. Rejection patterns (what should NOT be present) need to be tight. The current system has this backwards.

---

## Appendix: Test Strings for Regression Testing

### ETF — should PASS (negated caveats)
- "Positive net flow does not prove broad institutional demand without issuer breadth."
- "While positive net flow shows some demand, it does not confirm broad institutional demand."

### ETF — should FAIL (overclaims)
- "Positive net flow proves broad institutional demand is coming back to crypto."
- "The total holdings show fresh demand is building across the ETF complex."

### Stablecoin — should PASS (background context)
- "The peg still near 1.00 is background context while the real signal is supply acceleration."
- "With the peg holding around 1.00, supply dynamics become the primary focus."
- "The peg near 1.00 does not by itself prove anything about reserve health."

### Stablecoin — should FAIL (peg as thesis)
- "USDT sitting exactly at $1 proves the system is healthy enough to absorb new issuance."
- "The peg staying at 1 means the latest supply growth is a clean bullish signal."

### Funding — should PASS (caveated)
- "Funding alone is not the thesis, but when combined with rising OI it raises squeeze risk."
- "Treating funding by itself as directional would be wrong."
- "The negative funding read does not guarantee a squeeze, but with OI rising the setup is fragile."

### Funding — should FAIL (overclaims)
- "Negative funding by itself proves downside here."
- "Negative funding means a reversal is inevitable."
- "Funding alone tells us the market is bearish."

### VIX — should PASS (correct disclaimers)
- "The bill-note spread is a term spread, not a credit spread."
- "This is not a credit spread in the corporate sense."

### VIX — should FAIL (mischaracterization)
- "The credit spread is widening and suggests stress."
- "The current credit spread reading supports the recession thesis."

### Network — should PASS (correct caveats)
- "Price cannot validate network congestion because they measure different things."

### Network — should FAIL (overclaims)
- "Price is absorbing the network load cleanly, confirming healthy throughput."
- "The market validates congestion is real because price has not dropped."

### Divergence recognition — should be recognized
- "The bearish colony sentiment is being contradicted by spot price action."
- "Colony positioning diverges from the observed tape."
- "Agents lean bearish but the tape says otherwise."
- "Colony conviction is bearish, yet price is resolving higher."

### Spot — should FAIL (overclaims not currently caught)
- "BTC has rallied hard this week and the move speaks for itself — clearly bullish."
- "Bitcoin gained 5% this week, confirming the uptrend is intact."
- "The weekly candle is green, which means the bulls are in control."
