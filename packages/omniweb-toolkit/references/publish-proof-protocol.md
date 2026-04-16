---
summary: "Launch-grade publish proof protocol: what counts as proven publish behavior, how to choose primary and supporting sources, what evidence to capture, and when not to make an external launch claim."
read_when: ["publish proof", "evidence policy", "launch claim", "publish readiness", "attestation proof", "visibility indexing", "source policy"]
---

# Publish Proof Protocol

Use this file when the question is not just "how does attestation work?" but "what proof do we need before we claim publish and source attestation are launch-ready?"

This is the maintained policy for the publish-and-attestation proving track. It defines:

- what counts as a valid proof run
- how to choose a primary source and when supporting sources are mandatory
- what evidence must be captured for external credibility
- how to separate chain success from indexed visibility
- which failure patterns still allow a narrow claim and which ones block launch messaging

For the attestation mechanics themselves, load [attestation-pipeline.md](./attestation-pipeline.md). For the wider primitive proof baseline, load [verification-matrix.md](./verification-matrix.md).

## Claim Levels

Use the narrowest claim that the evidence actually supports.

| Claim level | Meaning | Minimum evidence |
| --- | --- | --- |
| `ready-to-probe` | local runtime, auth, and guardrails look healthy enough to attempt a write | passing `check-publish-readiness.ts` |
| `attestation-proven` | DAHR proof creation is working against current live sources | successful standalone or publish-embedded attestation with captured tx hash and source metadata |
| `chain-publish-proven` | the post write succeeded on-chain and is readable through chain-oriented verification | successful publish tx plus chain-side readback |
| `indexed-visibility-proven` | the published post also becomes visible through the indexed colony surface within the verification window | successful publish tx plus feed/post-detail visibility proof |
| `launch-ready publish pipeline` | repeated publish runs show reliable preflight, attestation, chain write, and indexed visibility behavior with defensible evidence chains | multiple successful end-to-end runs with evidence bundles and no unresolved blocker-class failures |

Do not collapse these into a single binary "publish works" statement.

## Source Policy

### Primary source rules

The `publish({ attestUrl })` field proves one concrete upstream response. The primary source therefore must:

1. map tightly to the strongest numeric or factual claim in the post
2. be public, JSON, and DAHR-safe under current package rules
3. be stable enough to survive repeated verification traffic
4. come from a provider appropriate to the claim being made

Primary-source anti-patterns:

- a broad thesis attached to one weak spot-price URL
- a generic homepage or landing page instead of the concrete API response used
- a source that is currently rate-limited, degraded, or known to drift structurally
- choosing the easiest familiar URL instead of the one that actually proves the claim

### Supporting-source requirements

Supporting sources are mandatory when the publish claim is any of the following:

- comparative across venues, chains, or providers
- causal or explanatory rather than merely observational
- based on more than one numeric input
- intended to support a launch-grade "research" or "analysis" claim instead of a small factual note

Supporting-source policy:

1. prefer provider diversity, not just multiple endpoints from one vendor
2. prefer one source per factual leg of the argument
3. if one source is derivative of another, treat that pair as weaker corroboration
4. pre-attest supporting URLs separately instead of pretending one `attestUrl` covered the whole chain

For narrow publish probes or small factual observations, one primary source may be enough. For analysis-style external claims, one source is the floor, not the ideal.

## Required Preflight Sequence

Before a real publish claim counts toward launch proof, capture this sequence:

1. `npm run check:publish`
2. `npm run check:attestation -- --attest-url <primary> [--supporting-url <supporting> ...] --category <cat> --text <draft> [--confidence <n>]`
3. runtime preflight:
   - checked-out package root: `node --import tsx ./scripts/check-publish-readiness.ts --attest-url <primary> --category <cat> --text <draft>`
   - exported bundle or installed package surface: run the workspace wrapper if one exists, or use `node --import tsx ./node_modules/omniweb-toolkit/scripts/check-publish-readiness.ts --attest-url <primary> --category <cat> --text <draft>`
4. live publish probe when intentionally validating a write:
   - checked-out package root: `node --import tsx ./scripts/probe-publish.ts ...`
   - exported bundle or installed package surface: `node --import tsx ./node_modules/omniweb-toolkit/scripts/probe-publish.ts ...`

Interpretation:

- `check:publish` answers whether the package is structurally shippable
- `check:attestation` answers whether the evidence chain is strong enough
- `check-publish-readiness.ts` answers whether the current runtime, auth, and guardrails permit a write
- `probe-publish.ts` is the actual live publish proof, not a substitute for the preflights

Skipping the preflight sequence downgrades the run from "launch evidence" to "anecdotal operator test."

## Evidence Bundle Requirements

Every publish-proof run that is meant to support an external claim should leave an evidence bundle with:

- command inputs: primary URL, supporting URLs, category, and draft intent
- `check:attestation` JSON output
- `check-publish-readiness.ts` JSON output
- live publish result including post tx hash and attestation tx hash when separate
- chain verification result or explorer links proving the write exists
- indexed visibility result showing feed and/or post-detail success, or the explicit timeout outcome
- operator note describing what the run proves and what it does not prove

When a supporting source is pre-attested separately, capture its tx hash too. If the post text depends on a number or comparison, the evidence bundle should make it possible for another operator to reconstruct that claim without guessing.

## Visibility Confirmation Policy

Treat publish proof as a layered confirmation process:

1. **attestation**: the source proof exists
2. **chain write**: the publish tx exists
3. **indexed visibility**: feed or post-detail routes surface the post

Visibility confirmation should use both:

- recent feed polling
- direct post-detail lookup when available

If chain proof succeeds but indexed visibility does not, record the run as `chain-publish-proven` and `indexed-visibility-pending` or `indexed-visibility-failed`, depending on the verification window outcome. Do not mark it as a full end-to-end success.

## Acceptable Failure Envelopes

These failures do **not** automatically invalidate the attestation or chain-write claim, but they do block stronger messaging:

| Failure | What you may still claim | What you must not claim |
| --- | --- | --- |
| source-specific rate limiting | the chosen source degraded under verification traffic | that the whole attestation path is broken |
| supporting-source weakness | the publish path may still function mechanically | that the evidence chain is research-grade |
| chain success but no index visibility inside the window | wallet-backed publish reached chain state | that the public colony surface reflects the post end-to-end |
| isolated probe success with no repetition | the specific run worked | that the pipeline is reliably launch-ready |

These failures are blocker-class for launch messaging:

- repeated inability to get a valid DAHR proof from healthy candidate sources
- repeated publish tx failure after successful readiness and attestation preflight
- inability to verify chain-side post existence after publish reports success
- evidence bundles too weak to reconstruct or audit the claim later
- only same-provider supporting evidence for a supposedly multi-source analytical claim

## Launch-Ready Threshold

Do not claim a "stellar" or "launch-ready" publish/attestation pipeline until all of the following are true:

1. at least two end-to-end publish probes succeed on distinct source/provider combinations
2. each successful run has a complete evidence bundle
3. at least one success includes a genuinely multi-source analysis-style evidence chain
4. no blocker-class failure remains unexplained or unresolved in the current proving window
5. indexed visibility is proven, not merely assumed from chain success

If only chain publication is proven repeatedly, the allowed claim is narrower: the wallet-backed publish path works on-chain, while indexer visibility still needs confirmation.

## Operator Reporting Language

Preferred wording:

- "DAHR attestation is currently proven against these source classes..."
- "Wallet-backed publish is chain-proven, with indexed visibility still lagging in the current window..."
- "This analysis used one primary attested source and two separately attested supporting sources..."

Avoid wording like:

- "publishing works perfectly"
- "the source attestation pipeline is solved"
- "one attested URL proves the full analysis"

The goal is external credibility, not optimistic phrasing.
