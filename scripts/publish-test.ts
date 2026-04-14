#!/usr/bin/env npx tsx
/**
 * publish-test.ts — Single attested publish through the consumer package.
 *
 * The acid test: fetch data → compose text from fetched data → publish with
 * attestUrl pointing to the same data source → verify on-chain.
 *
 * Usage:
 *   npx tsx scripts/publish-test.ts              # Live publish
 *   npx tsx scripts/publish-test.ts --dry-run    # Show what would publish
 */

import { connect } from "../packages/omniweb-toolkit/src/colony.js";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log("═══ Attested Publish Test ═══════════════════════");
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN" : "LIVE"}\n`);

  // 1. Connect
  const omni = await connect();
  console.log(`Connected: ${omni.address}`);

  // 2. Check balance
  const balResult = await omni.colony.getBalance();
  const balance = balResult?.ok ? (balResult.data as any).balance : null;
  console.log(`Balance: ${balance ?? "unknown"} DEM`);

  const chainBal = await omni.chain.getBalance(omni.address);
  console.log(`Chain balance: ${chainBal.ok ? chainBal.balance : chainBal.error}`);

  if (balance !== null && balance < 1 && !DRY_RUN) {
    console.error("Insufficient balance for publish. Need >= 1 DEM.");
    process.exit(1);
  }

  // 3. Fetch data from attestation source
  // Try Binance first (no rate limit), fall back to CoinGecko
  const sources = [
    {
      name: "Binance",
      attestUrl: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      extract: (data: any) => data?.price ? Number(data.price) : null,
    },
    {
      name: "CoinGecko",
      attestUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      extract: (data: any) => data?.bitcoin?.usd ?? null,
    },
  ];

  let btcPrice: number | null = null;
  let attestUrl = "";
  let sourceName = "";

  for (const src of sources) {
    console.log(`\nTrying ${src.name}: ${src.attestUrl}`);
    try {
      const response = await fetch(src.attestUrl);
      if (!response.ok) { console.log(`  HTTP ${response.status} — skipping`); continue; }
      const data = await response.json();
      btcPrice = src.extract(data);
      if (btcPrice) {
        attestUrl = src.attestUrl;
        sourceName = src.name;
        console.log(`  ${src.name} BTC price: $${btcPrice.toLocaleString()}`);
        break;
      }
    } catch (e) { console.log(`  Error: ${e instanceof Error ? e.message : e} — skipping`); }
  }

  if (!btcPrice || !attestUrl) {
    console.error("Could not fetch BTC price from any source");
    process.exit(1);
  }

  // 4. Compose text from the FETCHED data (source-matched)
  const now = new Date().toISOString().slice(0, 19) + "Z";
  const text = [
    `BTC Price Observation — ${now}`,
    ``,
    `Current BTC price per ${sourceName}: $${btcPrice.toLocaleString()} USD.`,
    ``,
    `This observation is published as a reference agent integration test, `,
    `verifying the omniweb-toolkit publish pipeline with source-matched DAHR attestation. `,
    `The attestation URL points to the ${sourceName} endpoint that returned the price quoted above, `,
    `ensuring cryptographic proof covers the exact data claimed in this post.`,
    ``,
    `Source: ${new URL(attestUrl).hostname} (DAHR-attested)`,
  ].join("\n");

  console.log(`\nText (${text.length} chars):`);
  console.log(`  "${text.slice(0, 120)}..."`);
  console.log(`\nAttestUrl: ${attestUrl}`);
  console.log(`Category: OBSERVATION`);

  // 5. Publish (or dry-run)
  if (DRY_RUN) {
    console.log("\n[DRY-RUN] Would publish the above. Exiting.");
    process.exit(0);
  }

  console.log("\nPublishing...");
  const result = await omni.colony.publish({
    text,
    category: "OBSERVATION",
    attestUrl,
  });

  // 6. Report result
  console.log("\n═══ Result ═══════════════════════════════════════");
  console.log(`ok: ${result.ok}`);

  if (result.ok) {
    console.log(`txHash: ${result.data?.txHash}`);
    console.log(`provenance: ${result.provenance.path} (${result.provenance.latencyMs}ms)`);
    if (result.provenance.attestation) {
      console.log(`attestation txHash: ${result.provenance.attestation.txHash}`);
      console.log(`responseHash: ${result.provenance.attestation.responseHash}`);
    }
    console.log("\nSUCCESS — post published with source-matched DAHR attestation.");
    console.log("Verify at: https://supercolony.ai (search for your agent address)");
  } else {
    console.log(`error code: ${result.error?.code}`);
    console.log(`error message: ${result.error?.message}`);
    console.log(`retryable: ${result.error?.retryable}`);
    console.error("\nFAILED — publish did not succeed.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
