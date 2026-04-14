# Task: Review & Verify TLSN ?token= Fix and Infrastructure Conclusion

## Context

Based on YOUR previous investigation (session 019ceb24), Claude applied a fix and reached a conclusion. We need you to independently review the fix and verify or challenge the conclusion.

## What Was Done

1. **Your finding:** `tlsn-js` static `Prover.notarize()` at `src/lib.ts:127` appends `?token=${hostname}` to the WebSocket proxy URL, but the instance `sendRequest()` at `src/lib.ts:239` does not. Our bridge used the instance path with bare proxy URL.

2. **Fix applied (commit 120e483):** `tools/lib/tlsn-playwright-bridge.ts` line ~330 now constructs:
   ```typescript
   const hostname = new URL(args.targetUrl).hostname;
   const proxyUrlWithToken = args.proxyUrl + (args.proxyUrl.includes("?") ? "&" : "?") + "token=" + hostname;
   await prover.sendRequest(proxyUrlWithToken, { ... });
   ```

3. **Test result:** MPC-TLS still hangs at 180s even with the `?token=` fix.

4. **Current conclusion:** "Infrastructure issue on Demos node — proxy accepts WebSocket but doesn't relay MPC-TLS frames."

## What We Need From You

### 1. Review the fix
- Read `tools/lib/tlsn-playwright-bridge.ts` — is the `?token=` fix correctly implemented?
- Is the hostname extraction correct for all target URLs we use?
- Are there other differences between the static `Prover.notarize()` path and our instance path that we missed?

### 2. Challenge the infrastructure conclusion
Don't just accept "it's infrastructure." Try to prove it wrong:
- Are there other client-side issues we might be missing?
- Does the `Prover` constructor in our bridge match what `Prover.notarize()` uses? Compare field names (`serverDns` vs `server_name`, `maxSentData` vs `max_sent_data`, etc.)
- Does the WASM prover version (`0.1.0-alpha.12.0`) have known issues?
- Is there a subprotocol or header the WebSocket needs?
- Does the order of operations matter (setup before sendRequest, etc.)?

### 3. Run independent tests
```bash
# Test the fix
npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --step full

# Check if the proxy URL format matters
# Try different target URLs — maybe blockstream.info specifically is the issue
npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --step full --url "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"

# Check the WASM prover API surface — does sendRequest have options we're not using?
grep -n "sendRequest\|send_request\|ProverConfig\|NetworkSetting\|server_name\|serverDns" node_modules/tlsn-js/src/lib.ts node_modules/tlsn-js/build/lib.d.ts

# Check if there's a newer version of tlsn-js
npm view tlsn-js versions --json 2>/dev/null || echo "npm registry unreachable"

# Look at the WASM prover types for any options we might be missing
cat node_modules/tlsn-js/build/lib.d.ts
```

### 4. Compare our Prover construction with the reference
Our bridge creates:
```typescript
const prover = new w.Prover({
  serverDns: new URL(args.targetUrl).hostname,
  maxSentData: args.maxBytes,
  maxRecvData: args.maxBytes,
});
```

The `tlsn-js` static path creates:
```typescript
const prover = new WasmProver({
  server_name: hostname,
  max_sent_data: maxSentData,
  max_recv_data: maxRecvData,
  // ... more fields: max_sent_records, max_recv_records_online, defer_decryption_from_start, network, client_auth
});
```

Note: the field names are different (`serverDns` vs `server_name`, camelCase vs snake_case). Is there a JS wrapper class (`Prover`) that translates these? Or is our bridge passing snake_case fields to a constructor that expects camelCase (or vice versa)?

### 5. Write your findings
Add your review to `claude-codex-coop/REVIEW-tlsn-verify.md` with:
- Fix correctness assessment
- Any additional issues found
- Test results
- Whether you agree with the "infrastructure" conclusion or have an alternative hypothesis
- Recommended next steps

## Files to Read
- `tools/lib/tlsn-playwright-bridge.ts` — the fixed bridge (focus on lines 280-370)
- `node_modules/tlsn-js/src/lib.ts` — the reference implementation
- `node_modules/tlsn-js/build/lib.d.ts` — TypeScript types
- `claude-codex-coop/REPORT-tlsn-debug.md` — the KyneSys report to validate
- `docs/attestation-reference.md` — full reference

## Key Question
**Is there something client-side we're still getting wrong, or is this genuinely a server-side infrastructure issue?**
