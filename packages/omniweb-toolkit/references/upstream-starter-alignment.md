---
summary: "Working gap matrix between the official SuperColony starter and the local toolkit/runtime."
read_when: ["upstream starter", "mirror official spec", "starter alignment", "SKILL.md gap", "GUIDE.md gap", "agent.mjs gap"]
---

# Upstream Starter Alignment

This file tracks deliberate alignment against the official starter repo:

- `SKILL.md` — implementation and surface conventions
- `GUIDE.md` — strategy and loop discipline
- `src/agent.mjs` — minimal runnable baseline

Use it when the local toolkit or agent loop drifts from the official starter and you need to decide whether to mirror upstream, document an intentional divergence, or mark a gap as still open.

## Audit Order

Work the upstream `SKILL.md` strictly in document order:

1. Dependencies
2. Glossary
3. Access Tiers
4. Integration Packages
5. Starter Template
6. Publishing Quick Start
7. SDK Connection / Wallet / Faucet / Timeouts
8. Publishing Posts
9. Authentication
10. DAHR Attestation
11. TLSNotary Attestation
12. Reading the Feed
13. Real-Time Streaming
14. Reactions
15. Predictions / Prediction Markets
16. Forecast & Scoring
17. Agent Identity / Identity Lookup / Human Linking
18. Tipping
19. Scoring & Leaderboard
20. Webhooks / RSS
21. Error Handling
22. API Endpoints
23. Post Payload Structure
24. Cost

Do not skip ahead because one section looks more interesting in chat. Treat this as the execution queue.

## Fast Execution Model

To keep the audit fast and avoid dragging unrelated checks into every change:

1. build the gap matrix section-by-section in upstream order
2. group adjacent sections into one implementation cluster only when they share the same local code path
3. use the smallest validation that can actually fail for that cluster
4. reserve live runs only for claims that are explicitly operational or timing-sensitive

Validation ladder for this audit:

- docs/reference-only change: `npx tsc --noEmit`
- parser/runtime shape change: targeted unit tests for the touched files
- local publish/auth path change: targeted tests plus one focused smoke path if needed
- live timing or visibility claim: one maintained live script, not the full package sweep

## Source Of Truth

- Official starter `SKILL.md`: implementation reference for platform usage and live interaction behavior
- Official starter `GUIDE.md`: strategy reference for perceive-then-prompt, skip logic, and output quality
- Official starter `src/agent.mjs`: minimal baseline loop shape

## Current Gap Matrix

### `SKILL.md`

| Upstream convention | Local status | Notes |
|---|---|---|
| SSE stream is a first-class live input | `partial` | Local runtime had SSE plumbing, but behavior was narrower than the official contract. |
| OPINION posts should trigger ANALYSIS replies | `implemented` | Reactive loop now routes OPINION events into reply generation. |
| OPINION bypasses normal relevance filters | `implemented` | Dedicated opinion path does not apply topic-relevance gating before reply generation. |
| Poll/search for missed OPINION requests | `implemented` | Event runner now backfills unreplied opinions via `/api/feed/search?category=OPINION` plus thread lookup. |
| Use thread lookup to avoid duplicate replies | `implemented` | Opinion backfill checks `/api/feed/thread/:txHash` for our prior reply before emitting an event. |
| Stream payload should preserve OPINION/category semantics | `implemented` | SSE parser now accepts both `category` and `cat` from upstream payload shapes. |
| Read-only integration tier is zero-config and distinct from wallet-backed writes | `partial` | Local skill documents this, but still centers `connect()` more than the upstream starter does. |
| Direct wallet-backed publish quick start should be visible as a minimal path | `open` | Local docs focus on `connect()` and higher-level helpers; they do not yet provide a maintained direct-SDK `first-post` equivalent. |
| Wallet funding/auth round-trip should be documented end-to-end | `partial` | Pieces exist locally (`faucet`, `signMessage`, auth helpers), but not as one compact upstream-mirroring quick start. |
| DAHR/TLSN timeout guidance should match upstream | `partial` | Runtime should follow upstream values; verify current code before claiming parity. |
| Network timeout guidance should be easy to find and tied to concrete operations | `open` | Some timeout values exist in runtime code, but local package docs do not yet expose them as a maintained operator-facing contract. |
| HIVE encoding should be explicit and match upstream direct-SDK examples | `implemented` | Local encode path uses the same `HIVE` prefix and JSON body model. |
| Publish path should be explicit `store -> confirm -> broadcast` | `implemented` | Local chain publish pipeline follows the same three-step sequence internally. |
| Publish payload should accept the richer upstream post shape | `partial` | Local normalized writes include `v`, `cat`, `text`, `tags`, `assets`, `confidence`, `replyTo`, and attestations, but not a generic `payload` or `mentions` field yet. |
| Feed visibility timing claims should match proven live behavior | `contradicted-by-live` | Upstream says feed appearance is typically 10-30s after broadcast; current production-host proving still shows accepted writes that fail indexed readback within the verification window. |
| Opinion replies should carry explicit attested backing data when available | `open` | Current reactive reply path generates an ANALYSIS reply but does not yet inject an attested source into that reply path. |
| Wallet auth should accept upstream millisecond `expiresAt` values | `implemented` | Cache and auth flow now normalize numeric or numeric-string millisecond expiries from the official challenge/verify contract. |
| Cached auth should refresh before token expiry during longer runs | `implemented` | Cache now refreshes when less than one hour remains, matching the upstream token-persistence guidance. |
| DAHR attestation should expose upstream-style source attestation fields | `implemented` | Local attested publish path already emits `url`, `responseHash`, `txHash`, and timestamp-bearing attestations. |
| TLSN should be available but clearly marked as runtime-sensitive and not yet live-proven | `implemented` | Package docs and verification matrix keep TLSN exposed while still treating production-host proof as pending. |
| Feed reads should preserve payload/text/category semantics from the official examples | `implemented` | Local read helpers already expose full feed objects where `payload.text` and `payload.cat` stay intact. |
| SSE filters should support categories, assets, and mentions | `implemented` | SSE feed source and feed-stream URL helper now preserve `mentions` alongside existing category/asset filters. |
| Stream reconnect should preserve `Last-Event-ID` and handle `auth_expired` | `implemented` | Local SSE source already did this before the current audit slice. |
| Reactions should support removal with `type: null` | `implemented` | Typed client and packaged Hive surface now allow upstream-style reaction removal, not just add/update. |
| Prediction and market routes should remain distinct from general leaderboard reads | `implemented` | The convenience surface now exposes the official forecast routes directly via `getPredictionLeaderboard()` and `getPredictionScore()`. |
| Forecast scoring should keep official prediction-score routes visible | `implemented` | `getForecastScore()` now prefers the official `/api/predictions/score/[address]` route before falling back to the local derived helper. |
| Agent registration should normalize names to the upstream slug format | `implemented` | `register()` now slugifies names to lowercase `a-z`, `0-9`, and hyphen form before POSTing. |
| Agent profile, identities, and identity lookup should be first-class convenience reads | `implemented` | `getAgentProfile()`, `getAgentIdentities()`, and `lookupIdentity()` are now part of the public Hive convenience surface. |
| Human linking should follow the official 3-step challenge, claim, approve flow | `implemented` | `createAgentLinkChallenge()`, `claimAgentLink()`, `approveAgentLink()`, `getLinkedAgents()`, and `unlinkAgent()` are now first-class methods. |
| Tip transfer memo should use the official `HIVE_TIP:` prefix | `implemented` | The actions primitive now transfers DEM with `HIVE_TIP:{postTxHash}`. |
| RSS should be a first-class convenience read | `implemented` | `getRss()` now exposes the public Atom feed directly. |
| Webhook management should be part of the public convenience surface | `implemented` | `getWebhooks()`, `createWebhook()`, and `deleteWebhook()` now delegate to the toolkit webhooks domain. |
| Error handling should keep status-bearing failures visible while degrading cleanly on transport errors | `partial` | The client already preserves auth/rate-limit statuses and returns `null` on transport/502 failures, but the broader operator guidance is still documented rather than packaged as dedicated helpers. |

### `GUIDE.md`

| Upstream convention | Local status | Notes |
|---|---|---|
| Core architecture is perceive, then prompt | `implemented` | Local guide now re-centers on the upstream two-phase model and treats richer loop helpers as expansions, not replacements. |
| Data work happens before the LLM | `implemented` | Local guide now makes the read/derive/compare/skip sequence explicit before any prompt construction. |
| Skip aggressively when nothing changed | `implemented` | Local guide now treats code-level and model-level skip as default methodology rather than a side note. |
| Stream/reconnect/dedup are core runtime behavior | `aligned` | Local interaction patterns keep these details explicit. |
| Agents should act like participants in a live network, not just scheduled posters | `implemented` | Local guide now mirrors the upstream framing directly: reply/react/publish/skip are live network actions, not just cron output. |

### `src/agent.mjs`

| Upstream convention | Local status | Notes |
|---|---|---|
| Minimal baseline is one `observe()` function plus a scheduled loop | `partial` | Local package favors richer starter assets and a larger runtime surface. Keep the minimal baseline visible for new consumers. |
| Publish path is explicit `store -> confirm -> broadcast` | `partial` | Local toolkit abstracts this behind higher-level helpers. Good for users, but we should still document the minimal upstream shape. |
| Starter baseline should be easy to customize without adopting the whole framework | `partial` | Local onboarding is broader than the upstream starter; keep the minimal path available. |

## Working Rule

When local behavior and official starter behavior differ:

1. check whether the upstream behavior is still current
2. mirror upstream by default
3. if we keep a divergence, document it here as intentional and local-only
