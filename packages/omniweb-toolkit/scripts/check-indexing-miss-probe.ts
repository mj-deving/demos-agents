#!/usr/bin/env npx tsx

import { resolve } from "node:path";
import { connectWallet } from "../../../src/lib/network/sdk.js";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "../../../src/toolkit/sdk-bridge.js";
import { decodeHiveData } from "../../../src/toolkit/hive-codec.js";
import { safeParse } from "../../../src/toolkit/guards/state-helpers.js";
import {
  DEFAULT_BASE_URL,
  fetchText,
  getNumberArg,
  getStringArg,
  hasFlag,
  loadToken,
} from "./_shared.js";

const DEFAULT_RANGE_START = 2109130;
const DEFAULT_RANGE_END = 2109145;
const PAGE_SIZE = 500;
const MAX_PAGES = 8;
const FEED_LIMIT = 250;

const INDEXED_TX = "44f24253af2b871a87055ee0e786ee8f93de045fdd01e547a1b6abd445460d21";
const MISSING_TXS = [
  "835a6c5cf1515ac80ceb9077af63f1e07b5bff6f53fe0ed42df5ceda502d85b2",
  "a4edc4422edc2c7f565f74945b6f327141685430df7398090d7ad31898ce8f18",
  "fd868d540661e1e3316151f3272de9f21adb1ae2244da1f8095ecc19db5a6289",
] as const;

interface RawSdkTx {
  id: number;
  hash: string;
  blockNumber: number;
  status: string;
  from: string;
  to: string;
  type: string;
  content: string;
  timestamp: number;
}

interface TxByHash {
  hash: string;
  blockNumber: number;
  status: string;
  content: {
    from: string;
    to: string;
    type: string;
    data: unknown;
    timestamp: number;
  };
}

interface NormalizedHiveTx {
  txHash: string;
  blockNumber: number;
  status: string;
  author: string | null;
  type: string | null;
  timestamp: number | null;
  wrapper: "storage-array" | "direct" | "unknown";
  rawContentKeys: string[];
  rawDataKind: string;
  hiveKeys: string[];
  hiveEntries: Array<[string, string]>;
}

function printHelp(): void {
  console.log(`
Usage:
  node --import tsx packages/omniweb-toolkit/scripts/check-indexing-miss-probe.ts [flags]

Flags:
  --env PATH           Path to env file for wallet connection (default: .env)
  --base-url URL       SuperColony API base URL (default: ${DEFAULT_BASE_URL})
  --range-start N      Lower block bound (default: ${DEFAULT_RANGE_START})
  --range-end N        Upper block bound (default: ${DEFAULT_RANGE_END})
  --json               Print compact JSON
  --help               Show help
`);
}

function parseArgs(args: string[]) {
  if (hasFlag(args, "--help")) {
    printHelp();
    process.exit(0);
  }

  return {
    envPath: resolve(getStringArg(args, "--env") ?? ".env"),
    baseUrl: getStringArg(args, "--base-url") ?? DEFAULT_BASE_URL,
    rangeStart: getNumberArg(args, "--range-start") ?? DEFAULT_RANGE_START,
    rangeEnd: getNumberArg(args, "--range-end") ?? DEFAULT_RANGE_END,
    json: hasFlag(args, "--json"),
  };
}

function decodeHivePayload(data: unknown): { wrapper: NormalizedHiveTx["wrapper"]; hive: Record<string, unknown> | null } {
  const wrapper = Array.isArray(data) && data[0] === "storage"
    ? "storage-array"
    : data != null
      ? "direct"
      : "unknown";
  const candidate = wrapper === "storage-array" ? data[1] : data;
  const hive = decodeHiveData(candidate);
  return { wrapper, hive };
}

function normalizeValue(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => normalizeValue(entry)).join(", ")}]`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function normalizeTxByHash(tx: TxByHash): NormalizedHiveTx {
  const rawData = tx.content?.data;
  const { wrapper, hive } = decodeHivePayload(rawData);
  return {
    txHash: tx.hash,
    blockNumber: tx.blockNumber,
    status: tx.status,
    author: typeof tx.content?.from === "string" ? tx.content.from : null,
    type: typeof tx.content?.type === "string" ? tx.content.type : null,
    timestamp: typeof tx.content?.timestamp === "number" ? tx.content.timestamp : null,
    wrapper,
    rawContentKeys: Object.keys(tx.content ?? {}),
    rawDataKind: Array.isArray(rawData) ? "array" : typeof rawData,
    hiveKeys: hive ? Object.keys(hive) : [],
    hiveEntries: hive
      ? Object.entries(hive).map(([key, value]) => [key, normalizeValue(value)] as [string, string])
      : [],
  };
}

function parseRawHiveTx(tx: RawSdkTx): NormalizedHiveTx | null {
  if (tx.type !== "storage" || typeof tx.content !== "string") return null;
  const parsed = safeParse(tx.content) as Record<string, unknown> | null;
  if (!parsed) return null;
  const rawData = parsed.data;
  const { wrapper, hive } = decodeHivePayload(rawData);
  if (!hive || hive.action) return null;

  return {
    txHash: tx.hash,
    blockNumber: tx.blockNumber,
    status: tx.status,
    author: typeof tx.from === "string" ? tx.from : null,
    type: tx.type,
    timestamp: typeof tx.timestamp === "number" ? tx.timestamp : null,
    wrapper,
    rawContentKeys: Object.keys(parsed),
    rawDataKind: Array.isArray(rawData) ? "array" : typeof rawData,
    hiveKeys: Object.keys(hive),
    hiveEntries: Object.entries(hive).map(([key, value]) => [key, normalizeValue(value)] as [string, string]),
  };
}

function summarizeDifference(a: NormalizedHiveTx, b: NormalizedHiveTx) {
  const keysA = new Set(a.hiveKeys);
  const keysB = new Set(b.hiveKeys);
  return {
    wrapperPair: [a.wrapper, b.wrapper],
    rawDataKinds: [a.rawDataKind, b.rawDataKind],
    onlyInA: a.hiveKeys.filter((key) => !keysB.has(key)),
    onlyInB: b.hiveKeys.filter((key) => !keysA.has(key)),
    sharedDifferentValues: a.hiveEntries.flatMap(([key, value]) => {
      const other = b.hiveEntries.find(([otherKey]) => otherKey === key);
      if (!other || other[1] === value) return [];
      return [{
        key,
        indexed: value,
        missing: other[1],
      }];
    }),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = loadToken();
  if (!token) {
    throw new Error("No cached auth token found in ~/.supercolony-auth.json");
  }

  const { demos, address } = await connectWallet(args.envPath);
  const bridge = createSdkBridge(demos, undefined, AUTH_PENDING_TOKEN, globalThis.fetch, undefined, {
    allowRawSdk: true,
  });
  const raw = bridge.getDemos() as unknown as {
    getTxByHash(txHash: string): Promise<TxByHash>;
    getTransactions(start?: number | "latest", limit?: number): Promise<RawSdkTx[]>;
  };

  const indexedTx = normalizeTxByHash(await raw.getTxByHash(INDEXED_TX));
  const missingTxs = await Promise.all(MISSING_TXS.map(async (txHash) => normalizeTxByHash(await raw.getTxByHash(txHash))));

  const scanned: RawSdkTx[] = [];
  let start: number | "latest" = "latest";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const pageTxs = await raw.getTransactions(start, PAGE_SIZE);
    if (!Array.isArray(pageTxs) || pageTxs.length === 0) break;
    scanned.push(...pageTxs);
    const last = pageTxs[pageTxs.length - 1];
    if (!last || last.blockNumber < args.rangeStart) break;
    start = Math.max(1, last.id - PAGE_SIZE);
  }

  const blockRangePosts = scanned
    .filter((tx) => tx.blockNumber >= args.rangeStart && tx.blockNumber <= args.rangeEnd)
    .map(parseRawHiveTx)
    .filter((tx): tx is NormalizedHiveTx => tx != null);

  const genericFeed = await fetchText(`/api/feed?limit=${FEED_LIMIT}&category=ANALYSIS`, {
    baseUrl: args.baseUrl,
    token,
    accept: "application/json",
  });
  const authorFeed = await fetchText(
    `/api/feed?limit=${FEED_LIMIT}&category=ANALYSIS&author=${encodeURIComponent(address)}`,
    {
      baseUrl: args.baseUrl,
      token,
      accept: "application/json",
    },
  );

  const genericBody = safeParse(genericFeed.body) as { posts?: Array<{ txHash?: string }> } | null;
  const authorBody = safeParse(authorFeed.body) as { posts?: Array<{ txHash?: string }> } | null;
  const genericHashes = new Set((genericBody?.posts ?? []).map((post) => String(post.txHash ?? "")));
  const authorHashes = new Set((authorBody?.posts ?? []).map((post) => String(post.txHash ?? "")));

  const readbackChecks = await Promise.all(
    MISSING_TXS.map(async (txHash) => {
      const postDetail = await fetchText(`/api/post/${encodeURIComponent(txHash)}`, {
        baseUrl: args.baseUrl,
        token,
        accept: "application/json",
      });
      const tx = txHash === indexedTx.txHash ? indexedTx : missingTxs.find((entry) => entry.txHash === txHash) ?? null;
      return {
        txHash,
        ageHours: tx?.timestamp != null
          ? Number((((Date.now() - tx.timestamp) / (1000 * 60 * 60))).toFixed(2))
          : null,
        postDetailStatus: postDetail.status,
        postDetailOk: postDetail.ok,
        inGenericAnalysisFeed: genericHashes.has(txHash),
        inAuthorAnalysisFeed: authorHashes.has(txHash),
      };
    }),
  );

  const output = {
    generatedAt: new Date().toISOString(),
    walletAddress: address,
    indexedReference: indexedTx,
    missingComparisons: missingTxs.map((missing) => ({
      missing,
      differenceFromIndexed: summarizeDifference(indexedTx, missing),
    })),
    blockRangePosts: blockRangePosts.map((post) => ({
      txHash: post.txHash,
      blockNumber: post.blockNumber,
      author: post.author,
      hiveKeys: post.hiveKeys,
      inGenericAnalysisFeed: genericHashes.has(post.txHash),
      inAuthorAnalysisFeed: authorHashes.has(post.txHash),
    })),
    missingReadbackChecks: readbackChecks,
  };

  if (args.json) {
    console.log(JSON.stringify(output));
    return;
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
