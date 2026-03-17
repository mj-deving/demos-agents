/**
 * TLSN diagnostic script — tests each pipeline step with timing.
 *
 * Usage:
 *   npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials
 *   npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --bridge node
 *   npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --url "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
 *   npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --step notary   # stop after notary check
 *   npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --step token    # stop after token
 *   npx tsx tools/tlsn-diagnose.ts --env ~/.config/demos/credentials --step full     # full attestation (default)
 */

import { parseArgs } from "node:util";
import { Demos } from "@kynesyslabs/demosdk/websdk";
import { info, connectWallet } from "./lib/sdk.js";
import { attestTlsnViaPlaywrightBridge } from "./lib/tlsn-playwright-bridge.js";

const { values: flags } = parseArgs({
  options: {
    env: { type: "string", default: "" },
    url: { type: "string", default: "https://blockstream.info/api/blocks/tip/height" },
    bridge: { type: "string", default: "playwright" },
    step: { type: "string", default: "full" },
  },
  strict: false,
});

const envPath = typeof flags.env === "string" ? flags.env : "";
const targetUrl = typeof flags.url === "string" ? flags.url : "https://blockstream.info/api/blocks/tip/height";
const bridge = typeof flags.bridge === "string" ? flags.bridge : "playwright";
const step = typeof flags.step === "string" ? flags.step : "full";

function elapsed(startMs: number): string {
  return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  console.log("═══ TLSN Diagnostic ═══════════════════════════");
  console.log(`  Target URL:  ${targetUrl}`);
  console.log(`  Bridge:      ${bridge}`);
  console.log(`  Step:        ${step}`);
  console.log(`  Env:         ${envPath || "(default)"}`);
  console.log("");

  // Step 1: Connect wallet
  const t0 = Date.now();
  console.log("[1/5] Connecting wallet...");
  const wallet = await connectWallet(envPath || "~/.config/demos/credentials");
  const demos = wallet.demos;
  console.log(`  ✓ Wallet connected: ${wallet.address.slice(0, 12)}... (${elapsed(t0)})`);

  // Step 2: Check notary info
  const t1 = Date.now();
  console.log("[2/5] Checking notary info...");
  try {
    const notaryInfo = await (demos as any).nodeCall("tlsnotary.getInfo", {});
    const notaryRaw = String(notaryInfo?.notaryUrl || "");
    const notaryHttp = notaryRaw.startsWith("ws://")
      ? `http://${notaryRaw.slice("ws://".length)}`
      : notaryRaw.startsWith("wss://")
        ? `https://${notaryRaw.slice("wss://".length)}`
        : notaryRaw;
    console.log(`  ✓ Notary URL (raw): ${notaryRaw}`);
    console.log(`  ✓ Notary URL (http): ${notaryHttp}`);
    console.log(`  ✓ Notary reachable (${elapsed(t1)})`);

    // Try to fetch notary directly
    const t1b = Date.now();
    try {
      const resp = await fetch(notaryHttp, { signal: AbortSignal.timeout(10000) });
      console.log(`  ✓ Notary HTTP status: ${resp.status} (${elapsed(t1b)})`);
    } catch (err: any) {
      console.log(`  ✗ Notary HTTP fetch failed: ${err?.message || err} (${elapsed(t1b)})`);
    }
  } catch (err: any) {
    console.log(`  ✗ Notary info failed: ${err?.message || err} (${elapsed(t1)})`);
    if (step === "notary") process.exit(1);
  }

  if (step === "notary") {
    console.log("\n═══ Done (notary check only) ═══");
    process.exit(0);
  }

  // Step 3: Request token
  const t2 = Date.now();
  console.log("[3/5] Requesting TLSN token...");
  try {
    // We need to do this manually to get timing
    const { DemosTransactions } = await import("@kynesyslabs/demosdk/websdk");
    const tx = DemosTransactions.empty();
    const { publicKey } = await (demos as any).crypto.getIdentity("ed25519");
    const publicKeyHex = Buffer.from(publicKey).toString("hex");
    const nonce = await (demos as any).getAddressNonce(publicKeyHex);
    tx.content.to = publicKeyHex;
    tx.content.nonce = nonce + 1;
    tx.content.amount = 1;
    tx.content.type = "native";
    tx.content.timestamp = Date.now();
    tx.content.data = ["native", { nativeOperation: "tlsn_request", args: [targetUrl] }];
    const signed = await (demos as any).sign(tx);
    const confirmed = await DemosTransactions.confirm(signed, demos as any);
    const broadcast = await DemosTransactions.broadcast(confirmed, demos as any);
    const broadcastOk = (broadcast as any)?.result === 200;
    const requestTxHash = String((signed as any).hash || "");
    console.log(`  ✓ Token tx broadcast: ${broadcastOk ? "OK" : "FAIL"} hash=${requestTxHash.slice(0, 16)}... (${elapsed(t2)})`);

    if (!broadcastOk) {
      console.log(`  ✗ Broadcast response: ${JSON.stringify(broadcast)}`);
      if (step === "token") process.exit(1);
    }

    // Poll for token
    const t2b = Date.now();
    let tokenId: string | null = null;
    for (let i = 0; i < 30; i++) {
      const resp = await (demos as any).nodeCall("tlsnotary.getToken", { txHash: requestTxHash });
      if (resp?.token?.id) {
        tokenId = String(resp.token.id);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (tokenId) {
      console.log(`  ✓ Token ID: ${tokenId} (${elapsed(t2b)})`);
    } else {
      console.log(`  ✗ Token not created within 30s (${elapsed(t2b)})`);
      if (step === "token") process.exit(1);
    }

    // Poll for proxy
    const t2c = Date.now();
    const ownerAddr = typeof (demos as any).getAddress === "function"
      ? String((demos as any).getAddress())
      : `0x${publicKeyHex}`;
    let proxyUrl = "";
    let lastError = "";
    for (let i = 0; i < 30; i++) {
      const resp = await (demos as any).nodeCall("requestTLSNproxy", {
        tokenId,
        owner: ownerAddr,
        targetUrl,
      });
      proxyUrl = String(resp?.websocketProxyUrl || "");
      if (proxyUrl) break;
      lastError = [resp?.error, resp?.message, resp?.lastError].filter(Boolean).join(" | ");
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (proxyUrl) {
      console.log(`  ✓ Proxy URL: ${proxyUrl.slice(0, 60)}... (${elapsed(t2c)})`);
    } else {
      console.log(`  ✗ Proxy not allocated within 30s: ${lastError} (${elapsed(t2c)})`);
    }
    console.log(`  Total token+proxy: ${elapsed(t2)}`);
  } catch (err: any) {
    console.log(`  ✗ Token request failed: ${err?.message || err} (${elapsed(t2)})`);
  }

  if (step === "token") {
    console.log("\n═══ Done (token check only) ═══");
    process.exit(0);
  }

  // Step 4: Full attestation
  const t3 = Date.now();
  console.log(`[4/5] Full TLSN attestation via ${bridge} bridge...`);
  try {
    const result = await attestTlsnViaPlaywrightBridge(demos as any, targetUrl);
    const duration = Date.now() - t3;
    console.log(`  ✓ Attestation succeeded! (${(duration / 1000).toFixed(1)}s)`);
    console.log(`    Token ID:     ${result.tokenId}`);
    console.log(`    Request tx:   ${result.requestTxHash.slice(0, 16)}...`);
    console.log(`    Proof tx:     ${result.proofTxHash.slice(0, 16)}...`);
    console.log(`    Storage fee:  ${result.storageFee} DEM`);
    const proofSize = JSON.stringify(result.presentation).length;
    console.log(`    Proof size:   ${(proofSize / 1024).toFixed(1)} KB`);
  } catch (err: any) {
    const duration = Date.now() - t3;
    console.log(`  ✗ Attestation failed after ${(duration / 1000).toFixed(1)}s: ${err?.message || err}`);
  }

  // Step 5: Summary
  const totalDuration = Date.now() - t0;
  console.log(`\n═══ Done (${(totalDuration / 1000).toFixed(1)}s total) ═══`);
}

main().catch((err) => {
  console.error(`Fatal: ${err?.message || err}`);
  process.exit(1);
});
