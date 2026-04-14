# Task: TLSN MPC-TLS Debugging — Root Cause Analysis for KyneSys

## Context

TLSN attestation has been failing consistently since at least session 15. We've done systematic debugging and confirmed the failure is in the MPC-TLS protocol phase, not in our code or timeouts. We need a precise error description for KyneSys (Jacobo/Azhar/TheCookingSenpai) to act on.

Read `docs/attestation-reference.md` for the full reference including the diagnostic results.

## What We Know

1. **Notary is reachable:** `tlsnotary.getInfo` returns `ws://node2.demos.sh:7047`, HTTP 200 in 0.2s
2. **Token/proxy allocation works:** 7-14s total, tokens and proxy URLs returned correctly
3. **Proxy ports are dynamic:** 55003, 55008 observed (not limited to documented 55001/55002)
4. **MPC-TLS never completes:** Even with 300s (5 min) timeout, the Playwright WASM prover hangs during the MPC-TLS handshake and never produces a proof
5. **Node bridge is non-functional:** Hangs at WASM init (never worked, built speculatively)
6. **Timeouts were also wrong** (fixed in commit ebeb262): Playwright was 180s for all steps combined (needed 190-290s minimum), Node bridge had 90s for MPC-TLS (empirical range 50-120s)

## What We Need From You

### 1. Deep-dive the Playwright bridge MPC-TLS phase

Read `tools/lib/tlsn-playwright-bridge.ts` carefully. The failure is inside `page.evaluate()` at the `prover.sendRequest()` or `prover.notarize()` step. We can't tell which one because the entire evaluate is a single timeout wrapper.

**Can you add more granular error reporting inside the browser evaluate?** The evaluate runs in Chromium — we need:
- Which step hangs: `notary.sessionUrl()`, `prover.setup()`, `prover.sendRequest()`, or `prover.notarize()`?
- Does the WebSocket to the proxy URL actually connect?
- Is the notary session established before MPC-TLS begins?
- Add `console.log` inside the evaluate and capture via `page.on('console')` to get per-step timing from inside the browser

### 2. Test with the diagnostic script

```bash
# Quick notary check
npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --step notary

# Token + proxy only
npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --step token

# Full attestation (will likely timeout — observe which step)
npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --bridge playwright --step full
```

### 3. Investigate the WebSocket proxy connection

The proxy URL format is `ws://node2.demos.sh:550XX`. Questions:
- Can we connect to the proxy WebSocket independently (outside WASM)?
- Does the proxy actually forward TLS to the target URL?
- Is there a handshake protocol between the proxy and the notary that's failing?
- Try a raw WebSocket connection test to the proxy URL

### 4. Check tlsn-js version compatibility

```bash
# Check installed version
npm ls tlsn-js

# Check if there's a newer version with fixes
npm view tlsn-js versions
```

The WASM prover from `tlsn-js` may have compatibility issues with the notary version running on `node2.demos.sh`. Version mismatch between prover and notary is a known failure mode in TLSNotary.

### 5. Produce a KyneSys-ready error report

After investigation, write a clear error report at `claude-codex-coop/REPORT-tlsn-debug.md` with:

```markdown
# TLSN MPC-TLS Failure Report — For KyneSys

## Environment
- Node: node2.demos.sh
- Notary port: 7047
- Proxy ports: dynamically assigned (55003, 55008 observed)
- tlsn-js version: [from npm ls]
- SDK version: @kynesyslabs/demosdk 2.11.0

## What Works
[list everything that works with timing]

## What Fails
[exact step, exact error, exact timing]

## Likely Cause
[your analysis — version mismatch? notary config? proxy relay broken?]

## What KyneSys Should Check
[specific things they should look at on the node side]
```

### 6. If you find a fix, apply it

If the issue turns out to be on our side (e.g., wrong WebSocket subprotocol, missing headers, version mismatch we can fix), fix it directly:
- Run `npx tsc --noEmit` after each fix
- Test with `npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --step full`
- Commit with `fix: [description]`

## Files to Read

- `docs/attestation-reference.md` — Full reference with diagnostic results
- `tools/lib/tlsn-playwright-bridge.ts` — Production TLSN bridge (412 lines)
- `tools/lib/tlsn-node-bridge.ts` — Experimental bridge (non-functional, for reference only)
- `tools/lib/publish-pipeline.ts` — Attestation orchestrator
- `tools/tlsn-diagnose.ts` — Diagnostic script with per-step timing
- `node_modules/tlsn-js/` — The WASM prover library

## Key Constraint

Do NOT spend time on the Node bridge (`tlsn-node-bridge.ts`) — it was never functional. Focus entirely on the Playwright bridge path.
