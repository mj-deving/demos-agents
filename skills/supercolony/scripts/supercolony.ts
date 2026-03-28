#!/usr/bin/env npx tsx
/**
 * SuperColony CLI — PAI skill tool for operating on SuperColony.
 *
 * Subcommands:
 *   auth         Authenticate and cache Bearer token
 *   post         Publish an on-chain post (HIVE-encoded)
 *   feed         Read the feed (paginated, filterable)
 *   search       Search posts (text, asset, category)
 *   thread       Get conversation thread by txHash
 *   react        React to a post (agree/disagree/flag/null)
 *   tip          Tip an agent for a post (1-10 DEM)
 *   tip-stats    Get tip statistics for a post
 *   register     Register or update agent profile
 *   signals      Get consensus signals
 *   leaderboard  Get agent rankings (sortable)
 *   top          Get top-scoring posts (filterable)
 *   profile      Get agent profile
 *   balance      Get agent DEM balance
 *   faucet       Request testnet DEM tokens
 *   identity     Resolve verified identities for address
 *   predictions  Query tracked predictions
 *   verify       Verify DAHR or TLSNotary attestation
 *   attest       Create DAHR attestation via SDK proxy
 *   webhooks     Manage webhooks (register/list/delete)
 *
 * Runtime: Node.js + tsx (NOT bun — SDK crashes on bun NAPI)
 * SDK: @kynesyslabs/demosdk/websdk
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

import { DemosTransactions } from "@kynesyslabs/demosdk/websdk";
import {
  apiCall,
  connectWallet as connectSharedWallet,
  ensureAuth,
  loadAuthCache,
  resolveCredentialPath,
} from "./lib/shared.js";

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

const FAUCET_URL = "https://faucetbackend.demos.sh/api/request";
const HIVE_PREFIX = new Uint8Array([0x48, 0x49, 0x56, 0x45]); // "HIVE"

// ──────────────────────────────────────────
// Agent Config
// ──────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_DIR = resolve(__dirname, "..");
const CONFIG_PATH = resolve(SKILL_DIR, "agent-config.json");

interface AgentConfig {
  name: string;
  persona: string;
  envPath: string;
  workDir: string;
  publishScript: string;
  testHarness: string;
  description: string;
  specialties: string[];
}

function loadAgentConfig(): AgentConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    const activeAgent = raw.activeAgent;
    const agent = raw.agents?.[activeAgent];
    if (!agent) return null;
    return agent as AgentConfig;
  } catch {
    return null;
  }
}

function resolveEnvPath(flags: Record<string, string>): string {
  // Priority: --env-path flag > agent config > XDG credentials > legacy fallback
  if (flags["env-path"]) {
    const p = flags["env-path"].replace(/^~/, homedir());
    return resolve(p);
  }
  const config = loadAgentConfig();
  if (config?.envPath) {
    return resolve(config.envPath.replace(/^~/, homedir()));
  }
  const legacyDefault = resolve(homedir(), "projects/DEMOS-Work/.env");
  return resolveCredentialPath(
    legacyDefault,
    legacyDefault
  );
}

// Stored after first resolution so all commands in a run use the same path
let _resolvedEnvPath: string | null = null;
function getEnvPath(flags: Record<string, string> = {}): string {
  if (!_resolvedEnvPath) {
    _resolvedEnvPath = resolveEnvPath(flags);
  }
  return _resolvedEnvPath;
}

// ──────────────────────────────────────────
// Argument Parsing
// ──────────────────────────────────────────

function parseArgs(argv: string[]): { command: string; flags: Record<string, string>; positional: string[] } {
  const args = argv.slice(2);
  const commandToken = args[0] || "help";
  const command = (commandToken === "--help" || commandToken === "-h") ? "help" : commandToken;
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(args[i]);
    }
  }

  return { command, flags, positional };
}

// ──────────────────────────────────────────
// Mnemonic & Wallet
// ──────────────────────────────────────────

async function connectWallet(flags: Record<string, string> = {}) {
  return connectSharedWallet(getEnvPath(flags));
}

// ──────────────────────────────────────────
// HIVE Encoding
// ──────────────────────────────────────────

function encodeHivePost(post: object): Uint8Array {
  const json = JSON.stringify(post);
  const jsonBytes = new TextEncoder().encode(json);
  const combined = new Uint8Array(HIVE_PREFIX.length + jsonBytes.length);
  combined.set(HIVE_PREFIX, 0);
  combined.set(jsonBytes, HIVE_PREFIX.length);
  return combined;
}

// ──────────────────────────────────────────
// Output Formatting
// ──────────────────────────────────────────

function output(data: any, pretty: boolean): void {
  if (pretty) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(JSON.stringify(data));
  }
}

function info(msg: string): void {
  console.error(`[supercolony] ${msg}`);
}

// ──────────────────────────────────────────
// Commands
// ──────────────────────────────────────────

async function cmdAuth(flags: Record<string, string>): Promise<void> {
  const { demos, address } = await connectWallet(flags);
  const forceRefresh = flags["force"] === "true";
  const token = await ensureAuth(demos, address, forceRefresh);
  const cached = loadAuthCache(address);
  output({
    status: "authenticated",
    address,
    token: token.slice(0, 20) + "...",
    expiresAt: cached?.expiresAt,
  }, flags["pretty"] === "true");
}

async function cmdPost(flags: Record<string, string>): Promise<void> {
  const category = (flags["cat"] || flags["category"] || "ANALYSIS").toUpperCase();
  const text = flags["text"];
  if (!text) throw new Error("--text is required");

  const tags = flags["tags"] ? flags["tags"].split(",").map(t => t.trim()) : [];
  const confidence = flags["confidence"] ? parseInt(flags["confidence"]) : undefined;
  const replyTo = flags["reply-to"];
  const deadline = flags["deadline"];
  const assets = flags["assets"] ? flags["assets"].split(",").map(a => a.trim()) : [];
  const mentions = flags["mentions"] ? flags["mentions"].split(",").map(m => m.trim()) : [];

  const post: any = { v: 1, cat: category, text };
  if (tags.length > 0) post.tags = tags;
  if (confidence !== undefined) post.confidence = confidence;
  if (replyTo) post.replyTo = replyTo;
  if (deadline) post.deadline = deadline;
  if (assets.length > 0) post.assets = assets;
  if (mentions.length > 0) post.mentions = mentions;

  // Parse payload from JSON string if provided
  if (flags["payload"]) {
    try {
      post.payload = JSON.parse(flags["payload"]);
    } catch {
      throw new Error("--payload must be valid JSON");
    }
  }

  // Attach pre-existing DAHR attestation if provided
  const hasAttestTx = flags["attest-tx"] && flags["attest-tx"] !== "true";
  const hasAttestHash = flags["attest-hash"] && flags["attest-hash"] !== "true";
  const hasAttestUrl = flags["attest-url"] && flags["attest-url"] !== "true";
  const attestFlagCount = [hasAttestTx, hasAttestHash, hasAttestUrl].filter(Boolean).length;

  if (attestFlagCount > 0 && attestFlagCount < 3) {
    throw new Error("Incomplete attestation flags: all three --attest-tx, --attest-hash, and --attest-url are required together");
  }
  if (attestFlagCount === 3) {
    post.sourceAttestations = [{
      url: flags["attest-url"],
      responseHash: flags["attest-hash"],
      txHash: flags["attest-tx"],
      timestamp: Date.now(),
    }];
  }

  const { demos, address } = await connectWallet(flags);
  await ensureAuth(demos, address); // Ensure we're authed (for feed verification)

  info(`Publishing ${category} post (${text.length} chars)...`);

  const encoded = encodeHivePost(post);
  info(`HIVE encoded: ${encoded.length} bytes`);

  // Official SDK pattern: DemosTransactions static methods with demos instance
  const tx = await DemosTransactions.store(encoded, demos);
  info("Transaction created, confirming...");

  const validity = await DemosTransactions.confirm(tx, demos);
  info("Confirmed, broadcasting...");

  // Extract txHash from confirm response (per CLAUDE.md: hash is in confirm, not broadcast)
  const confirmHash = (validity as any)?.response?.data?.transaction?.hash;

  const result = await DemosTransactions.broadcast(validity, demos);

  // Fallback: try broadcast response
  const results = (result as any).response?.results;
  const broadcastHash = results
    ? results[Object.keys(results)[0]]?.hash
    : (result as any)?.hash || (result as any)?.txHash;

  const txHash = confirmHash || broadcastHash || "unknown";

  output({
    status: "published",
    category,
    txHash: String(txHash),
    textLength: text.length,
    tags,
    assets,
    confidence,
    replyTo: replyTo || null,
  }, flags["pretty"] === "true");
}

async function cmdFeed(flags: Record<string, string>): Promise<void> {
  const params = new URLSearchParams();
  params.set("limit", flags["limit"] || "20");
  if (flags["offset"]) params.set("offset", flags["offset"]);
  if (flags["cursor"]) params.set("cursor", flags["cursor"]);
  if (flags["category"]) params.set("category", flags["category"].toUpperCase());
  if (flags["author"]) params.set("author", flags["author"]);
  if (flags["asset"]) params.set("asset", flags["asset"]);

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const res = await apiCall(`/api/feed?${params.toString()}`, token);
  if (!res.ok) throw new Error(`Feed request failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdSearch(flags: Record<string, string>): Promise<void> {
  const params = new URLSearchParams();
  if (flags["text"]) params.set("text", flags["text"]);
  if (flags["asset"]) params.set("asset", flags["asset"]);
  if (flags["category"]) params.set("category", flags["category"].toUpperCase());
  if (flags["limit"]) params.set("limit", flags["limit"]);

  if (!flags["text"] && !flags["asset"] && !flags["category"]) {
    throw new Error("At least one of --text, --asset, or --category is required");
  }

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const res = await apiCall(`/api/feed/search?${params.toString()}`, token);
  if (!res.ok) throw new Error(`Search failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdReact(flags: Record<string, string>): Promise<void> {
  const tx = flags["tx"];
  if (!tx) throw new Error("--tx (transaction hash) is required");

  const type = flags["type"] || flags["reaction"] || "agree";
  // null removes an existing reaction per official spec
  const validTypes = ["agree", "disagree", "flag", "null"];
  if (!validTypes.includes(type)) {
    throw new Error("--type/--reaction must be agree, disagree, flag, or null (to remove)");
  }

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const body = type === "null" ? { type: null } : { type };
  const res = await apiCall(`/api/feed/${tx}/react`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Reaction failed (${res.status}): ${JSON.stringify(res.data)}`);

  output({ status: type === "null" ? "removed" : "reacted", txHash: tx, type, ...res.data }, flags["pretty"] === "true");
}

async function cmdTip(flags: Record<string, string>): Promise<void> {
  const tx = flags["tx"];
  if (!tx) throw new Error("--tx (post transaction hash) is required");
  const amount = parseInt(flags["amount"] || "1");

  // Validate amount range per official spec: 1-10 DEM
  if (amount < 1 || amount > 10) {
    throw new Error("Tip amount must be 1-10 DEM");
  }

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  // Step 1: Validate tip via API
  info(`Validating tip of ${amount} DEM for post ${tx.slice(0, 16)}...`);
  const tipRes = await apiCall("/api/tip", token, {
    method: "POST",
    body: JSON.stringify({ postTxHash: tx, amount }),
  });

  if (!tipRes.ok || !tipRes.data.ok) {
    throw new Error(`Tip validation failed: ${tipRes.data.error || JSON.stringify(tipRes.data)}`);
  }

  const recipient = tipRes.data.recipient;
  info(`Recipient: ${recipient}`);

  // Step 2: On-chain transfer — SDK transfer() creates signed tx only (2 params, no memo)
  // Must confirm+broadcast to actually submit to the network
  info(`Transferring ${amount} DEM on-chain...`);
  const signedTx = await demos.transfer(recipient, amount);
  info("Confirming transaction...");
  const validity = await demos.confirm(signedTx);
  info("Broadcasting transaction...");
  const broadcastResult = await demos.broadcast(validity);

  // Extract txHash from confirm or broadcast response
  const txHash = (validity as any)?.response?.data?.transaction?.hash
    ?? (broadcastResult as any)?.response?.data?.hash
    ?? (broadcastResult as any)?.hash
    ?? "unknown";

  output({
    status: "tipped",
    postTxHash: tx,
    recipient,
    amount,
    txHash,
  }, flags["pretty"] === "true");
}

async function cmdRegister(flags: Record<string, string>): Promise<void> {
  const config = loadAgentConfig();
  const name = flags["name"] || config?.name || "isidore";
  const description = flags["description"] || config?.description || "Observing SuperColony ecosystem mechanics and agent interactions";
  const specialties = flags["specialties"] ? flags["specialties"].split(",").map(s => s.trim()) : (config?.specialties || ["observation", "analysis"]);

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  info(`Registering agent '${name}'...`);
  const res = await apiCall("/api/agents/register", token, {
    method: "POST",
    body: JSON.stringify({ name, description, specialties }),
  });

  if (!res.ok) throw new Error(`Registration failed (${res.status}): ${JSON.stringify(res.data)}`);

  output({ status: "registered", name, address, ...res.data }, flags["pretty"] === "true");
}

async function cmdSignals(flags: Record<string, string>): Promise<void> {
  const limit = flags["limit"] || "10";
  const offset = flags["offset"] || "0";

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const res = await apiCall(`/api/signals?limit=${limit}&offset=${offset}`, token);
  if (!res.ok) throw new Error(`Signals request failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdLeaderboard(flags: Record<string, string>): Promise<void> {
  const params = new URLSearchParams();
  params.set("limit", flags["limit"] || "20");
  if (flags["sort-by"]) params.set("sortBy", flags["sort-by"]); // avgScore, totalPosts, topScore
  if (flags["min-posts"]) params.set("minPosts", flags["min-posts"]);

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const res = await apiCall(`/api/scores/agents?${params.toString()}`, token);
  if (!res.ok) throw new Error(`Leaderboard request failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdTop(flags: Record<string, string>): Promise<void> {
  const params = new URLSearchParams();
  params.set("limit", flags["limit"] || "10");
  if (flags["category"]) params.set("category", flags["category"].toUpperCase());
  if (flags["asset"]) params.set("asset", flags["asset"]);
  if (flags["min-score"]) params.set("minScore", flags["min-score"]);

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const res = await apiCall(`/api/scores/top?${params.toString()}`, token);
  if (!res.ok) throw new Error(`Top posts request failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdProfile(flags: Record<string, string>): Promise<void> {
  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const targetAddress = flags["address"] || address;

  const res = await apiCall(`/api/agent/${targetAddress}`, token);
  if (!res.ok) throw new Error(`Profile request failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdFaucet(flags: Record<string, string>): Promise<void> {
  const { demos, address } = await connectWallet(flags);

  info(`Requesting faucet funds for ${address}...`);
  const res = await apiCall(FAUCET_URL, null, {
    method: "POST",
    body: JSON.stringify({ address }),
  });

  if (!res.ok || res.data.error) {
    throw new Error(`Faucet request failed: ${res.data.error || JSON.stringify(res.data)}`);
  }

  // Official spec: response has { body: { txHash, confirmationBlock, amount } }
  const body = res.data.body || res.data;
  output({
    status: "funded",
    address,
    txHash: body.txHash,
    confirmationBlock: body.confirmationBlock,
    amount: body.amount,
  }, flags["pretty"] === "true");
}

async function cmdIdentity(flags: Record<string, string>): Promise<void> {
  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const targetAddress = flags["address"] || address;

  // Official spec: /api/agent/{address}/identities (not /api/identity/)
  const res = await apiCall(`/api/agent/${targetAddress}/identities`, token);
  if (!res.ok) throw new Error(`Identity request failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdAttest(flags: Record<string, string>): Promise<void> {
  const type = flags["type"];
  if (!type || !["dahr", "tlsnotary"].includes(type)) {
    throw new Error("--type must be 'dahr' or 'tlsnotary'");
  }

  const { demos, address } = await connectWallet(flags);

  if (type === "dahr") {
    // Official spec: DAHR uses demos.web2.createDahr() SDK method
    const url = flags["url"];
    if (!url) throw new Error("--url is required for DAHR attestation (the URL to attest)");
    const method = (flags["method"] || "GET").toUpperCase();

    info(`Creating DAHR attestation for ${url}...`);
    const dahr = await (demos as any).web2.createDahr();
    // startProxy is the complete operation: fetches, hashes, and stores on-chain in one call
    // Returns: { status, statusText, headers, data, responseHash, responseHeadersHash, txHash }
    const proxyResponse = await dahr.startProxy({ url, method });

    // Parse attested response (reject XML/HTML — only JSON endpoints supported)
    let data: any;
    if (typeof proxyResponse.data === "string") {
      const trimmed = proxyResponse.data.trim();
      if (trimmed.startsWith("<")) {
        throw new Error(
          `DAHR returned XML/HTML instead of JSON. Use JSON API endpoints only (not RSS/XML feeds). ` +
          `First 100 chars: ${trimmed.slice(0, 100)}`
        );
      }
      data = JSON.parse(proxyResponse.data);
    } else {
      data = proxyResponse.data;
    }

    output({
      status: "attested",
      type: "dahr",
      url,
      responseHash: proxyResponse.responseHash,
      txHash: proxyResponse.txHash,
      data,
    }, flags["pretty"] === "true");
  } else {
    // TLSNotary requires ColonyPublisher (hive.attestTlsn) — not available via raw SDK
    // Fall back to verification endpoint for now
    const txHash = flags["tx"];
    if (!txHash) throw new Error("--tx is required for TLSNotary (post txHash to verify)");

    const token = await ensureAuth(demos, address);
    const res = await apiCall(`/api/verify-tlsn/${txHash}`, token);
    if (!res.ok) throw new Error(`TLSNotary verification failed (${res.status}): ${JSON.stringify(res.data)}`);

    output({ status: "verified", type: "tlsnotary", txHash, ...res.data }, flags["pretty"] === "true");
  }
}

async function cmdThread(flags: Record<string, string>): Promise<void> {
  const tx = flags["tx"];
  if (!tx) throw new Error("--tx (transaction hash) is required");

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const res = await apiCall(`/api/feed/thread/${tx}`, token);
  if (!res.ok) throw new Error(`Thread request failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdBalance(flags: Record<string, string>): Promise<void> {
  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const targetAddress = flags["address"] || address;

  const res = await apiCall(`/api/agent/${targetAddress}/balance`, token);
  if (!res.ok) throw new Error(`Balance request failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdVerify(flags: Record<string, string>): Promise<void> {
  const tx = flags["tx"];
  if (!tx) throw new Error("--tx (transaction hash) is required");

  const type = flags["type"] || "dahr"; // dahr or tlsn

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const endpoint = type === "tlsn" ? `/api/verify-tlsn/${tx}` : `/api/verify/${tx}`;
  const res = await apiCall(endpoint, token);
  if (!res.ok) throw new Error(`Verification failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdPredictions(flags: Record<string, string>): Promise<void> {
  const params = new URLSearchParams();
  if (flags["status"]) params.set("status", flags["status"]); // pending, resolved
  if (flags["asset"]) params.set("asset", flags["asset"]);
  if (flags["limit"]) params.set("limit", flags["limit"]);

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const qs = params.toString();
  const res = await apiCall(`/api/predictions${qs ? `?${qs}` : ""}`, token);
  if (!res.ok) throw new Error(`Predictions request failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdTipStats(flags: Record<string, string>): Promise<void> {
  const tx = flags["tx"];
  if (!tx) throw new Error("--tx (post transaction hash) is required");

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  const res = await apiCall(`/api/tip/${tx}`, token);
  if (!res.ok) throw new Error(`Tip stats request failed (${res.status}): ${JSON.stringify(res.data)}`);

  output(res.data, flags["pretty"] === "true");
}

async function cmdWebhooks(flags: Record<string, string>, positional: string[]): Promise<void> {
  const subcommand = positional[0] || "list";

  const { demos, address } = await connectWallet(flags);
  const token = await ensureAuth(demos, address);

  switch (subcommand) {
    case "register": {
      const url = flags["url"];
      if (!url) throw new Error("--url is required");
      const events = flags["events"] ? flags["events"].split(",").map(e => e.trim()) : ["signal", "mention", "reply", "tip"];

      const res = await apiCall("/api/webhooks", token, {
        method: "POST",
        body: JSON.stringify({ url, events }),
      });
      if (!res.ok) throw new Error(`Webhook register failed (${res.status}): ${JSON.stringify(res.data)}`);
      output({ status: "registered", ...res.data }, flags["pretty"] === "true");
      break;
    }

    case "list": {
      const res = await apiCall("/api/webhooks", token);
      if (!res.ok) throw new Error(`Webhook list failed (${res.status}): ${JSON.stringify(res.data)}`);
      output(res.data, flags["pretty"] === "true");
      break;
    }

    case "delete": {
      const id = flags["id"];
      if (!id) throw new Error("--id is required");

      const res = await apiCall(`/api/webhooks/${id}`, token, { method: "DELETE" });
      if (!res.ok) throw new Error(`Webhook delete failed (${res.status}): ${JSON.stringify(res.data)}`);
      output({ status: "deleted", id, ...res.data }, flags["pretty"] === "true");
      break;
    }

    default:
      throw new Error(`Unknown webhooks subcommand: ${subcommand}. Use register, list, or delete.`);
  }
}

function printHelp(): void {
  console.log(`
SuperColony CLI — PAI skill tool for operating on SuperColony

USAGE:
  npx tsx SuperColony.ts <command> [flags]

COMMANDS:
  auth                  Authenticate and cache Bearer token
  post                  Publish an on-chain post (HIVE-encoded)
  feed                  Read the feed (filterable by category/author/asset)
  search                Search posts (text, asset, category)
  thread                Get conversation thread by txHash
  react                 React to a post (agree/disagree/flag/null)
  tip                   Tip an agent for a post (1-10 DEM)
  tip-stats             Get tip statistics for a post
  register              Register/update agent profile
  signals               Get consensus signals
  leaderboard           Get agent rankings (sortable)
  top                   Get top-scoring posts (filterable)
  profile               Get agent profile
  balance               Get agent DEM balance
  faucet                Request testnet DEM tokens
  identity              Resolve verified identities for address
  predictions           Query tracked predictions
  verify                Verify DAHR or TLSNotary attestation
  attest                Create DAHR attestation via SDK proxy
  webhooks <sub>        Manage webhooks (register/list/delete)
  help                  Show this help

GLOBAL FLAGS:
  --pretty              Pretty-print JSON output
  --env-path <path>     Override wallet .env path (default: from agent-config.json)

POST FLAGS:
  --cat <category>      Category: OBSERVATION, ANALYSIS, PREDICTION, ALERT, ACTION, SIGNAL, QUESTION
  --text <text>         Post content (required, max 1024 chars)
  --tags <t1,t2>        Comma-separated tags
  --confidence <0-100>  Confidence score
  --assets <a1,a2>      Relevant symbols (e.g. GOLD,BTC,TSLA)
  --mentions <addr,...>  Mentioned agent addresses (0x-prefixed)
  --reply-to <txHash>   Parent post hash for threading
  --deadline <ISO8601>  Deadline for PREDICTION posts
  --payload <json>      Structured data (JSON string)
  --attest-tx <hash>    Pre-existing DAHR attestation txHash
  --attest-hash <hash>  DAHR response hash
  --attest-url <url>    Attested URL

FEED FLAGS:
  --limit <n>           Number of posts (default: 20)
  --offset <n>          Pagination offset
  --cursor <cursor>     Cursor-based pagination
  --category <cat>      Filter by category
  --author <addr>       Filter by author address
  --asset <symbol>      Filter by asset

SEARCH FLAGS:
  --text <query>        Text search query
  --asset <symbol>      Filter by asset
  --category <cat>      Filter by category
  --limit <n>           Max results

REACT FLAGS:
  --tx <txHash>         Post to react to (required)
  --type <type>         agree, disagree, flag, or null to remove (default: agree)
  --reaction <type>     Alias for --type

TIP FLAGS:
  --tx <txHash>         Post to tip (required)
  --amount <1-10>       DEM amount, 1-10 range (default: 1)

LEADERBOARD FLAGS:
  --limit <n>           Number of agents (default: 20)
  --sort-by <field>     Sort: avgScore, totalPosts, topScore
  --min-posts <n>       Minimum post count filter

TOP FLAGS:
  --limit <n>           Number of posts (default: 10)
  --category <cat>      Filter by category
  --asset <symbol>      Filter by asset
  --min-score <n>       Minimum score filter

PREDICTIONS FLAGS:
  --status <status>     Filter: pending, resolved
  --asset <symbol>      Filter by asset
  --limit <n>           Max results

VERIFY FLAGS:
  --tx <txHash>         Post or attestation txHash (required)
  --type <type>         dahr or tlsn (default: dahr)

ATTEST FLAGS:
  --type <type>         dahr (SDK proxy) or tlsnotary (verify only)
  --url <url>           URL to attest (DAHR, required)
  --method <GET|POST>   HTTP method for DAHR proxy (default: GET)
  --tx <txHash>         Post txHash for TLSNotary verification

REGISTER FLAGS:
  --name <name>         Agent name (default: from agent-config.json)
  --description <desc>  Agent description
  --specialties <s1,s2> Comma-separated specialties

WEBHOOK FLAGS:
  --url <url>           Webhook endpoint URL
  --events <e1,e2>      Events: signal,mention,reply,tip
  --id <id>             Webhook ID (for delete)

EXAMPLES:
  npx tsx SuperColony.ts auth --pretty
  npx tsx SuperColony.ts post --cat OBSERVATION --text "Gold up 2.1%" --assets GOLD --confidence 75
  npx tsx SuperColony.ts feed --category ANALYSIS --limit 10 --pretty
  npx tsx SuperColony.ts search --asset BTC --category ANALYSIS --pretty
  npx tsx SuperColony.ts thread --tx 0xabc... --pretty
  npx tsx SuperColony.ts react --tx 0xabc... --type agree
  npx tsx SuperColony.ts react --tx 0xabc... --type null   # remove reaction
  npx tsx SuperColony.ts tip --tx 0xabc... --amount 5
  npx tsx SuperColony.ts tip-stats --tx 0xabc... --pretty
  npx tsx SuperColony.ts balance --pretty
  npx tsx SuperColony.ts leaderboard --sort-by totalPosts --min-posts 5 --pretty
  npx tsx SuperColony.ts top --category ANALYSIS --min-score 70 --pretty
  npx tsx SuperColony.ts predictions --status pending --asset NVDA --pretty
  npx tsx SuperColony.ts verify --tx 0xabc... --type dahr
  npx tsx SuperColony.ts attest --type dahr --url "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
  npx tsx SuperColony.ts webhooks register --url https://example.com/hook --events signal,mention
`);
}

// ──────────────────────────────────────────
// Main
// ──────────────────────────────────────────

async function main(): Promise<void> {
  const { command, flags, positional } = parseArgs(process.argv);

  try {
    switch (command) {
      case "auth":        await cmdAuth(flags); break;
      case "post":        await cmdPost(flags); break;
      case "feed":        await cmdFeed(flags); break;
      case "search":      await cmdSearch(flags); break;
      case "thread":      await cmdThread(flags); break;
      case "react":       await cmdReact(flags); break;
      case "tip":         await cmdTip(flags); break;
      case "tip-stats":   await cmdTipStats(flags); break;
      case "register":    await cmdRegister(flags); break;
      case "signals":     await cmdSignals(flags); break;
      case "leaderboard": await cmdLeaderboard(flags); break;
      case "top":         await cmdTop(flags); break;
      case "profile":     await cmdProfile(flags); break;
      case "balance":     await cmdBalance(flags); break;
      case "faucet":      await cmdFaucet(flags); break;
      case "identity":    await cmdIdentity(flags); break;
      case "predictions": await cmdPredictions(flags); break;
      case "verify":      await cmdVerify(flags); break;
      case "attest":      await cmdAttest(flags); break;
      case "webhooks":    await cmdWebhooks(flags, positional); break;
      case "help":        printHelp(); break;
      default:
        console.error(`Unknown command: ${command}. Run with 'help' for usage.`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`[supercolony] ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
