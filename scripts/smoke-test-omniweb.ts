#!/usr/bin/env npx tsx
/**
 * smoke-test-omniweb.ts — Live read-only validation of the OmniWeb consumer path.
 *
 * Tests: connect() → all 6 OmniWeb domain read methods.
 * Zero DEM cost — read operations only.
 *
 * Usage:
 *   npx tsx scripts/smoke-test-omniweb.ts
 *   npx tsx scripts/smoke-test-omniweb.ts --json    # Machine-readable output
 *
 * Requires: DEMOS_MNEMONIC in .env
 */

import { connect } from "../packages/omniweb-toolkit/src/colony.js";

interface TestResult {
  name: string;
  domain: string;
  ok: boolean;
  latencyMs: number;
  detail?: string;
  error?: string;
}

const jsonMode = process.argv.includes("--json");

function log(msg: string) {
  if (!jsonMode) console.log(msg);
}

async function runTest(
  name: string,
  domain: string,
  fn: () => Promise<unknown>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    const result = await fn();
    const latencyMs = Date.now() - start;
    const isOk = result !== null && result !== undefined;
    const detail = typeof result === "object" && result !== null && "ok" in result
      ? `ok: ${(result as any).ok}`
      : typeof result === "string" ? result.slice(0, 50) : "returned";
    return { name, domain, ok: isOk, latencyMs, detail };
  } catch (err) {
    return {
      name, domain, ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  log("═══ OmniWeb Smoke Test ═══════════════════════════");
  log("Connecting to Demos network...\n");

  const connectStart = Date.now();
  const omni = await connect();
  const connectMs = Date.now() - connectStart;
  log(`Connected as ${omni.address} (${connectMs}ms)\n`);

  const results: TestResult[] = [];

  // ── Colony Domain (core) ──────────────────────────
  log("── Colony Domain ──");

  results.push(await runTest("getFeed", "colony", async () => {
    const r = await omni.colony.getFeed({ limit: 5 });
    if (r?.ok) log(`  getFeed: ${(r.data as any).posts?.length ?? 0} posts`);
    return r;
  }));

  results.push(await runTest("getSignals", "colony", async () => {
    const r = await omni.colony.getSignals();
    if (r?.ok) log(`  getSignals: ${Array.isArray(r.data) ? (r.data as any[]).length : 0} signals`);
    return r;
  }));

  results.push(await runTest("getOracle", "colony", async () => {
    const r = await omni.colony.getOracle({ assets: ["BTC", "ETH"] });
    if (r?.ok) {
      const data = r.data as any;
      log(`  getOracle: ${data.assets?.length ?? 0} assets, ${data.divergences?.length ?? 0} divergences`);
    }
    return r;
  }));

  results.push(await runTest("getBalance", "colony", async () => {
    const r = await omni.colony.getBalance();
    if (r?.ok) log(`  getBalance: ${(r.data as any).balance} DEM`);
    return r;
  }));

  results.push(await runTest("getLeaderboard", "colony", async () => {
    const r = await omni.colony.getLeaderboard({ limit: 5 });
    if (r?.ok) log(`  getLeaderboard: ${(r.data as any).agents?.length ?? (r.data as any).length ?? 0} agents`);
    return r;
  }));

  results.push(await runTest("getPrices", "colony", async () => {
    const r = await omni.colony.getPrices(["BTC", "ETH"]);
    if (r?.ok) {
      const prices = r.data as any[];
      log(`  getPrices: ${prices?.map((p: any) => `${p.ticker ?? p.symbol}: $${p.priceUsd?.toLocaleString()}`).join(", ")}`);
    }
    return r;
  }));

  results.push(await runTest("getAgents", "colony", async () => {
    const r = await omni.colony.getAgents();
    if (r?.ok) log(`  getAgents: ${(r.data as any).agents?.length ?? 0} agents`);
    return r;
  }));

  // ── Identity Domain ───────────────────────────────
  log("\n── Identity Domain ──");

  results.push(await runTest("getIdentities", "identity", async () => {
    const r = await omni.identity.getIdentities();
    log(`  getIdentities: ${r.ok ? "OK" : r.error ?? "failed"}`);
    return r;
  }));

  // ── Chain Domain ──────────────────────────────────
  log("\n── Chain Domain ──");

  results.push(await runTest("getAddress", "chain", async () => {
    const addr = omni.chain.getAddress();
    log(`  getAddress: ${addr}`);
    return { ok: !!addr, data: addr };
  }));

  results.push(await runTest("getBalance (chain)", "chain", async () => {
    const r = await omni.chain.getBalance(omni.address);
    log(`  getBalance: ${r.ok ? r.balance : r.error}`);
    return r;
  }));

  // ── Storage Domain ────────────────────────────────
  log("\n── Storage Domain ──");

  results.push(await runTest("list", "storage", async () => {
    const r = await omni.storage.list();
    log(`  list: ${r.ok ? `${(r.data as any[])?.length ?? 0} programs` : r.error}`);
    return r;
  }));

  // ── Summary ───────────────────────────────────────
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const totalMs = results.reduce((s, r) => s + r.latencyMs, 0);

  log(`\n═══ Results ═══════════════════════════════════════`);
  log(`Passed: ${passed}/${results.length}`);
  log(`Failed: ${failed}/${results.length}`);
  log(`Total latency: ${totalMs}ms (connect: ${connectMs}ms)`);

  if (failed > 0) {
    log("\nFailed tests:");
    for (const r of results.filter((r) => !r.ok)) {
      log(`  ✗ ${r.domain}.${r.name}: ${r.error ?? "returned null"}`);
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      address: omni.address,
      connectMs,
      passed,
      failed,
      total: results.length,
      totalMs,
      results,
    }, null, 2));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
