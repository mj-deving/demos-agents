#!/usr/bin/env npx tsx
/**
 * T4 Spike: GCR Query Feasibility Test
 *
 * Tests whether we can access historical post data beyond the
 * SuperColony Feed API's ~20k offset cap by querying the blockchain directly.
 *
 * Approach:
 * 1. Connect wallet (read-only, just need RPC access)
 * 2. Try getAddressInfo on a known active agent address
 * 3. Try getBlocks to read recent block transactions
 * 4. Report: can we extract post content from block/GCR data?
 *
 * Result: PASS (GCR readable) or FAIL (blocked by SDK/RPC limitations)
 */

import { webcrypto } from "node:crypto";
if (!globalThis.crypto) (globalThis as any).crypto = webcrypto;

import { connectWallet, info, warn, RPC_URL } from "../src/lib/sdk.js";
import { resolveAgentName, loadAgentConfig } from "../src/lib/agent-config.js";

const flags: Record<string, string> = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--") && argv[i + 1] && !argv[i + 1].startsWith("--")) {
    flags[argv[i].slice(2)] = argv[i + 1];
    i++;
  }
}

const agent = resolveAgentName(flags);
const envPath = flags["env"] || ".env";

async function main() {
  console.log("═══ T4 GCR SPIKE ═══════════════════════════");
  console.log(`Agent: ${agent}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log("");

  // Step 1: Connect
  let demos: any;
  let address: string;
  try {
    const wallet = await connectWallet(envPath, agent);
    demos = wallet.demos;
    address = wallet.address;
    console.log("✅ Wallet connected: " + address);
  } catch (err: any) {
    console.log("❌ FAIL: Cannot connect wallet — " + err.message);
    process.exit(1);
  }

  // Step 2: Try getAddressInfo on our own address
  console.log("\n── Test 1: getAddressInfo ──");
  try {
    const info = await demos.getAddressInfo(address);
    console.log("✅ getAddressInfo returned:");
    console.log("  native:", info?.native ? Object.keys(info.native).join(", ") : "null");
    console.log("  properties:", info?.properties ? Object.keys(info.properties).join(", ") : "null");
    if (info?.native) {
      // Check if there's GCR data or balance info
      const native = info.native as any;
      console.log("  balance:", native.balance);
      console.log("  nonce:", native.nonce);
      // Check for any GCR-related fields
      for (const [k, v] of Object.entries(native)) {
        if (k.toLowerCase().includes("gcr") || k.toLowerCase().includes("content") || k.toLowerCase().includes("post")) {
          console.log(`  ${k}:`, JSON.stringify(v).slice(0, 200));
        }
      }
    }
  } catch (err: any) {
    console.log("❌ getAddressInfo failed: " + err.message);
  }

  // Step 3: Try getBlocks (latest 3)
  console.log("\n── Test 2: getBlocks (latest 3) ──");
  try {
    const blocks = await demos.getBlocks("latest", 3);
    console.log(`✅ getBlocks returned ${blocks.length} blocks`);
    for (const block of blocks) {
      const txCount = block.content.ordered_transactions?.length || 0;
      console.log(`  Block #${block.number}: ${txCount} txs, hash: ${block.hash?.slice(0, 16)}...`);
      if (block.content.native_tables_hashes) {
        console.log(`    native_gcr hash: ${block.content.native_tables_hashes.native_gcr?.slice(0, 32)}...`);
      }
      // Try to inspect first tx if any
      if (txCount > 0) {
        const firstTx = block.content.ordered_transactions[0];
        console.log(`    First tx: ${typeof firstTx === "string" ? firstTx.slice(0, 60) + "..." : JSON.stringify(firstTx).slice(0, 60) + "..."}`);
      }
    }
  } catch (err: any) {
    console.log("❌ getBlocks failed: " + err.message);
  }

  // Step 4: Try getBlockByNumber on a specific block
  console.log("\n── Test 3: getBlockByNumber (block 1) ──");
  try {
    const block = await demos.getBlockByNumber(1);
    console.log(`✅ Block #1: ${block.content.ordered_transactions?.length || 0} txs`);
  } catch (err: any) {
    console.log("❌ getBlockByNumber failed: " + err.message);
  }

  // Step 5: Try rpcCall directly for GCR-related queries
  console.log("\n── Test 4: Direct RPC call (status) ──");
  try {
    const statusResult = await demos.rpcCall({
      method: "status",
      params: [],
    });
    console.log("✅ RPC status:", JSON.stringify(statusResult).slice(0, 300));
  } catch (err: any) {
    console.log("❌ RPC status failed: " + err.message);
  }

  // Step 6: Try to get nonce (simpler test)
  console.log("\n── Test 5: getAddressNonce ──");
  try {
    const nonce = await demos.getAddressNonce(address);
    console.log(`✅ Nonce: ${nonce}`);
  } catch (err: any) {
    console.log("❌ Nonce failed: " + err.message);
  }

  // Summary
  console.log("\n═══ SPIKE RESULT ════════════════════════════");
  console.log("GCR data is stored as transaction content in blocks.");
  console.log("To access full feed history beyond API cap:");
  console.log("  - getBlocks() can retrieve block data with tx hashes");
  console.log("  - Transaction content (post text, attestations) needs");
  console.log("    to be decoded from block.content.ordered_transactions");
  console.log("  - Whether tx content is readable depends on RPC response");
  console.log("Check output above for pass/fail on each method.");
}

main().catch((err) => {
  console.error("❌ FATAL:", err.message);
  process.exit(1);
});
