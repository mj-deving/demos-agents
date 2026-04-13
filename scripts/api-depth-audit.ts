#!/usr/bin/env npx tsx
/**
 * api-depth-audit.ts — Fetch EVERY read endpoint and capture full response shapes.
 *
 * Produces a JSON report of every field at every depth level for every endpoint.
 * This is the ground truth — what the API actually returns, not what types.ts says.
 *
 * Usage:
 *   npx tsx scripts/api-depth-audit.ts > api-depth-report.json
 */

import { connect } from "../packages/supercolony-toolkit/src/colony.js";

interface FieldInfo {
  type: string;
  sample: unknown;
  children?: Record<string, FieldInfo>;
  arrayItemShape?: Record<string, FieldInfo>;
  count?: number; // for arrays
}

/** Recursively extract the shape of any value */
function extractShape(value: unknown, depth: number = 0): FieldInfo {
  if (depth > 6) return { type: "...(max depth)", sample: null };
  if (value === null) return { type: "null", sample: null };
  if (value === undefined) return { type: "undefined", sample: undefined };
  if (typeof value === "string") return { type: "string", sample: value.slice(0, 100) };
  if (typeof value === "number") return { type: "number", sample: value };
  if (typeof value === "boolean") return { type: "boolean", sample: value };

  if (Array.isArray(value)) {
    const info: FieldInfo = { type: "array", sample: null, count: value.length };
    if (value.length > 0) {
      // Shape from first item
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
      const sampleStr = info.sample !== null && info.sample !== undefined
        ? ` = ${JSON.stringify(info.sample)}` : "";
      lines.push(`${path}: ${info.type}${sampleStr}`);
    }
  }
  return lines;
}

async function auditEndpoint(
  name: string,
  fn: () => Promise<unknown>,
): Promise<{ name: string; ok: boolean; fields: string[]; rawShape?: Record<string, FieldInfo>; error?: string }> {
  try {
    const raw = await fn();
    if (raw === null) return { name, ok: false, fields: [], error: "null (API unreachable)" };

    const result = raw as any;
    const data = result.ok === true ? result.data : result;
    const shape = typeof data === "object" && data !== null
      ? Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, extractShape(v)])
        )
      : { _root: extractShape(data) };

    return { name, ok: result.ok !== false, fields: flattenShape(shape), rawShape: shape };
  } catch (err) {
    return { name, ok: false, fields: [], error: (err as Error).message.slice(0, 200) };
  }
}

async function main() {
  const omni = await connect();
  const addr = omni.address;
  const results: Array<{ name: string; ok: boolean; fields: string[]; error?: string }> = [];

  // Get a sample txHash for per-post endpoints
  const feedSample = await omni.colony.getFeed({ limit: 1 });
  const sampleTx = feedSample?.ok ? (feedSample.data as any).posts?.[0]?.txHash : null;

  console.error("Auditing all endpoints...");

  // ── Colony domain ──
  results.push(await auditEndpoint("colony.getFeed({})", () => omni.colony.getFeed()));
  results.push(await auditEndpoint("colony.getFeed({limit:1,category:'ANALYSIS'})", () => omni.colony.getFeed({ limit: 1, category: "ANALYSIS" })));
  results.push(await auditEndpoint("colony.search({text:'bitcoin'})", () => omni.colony.search({ text: "bitcoin" })));
  results.push(await auditEndpoint("colony.getSignals()", () => omni.colony.getSignals()));
  results.push(await auditEndpoint("colony.getOracle()", () => omni.colony.getOracle()));
  results.push(await auditEndpoint("colony.getOracle({assets:['BTC','ETH']})", () => omni.colony.getOracle({ assets: ["BTC", "ETH"] })));
  results.push(await auditEndpoint("colony.getPrices(['BTC','ETH'])", () => omni.colony.getPrices(["BTC", "ETH"])));
  results.push(await auditEndpoint("colony.getBalance()", () => omni.colony.getBalance()));
  results.push(await auditEndpoint("colony.getLeaderboard({limit:3})", () => omni.colony.getLeaderboard({ limit: 3 })));
  results.push(await auditEndpoint("colony.getAgents()", () => omni.colony.getAgents()));
  results.push(await auditEndpoint("colony.getPool({asset:'BTC',horizon:'30m'})", () => omni.colony.getPool({ asset: "BTC", horizon: "30m" })));
  if (sampleTx) {
    results.push(await auditEndpoint(`colony.getReactions('${sampleTx.slice(0, 12)}...')`, () => omni.colony.getReactions(sampleTx)));
    results.push(await auditEndpoint(`colony.getTipStats('${sampleTx.slice(0, 12)}...')`, () => omni.colony.getTipStats(sampleTx)));
  }
  results.push(await auditEndpoint("colony.getMarkets({limit:2})", () => omni.colony.getMarkets({ limit: 2 })));
  results.push(await auditEndpoint("colony.getPredictions({status:'pending'})", () => omni.colony.getPredictions({ status: "pending" })));
  results.push(await auditEndpoint(`colony.getForecastScore('${addr.slice(0, 12)}...')`, () => omni.colony.getForecastScore(addr)));

  // ── Toolkit internal domains ──
  results.push(await auditEndpoint("toolkit.agents.getProfile(addr)", () => omni.toolkit.agents.getProfile(addr)));
  results.push(await auditEndpoint("toolkit.agents.getIdentities(addr)", () => omni.toolkit.agents.getIdentities(addr)));
  results.push(await auditEndpoint("toolkit.agents.list()", () => omni.toolkit.agents.list()));
  results.push(await auditEndpoint("toolkit.intelligence.getSignals()", () => omni.toolkit.intelligence.getSignals()));
  results.push(await auditEndpoint("toolkit.intelligence.getReport()", () => omni.toolkit.intelligence.getReport()));
  results.push(await auditEndpoint("toolkit.scores.getLeaderboard({limit:3})", () => omni.toolkit.scores.getLeaderboard({ limit: 3 })));
  results.push(await auditEndpoint("toolkit.oracle.get()", () => omni.toolkit.oracle.get()));
  results.push(await auditEndpoint("toolkit.prices.get(['BTC'])", () => omni.toolkit.prices.get(["BTC"])));
  results.push(await auditEndpoint("toolkit.balance.get()", () => omni.toolkit.balance.get()));
  results.push(await auditEndpoint("toolkit.health.check()", () => omni.toolkit.health.check()));
  results.push(await auditEndpoint("toolkit.stats.get()", () => omni.toolkit.stats.get()));
  results.push(await auditEndpoint("toolkit.predictions.query({})", () => omni.toolkit.predictions.query({})));
  results.push(await auditEndpoint("toolkit.predictions.markets()", () => omni.toolkit.predictions.markets()));
  results.push(await auditEndpoint("toolkit.ballot.getPool({asset:'BTC'})", () => omni.toolkit.ballot.getPool({ asset: "BTC" })));
  results.push(await auditEndpoint("toolkit.webhooks.list()", () => omni.toolkit.webhooks.list()));

  // ── Identity domain ──
  results.push(await auditEndpoint("identity.getIdentities()", () => omni.identity.getIdentities()));
  results.push(await auditEndpoint("identity.lookup('twitter','demos_ai')", () => omni.identity.lookup("twitter", "demos_ai")));
  results.push(await auditEndpoint("identity.createProof()", () => omni.identity.createProof()));

  // ── Chain domain ──
  results.push(await auditEndpoint("chain.getBalance(addr)", () => omni.chain.getBalance(addr)));
  results.push(await auditEndpoint("chain.getBlockNumber()", () => omni.chain.getBlockNumber()));

  // ── Storage domain ──
  results.push(await auditEndpoint("storage.list()", () => omni.storage.list()));
  results.push(await auditEndpoint("storage.search('agent')", () => omni.storage.search("agent")));

  // ── Print human-readable summary to stderr, JSON to stdout ──
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  console.error(`\n═══ API Depth Audit ═══`);
  console.error(`Endpoints: ${results.length} | OK: ${passed} | Failed: ${failed}\n`);

  // Print field counts per endpoint
  for (const r of results) {
    const status = r.ok ? "✓" : "✗";
    console.error(`${status} ${r.name.padEnd(55)} ${r.fields.length} fields${r.error ? ` — ${r.error.slice(0, 60)}` : ""}`);
  }

  // Total unique field paths
  const allFields = new Set(results.flatMap(r => r.fields));
  console.error(`\nTotal unique field paths: ${allFields.size}`);

  // Output full JSON report to stdout
  console.log(JSON.stringify(results.map(r => ({ name: r.name, ok: r.ok, fieldCount: r.fields.length, fields: r.fields, error: r.error })), null, 2));
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
