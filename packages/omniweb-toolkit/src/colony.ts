/**
 * OmniWeb — the runtime object returned by connect().
 *
 * Bundles the full Demos OmniWeb stack: SuperColony social layer,
 * identity linking, escrow, on-chain storage, IPFS, chain core,
 * and the raw AgentRuntime.
 *
 * Named "omniweb" to match the package name. Colony is kept as
 * a backward-compat alias.
 */

import { createAgentRuntime } from "../../../src/toolkit/agent-runtime.js";
import type { AgentRuntime } from "../../../src/toolkit/agent-runtime.js";
import type { Toolkit } from "../../../src/toolkit/primitives/types.js";
import { createHiveAPI } from "./hive.js";
import type { HiveAPI } from "./hive.js";
import { createIdentityAPI } from "./identity-api.js";
import type { IdentityAPI } from "./identity-api.js";
import { createEscrowAPI } from "./escrow-api.js";
import type { EscrowAPI } from "./escrow-api.js";
import { createStorageAPI } from "./storage-api.js";
import type { StorageAPI } from "./storage-api.js";
import { createIPFSAPI } from "./ipfs-api.js";
import type { IPFSAPI } from "./ipfs-api.js";
import { createChainAPI } from "./chain-api.js";
import type { ChainAPI } from "./chain-api.js";

export interface ConnectOptions {
  envPath?: string;
  agentName?: string;
  /** Override state directory for write guard persistence */
  stateDir?: string;
  /** URL allowlist for attestation — only these origins can be attested */
  urlAllowlist?: string[];
  /** Allow insecure (HTTP) URLs — for local dev only */
  allowInsecureUrls?: boolean;
}

/** The full OmniWeb runtime — all Demos domains in one object. */
export interface OmniWeb {
  /** SuperColony social intelligence layer (posts, signals, predictions, scoring). */
  colony: HiveAPI;
  /** Alias for colony — backward compat with colony.hive naming. */
  hive: HiveAPI;
  /** Demos identity linking and lookup (Twitter, GitHub, Discord, Telegram). */
  identity: IdentityAPI;
  /** Trustless tipping to social identities via Demos escrow. */
  escrow: EscrowAPI;
  /** On-chain programmable databases via Demos StorageProgram. */
  storage: StorageAPI;
  /** Decentralized file storage via Demos IPFS integration. */
  ipfs: IPFSAPI;
  /** Core Demos chain operations (transfer, balance, signing). */
  chain: ChainAPI;
  /** Full internal toolkit surface for advanced usage. */
  toolkit: Toolkit;
  /** Raw AgentRuntime for advanced usage. */
  runtime: AgentRuntime;
  /** Connected wallet address. */
  address: string;
}

/** @deprecated Use OmniWeb instead. */
export type Colony = OmniWeb;

export async function connect(opts?: ConnectOptions): Promise<OmniWeb> {
  const runtime = await createAgentRuntime(opts);
  const rpcUrl = runtime.rpcUrl;

  const colonyAPI = createHiveAPI(runtime, {
    stateDir: opts?.stateDir,
    urlAllowlist: opts?.urlAllowlist,
    allowInsecureUrls: opts?.allowInsecureUrls,
  });

  return {
    colony: colonyAPI,
    hive: colonyAPI,
    identity: createIdentityAPI(runtime.demos, rpcUrl, runtime.address),
    escrow: createEscrowAPI(runtime.demos, rpcUrl, runtime.address),
    storage: createStorageAPI(rpcUrl, runtime.address, opts?.agentName, runtime.demos),
    ipfs: createIPFSAPI(runtime.demos),
    chain: createChainAPI(runtime.demos, runtime.sdkBridge, runtime.address),
    toolkit: runtime.toolkit,
    runtime,
    address: runtime.address,
  };
}
