import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { Demos, DemosTransactions } from "@kynesyslabs/demosdk/websdk";
import { info } from "./sdk.js";

const require = createRequire(import.meta.url);
const TLSN_MAX_BYTES = 16_384;
const TLSN_TOKEN_POLL_ATTEMPTS = 30;
const TLSN_TOKEN_POLL_INTERVAL_MS = 1000;

async function withTimeout<T>(label: string, ms: number, work: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export interface TlsnAttestPlaywrightResult {
  requestedUrl: string;
  attestedUrl: string;
  requestTxHash: string;
  proofTxHash: string;
  tokenId: string;
  storageFee: number;
  presentation: any;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function assertHttpsUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`TLSN requires HTTPS URL, got "${parsed.protocol}"`);
  }
  return parsed;
}

function normalizeNotaryUrl(url: string): string {
  if (url.startsWith("wss://")) return `https://${url.slice("wss://".length)}`;
  if (url.startsWith("ws://")) return `http://${url.slice("ws://".length)}`;
  return url;
}

function coerceTlsnMethod(method: string): "GET" | "POST" | "PUT" | "DELETE" | "PATCH" {
  const upper = method.toUpperCase();
  switch (upper) {
    case "GET":
    case "POST":
    case "PUT":
    case "DELETE":
    case "PATCH":
      return upper;
    default:
      throw new Error(`Unsupported TLSN HTTP method "${method}"`);
  }
}

async function createTlsnRequestTransaction(demos: Demos, targetUrl: string): Promise<any> {
  const tx = DemosTransactions.empty();
  const { publicKey } = await (demos as any).crypto.getIdentity("ed25519");
  const publicKeyHex = uint8ArrayToHex(publicKey);
  const nonce = await demos.getAddressNonce(publicKeyHex);

  tx.content.to = publicKeyHex;
  tx.content.nonce = nonce + 1;
  tx.content.amount = 1;
  tx.content.type = "native";
  tx.content.timestamp = Date.now();
  tx.content.data = [
    "native",
    {
      nativeOperation: "tlsn_request",
      args: [targetUrl],
    },
  ];

  return await demos.sign(tx);
}

async function createTlsnStoreTransaction(
  demos: Demos,
  tokenId: string,
  proof: string,
  storageType: "onchain" | "ipfs",
  fee: number
): Promise<any> {
  const tx = DemosTransactions.empty();
  const { publicKey } = await (demos as any).crypto.getIdentity("ed25519");
  const publicKeyHex = uint8ArrayToHex(publicKey);
  const nonce = await demos.getAddressNonce(publicKeyHex);

  tx.content.to = publicKeyHex;
  tx.content.nonce = nonce + 1;
  tx.content.amount = fee;
  tx.content.type = "native";
  tx.content.timestamp = Date.now();
  tx.content.data = [
    "native",
    {
      nativeOperation: "tlsn_store",
      args: [tokenId, proof, storageType],
    },
  ];

  return await demos.sign(tx);
}

async function requestTlsnToken(
  demos: Demos,
  targetUrl: string
): Promise<{ proxyUrl: string; tokenId: string; requestTxHash: string }> {
  const tx = await createTlsnRequestTransaction(demos, targetUrl);
  const confirmResult = await DemosTransactions.confirm(tx, demos);
  const broadcastResult = await DemosTransactions.broadcast(confirmResult, demos);
  if ((broadcastResult as any)?.result !== 200) {
    throw new Error(`TLSN request failed: ${String((broadcastResult as any)?.response?.message || "unknown broadcast error")}`);
  }

  const requestTxHash = String((tx as any).hash || "");
  if (!requestTxHash) throw new Error("TLSN request transaction hash missing");

  let tokenId: string | null = null;
  for (let attempt = 0; attempt < TLSN_TOKEN_POLL_ATTEMPTS; attempt++) {
    const tokenResponse = await (demos as any).nodeCall("tlsnotary.getToken", { txHash: requestTxHash });
    if (tokenResponse?.token?.id) {
      tokenId = String(tokenResponse.token.id);
      break;
    }
    if (attempt < TLSN_TOKEN_POLL_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, TLSN_TOKEN_POLL_INTERVAL_MS));
    }
  }
  if (!tokenId) {
    throw new Error(`TLSN token not created within ${TLSN_TOKEN_POLL_ATTEMPTS}s (tx=${requestTxHash.slice(0, 12)}...)`);
  }

  const { publicKey } = await (demos as any).crypto.getIdentity("ed25519");
  const ownerFromWallet = typeof (demos as any).getAddress === "function"
    ? String((demos as any).getAddress())
    : "";
  const owner = ownerFromWallet || `0x${uint8ArrayToHex(publicKey)}`;

  let proxyUrl = "";
  let lastProxyError = "";
  for (let attempt = 0; attempt < TLSN_TOKEN_POLL_ATTEMPTS; attempt++) {
    const proxyResponse = await (demos as any).nodeCall("requestTLSNproxy", {
      tokenId,
      owner,
      targetUrl,
    });

    proxyUrl = String(proxyResponse?.websocketProxyUrl || "");
    if (proxyUrl) return { proxyUrl, tokenId, requestTxHash };

    const errCode = proxyResponse?.error ? String(proxyResponse.error) : "";
    const errMsg = proxyResponse?.message ? String(proxyResponse.message) : "";
    const errLast = proxyResponse?.lastError ? String(proxyResponse.lastError) : "";
    lastProxyError = [errCode, errMsg, errLast].filter(Boolean).join(" | ");

    if (attempt < TLSN_TOKEN_POLL_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, TLSN_TOKEN_POLL_INTERVAL_MS));
    }
  }

  throw new Error(
    `TLSN proxy allocation failed for token ${tokenId}` +
    (lastProxyError ? ` (${lastProxyError})` : "")
  );
}

async function storeTlsnProof(
  demos: Demos,
  tokenId: string,
  proof: string
): Promise<{ txHash: string; storageFee: number }> {
  const proofSizeKB = Math.ceil(proof.length / 1024);
  const storageFee = 1 + proofSizeKB;

  const tx = await createTlsnStoreTransaction(demos, tokenId, proof, "onchain", storageFee);
  const confirmResult = await DemosTransactions.confirm(tx, demos);
  const broadcastResult = await DemosTransactions.broadcast(confirmResult, demos);
  if ((broadcastResult as any)?.result !== 200) {
    throw new Error(`TLSN proof storage failed: ${String((broadcastResult as any)?.response?.message || "unknown broadcast error")}`);
  }

  const txHash = String((tx as any).hash || "");
  if (!txHash) throw new Error("TLSN proof storage tx hash missing");
  return { txHash, storageFee };
}

async function resolveTlsnBuildDir(): Promise<{ dir: string; wasmAssetName: string }> {
  const libPath = require.resolve("tlsn-js/build/lib.js");
  const dir = dirname(libPath);
  const files = await readdir(dir);
  const wasmAssetName = files.find((name) => /^[a-f0-9]{20}\.wasm$/i.test(name));
  if (!wasmAssetName) throw new Error("tlsn-js build wasm asset not found");
  return { dir, wasmAssetName };
}

async function startTlsnStaticServer(buildDir: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const parsed = new URL(req.url || "/", "http://127.0.0.1");
    const path = decodeURIComponent(parsed.pathname || "/");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

    if (path === "/" || path === "/bridge.html") {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html><head><meta charset="utf-8"><title>TLSN Bridge</title></head><body><script src="/lib.js"></script></body></html>`);
      return;
    }

    const abs = resolve(buildDir, `.${path}`);
    if (!abs.startsWith(buildDir) || !existsSync(abs)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    if (path.endsWith(".wasm")) res.setHeader("content-type", "application/wasm");
    else if (path.endsWith(".js")) res.setHeader("content-type", "application/javascript");
    else if (path.endsWith(".html")) res.setHeader("content-type", "text/html; charset=utf-8");
    else res.setHeader("content-type", "application/octet-stream");

    createReadStream(abs).pipe(res);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("TLSN static server failed to bind TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

async function runBrowserTlsnAttestation(
  targetUrl: string,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  proxyUrl: string,
  notaryUrl: string
): Promise<any> {
  let playwright: any;
  try {
    playwright = await import("playwright");
  } catch (err: any) {
    throw new Error(`Playwright not installed: ${String(err?.message || err)}`);
  }

  const { dir } = await resolveTlsnBuildDir();
  const server = await startTlsnStaticServer(dir);
  let browser: any = null;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(300_000); // 5 min — MPC-TLS steps can take 190-290s total
    await page.goto(`${server.baseUrl}/bridge.html`, { waitUntil: "domcontentloaded" });

    const result = await withTimeout(
      "Playwright TLSN evaluate",
      300_000, // 5 min — previous 180s was insufficient (steps sum to 190-290s)
      page.evaluate(
        async (args: {
          targetUrl: string;
          method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
          proxyUrl: string;
          notaryUrl: string;
          maxBytes: number;
        }) => {
          const w: any = window as any;
          if (typeof w.default !== "function" || !w.Prover || !w.NotaryServer || !w.Presentation) {
            throw new Error("tlsn-js globals not available in browser context");
          }

          await w.default({
            loggingLevel: "Info",
            hardwareConcurrency: navigator.hardwareConcurrency || 2,
          });

          const prover = new w.Prover({
            serverDns: new URL(args.targetUrl).hostname,
            maxSentData: args.maxBytes,
            maxRecvData: args.maxBytes,
          });

          let presentationJson: any;
          try {
            const notary = w.NotaryServer.from(args.notaryUrl);
            const sessionUrl = await notary.sessionUrl(args.maxBytes, args.maxBytes);
            await prover.setup(sessionUrl);
            await prover.sendRequest(args.proxyUrl, {
              url: args.targetUrl,
              method: args.method,
              headers: { Accept: "application/json" },
            });
            const transcript = await prover.transcript();
            if (!Array.isArray(transcript?.recv) || transcript.recv.length === 0) {
              throw new Error("TLSN transcript response is empty");
            }

            const commitRanges = {
              sent: [{ start: 0, end: transcript.sent.length }],
              recv: [{ start: 0, end: transcript.recv.length }],
            };
            const notarized = await prover.notarize(commitRanges);
            const presentation = new w.Presentation({
              attestationHex: notarized.attestation,
              secretsHex: notarized.secrets,
              notaryUrl: notarized.notaryUrl || args.notaryUrl,
              websocketProxyUrl: notarized.websocketProxyUrl || args.proxyUrl,
              reveal: { ...commitRanges, server_identity: true },
            });
            try {
              presentationJson = await presentation.json();
            } finally {
              await presentation.free();
            }
          } finally {
            await prover.free();
          }

          return presentationJson;
        },
        {
          targetUrl,
          method,
          proxyUrl,
          notaryUrl,
          maxBytes: TLSN_MAX_BYTES,
        }
      )
    );

    return result;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // non-fatal
      }
    }
    await server.close();
  }
}

export async function attestTlsnViaPlaywrightBridge(
  demos: Demos,
  url: string,
  method: string = "GET"
): Promise<TlsnAttestPlaywrightResult> {
  const parsed = assertHttpsUrl(url);
  const httpMethod = coerceTlsnMethod(method);

  info(`TLSN token request: ${parsed.toString()}`);
  const token = await requestTlsnToken(demos, parsed.toString());
  info(`TLSN token acquired: ${token.tokenId}`);

  const notaryInfo = await (demos as any).nodeCall("tlsnotary.getInfo", {});
  const notaryRaw = String(notaryInfo?.notaryUrl || "");
  if (!notaryRaw) {
    throw new Error("TLSN notary discovery failed: node did not return notaryUrl");
  }
  const notaryUrl = normalizeNotaryUrl(notaryRaw);

  const presentationJson = await runBrowserTlsnAttestation(
    parsed.toString(),
    httpMethod,
    token.proxyUrl,
    notaryUrl
  );

  const serializedProof = JSON.stringify(presentationJson);
  const stored = await storeTlsnProof(demos, token.tokenId, serializedProof);
  info(`TLSN attested (playwright): proofTx=${stored.txHash.slice(0, 16)}...`);

  return {
    requestedUrl: parsed.toString(),
    attestedUrl: parsed.toString(),
    requestTxHash: token.requestTxHash,
    proofTxHash: stored.txHash,
    tokenId: token.tokenId,
    storageFee: stored.storageFee,
    presentation: presentationJson,
  };
}
