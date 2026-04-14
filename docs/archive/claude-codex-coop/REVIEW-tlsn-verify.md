# TLSN Verification Review — Codex (2026-03-14)

## Fix Assessment: CORRECT

The `?token=<hostname>` fix in `tlsn-playwright-bridge.ts` is correctly implemented:
- Uses `new URL(...).hostname` matching `tlsn-js` static path (`src/lib.ts:111`)
- Passes `maxSentData/maxRecvData` into `sessionUrl(...)` correctly
- Appends `?token=<hostname>` before `sendRequest()` matching reference
- `serverDns` vs `server_name` is NOT a bug — JS wrapper translates camelCase→snake_case (`lib.ts:167`)
- Optional WASM fields (`maxSentRecords`, `maxRecvDataOnline`, `maxRecvRecordsOnline`, `deferDecryptionFromStart`, `network`, `clientAuth`) — no evidence they're required for GET flow

## Infrastructure Conclusion: PARTIALLY AGREE

For the **Playwright bridge path specifically**, infra/proxy is the strong hypothesis. But the blanket "client is clean" conclusion is too broad:

### Additional Client-Side Defects Found

1. **Node bridge bare proxyUrl** — `tlsn-node-bridge.ts:459` still uses `prover.sendRequest(token.proxyUrl, ...)` without `?token=`
2. **SDK TLSNotary.attest() bare proxyUrl** — `node_modules/@kynesyslabs/demosdk/build/tlsnotary/TLSNotary.js:259` and `:445` both call `sendRequest(proxyUrl, ...)` without `?token=`
3. **SDK sessionUrl() without size args** — SDK calls `notary.sessionUrl()` with no `maxSentData/maxRecvData`, unlike reference
4. **PATCH method unsupported** — Our bridge allows `PATCH` but WASM `Method` type only allows `GET|POST|PUT|DELETE` (`tlsn_wasm.d.ts:19`)
5. **tlsn-js is browser-only** — official npm page says "does not work in Node.js", confirming Node bridge was never viable

## Test Results

- `--step full` (blockstream.info): TIMEOUT after 315.5s (300s evaluate timeout)
- `--step full --url coingecko`: TIMEOUT after 313.6s (same failure)
- Hang is **not target-specific** — reproducible across multiple APIs
- Control plane (notary, token, proxy) all healthy in both tests

## Recommended Next Steps

1. Report SDK `?token=` gap to KyneSys — their `TLSNotary.attest()` has the same bug
2. Remove `PATCH` from bridge method type (WASM doesn't support it)
3. Apply `?token=` fix to Node bridge too (even if non-functional, for correctness)
4. The remaining hang needs KyneSys server-side investigation — client code now matches reference
