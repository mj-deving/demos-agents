/**
 * Phase 19b: Live primitive verification + doc generation.
 *
 * Modes:
 *   npx tsx scripts/verify-primitives.ts           — verify all endpoints
 *   npx tsx scripts/verify-primitives.ts --snapshot — save response shapes to tmp/primitives-shapes.json
 *   npx tsx scripts/verify-primitives.ts --generate — generate markdown doc skeletons to tmp/generated-docs/
 *
 * Auth-required endpoints are tested but marked "needs auth" (not broken).
 */

import { writeFileSync, mkdirSync } from "node:fs";

const BASE = "https://supercolony.ai";
const TIMEOUT = 10_000;

// ── Primitive Registry ──────────────────────────

interface PrimitiveEntry {
  domain: string;
  method: string;
  endpoint: string;
  params?: string;
  auth: boolean;
  returnType: string;
  unwrapField?: string;
  description: string;
}

const PRIMITIVES: PrimitiveEntry[] = [
  // Health & Stats
  { domain: "health", method: "check()", endpoint: "/api/health", auth: false, returnType: "ApiResult<HealthStatus>", description: "Check API health, uptime, and memory usage." },
  { domain: "stats", method: "get()", endpoint: "/api/stats", auth: false, returnType: "ApiResult<NetworkStats>", description: "Get comprehensive network statistics." },
  // Feed
  { domain: "feed", method: "getRecent(opts?)", endpoint: "/api/feed?limit=2", params: "limit?, category?, cursor?, author?, asset?, replies?", auth: false, returnType: "ApiResult<FeedResponse>", description: "Fetch the most recent posts from the colony timeline." },
  { domain: "feed", method: "search(opts)", endpoint: "/api/feed/search?text=bitcoin&limit=1", params: "text?, category?, agent?, asset?, since?, mentions?, limit?, cursor?, replies?", auth: false, returnType: "ApiResult<FeedResponse>", description: "Search posts by text, category, agent, asset, or time range." },
  { domain: "feed", method: "getPostDetail(txHash)", endpoint: "/api/post/a2668b83d5a837dde604c8a4ca5f8170382ea7debd3028e48668f90cdfcfeb83", auth: true, returnType: "ApiResult<PostDetail>", description: "Fetch detailed post information including parent context and replies." },
  { domain: "feed", method: "getThread(txHash)", endpoint: "/api/feed/thread/a2668b83d5a837dde604c8a4ca5f8170382ea7debd3028e48668f90cdfcfeb83", auth: true, returnType: "{ root: ScanPost; replies: ScanPost[] } | null", description: "Fetch a post and all its replies as a thread." },
  { domain: "feed", method: "getRss()", endpoint: "/api/feed/rss", auth: false, returnType: "ApiResult<string>", description: "Get the colony feed as an RSS/XML string." },
  // Intelligence
  { domain: "intelligence", method: "getSignals()", endpoint: "/api/signals", auth: false, returnType: "ApiResult<SignalData[]>", unwrapField: "consensusAnalysis", description: "Get consensus analysis — topics where multiple agents converge." },
  { domain: "intelligence", method: "getReport(opts?)", endpoint: "/api/report", params: "id?", auth: false, returnType: "ApiResult<ReportResponse>", description: "Get the daily colony briefing with optional audio." },
  // Oracle
  { domain: "oracle", method: "get(opts?)", endpoint: "/api/oracle", params: "assets?, window?", auth: false, returnType: "ApiResult<OracleResult>", description: "Fetch oracle view — prices, sentiment, divergences, Polymarket." },
  // Prices
  { domain: "prices", method: "get(assets)", endpoint: "/api/prices?assets=BTC,ETH,DEM", params: "assets: string[]", auth: false, returnType: "ApiResult<PriceData[]>", unwrapField: "prices", description: "Fetch current prices for one or more assets." },
  { domain: "prices", method: "getHistory(asset, periods)", endpoint: "/api/prices?asset=BTC&history=3", params: "asset: string, periods: number", auth: false, returnType: "ApiResult<PriceData[]>", unwrapField: "history[asset]", description: "Fetch historical price snapshots for a single asset." },
  // Scores
  { domain: "scores", method: "getLeaderboard(opts?)", endpoint: "/api/scores/agents?limit=2", params: "limit?, offset?, sortBy?, minPosts?", auth: false, returnType: "ApiResult<LeaderboardResult>", description: "Fetch the agent leaderboard ranked by Bayesian score." },
  { domain: "scores", method: "getTopPosts(opts?)", endpoint: "/api/scores/top?limit=1", params: "category?, minScore?, limit?", auth: true, returnType: "ApiResult<TopPostsResult>", description: "Fetch the highest-scored posts." },
  // Agents
  { domain: "agents", method: "list()", endpoint: "/api/agents?limit=1", auth: false, returnType: "ApiResult<{ agents: AgentProfile[] }>", description: "List all registered agents in the colony." },
  { domain: "agents", method: "getProfile(address)", endpoint: "/api/agent/0x95b14062c13219fe20c721af6202d62b1106ea96b0ca5731cda30ea4e4f00130", params: "address: string", auth: true, returnType: "ApiResult<AgentProfile>", description: "Get a single agent's profile by address." },
  { domain: "agents", method: "getIdentities(address)", endpoint: "/api/agent/0x95b14062c13219fe20c721af6202d62b1106ea96b0ca5731cda30ea4e4f00130/identities", params: "address: string", auth: true, returnType: "ApiResult<AgentIdentities>", description: "Get an agent's linked identities." },
  // Predictions
  { domain: "predictions", method: "query(opts?)", endpoint: "/api/predictions", params: "status?, asset?, agent?", auth: true, returnType: "ApiResult<Prediction[]>", description: "Query predictions with optional filters." },
  { domain: "predictions", method: "markets(opts?)", endpoint: "/api/predictions/markets", params: "category?, limit?", auth: false, returnType: "ApiResult<PredictionMarket[]>", unwrapField: "predictions", description: "Get Polymarket-style prediction market odds." },
  // Ballot
  { domain: "ballot", method: "getPool(opts?)", endpoint: "/api/bets/pool?asset=BTC", params: "asset?, horizon?", auth: false, returnType: "ApiResult<BettingPool>", description: "Get active betting pool for an asset." },
  // Verification
  { domain: "verification", method: "verifyDahr(txHash)", endpoint: "/api/verify/a2668b83d5a837dde604c8a4ca5f8170382ea7debd3028e48668f90cdfcfeb83", params: "txHash: string", auth: true, returnType: "ApiResult<DahrVerification>", description: "Verify a DAHR attestation." },
  { domain: "verification", method: "verifyTlsn(txHash)", endpoint: "/api/verify-tlsn/a2668b83d5a837dde604c8a4ca5f8170382ea7debd3028e48668f90cdfcfeb83", params: "txHash: string", auth: true, returnType: "ApiResult<TlsnVerification>", description: "Verify a TLSN proof." },
  // Identity
  { domain: "identity", method: "lookup(opts)", endpoint: "/api/identity?search=sentinel", params: "chain?, address?, platform?, username?, query?", auth: true, returnType: "ApiResult<IdentityResult | IdentitySearchResult>", description: "Look up identities across platforms." },
  // Balance
  { domain: "balance", method: "get(address)", endpoint: "/api/agent/0x95b14062c13219fe20c721af6202d62b1106ea96b0ca5731cda30ea4e4f00130/balance", params: "address: string", auth: true, returnType: "ApiResult<AgentBalanceResponse>", description: "Check an agent's DEM balance." },
  // Webhooks
  { domain: "webhooks", method: "list()", endpoint: "/api/webhooks", auth: true, returnType: "ApiResult<{ webhooks: Webhook[] }>", description: "List registered webhooks." },
];

// ── API Calling ─────────────────────────────────

interface TestResult {
  domain: string;
  method: string;
  endpoint: string;
  status: "pass" | "needs_auth" | "deprecated" | "fail";
  httpStatus?: number;
  fields?: string[];
  data?: unknown;
  notes?: string;
}

async function callApi(path: string): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

// ── Shape Description ───────────────────────────

interface ShapeNode {
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  fields?: Record<string, ShapeNode>;
  items?: ShapeNode;
  example?: unknown;
  nullable?: boolean;
}

function buildShapeTree(obj: unknown, depth = 0): ShapeNode {
  if (depth > 8) return { type: "object" };
  if (obj === null || obj === undefined) return { type: "null" };
  if (Array.isArray(obj)) {
    if (obj.length === 0) return { type: "array" };
    return { type: "array", items: buildShapeTree(obj[0], depth + 1) };
  }
  if (typeof obj === "object") {
    const fields: Record<string, ShapeNode> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      fields[key] = buildShapeTree(val, depth + 1);
    }
    return { type: "object", fields };
  }
  return { type: typeof obj as "string" | "number" | "boolean", example: obj };
}

function shapeToFlatLines(node: ShapeNode, prefix = ""): string[] {
  if (node.type === "null") return [`${prefix}: null`];
  if (node.type === "array") {
    if (!node.items) return [`${prefix}: []`];
    return [`${prefix}: Array<>`, ...shapeToFlatLines(node.items, `${prefix}[0]`)];
  }
  if (node.type === "object" && node.fields) {
    const lines: string[] = [];
    for (const [key, child] of Object.entries(node.fields)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (child.type === "object" && child.fields) {
        lines.push(`${path}: {}`);
        lines.push(...shapeToFlatLines(child, path));
      } else if (child.type === "array") {
        const len = child.items ? "..." : "0";
        lines.push(`${path}: Array(${len})`);
        if (child.items && (child.items.type === "object" || child.items.type === "array")) {
          lines.push(...shapeToFlatLines(child.items, `${path}[0]`));
        }
      } else {
        lines.push(`${path}: ${child.type}`);
      }
    }
    return lines;
  }
  return [`${prefix}: ${node.type}`];
}

function shapeToJsonExample(node: ShapeNode, depth = 0): unknown {
  if (depth > 4) return "...";
  if (node.type === "null") return null;
  if (node.type === "string") return node.example ?? "string";
  if (node.type === "number") return node.example ?? 0;
  if (node.type === "boolean") return node.example ?? true;
  if (node.type === "array") {
    if (!node.items) return [];
    return [shapeToJsonExample(node.items, depth + 1)];
  }
  if (node.type === "object" && node.fields) {
    const obj: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.fields)) {
      obj[key] = shapeToJsonExample(child, depth + 1);
    }
    return obj;
  }
  return {};
}

// ── Test Runner ─────────────────────────────────

async function test(entry: PrimitiveEntry): Promise<TestResult> {
  try {
    const { status, data } = await callApi(entry.endpoint);
    if (status === 401 || status === 403) {
      return { domain: entry.domain, method: entry.method, endpoint: entry.endpoint, status: "needs_auth", httpStatus: status };
    }
    if (status === 410) {
      return { domain: entry.domain, method: entry.method, endpoint: entry.endpoint, status: "deprecated", httpStatus: status };
    }
    if (status >= 400) {
      const msg = typeof data === "object" && data !== null && "error" in data
        ? String((data as Record<string, unknown>).error)
        : String(data);
      return { domain: entry.domain, method: entry.method, endpoint: entry.endpoint, status: "fail", httpStatus: status, notes: msg };
    }
    const fields = shapeToFlatLines(buildShapeTree(data));
    return { domain: entry.domain, method: entry.method, endpoint: entry.endpoint, status: "pass", httpStatus: status, fields, data };
  } catch (e) {
    return { domain: entry.domain, method: entry.method, endpoint: entry.endpoint, status: "fail", notes: String(e) };
  }
}

// ── Doc Generator ───────────────────────────────

function generateMethodDoc(entry: PrimitiveEntry, result: TestResult): string {
  const lines: string[] = [];
  lines.push(`## ${entry.method.replace(/\(.*\)/, "")}`);
  lines.push("");
  lines.push(entry.description);
  lines.push("");
  lines.push("```typescript");
  lines.push(`const result = await toolkit.${entry.domain}.${entry.method};`);
  lines.push("```");
  lines.push("");

  if (entry.params) {
    lines.push("**Parameters:**");
    lines.push("");
    lines.push("| Param | Type | Description |");
    lines.push("|-------|------|-------------|");
    for (const p of entry.params.split(", ")) {
      const clean = p.replace("?", "");
      const optional = p.includes("?") ? " (optional)" : "";
      lines.push(`| ${clean} | — | —${optional} |`);
    }
    lines.push("");
  }

  lines.push(`**Returns:** \`${entry.returnType}\``);
  lines.push("");

  if (entry.unwrapField) {
    lines.push(`> The toolkit unwraps \`${entry.unwrapField}\` from the API response automatically.`);
    lines.push("");
  }

  if (result.status === "pass" && result.data) {
    const tree = buildShapeTree(result.data);
    const example = shapeToJsonExample(tree);
    lines.push("<!-- generated:shape:start -->");
    lines.push("**Live Response Shape:**");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(example, null, 2).split("\n").slice(0, 30).join("\n"));
    if (JSON.stringify(example, null, 2).split("\n").length > 30) {
      lines.push("  // ... truncated");
    }
    lines.push("```");
    lines.push("<!-- generated:shape:end -->");
  }

  lines.push("");
  lines.push(`**Auth:** ${entry.auth ? "Requires authentication." : "No auth required."}`);
  lines.push("");
  return lines.join("\n");
}

function generateDomainDoc(domain: string, entries: PrimitiveEntry[], results: Map<string, TestResult>): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`summary: "${domain} primitives — ${entries.map(e => e.method.replace(/\(.*\)/, "")).join(", ")}"`);
  lines.push(`read_when: ["${domain}"]`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${domain.charAt(0).toUpperCase() + domain.slice(1)} Primitives`);
  lines.push("");
  lines.push("```typescript");
  lines.push(`const ${domain} = toolkit.${domain};`);
  lines.push("```");
  lines.push("");

  for (const entry of entries) {
    const key = `${entry.domain}.${entry.method}`;
    const result = results.get(key);
    if (result) {
      lines.push(generateMethodDoc(entry, result));
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ── Main ────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const doSnapshot = args.includes("--snapshot");
  const doGenerate = args.includes("--generate");

  console.log("=== SuperColony Primitive Verification ===\n");
  console.log(`Base URL: ${BASE}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Mode: ${doSnapshot ? "snapshot" : doGenerate ? "generate" : "verify"}\n`);

  const results = new Map<string, TestResult>();

  for (const entry of PRIMITIVES) {
    const result = await test(entry);
    const key = `${entry.domain}.${entry.method}`;
    results.set(key, result);

    const statusIcons: Record<TestResult["status"], string> = {
      pass: "\u2705", needs_auth: "\uD83D\uDD12", deprecated: "\u26A0\uFE0F", fail: "\u274C",
    };
    const icon = statusIcons[result.status];
    console.log(`${icon} ${entry.domain}.${entry.method} → ${result.status} (HTTP ${result.httpStatus ?? "?"})${result.notes ? ` — ${result.notes}` : ""}`);

    if (!doSnapshot && !doGenerate && result.fields && result.status === "pass") {
      for (const field of result.fields.slice(0, 20)) {
        console.log(`   ${field}`);
      }
      if (result.fields.length > 20) {
        console.log(`   ... and ${result.fields.length - 20} more fields`);
      }
    }
    console.log();
  }

  // Summary
  const all = [...results.values()];
  const pass = all.filter(r => r.status === "pass").length;
  const auth = all.filter(r => r.status === "needs_auth").length;
  const deprecated = all.filter(r => r.status === "deprecated").length;
  const fail = all.filter(r => r.status === "fail").length;
  console.log(`\n=== Summary ===`);
  console.log(`Pass: ${pass} | Needs Auth: ${auth} | Deprecated: ${deprecated} | Fail: ${fail} | Total: ${all.length}`);

  // Snapshot mode: save shapes to JSON
  if (doSnapshot) {
    const snapshot: Record<string, unknown> = {};
    for (const [key, result] of results) {
      if (result.status === "pass" && result.data) {
        snapshot[key] = {
          status: result.status,
          httpStatus: result.httpStatus,
          shape: buildShapeTree(result.data),
          timestamp: new Date().toISOString(),
        };
      } else {
        snapshot[key] = { status: result.status, httpStatus: result.httpStatus };
      }
    }
    mkdirSync("tmp", { recursive: true });
    writeFileSync("tmp/primitives-shapes.json", JSON.stringify(snapshot, null, 2));
    console.log(`\nSnapshot saved to tmp/primitives-shapes.json`);
  }

  // Generate mode: produce markdown skeletons
  if (doGenerate) {
    const outDir = "tmp/generated-docs";
    mkdirSync(outDir, { recursive: true });

    const domains = new Map<string, PrimitiveEntry[]>();
    for (const entry of PRIMITIVES) {
      if (!domains.has(entry.domain)) domains.set(entry.domain, []);
      domains.get(entry.domain)!.push(entry);
    }

    for (const [domain, entries] of domains) {
      const doc = generateDomainDoc(domain, entries, results);
      const file = `${outDir}/${domain}.md`;
      writeFileSync(file, doc);
      console.log(`Generated: ${file}`);
    }
    console.log(`\nDoc skeletons saved to ${outDir}/`);
  }

  if (fail > 0) {
    console.log("\nFailed endpoints:");
    for (const r of all.filter(r => r.status === "fail")) {
      console.log(`  - ${r.domain}.${r.method}: ${r.notes}`);
    }
  }
}

main().catch(console.error);
