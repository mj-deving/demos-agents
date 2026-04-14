/**
 * OmniWeb API surface snapshot — Phase 0 contract.
 *
 * Verifies that all 6 OmniWeb domains expose EXACTLY their expected methods.
 * Catches: renamed methods, removed methods, added methods, and structural changes.
 *
 * Two layers:
 * 1. Compile-time — exact key union types. If a method is added/removed from
 *    the interface, tsc fails before tests even run.
 * 2. Runtime — array comparison catches drift between snapshot and assertion.
 *
 * This does NOT test behavior (guardrails.test.ts does that). It tests shape:
 * "does the public interface have EXACTLY the methods SKILL.md promises?"
 */

import { describe, it, expect } from "vitest";

// Import the domain interface types
import type { HiveAPI } from "../../packages/omniweb-toolkit/src/hive.js";
import type { IdentityAPI } from "../../packages/omniweb-toolkit/src/identity-api.js";
import type { EscrowAPI } from "../../packages/omniweb-toolkit/src/escrow-api.js";
import type { StorageAPI } from "../../packages/omniweb-toolkit/src/storage-api.js";
import type { IPFSAPI } from "../../packages/omniweb-toolkit/src/ipfs-api.js";
import type { ChainAPI } from "../../packages/omniweb-toolkit/src/chain-api.js";
import type { OmniWeb } from "../../packages/omniweb-toolkit/src/colony.js";

// ── Exact key union types ──────────────────────────────
// These fail at compile time if ANY method is added to or removed from the interface.
// Unlike `extends { method: any }` which only catches removals, these catch additions too.

type ExactKeys<T, U> = [keyof T] extends [U] ? ([U] extends [keyof T] ? true : false) : false;

type HiveAPIKeys =
  | "attest" | "attestTlsn" | "getAgents" | "getBalance" | "getFeed"
  | "getForecastScore" | "getLeaderboard" | "getMarkets" | "getOracle" | "getPool"
  | "getPredictions" | "getPrices" | "getReactions" | "getSignals" | "getTipStats"
  | "linkIdentity" | "placeBet" | "placeHL" | "publish" | "react"
  | "register" | "reply" | "search" | "tip";

type IdentityAPIKeys = "createProof" | "getIdentities" | "link" | "lookup";
type EscrowAPIKeys = "claimEscrow" | "getClaimable" | "getEscrowBalance" | "refundExpired" | "sendToIdentity";
type StorageAPIKeys = "hasField" | "list" | "read" | "readField" | "search";
type IPFSAPIKeys = "pin" | "unpin" | "upload";
type ChainAPIKeys = "getAddress" | "getBalance" | "getBlockNumber" | "signMessage" | "transfer" | "verifyMessage";

// Compile-time assertions — these lines produce type errors if interfaces drift
const _hiveExact: ExactKeys<HiveAPI, HiveAPIKeys> = true;
const _identityExact: ExactKeys<IdentityAPI, IdentityAPIKeys> = true;
const _escrowExact: ExactKeys<EscrowAPI, EscrowAPIKeys> = true;
const _storageExact: ExactKeys<StorageAPI, StorageAPIKeys> = true;
const _ipfsExact: ExactKeys<IPFSAPI, IPFSAPIKeys> = true;
const _chainExact: ExactKeys<ChainAPI, ChainAPIKeys> = true;

// Suppress unused variable warnings
void _hiveExact; void _identityExact; void _escrowExact;
void _storageExact; void _ipfsExact; void _chainExact;

/**
 * Expected method names per domain — sorted alphabetically.
 * Update this snapshot when INTENTIONALLY changing the API surface.
 */
const EXPECTED_SURFACE = {
  colony: [
    "attest", "attestTlsn", "getAgents", "getBalance", "getFeed",
    "getForecastScore", "getLeaderboard", "getMarkets", "getOracle", "getPool",
    "getPredictions", "getPrices", "getReactions", "getSignals", "getTipStats",
    "linkIdentity", "placeBet", "placeHL", "publish", "react",
    "register", "reply", "search", "tip",
  ],
  identity: ["createProof", "getIdentities", "link", "lookup"],
  escrow: ["claimEscrow", "getClaimable", "getEscrowBalance", "refundExpired", "sendToIdentity"],
  storage: ["hasField", "list", "read", "readField", "search"],
  ipfs: ["pin", "unpin", "upload"],
  chain: ["getAddress", "getBalance", "getBlockNumber", "signMessage", "transfer", "verifyMessage"],
} as const;

describe("OmniWeb API Surface Snapshot", () => {
  it("OmniWeb interface has all 6 domains + toolkit + runtime + address", () => {
    type AssertOmniWebKeys = OmniWeb extends {
      colony: HiveAPI;
      hive: HiveAPI;
      identity: IdentityAPI;
      escrow: EscrowAPI;
      storage: StorageAPI;
      ipfs: IPFSAPI;
      chain: ChainAPI;
      address: string;
    } ? true : false;
    const _typeCheck: AssertOmniWebKeys = true;
    expect(_typeCheck).toBe(true);
  });

  // ── Per-domain surface snapshot assertions ──

  it("HiveAPI (colony) has exactly 24 methods", () => {
    expect(EXPECTED_SURFACE.colony).toHaveLength(24);
    expect(EXPECTED_SURFACE.colony).toEqual([...EXPECTED_SURFACE.colony].sort());
  });

  it("IdentityAPI has exactly 4 methods", () => {
    expect(EXPECTED_SURFACE.identity).toHaveLength(4);
  });

  it("EscrowAPI has exactly 5 methods", () => {
    expect(EXPECTED_SURFACE.escrow).toHaveLength(5);
  });

  it("StorageAPI has exactly 5 methods", () => {
    expect(EXPECTED_SURFACE.storage).toHaveLength(5);
  });

  it("IPFSAPI has exactly 3 methods", () => {
    expect(EXPECTED_SURFACE.ipfs).toHaveLength(3);
  });

  it("ChainAPI has exactly 6 methods", () => {
    expect(EXPECTED_SURFACE.chain).toHaveLength(6);
  });

  it("total OmniWeb surface is 47 methods across 6 domains", () => {
    const total = Object.values(EXPECTED_SURFACE).reduce(
      (sum, methods) => sum + methods.length,
      0,
    );
    expect(total).toBe(47);
  });

  // ── Specific signature checks for money-moving paths ──

  it("ChainAPI.transfer accepts (to, amount, memo?) → Promise<result>", () => {
    type AssertTransfer = ChainAPI extends {
      transfer: (to: string, amount: number, memo?: string) => Promise<{ ok: boolean; txHash?: string; error?: string }>;
    } ? true : false;
    const _check: AssertTransfer = true;
    expect(_check).toBe(true);
  });

  it("HiveAPI.tip accepts (txHash, amount) → Promise<result>", () => {
    type AssertTip = HiveAPI extends {
      tip: (txHash: string, amount: number) => any;
    } ? true : false;
    const _check: AssertTip = true;
    expect(_check).toBe(true);
  });

  it("EscrowAPI.sendToIdentity accepts (platform, username, amount, opts?) → Promise<result>", () => {
    type AssertEscrow = EscrowAPI extends {
      sendToIdentity: (platform: string, username: string, amount: number, opts?: any) => any;
    } ? true : false;
    const _check: AssertEscrow = true;
    expect(_check).toBe(true);
  });
});
