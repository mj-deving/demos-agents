import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Demos, DemosTransactions } from "@kynesyslabs/demosdk/websdk";
import { info } from "./sdk.js";

const require = createRequire(import.meta.url);
const TLSN_MAX_BYTES = 16_384;
const TLSN_TOKEN_POLL_ATTEMPTS = 30;
const TLSN_TOKEN_POLL_INTERVAL_MS = 1000;

type TlsnJsModule = {
  default: (opts?: { loggingLevel?: "Debug" | "Info" | "Warn" | "Error"; hardwareConcurrency?: number }) => Promise<void>;
  Prover: new (config: {
    serverDns: string;
    maxSentData?: number;
    maxRecvData?: number;
  }) => {
    setup(url: string): Promise<void>;
    sendRequest(
      wsProxyUrl: string,
      request: { url: string; method?: string; headers?: Record<string, string>; body?: unknown }
    ): Promise<{ status: number; headers: Record<string, string> }>;
    transcript(): Promise<{ sent: number[]; recv: number[] }>;
    notarize(commit: { sent: Array<{ start: number; end: number }>; recv: Array<{ start: number; end: number }> }): Promise<{
      attestation: string;
      secrets: string;
      notaryUrl?: string;
      websocketProxyUrl?: string;
    }>;
    free(): Promise<void>;
  };
  NotaryServer: {
    from(url: string): {
      sessionUrl(maxSentData?: number, maxRecvData?: number): Promise<string>;
    };
  };
  Presentation: new (params: {
    attestationHex: string;
    secretsHex: string;
    notaryUrl?: string;
    websocketProxyUrl?: string;
    reveal: {
      sent: Array<{ start: number; end: number }>;
      recv: Array<{ start: number; end: number }>;
      server_identity: boolean;
    };
  }) => {
    json(): Promise<any>;
    free(): Promise<void>;
  };
};

export interface TlsnAttestBridgeResult {
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

async function prepareTlsnRuntimeLayout(
  tlsnBuildDir: string
): Promise<{ spawnJsDir: string; workerAssetName: string; wasmAssetName: string }> {
  const snippetsRoot = resolve(tlsnBuildDir, "snippets");
  const snippetDirs = await readdir(snippetsRoot, { withFileTypes: true });
  const spawnDir = snippetDirs.find((d) => d.isDirectory() && d.name.startsWith("web-spawn-"));
  if (!spawnDir) {
    throw new Error("TLSN snippets directory not found (web-spawn-*)");
  }
  const spawnJsDir = resolve(snippetsRoot, spawnDir.name, "js");

  const buildFiles = await readdir(tlsnBuildDir);
  const workerAssetName = buildFiles.find((name) => /^[a-f0-9]{20}\.js$/i.test(name));
  const wasmAssetName = buildFiles.find((name) => /^[a-f0-9]{20}\.wasm$/i.test(name));
  if (!workerAssetName || !wasmAssetName) {
    throw new Error("TLSN build assets not found (hashed worker/wasm)");
  }

  // Worker expects to be colocated with spawn.js under snippets/.../js.
  const workerTarget = resolve(spawnJsDir, workerAssetName);
  try {
    await copyFile(resolve(tlsnBuildDir, workerAssetName), workerTarget);
  } catch {
    // Non-fatal if already present and immutable.
  }
  await patchWorkerScriptForFileFetch(workerTarget);
  await patchWorkerScriptForFileFetch(resolve(spawnJsDir, "spawn.js"));

  return { spawnJsDir, workerAssetName, wasmAssetName };
}

async function patchWorkerScriptForFileFetch(filePath: string): Promise<void> {
  let src = "";
  try {
    src = await readFile(filePath, "utf-8");
  } catch {
    return;
  }
  if (src.includes("__TLSN_FETCH_PATCH__")) return;

  const prefix = `// __TLSN_FETCH_PATCH__
import { readFile as __tlsnReadFile } from "node:fs/promises";
import { fileURLToPath as __tlsnFileURLToPath } from "node:url";
const __tlsnNativeFetch = globalThis.fetch?.bind(globalThis);
if (typeof __tlsnNativeFetch === "function") {
  globalThis.fetch = async (input, init) => {
    const raw = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : typeof input?.url === "string"
          ? input.url
          : "";
    if (raw.startsWith("file://")) {
      const bytes = await __tlsnReadFile(__tlsnFileURLToPath(raw));
      const headers = new Headers();
      if (raw.endsWith(".wasm")) headers.set("content-type", "application/wasm");
      else if (raw.endsWith(".js")) headers.set("content-type", "application/javascript");
      else headers.set("content-type", "application/octet-stream");
      return new Response(bytes, { status: 200, headers });
    }
    return __tlsnNativeFetch(input, init);
  };
}
`;

  await writeFile(filePath, `${prefix}\n${src}`, "utf-8");
}

function ensureTlsnPolyfills(
  locationDir: string,
  tlsnBuildDir: string,
  wasmAssetName: string
): void {
  const g = globalThis as any;
  if (!g.self) g.self = g;
  if (typeof g.addEventListener !== "function") g.addEventListener = () => {};
  if (typeof g.removeEventListener !== "function") g.removeEventListener = () => {};
  const dirUrl = pathToFileURL(resolve(locationDir));
  g.location = new URL(dirUrl.href.endsWith("/") ? dirUrl.href : `${dirUrl.href}/`);

  if (typeof g.Worker !== "function") {
    try {
      const workerPkg = require("web-worker");
      g.Worker = workerPkg?.default || workerPkg;
    } catch (err: any) {
      throw new Error(`TLSN runtime missing Worker implementation: ${String(err?.message || err)}`);
    }
  }

  // Node exposes navigator as read-only object in newer runtimes. Best-effort only.
  try {
    if (!g.navigator) g.navigator = { hardwareConcurrency: 2 };
    if (typeof g.navigator.hardwareConcurrency !== "number" || g.navigator.hardwareConcurrency < 1) {
      Object.defineProperty(g.navigator, "hardwareConcurrency", {
        value: 2,
        configurable: true,
      });
    }
  } catch {
    // Non-fatal: tlsn-js falls back internally.
  }

  if (!g.__tlsnFetchPatched) {
    const nativeFetch = g.fetch?.bind(g);
    if (typeof nativeFetch !== "function") {
      throw new Error("Global fetch is unavailable; TLSN runtime requires fetch");
    }
    g.fetch = async (input: any, init?: any) => {
      const raw = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : typeof input?.url === "string"
            ? input.url
            : "";

      if (raw.startsWith("file://")) {
        const requestedPath = fileURLToPath(raw);
        const remappedPath = requestedPath.endsWith(`/${wasmAssetName}`)
          ? resolve(tlsnBuildDir, wasmAssetName)
          : requestedPath;
        const bytes = await readFile(remappedPath);
        const headers = new Headers();
        if (raw.endsWith(".wasm")) headers.set("content-type", "application/wasm");
        else if (raw.endsWith(".js")) headers.set("content-type", "application/javascript");
        else headers.set("content-type", "application/octet-stream");
        return new Response(bytes, { status: 200, headers });
      }
      return nativeFetch(input, init);
    };
    g.__tlsnFetchPatched = true;
  }
}

let tlsnModCache: TlsnJsModule | null = null;

async function loadTlsnJs(): Promise<TlsnJsModule> {
  if (tlsnModCache) return tlsnModCache;
  const libPath = require.resolve("tlsn-js/build/lib.js");
  const buildDir = dirname(libPath);
  const runtime = await prepareTlsnRuntimeLayout(buildDir);
  ensureTlsnPolyfills(runtime.spawnJsDir, buildDir, runtime.wasmAssetName);
  const mod = require("tlsn-js") as TlsnJsModule;
  if (!mod || typeof mod.default !== "function" || !mod.Prover || !mod.NotaryServer || !mod.Presentation) {
    throw new Error("tlsn-js module is missing required exports (default/Prover/NotaryServer/Presentation)");
  }
  tlsnModCache = mod;
  return mod;
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
  if (!requestTxHash) {
    throw new Error("TLSN request transaction hash missing");
  }

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
    if (proxyUrl) {
      return { proxyUrl, tokenId, requestTxHash };
    }

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
  if (!txHash) {
    throw new Error("TLSN proof storage tx hash missing");
  }
  return { txHash, storageFee };
}

export async function attestTlsnViaNodeBridge(
  demos: Demos,
  url: string,
  method: string = "GET"
): Promise<TlsnAttestBridgeResult> {
  const parsed = assertHttpsUrl(url);
  const httpMethod = coerceTlsnMethod(method);
  const tlsn = await loadTlsnJs();

  info(`TLSN token request: ${parsed.toString()}`);
  const token = await requestTlsnToken(demos, parsed.toString());
  info(`TLSN token acquired: ${token.tokenId}`);

  const notaryInfo = await (demos as any).nodeCall("tlsnotary.getInfo", {});
  const notaryRaw = String(notaryInfo?.notaryUrl || "");
  if (!notaryRaw) {
    throw new Error("TLSN notary discovery failed: node did not return notaryUrl");
  }
  const notaryUrl = normalizeNotaryUrl(notaryRaw);
  info(`TLSN notary: ${notaryUrl}`);

  info("TLSN init: wasm runtime");
  await withTimeout(
    "TLSN wasm init",
    30_000,
    tlsn.default({
      loggingLevel: "Info",
      hardwareConcurrency: 1,
    })
  );
  info("TLSN init: done");

  const prover = new tlsn.Prover({
    serverDns: parsed.hostname,
    maxSentData: TLSN_MAX_BYTES,
    maxRecvData: TLSN_MAX_BYTES,
  });

  let presentationJson: any;
  try {
    const notary = tlsn.NotaryServer.from(notaryUrl);
    info("TLSN setup: requesting session");
    const sessionUrl = await withTimeout(
      "TLSN session negotiation",
      30_000,
      notary.sessionUrl(TLSN_MAX_BYTES, TLSN_MAX_BYTES)
    );
    info("TLSN setup: session acquired");
    await withTimeout("TLSN prover setup", 45_000, prover.setup(sessionUrl));
    info("TLSN setup: prover ready");

    info("TLSN request: sending target request");
    await withTimeout(
      "TLSN attested request",
      180_000, // 3 min — MPC-TLS empirically 50-120s, previous 90s cut off valid sessions
      prover.sendRequest(token.proxyUrl, {
        url: parsed.toString(),
        method: httpMethod,
        headers: { Accept: "application/json" },
      })
    );
    info("TLSN request: response received");

    const transcript = await withTimeout("TLSN transcript", 30_000, prover.transcript());
    if (!Array.isArray(transcript.sent) || !Array.isArray(transcript.recv)) {
      throw new Error("TLSN transcript unavailable");
    }
    if (transcript.recv.length === 0) {
      throw new Error("TLSN transcript contains empty response");
    }

    // Reveal full request/response transcript for strongest evidentiary value.
    const commitRanges = {
      sent: [{ start: 0, end: transcript.sent.length }],
      recv: [{ start: 0, end: transcript.recv.length }],
    };

    info("TLSN notarize: generating proof");
    const notarized = await withTimeout("TLSN notarize", 240_000, prover.notarize(commitRanges)); // 4 min — proof generation 30-60s but can spike
    info("TLSN notarize: proof generated");
    const presentation = new tlsn.Presentation({
      attestationHex: notarized.attestation,
      secretsHex: notarized.secrets,
      notaryUrl: notarized.notaryUrl || notaryUrl,
      websocketProxyUrl: notarized.websocketProxyUrl || token.proxyUrl,
      reveal: { ...commitRanges, server_identity: true },
    });
    try {
      info("TLSN presentation: serializing");
      presentationJson = await withTimeout("TLSN presentation serialization", 30_000, presentation.json());
      info("TLSN presentation: serialized");
    } finally {
      await presentation.free();
    }
  } finally {
    await prover.free();
  }

  const serializedProof = JSON.stringify(presentationJson);
  const stored = await storeTlsnProof(demos, token.tokenId, serializedProof);
  info(`TLSN attested: proofTx=${stored.txHash.slice(0, 16)}...`);

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
