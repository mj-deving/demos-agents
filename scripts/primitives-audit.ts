#!/usr/bin/env npx tsx
/**
 * primitives-audit.ts — Exercise ALL read primitives with ALL parameter variants.
 *
 * Structured output: JSON array of { primitive, params, ok, latencyMs, summary, error? }
 *
 * Usage:
 *   npx tsx scripts/primitives-audit.ts          # Human-readable table
 *   npx tsx scripts/primitives-audit.ts --json   # Machine-readable JSON
 */

import { connect } from "../packages/omniweb-toolkit/src/colony.js";

const JSON_MODE = process.argv.includes("--json");

interface TestResult {
  id: string;
  domain: string;
  primitive: string;
  params: string;
  ok: boolean;
  latencyMs: number;
  summary: string;
  error?: string;
}

const results: TestResult[] = [];

async function test(
  id: string,
  domain: string,
  primitive: string,
  params: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const start = Date.now();
  try {
    const raw = await fn();
    const latencyMs = Date.now() - start;

    // Determine ok status
    let ok = false;
    let summary = "";

    if (raw === null) {
      summary = "null (API unreachable)";
    } else if (typeof raw === "object" && raw !== null) {
      if ("ok" in raw) {
        ok = (raw as any).ok === true;
        if (ok) {
          const data = (raw as any).data;
          summary = summarize(data);
        } else {
          summary = `error: ${(raw as any).error ?? (raw as any).status}`;
        }
      } else {
        // Direct return (chain domain methods)
        ok = true;
        summary = summarize(raw);
      }
    } else {
      ok = raw !== undefined && raw !== null;
      summary = String(raw).slice(0, 80);
    }

    results.push({ id, domain, primitive, params, ok, latencyMs, summary });
  } catch (err) {
    results.push({
      id, domain, primitive, params,
      ok: false,
      latencyMs: Date.now() - start,
      summary: "EXCEPTION",
      error: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120),
    });
  }
}

function summarize(data: unknown): string {
  if (data === null || data === undefined) return "null";
  if (typeof data === "number") return String(data);
  if (typeof data === "string") return data.slice(0, 80);
  if (typeof data === "boolean") return String(data);
  if (Array.isArray(data)) return `[${data.length} items]`;
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // Common patterns
    if ("posts" in obj && Array.isArray(obj.posts)) return `${(obj.posts as any[]).length} posts${obj.hasMore ? " (hasMore)" : ""}`;
    if ("agents" in obj && Array.isArray(obj.agents)) return `${(obj.agents as any[]).length} agents`;
    if ("balance" in obj) return `balance: ${obj.balance}`;
    if ("assets" in obj && Array.isArray(obj.assets)) return `${(obj.assets as any[]).length} assets, ${Array.isArray((obj as any).divergences) ? (obj as any).divergences.length : 0} divergences`;
    if ("composite" in obj) return `composite: ${obj.composite}, betting: ${obj.betting}, calibration: ${obj.calibration}`;
    if ("totalBets" in obj) return `totalBets: ${obj.totalBets}, totalDem: ${obj.totalDem}`;
    if ("ok" in obj) return `ok: ${obj.ok}`;
    const keys = Object.keys(obj);
    return `{${keys.slice(0, 5).join(", ")}${keys.length > 5 ? `, +${keys.length - 5}` : ""}}`;
  }
  return String(data).slice(0, 80);
}

async function main() {
  const omni = await connect();
  const addr = omni.address;

  // ══════════════════════════════════════════════════
  // COLONY DOMAIN — 14 read methods
  // ══════════════════════════════════════════════════

  // getFeed variants
  await test("R1a", "colony", "getFeed", "{}", () => omni.colony.getFeed());
  await test("R1b", "colony", "getFeed", "{limit:5}", () => omni.colony.getFeed({ limit: 5 }));
  await test("R1c", "colony", "getFeed", "{limit:5,category:'ANALYSIS'}", () => omni.colony.getFeed({ limit: 5, category: "ANALYSIS" }));
  await test("R1d", "colony", "getFeed", "{limit:5,category:'PREDICTION'}", () => omni.colony.getFeed({ limit: 5, category: "PREDICTION" }));
  await test("R1e", "colony", "getFeed", "{limit:50}", () => omni.colony.getFeed({ limit: 50 }));

  // search variants
  await test("R2a", "colony", "search", "{text:'bitcoin'}", () => omni.colony.search({ text: "bitcoin" }));
  await test("R2b", "colony", "search", "{text:'ethereum'}", () => omni.colony.search({ text: "ethereum" }));
  await test("R2c", "colony", "search", "{category:'ANALYSIS'}", () => omni.colony.search({ category: "ANALYSIS" }));
  await test("R2d", "colony", "search", "{text:'nonexistent_xyz_123'}", () => omni.colony.search({ text: "nonexistent_xyz_123" }));

  // getSignals
  await test("R5", "colony", "getSignals", "()", () => omni.colony.getSignals());

  // getOracle variants
  await test("R11a", "colony", "getOracle", "{}", () => omni.colony.getOracle());
  await test("R11b", "colony", "getOracle", "{assets:['BTC']}", () => omni.colony.getOracle({ assets: ["BTC"] }));
  await test("R11c", "colony", "getOracle", "{assets:['BTC','ETH','SOL']}", () => omni.colony.getOracle({ assets: ["BTC", "ETH", "SOL"] }));

  // getPrices variants
  await test("R12a", "colony", "getPrices", "['BTC']", () => omni.colony.getPrices(["BTC"]));
  await test("R12b", "colony", "getPrices", "['BTC','ETH']", () => omni.colony.getPrices(["BTC", "ETH"]));
  await test("R12c", "colony", "getPrices", "['BTC','ETH','SOL','AVAX']", () => omni.colony.getPrices(["BTC", "ETH", "SOL", "AVAX"]));

  // getBalance
  await test("R19", "colony", "getBalance", "()", () => omni.colony.getBalance());

  // getLeaderboard variants
  await test("R7a", "colony", "getLeaderboard", "{}", () => omni.colony.getLeaderboard());
  await test("R7b", "colony", "getLeaderboard", "{limit:5}", () => omni.colony.getLeaderboard({ limit: 5 }));
  await test("R7c", "colony", "getLeaderboard", "{limit:20}", () => omni.colony.getLeaderboard({ limit: 20 }));

  // getAgents
  await test("R8", "colony", "getAgents", "()", () => omni.colony.getAgents());

  // getPool variants
  await test("R15a", "colony", "getPool", "{}", () => omni.colony.getPool());
  await test("R15b", "colony", "getPool", "{asset:'BTC'}", () => omni.colony.getPool({ asset: "BTC" }));
  await test("R15c", "colony", "getPool", "{asset:'BTC',horizon:'30m'}", () => omni.colony.getPool({ asset: "BTC", horizon: "30m" }));
  await test("R15d", "colony", "getPool", "{asset:'ETH',horizon:'4h'}", () => omni.colony.getPool({ asset: "ETH", horizon: "4h" }));

  // getReactions (use a known txHash from feed)
  const feedResult = await omni.colony.getFeed({ limit: 1 });
  const sampleTxHash = feedResult?.ok ? (feedResult.data as any).posts?.[0]?.txHash : null;
  if (sampleTxHash) {
    await test("R23", "colony", "getReactions", `'${sampleTxHash.slice(0, 12)}...'`, () => omni.colony.getReactions(sampleTxHash));
    await test("R24", "colony", "getTipStats", `'${sampleTxHash.slice(0, 12)}...'`, () => omni.colony.getTipStats(sampleTxHash));
  }

  // getMarkets
  await test("R14a", "colony", "getMarkets", "{}", () => omni.colony.getMarkets());
  await test("R14b", "colony", "getMarkets", "{limit:3}", () => omni.colony.getMarkets({ limit: 3 }));

  // getPredictions
  await test("R13a", "colony", "getPredictions", "{}", () => omni.colony.getPredictions());
  await test("R13b", "colony", "getPredictions", "{status:'pending'}", () => omni.colony.getPredictions({ status: "pending" }));

  // getForecastScore
  await test("R-FC", "colony", "getForecastScore", `'${addr.slice(0, 12)}...'`, () => omni.colony.getForecastScore(addr));

  // ══���═══════════════════════════════════════════════
  // IDENTITY DOMAIN — 4 methods
  // ═════════════════════���════════════════════════════

  await test("I1", "identity", "getIdentities", "()", () => omni.identity.getIdentities());
  await test("I2", "identity", "getIdentities", `'${addr.slice(0, 12)}...'`, () => omni.identity.getIdentities(addr));
  await test("I3", "identity", "lookup", "('twitter','demos_ai')", () => omni.identity.lookup("twitter", "demos_ai"));
  await test("I4", "identity", "createProof", "()", () => omni.identity.createProof());

  // ═════��═════════════════════════════════���══════════
  // CHAIN DOMAIN — 4 read methods
  // ═════���════════════════════════════════════════════

  await test("C1", "chain", "getAddress", "()", async () => ({ ok: true, data: omni.chain.getAddress() }));
  await test("C2", "chain", "getBalance", `'${addr.slice(0, 12)}...'`, () => omni.chain.getBalance(addr));
  await test("C3", "chain", "getBlockNumber", "()", () => omni.chain.getBlockNumber());
  await test("C4", "chain", "verifyMessage", "('test','fakesig','fakepk')", () => omni.chain.verifyMessage("test", "fake_sig", "fake_pk"));

  // ══���═══════════════════��═══════════════════════════
  // STORAGE DOMAIN — 3 read methods
  // ═══════════��═══════════════════════���══════════════

  await test("S1", "storage", "list", "()", () => omni.storage.list());
  await test("S2", "storage", "search", "('agent')", () => omni.storage.search("agent"));
  await test("S3", "storage", "search", "('test',3)", () => omni.storage.search("test", 3));

  // ═════════════════════��════════════════════════════
  // ESCROW DOMAIN — 2 read methods
  // ═���════════════���═══════════════════════════════════

  await test("E1", "escrow", "getClaimable", "('twitter','test_user')", () => omni.escrow.getClaimable("twitter", "test_user"));
  await test("E2", "escrow", "getEscrowBalance", "('twitter','test_user')", () => omni.escrow.getEscrowBalance("twitter", "test_user"));

  // ══════════════════════════════════════════════════
  // OUTPUT
  // ══════════════════════════════════════════════════

  if (JSON_MODE) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    console.log("\n═══ Primitives Audit ════════════════════════════════════════════════════════════");
    console.log(`${"ID".padEnd(6)} ${"Domain".padEnd(10)} ${"Primitive".padEnd(20)} ${"Params".padEnd(40)} ${"OK".padEnd(4)} ${"ms".padEnd(6)} Summary`);
    console.log("─".repeat(140));
    for (const r of results) {
      const status = r.ok ? "✓" : "✗";
      const line = `${r.id.padEnd(6)} ${r.domain.padEnd(10)} ${r.primitive.padEnd(20)} ${r.params.padEnd(40)} ${status.padEnd(4)} ${String(r.latencyMs).padEnd(6)} ${r.summary}`;
      console.log(line);
      if (r.error) console.log(`       ERROR: ${r.error}`);
    }
    console.log("─".repeat(140));
    console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
