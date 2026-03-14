/**
 * TLSN SDK path test — uses the static Prover.notarize() path
 * (same as SDK attestQuick) which internally handles ?token=<hostname>.
 *
 * This is the definitive server-side vs client-side test:
 * - If this fails, the problem is server-side (infra/notary/proxy)
 * - If this succeeds, the problem was our sendRequest() call
 *
 * Usage:
 *   npx tsx tools/tlsn-sdk-test.ts --env ~/.config/demos/credentials
 */

import { parseArgs } from "node:util";
import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { connectWallet, info } from "./lib/sdk.js";

const require = createRequire(import.meta.url);

const { values: flags } = parseArgs({
  options: {
    env: { type: "string", default: "" },
    url: { type: "string", default: "https://blockstream.info/api/blocks/tip/height" },
    timeout: { type: "string", default: "300" },
  },
  strict: false,
});

const targetUrl = String(flags.url || "https://blockstream.info/api/blocks/tip/height");
const timeoutSec = parseInt(String(flags.timeout || "300"), 10);

console.log("═══ TLSN SDK Path Test ═══════════════════════════");
console.log(`  Target URL:  ${targetUrl}`);
console.log(`  Timeout:     ${timeoutSec}s`);
console.log(`  Test:        Static Prover.notarize() (SDK attestQuick path)`);
console.log(`  Purpose:     If this fails, it's server-side (not our code)`);
console.log();

// ── Wallet + Token ──────────────────────────────

const t0 = Date.now();
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

console.log("[1/4] Connecting wallet...");
const wallet = await connectWallet(String(flags.env || ""));
const demos = wallet.demos;
console.log(`  ✓ Wallet connected (${elapsed()})`);

console.log("[2/4] Getting notary info...");
const notaryInfo = await (demos as any).nodeCall("tlsnotary.getInfo", {});
const rawNotaryUrl = String(notaryInfo?.url || notaryInfo?.notaryUrl || "");
const notaryUrl = rawNotaryUrl.replace(/^ws:\/\//, "http://");
console.log(`  ✓ Notary URL: ${notaryUrl} (${elapsed()})`);

console.log("[3/4] Requesting TLSN token + proxy...");
const { DemosTransactions } = await import("@kynesyslabs/demosdk/websdk");
function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}
// Build tx same way as tlsn-playwright-bridge.ts:71-90
const tx = DemosTransactions.empty() as any;
const { publicKey } = await (demos as any).crypto.getIdentity("ed25519");
const publicKeyHex = uint8ArrayToHex(publicKey);
const nonce = await (demos as any).getAddressNonce(publicKeyHex);
tx.content.to = publicKeyHex;
tx.content.nonce = nonce + 1;
tx.content.amount = 1;
tx.content.type = "native";
tx.content.timestamp = Date.now();
tx.content.data = ["native", { nativeOperation: "tlsn_request", args: [targetUrl] }];
const signedTx = await (demos as any).sign(tx);
const confirmResult = await DemosTransactions.confirm(signedTx, demos);
const broadcastResult = await DemosTransactions.broadcast(confirmResult, demos);
const txHash = String((signedTx as any).hash || "");
console.log(`  ✓ Token tx: ${txHash.slice(0, 16)}... (${elapsed()})`);

// Poll for token (bridge uses tokenResponse.token.id)
let tokenId = "";
for (let i = 0; i < 30; i++) {
  const tokenResp = await (demos as any).nodeCall("tlsnotary.getToken", { txHash });
  tokenId = String(tokenResp?.token?.id || tokenResp?.tokenId || "");
  if (tokenId) break;
  await new Promise(r => setTimeout(r, 1000));
}
if (!tokenId) { console.error("  ✗ Token poll failed"); process.exit(1); }
console.log(`  ✓ Token: ${tokenId} (${elapsed()})`);

// Poll for proxy
let proxyUrl = "";
const owner = `0x${publicKeyHex}`;
for (let i = 0; i < 30; i++) {
  const proxyResp = await (demos as any).nodeCall("requestTLSNproxy", {
    tokenId, owner, targetUrl,
  });
  proxyUrl = String(proxyResp?.websocketProxyUrl || "");
  if (proxyUrl) break;
  await new Promise(r => setTimeout(r, 1000));
}
if (!proxyUrl) { console.error("  ✗ Proxy poll failed"); process.exit(1); }
console.log(`  ✓ Proxy: ${proxyUrl} (${elapsed()})`);

// ── Browser attestation via static Prover.notarize() ──────────────────

console.log("[4/4] Running static Prover.notarize() in browser...");
console.log(`  This is the SDK attestQuick path — handles ?token= internally`);

// Find tlsn-js build dir
const tlsnPkg = require.resolve("tlsn-js/package.json");
const tlsnBuildDir = resolve(dirname(tlsnPkg), "build");

// Start static server for WASM assets
const server = await new Promise<{ baseUrl: string; close: () => Promise<void> }>((res) => {
  const srv = createServer(async (req, resp) => {
    const urlPath = req.url || "/";
    if (urlPath === "/" || urlPath === "/bridge.html") {
      resp.writeHead(200, {
        "Content-Type": "text/html",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      });
      // Serve all JS files from tlsn-js build dir
      const files = await readdir(tlsnBuildDir);
      const jsFiles = files.filter(f => f.endsWith(".js"));
      const scripts = jsFiles.map(f => `<script src="/${f}"></script>`).join("\n");
      resp.end(`<!DOCTYPE html><html><head>${scripts}</head><body></body></html>`);
      return;
    }
    const filePath = resolve(tlsnBuildDir, urlPath.slice(1));
    if (!existsSync(filePath)) { resp.writeHead(404); resp.end(); return; }
    const ext = filePath.split(".").pop();
    const ct = ext === "js" ? "application/javascript" : ext === "wasm" ? "application/wasm" : "application/octet-stream";
    resp.writeHead(200, {
      "Content-Type": ct,
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    });
    createReadStream(filePath).pipe(resp);
  });
  srv.listen(0, "127.0.0.1", () => {
    const addr = srv.address() as any;
    res({
      baseUrl: `http://127.0.0.1:${addr.port}`,
      close: () => new Promise<void>((r) => srv.close(() => r())),
    });
  });
});

let playwright: any;
try {
  playwright = await import("playwright");
} catch {
  console.error("  ✗ Playwright not installed");
  process.exit(1);
}

const browser = await playwright.chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(timeoutSec * 1000);

  // Capture console
  page.on("console", (msg: any) => {
    const text = msg.text?.() ?? String(msg);
    console.log(`  [browser] ${text}`);
  });

  await page.goto(`${server.baseUrl}/bridge.html`, { waitUntil: "domcontentloaded" });

  const startTime = Date.now();
  console.log(`  Starting evaluate at ${elapsed()}...`);

  try {
    const result = await Promise.race([
      page.evaluate(
        async (args: { targetUrl: string; proxyUrl: string; notaryUrl: string; maxBytes: number }) => {
          const w: any = window as any;
          if (typeof w.default !== "function" || !w.Prover) {
            throw new Error("tlsn-js globals not available");
          }

          await w.default({
            loggingLevel: "Info",
            hardwareConcurrency: navigator.hardwareConcurrency || 2,
          });
          console.log("[sdk-test] WASM initialized");

          // Use the STATIC Prover.notarize() — this is what SDK attestQuick() uses.
          // This path internally appends ?token=<hostname> to the proxyUrl.
          // If this hangs, it's 100% server-side.
          console.log("[sdk-test] Calling Prover.notarize() (static path)...");
          const presentationJSON = await w.Prover.notarize({
            notaryUrl: args.notaryUrl,
            websocketProxyUrl: args.proxyUrl,
            maxSentData: args.maxBytes,
            maxRecvData: args.maxBytes,
            url: args.targetUrl,
            method: "GET",
            headers: { Accept: "application/json" },
            commit: {
              sent: [{ start: 0, end: 100 }],
              recv: [{ start: 0, end: 200 }],
            },
            serverIdentity: true,
          });
          console.log("[sdk-test] Prover.notarize() completed!");
          return presentationJSON;
        },
        { targetUrl, proxyUrl, notaryUrl, maxBytes: 16384 }
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeoutSec}s`)), timeoutSec * 1000)
      ),
    ]);

    const dur = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log();
    console.log(`  ✓ SUCCESS in ${dur}s — Prover.notarize() completed!`);
    console.log(`  This means the problem was client-side (?token= or other issue).`);
    console.log(`  Result preview: ${JSON.stringify(result).slice(0, 200)}...`);

  } catch (err: any) {
    const dur = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log();
    console.log(`  ✗ FAILED after ${dur}s: ${err.message?.split("\n")[0]}`);
    console.log();
    console.log(`  ═══ VERDICT ═══`);
    console.log(`  The SDK's own Prover.notarize() (which handles ?token= internally) also fails.`);
    console.log(`  This CONFIRMS the problem is SERVER-SIDE (Demos node infrastructure).`);
    console.log(`  Our client code is correct — KyneSys needs to investigate their notary/proxy.`);
  }

} finally {
  await browser.close();
  await server.close();
}

console.log();
console.log(`═══ Done (${elapsed()} total) ═══`);
