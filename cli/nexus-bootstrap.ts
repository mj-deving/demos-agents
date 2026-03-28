#!/usr/bin/env npx tsx
/**
 * NEXUS Bootstrap — create the agent's first on-chain Storage Program.
 *
 * This script:
 * 1. Connects wallet + authenticates
 * 2. Creates nexus-state Storage Program (public ACL)
 * 3. Writes initial state (agent, version, started)
 * 4. Reads back and verifies
 * 5. Writes a field update (setField)
 * 6. Reads updated field and verifies
 * 7. Lists agent's programs
 *
 * Usage:
 *   npx tsx tools/nexus-bootstrap.ts [--env PATH] [--dry-run]
 */

import { Demos, DemosTransactions } from "@kynesyslabs/demosdk/websdk";
import { StorageProgram } from "@kynesyslabs/demosdk/storage";
import { connectWallet, info, setLogAgent } from "../src/lib/network/sdk.js";
const warn = (msg: string) => console.warn(`[nexus] WARN: ${msg}`);
import type { Transaction } from "@kynesyslabs/demosdk/types";

const RPC_URL = "https://demosnode.discus.sh/";

// ── Args ────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const envIdx = args.indexOf("--env");
const envPath = envIdx >= 0 ? args[envIdx + 1] : undefined;

// ── Helpers ─────────────────────────────────────────

function formatResult(label: string, data: unknown): void {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(data, null, 2));
}

async function submitStorageTransaction(
  demos: Demos,
  payload: any,
  storageAddress: string,
  senderAddress: string,
): Promise<string> {
  // Use DemosTransactions.empty() for proper base object (avoids missing fields)
  const tx = DemosTransactions.empty();
  tx.content = {
    ...tx.content,
    type: "storageProgram",
    from: senderAddress,
    to: storageAddress,
    data: ["storageProgram", payload],
    amount: 0,
    timestamp: Date.now(),
  };

  info("Signing transaction...");
  const signed = await demos.sign(tx as Transaction);

  info("Confirming transaction...");
  const validity = await demos.confirm(signed);

  info("Broadcasting transaction...");
  const result = await demos.broadcast(validity);

  // Extract txHash (same pattern as publish-pipeline.ts)
  const confirmHash = (validity as any)?.response?.data?.transaction?.hash;
  const results = (result as any)?.response?.results;
  const txHash = confirmHash || (results
    ? results[Object.keys(results)[0]]?.hash
    : (result as any)?.response?.data?.transaction?.hash ||
      (result as any)?.hash ||
      "unknown");

  info(`Transaction hash: ${txHash}`);
  return txHash;
}

// ── Main ────────────────────────────────────────────

async function main(): Promise<void> {
  setLogAgent("nexus");
  info("NEXUS Bootstrap starting...");

  // Step 1: Connect wallet
  info("Connecting wallet...");
  const { demos, address } = await connectWallet(envPath || ".env", "nexus");
  info(`Wallet connected: ${address}`);

  // Derive storage address
  // Use nonce=1 for the primary state program (deterministic)
  const storageAddress = StorageProgram.deriveStorageAddress(address, "nexus-state", 1);
  info(`Derived storage address: ${storageAddress}`);

  // Step 2: Check if program already exists
  info("Checking if nexus-state already exists...");
  const existing = await StorageProgram.getByAddress(RPC_URL, storageAddress, address);
  if (existing && existing.storageAddress) {
    info("nexus-state already exists — skipping creation");
    formatResult("Existing Program", {
      storageAddress: existing.storageAddress,
      programName: existing.programName,
      encoding: existing.encoding,
      sizeBytes: existing.sizeBytes,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      data: existing.data,
    });
  } else if (existing) {
    info("nexus-state query returned empty object — program may not exist yet");
    formatResult("Raw Response", existing);
  } else {
    // Step 3: Create Storage Program
    info("Creating nexus-state Storage Program...");
    const initialState = {
      agent: "nexus",
      version: "1.0.0",
      tier: "omniweb",
      started: new Date().toISOString(),
      state: {
        lastLoop: null,
        loopCount: 0,
        attestationCount: 0,
      },
      budget: {
        totalBalance: 0,
        sessionSpend: 0,
        sessionIncome: 0,
      },
      coordination: {
        availableTasks: [],
        signals: [],
      },
    };

    const payload = StorageProgram.createStorageProgram(
      address,
      "nexus-state",
      initialState,
      "json",
      StorageProgram.publicACL(),
      { nonce: 1 },
    );

    if (dryRun) {
      info("[dry-run] Would create Storage Program");
      formatResult("Create Payload", payload);
    } else {
      const txHash = await submitStorageTransaction(demos, payload, storageAddress, address);
      formatResult("Storage Program Created", { storageAddress, txHash });

      // Wait for indexing
      info("Waiting 5s for indexing...");
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Step 4: Read back state
  info("Reading nexus-state from chain...");
  const readResult = await StorageProgram.getByAddress(RPC_URL, storageAddress, address);
  if (readResult && readResult.storageAddress) {
    formatResult("Read State", {
      programName: readResult.programName,
      encoding: readResult.encoding,
      sizeBytes: readResult.sizeBytes,
      data: readResult.data,
    });
  } else {
    formatResult("Raw Read Response", readResult);
    warn("nexus-state not found or empty response — program may need creation");
  }

  // Step 5: Write field update
  if (!dryRun && readResult) {
    info("Writing field update: lastLoop = now...");
    const setPayload = StorageProgram.setField(
      storageAddress,
      "lastBootstrap",
      new Date().toISOString(),
    );

    const txHash = await submitStorageTransaction(demos, setPayload, storageAddress, address);
    formatResult("Field Update", { field: "lastBootstrap", txHash });

    // Wait for indexing
    info("Waiting 3s for indexing...");
    await new Promise(r => setTimeout(r, 3000));

    // Step 6: Read updated field
    info("Reading updated field...");
    const fieldResult = await StorageProgram.getValue(
      RPC_URL,
      storageAddress,
      "lastBootstrap",
      address,
    );
    if (fieldResult) {
      formatResult("Field Read", fieldResult);
    } else {
      warn("Field not found (may need more indexing time)");
    }
  }

  // Step 7: List all programs
  info("Listing agent programs...");
  const programs = await StorageProgram.getByOwner(RPC_URL, address, address);
  if (Array.isArray(programs)) {
    formatResult("Agent Programs", programs.map(p => ({
      name: p.programName,
      address: p.storageAddress,
      size: p.sizeBytes,
      updated: p.updatedAt,
    })));
  } else {
    formatResult("Agent Programs (raw response)", programs);
  }

  info("\nNEXUS Bootstrap complete.");
  if (readResult) {
    info(`Storage Address: ${storageAddress}`);
    info("Add this to agents/nexus/persona.yaml as storageAddress.");
  }
}

main().catch((err) => {
  console.error(`[nexus-bootstrap] Fatal: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
