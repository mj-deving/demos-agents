#!/usr/bin/env npx tsx
/**
 * api-depth-audit.ts — Fetch EVERY read endpoint and capture full response shapes.
 *
 * Uses direct HTTP fetch — no SDK, no connect(), no wallet, no RPC dependency.
 * Produces a JSON report of every field at every depth level for every endpoint.
 * This is the ground truth — what the API actually returns, not what types.ts says.
 *
 * Usage:
 *   npx tsx scripts/api-depth-audit.ts > api-depth-report.json
 *   npx tsx scripts/api-depth-audit.ts --samples > api-depth-report-with-samples.json
 *   npx tsx scripts/api-depth-audit.ts --samples --auth > api-depth-report-auth.json
 *
 * Cross-check: python3 scripts/shape-cross-check.py <report.json>
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const BASE_URL = process.env.SUPERCOLONY_API_URL ?? "https://supercolony.ai";
const CLI_ARGS = new Set(process.argv.slice(2));
const INCLUDE_SAMPLES = CLI_ARGS.has("--samples");
const ENABLE_AUTH = CLI_ARGS.has("--auth");
const AGENT_ADDR = "0x6a1104179536c23247730e3905cee5f68db432d67ec16c2db8a0d611b3b5554b";

/** Read auth token from ~/.supercolony-auth.json when --auth is passed */
function loadAuthToken(): string | null {
  if (!ENABLE_AUTH) return null;
  const authPath = resolve(homedir(), ".supercolony-auth.json");
  if (!existsSync(authPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(authPath, "utf-8"));
    return raw.token ?? null;
  } catch {
    return null;
  }
}

const AUTH_TOKEN = loadAuthToken();

interface FieldInfo {
  type: string;
  sample: unknown;
  children?: Record<string, FieldInfo>;
  arrayItemShape?: Record<string, FieldInfo>;
  count?: number;
}

/** Recursively extract the shape of any value */
function extractShape(value: unknown, depth: number = 0): FieldInfo {
  if (depth > 6) return { type: "...(max depth)", sample: null };
  if (value === null) return { type: "null", sample: null };
  if (value === undefined) return { type: "undefined", sample: undefined };
  if (typeof value === "string") return { type: "string", sample: INCLUDE_SAMPLES ? value.slice(0, 100) : "(string)" };
  if (typeof value === "number") return { type: "number", sample: INCLUDE_SAMPLES ? value : 0 };
  if (typeof value === "boolean") return { type: "boolean", sample: INCLUDE_SAMPLES ? value : false };

  if (Array.isArray(value)) {
    const info: FieldInfo = { type: "array", sample: null, count: value.length };
    if (value.length > 0) {
      info.arrayItemShape = typeof value[0] === "object" && value[0] !== null
        ? Object.fromEntries(
            Object.entries(value[0]).map(([k, v]) => [k, extractShape(v, depth + 1)])
          )
        : { _item: extractShape(value[0], depth + 1) };
    }
    return info;
  }

  if (typeof value === "object") {
    const children: Record<string, FieldInfo> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      children[k] = extractShape(v, depth + 1);
    }
    return { type: "object", sample: null, children };
  }

  return { type: typeof value, sample: String(value).slice(0, 50) };
}

/** Flatten shape to a list of dot-paths for easy reading */
function flattenShape(shape: Record<string, FieldInfo>, prefix: string = ""): string[] {
  const lines: string[] = [];
  for (const [key, info] of Object.entries(shape)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (info.type === "object" && info.children) {
      lines.push(`${path}: object`);
      lines.push(...flattenShape(info.children, path));
    } else if (info.type === "array" && info.arrayItemShape) {
      lines.push(`${path}: array[${info.count}]`);
      lines.push(...flattenShape(info.arrayItemShape, `${path}[]`));
    } else {
      const sampleStr = INCLUDE_SAMPLES && info.sample !== null && info.sample !== undefined
        ? ` = ${JSON.stringify(info.sample)}` : "";
      lines.push(`${path}: ${info.type}${sampleStr}`);
    }
  }
  return lines;
}

interface AuditResult {
  name: string;
  path: string;
  ok: boolean;
  fields: string[];
  rawData?: unknown;
  error?: string;
  httpStatus?: number;
}

async function auditEndpoint(name: string, path: string): Promise<AuditResult> {
  const url = `${BASE_URL}${path}`;
  try {
    const headers: Record<string, string> = { "Accept": "application/json" };
    if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      return { name, path, ok: false, fields: [], httpStatus: res.status, error: `Non-JSON response: ${contentType.slice(0, 60)}` };
    }

    const data = await res.json();
    if (!res.ok) {
      return { name, path, ok: false, fields: [], httpStatus: res.status, error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 100)}` };
    }

    const shape = typeof data === "object" && data !== null
      ? Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, extractShape(v)])
        )
      : { _root: extractShape(data) };

    return {
      name,
      path,
      ok: true,
      fields: flattenShape(shape),
      rawData: INCLUDE_SAMPLES ? data : undefined,
      httpStatus: res.status,
    };
  } catch (err) {
    return { name, path, ok: false, fields: [], error: (err as Error).message.slice(0, 200) };
  }
}

async function main() {
  console.error(`API Depth Audit — ${BASE_URL}`);
  console.error(`Agent address: ${AGENT_ADDR}`);
  console.error(`Auth: ${ENABLE_AUTH ? (AUTH_TOKEN ? "token loaded" : "enabled but no token found") : "disabled (use --auth)"}\n`);

  // Get a sample txHash from feed for per-post endpoints
  let sampleTx: string | null = null;
  try {
    const feedRes = await fetch(`${BASE_URL}/api/feed?limit=1`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (feedRes.ok) {
      const feedData = await feedRes.json();
      sampleTx = feedData?.posts?.[0]?.txHash ?? null;
    }
  } catch { /* non-critical */ }

  console.error(`Sample txHash: ${sampleTx?.slice(0, 16) ?? "none"}...\n`);

  const enc = encodeURIComponent;
  const endpoints: Array<{ name: string; path: string }> = [
    // ── Feed ──
    { name: "feed.getRecent", path: "/api/feed?limit=2" },
    { name: "feed.search", path: "/api/feed/search?text=bitcoin&limit=2" },
    { name: "feed.getPost", path: sampleTx ? `/api/post/${enc(sampleTx)}` : "" },
    { name: "feed.getThread", path: sampleTx ? `/api/feed/thread/${enc(sampleTx)}` : "" },

    // ── Intelligence ──
    { name: "signals.get", path: "/api/signals" },
    { name: "convergence.get", path: "/api/convergence" },
    { name: "report.get", path: "/api/report" },

    // ── Oracle ──
    { name: "oracle.get", path: "/api/oracle" },
    { name: "oracle.getFiltered", path: "/api/oracle?assets=BTC,ETH" },

    // ── Prices ──
    { name: "prices.get", path: "/api/prices?assets=BTC,ETH" },
    { name: "prices.getHistory", path: "/api/prices?asset=BTC&history=24" },

    // ── Agents ──
    { name: "agents.list", path: "/api/agents" },
    { name: "agents.getProfile", path: `/api/agent/${enc(AGENT_ADDR)}` },
    { name: "agents.getIdentities", path: `/api/agent/${enc(AGENT_ADDR)}/identities` },
    { name: "agents.getBalance", path: `/api/agent/${enc(AGENT_ADDR)}/balance` },

    // ── Scores ──
    { name: "scores.leaderboard", path: "/api/scores/agents?limit=3" },
    { name: "scores.topPosts", path: "/api/scores/top?limit=3" },

    // ── Health & Stats ──
    { name: "health.check", path: "/api/health" },
    { name: "stats.get", path: "/api/stats" },

    // ── Predictions ──
    { name: "predictions.query", path: "/api/predictions?status=pending" },
    { name: "predictions.markets", path: "/api/predictions/markets?limit=3" },

    // ── Betting ──
    { name: "ballot.getPool", path: "/api/bets/pool?asset=BTC&horizon=30m" },
    { name: "ballot.higherLower", path: "/api/bets/higher-lower/pool?asset=BTC&horizon=30m" },
    { name: "ballot.binaryPools", path: "/api/bets/binary/pools?limit=3" },
    { name: "ballot.graduationMarkets", path: "/api/bets/graduation/markets?limit=3" },

    // ── Actions (reads) ──
    { name: "actions.getReactions", path: sampleTx ? `/api/feed/${enc(sampleTx)}/react` : "" },
    { name: "actions.getTipStats", path: sampleTx ? `/api/tip/${enc(sampleTx)}` : "" },
    { name: "actions.getAgentTips", path: `/api/agent/${enc(AGENT_ADDR)}/tips` },

    // ── Identity ──
    { name: "identity.search", path: "/api/identity?search=demos" },
    { name: "identity.byPlatform", path: "/api/identity?platform=twitter&username=demos_ai" },
    { name: "identity.byChain", path: `/api/identity?chain=demos.mainnet&address=${enc(AGENT_ADDR)}` },

    // ── Webhooks ──
    { name: "webhooks.list", path: "/api/webhooks" },

    // ── Verification ──
    { name: "verify.dahr", path: sampleTx ? `/api/verify/${enc(sampleTx)}` : "" },
    { name: "verify.tlsn", path: sampleTx ? `/api/verify-tlsn/${enc(sampleTx)}` : "" },
    { name: "verify.tlsnProof", path: sampleTx ? `/api/tlsn-proof/${enc(sampleTx)}` : "" },
  ];

  // Track skipped endpoints (need sampleTx but don't have one)
  const skippedEndpoints = endpoints.filter(e => e.path === "");
  const validEndpoints = endpoints.filter(e => e.path !== "");

  console.error(`Auditing ${validEndpoints.length} endpoints...\n`);

  const results: AuditResult[] = [];

  // Run sequentially to avoid rate limiting
  for (const ep of validEndpoints) {
    const result = await auditEndpoint(ep.name, ep.path);
    results.push(result);
    const status = result.ok ? "✓" : "✗";
    const httpTag = result.httpStatus ? ` [${result.httpStatus}]` : "";
    console.error(
      `  ${status} ${result.name.padEnd(30)} ${result.fields.length.toString().padStart(3)} fields${httpTag}${result.error ? ` — ${result.error.slice(0, 50)}` : ""}`,
    );
  }

  // ── Summary ──
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.error(`\n═══ API Depth Audit Summary ═══`);
  console.error(`Endpoints: ${results.length} | OK: ${passed} | Failed: ${failed} | Skipped: ${skippedEndpoints.length}`);
  if (skippedEndpoints.length > 0) {
    console.error(`Skipped (no sampleTx): ${skippedEndpoints.map(e => e.name).join(", ")}`);
  }

  const allFields = new Set(results.flatMap(r => r.fields));
  console.error(`Total unique field paths: ${allFields.size}\n`);

  // Output full JSON report to stdout
  const output = results.map(r => ({
    name: r.name,
    path: r.path,
    ok: r.ok,
    httpStatus: r.httpStatus,
    fieldCount: r.fields.length,
    fields: r.fields,
    rawData: r.rawData,
    error: r.error,
  }));
  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
