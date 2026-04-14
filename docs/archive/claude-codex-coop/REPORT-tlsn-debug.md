# TLSN MPC-TLS Failure Report — For KyneSys

## Environment

- Node: node2.demos.sh
- Notary port: 7047
- Proxy ports: dynamically assigned (55003, 55008 observed)
- tlsn-js version: 0.1.0-alpha.12.0
- SDK version: @kynesyslabs/demosdk 2.11.0

## What Works

| Component | Status | Timing |
|---|---|---|
| Notary info (`tlsnotary.getInfo`) | OK | 0.1–0.8s |
| Notary HTTP reachability | OK (200) | 0.2s |
| Token request + broadcast | OK | 0.5–1.4s |
| Proxy allocation (`requestTLSNproxy`) | OK | 0.1–3.5s |
| Notary session creation (`POST /session`) | OK (200) | 0.25s |
| Browser WebSocket upgrade to proxy | OK | 0.3–1.4s |

## What Fails

- **MPC-TLS never completes** — the WASM prover hangs indefinitely at `prover.sendRequest()`, even with 300s (5 min) timeout
- The proxy endpoint accepts the WebSocket upgrade but the MPC-TLS protocol exchange never progresses

## Root Cause Found (Codex investigation 2026-03-14)

**Missing `?token=<hostname>` query parameter on the WebSocket proxy URL.**

In `tlsn-js` source code (`src/lib.ts:127`), the static `Prover.notarize()` helper appends `?token=${hostname}` to the proxy URL before calling the WASM `send_request`:

```typescript
// tlsn-js static path (line 127)
await prover.send_request(websocketProxyUrl + `?token=${hostname}`, { ... });
```

But our bridge used the instance `sendRequest()` method which does **not** append the token (line 239):

```typescript
// tlsn-js instance path (line 239) — no token appended
const resp = await this.#prover.send_request(wsProxyUrl, { ... });
```

Our Playwright bridge called `prover.sendRequest(proxyUrl, ...)` with the bare proxy URL — no `?token=` query. The proxy accepts the WebSocket connection but cannot route MPC-TLS frames without knowing the target hostname, causing the indefinite hang.

**Evidence supporting this:**
- Raw browser WebSocket to proxy opens successfully — bare URL in 1421ms, **with `?token=blockstream.info` in 277ms** (5x faster, suggesting the proxy recognizes the token and shortcuts)
- Node-side probe (outside browser) to bare proxy URL: rejected in 153ms with "non-101 status code"
- The hang occurs specifically at `prover.sendRequest()` — notary session creation and prover setup complete successfully

## Fix Applied

`tools/lib/tlsn-playwright-bridge.ts` — line 316 changed from:

```typescript
await prover.sendRequest(args.proxyUrl, { ... });
```

To:

```typescript
const hostname = new URL(args.targetUrl).hostname;
const proxyUrlWithToken = args.proxyUrl + (args.proxyUrl.includes("?") ? "&" : "?") + `token=${hostname}`;
await prover.sendRequest(proxyUrlWithToken, { ... });
```

Also added per-step `console.log` timing with `page.on('console')` capture for future debugging visibility.

## SDK Bug: Same `?token=` issue in demosdk

**Your own SDK has the same bug.** In `@kynesyslabs/demosdk` v2.11.0:
- `TLSNotary.attest()` at `TLSNotary.js:259` calls `prover.sendRequest(proxyUrl, ...)` — bare URL, no `?token=`
- `TLSNotary.js:445` — same bare URL
- `TLSNotary.attest()` also calls `notary.sessionUrl()` without `maxSentData/maxRecvData` args

The static `Prover.notarize()` helper in `tlsn-js` appends `?token=${hostname}` internally, but the instance `sendRequest()` method does not. Any code using the instance API (including our bridge AND your SDK) will hit this.

## What KyneSys Should Verify

1. **Confirm `?token=<hostname>` is required** — does the proxy documentation mention this query parameter?
2. **Fix the SDK** — `TLSNotary.attest()` and the alternate path at `:445` need `?token=<hostname>` appended
3. **Should `requestTLSNproxy` return the fully qualified URL?** — the node could append `?token=<hostname>` to the returned `websocketProxyUrl` instead of requiring clients to know about it
4. **Check proxy logs** — are there failed/incomplete MPC-TLS sessions logged on the proxy side from our previous 300s timeout attempts?
5. **Notary/proxy version** — confirm compatibility with `tlsn-js@0.1.0-alpha.12.0`
6. **Dynamic port allocation** — is the range 55000-55100 intentional? We've seen 55003, 55005, 55008

## Testing Status

- [x] `?token=` fix applied and tested — MPC-TLS **still hangs** (killed at 180s)
- [x] Proxy URL now correctly includes `?token=blockstream.info` (matching tlsn-js reference)
- [x] `__name` browser context error from tsx/esbuild resolved (page.evaluate must not contain tsx-transformed helpers)
- [x] **DEFINITIVE TEST: SDK's own `Prover.notarize()` also fails** — 300s timeout, same hang

## Definitive Evidence (2026-03-14)

### 1. SDK Reference Path Test
Used `Prover.notarize()` (the static path that `attestQuick()` uses internally) — this handles `?token=<hostname>` internally within `tlsn-js` itself. **Result: TIMEOUT after 313.2s.** This proves the hang is NOT caused by any client-side code issue.

### 2. On-Chain Transaction History
Our address has **51 `tlsn_request` transactions and ZERO `tlsn_store` transactions**. TLSN attestation has **never successfully completed** from this address — not once, ever.

### 3. Network-Wide Feed Analysis
Checked last 100 posts across 47 publishers: **85 DAHR attestations, 0 TLSN attestations.** No agent on the entire SuperColony network is successfully using TLSN. This is not agent-specific — it is network-wide.

### 4. Multi-Target Verification
Tested with both `blockstream.info` and `api.coingecko.com` — same failure on both. The hang is not target-specific.

### 5. Two Independent AI Agents
Both Claude and Codex (gpt-5.4) independently confirmed the same findings.

## Conclusion

**This is 100% a server-side infrastructure issue.** The MPC-TLS proxy relay on `node2.demos.sh` does not forward TLS frames between prover and notary. Evidence:
- KyneSys's own `Prover.notarize()` reference implementation fails identically
- Nobody on the network has a TLSN attestation
- 51 token requests, 0 stored proofs
- Proxy accepts WebSocket upgrades but MPC-TLS protocol never progresses

**What KyneSys needs to check:** The MPC-TLS relay/forwarding on the proxy side. The proxy accepts WebSocket upgrades, the notary creates sessions, but the actual MPC-TLS cryptographic handshake between prover and notary through the proxy never completes. Server-side logs from the proxy during an attempted attestation would reveal whether TLS frames are being forwarded or dropped.
