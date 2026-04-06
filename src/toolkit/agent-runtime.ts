/**
 * Agent Runtime Factory — encapsulates the 6-step SDK init sequence.
 *
 * Mirrors v3-loop.ts lines 73-103 as a reusable factory so templates
 * can boot a complete runtime in one call instead of duplicating init.
 *
 * Steps: connectWallet → createSdkBridge → ensureAuth →
 * SuperColonyApiClient → AutoDataSource → createToolkit
 */

import type { Demos } from "@kynesyslabs/demosdk/websdk";
import { connectWallet } from "../lib/network/sdk.js";
import { ensureAuth, loadAuthCache } from "../lib/auth/auth.js";
import { createSdkBridge, AUTH_PENDING_TOKEN } from "./sdk-bridge.js";
import type { SdkBridge } from "./sdk-bridge.js";
import { SuperColonyApiClient } from "./supercolony/api-client.js";
import { ApiDataSource, ChainDataSource, AutoDataSource } from "./data-source.js";
import { createToolkit } from "./primitives/index.js";
import type { Toolkit } from "./primitives/types.js";
import type { ColonyDatabase } from "./colony/schema.js";
import { resolveProvider } from "../lib/llm/llm-provider.js";
import type { LLMProvider } from "../lib/llm/llm-provider.js";

export interface AgentRuntime {
  toolkit: Toolkit;
  sdkBridge: SdkBridge;
  address: string;
  getToken: () => Promise<string | null>;
  demos: Demos;
  /** Authenticated API call wrapper — sdkBridge captures AUTH_PENDING_TOKEN at
   *  construction and never updates. Same pattern as v3-loop.ts:89-95. */
  authenticatedApiCall: (path: string, options?: RequestInit) => Promise<{ ok: boolean; status: number; data: unknown }>;
  /** Colony DB instance (optional — templates work without it) */
  colonyDb?: ColonyDatabase;
  /** LLM provider for heavy-path publishing (drafting post text from evidence) */
  llmProvider: LLMProvider | null;
}

export interface AgentRuntimeOptions {
  envPath?: string;
  agentName?: string;
  apiBaseUrl?: string; // default: https://supercolony.ai
}

/**
 * Initialize a complete agent runtime — SDK, auth, toolkit.
 *
 * Encapsulates: connectWallet -> createSdkBridge -> ensureAuth ->
 * SuperColonyApiClient -> AutoDataSource -> createToolkit
 *
 * Equivalent to v3-loop.ts lines 73-103 but as a reusable factory.
 */
export async function createAgentRuntime(opts?: AgentRuntimeOptions): Promise<AgentRuntime> {
  const envPath = opts?.envPath ?? ".env";

  // Step 1: Connect wallet (SDK + mnemonic)
  const { demos, address } = await connectWallet(envPath, opts?.agentName);

  // Step 2: Create SDK bridge
  const sdkBridge = createSdkBridge(demos, opts?.apiBaseUrl, AUTH_PENDING_TOKEN);

  // Step 3: Authenticate (graceful degradation — chain-only on failure)
  let authToken: string | null = null;
  try {
    authToken = await ensureAuth(demos, address);
  } catch {
    console.warn("[agent-runtime] Auth failed — continuing in chain-only mode");
  }

  // Step 4: Create API client with lazy token refresh
  const getToken = async () => authToken ?? loadAuthCache(address)?.token ?? null;
  const apiClient = new SuperColonyApiClient({ getToken });

  // Step 5: Create data source (API-first, chain fallback)
  const apiDataSource = new ApiDataSource(apiClient);
  const chainDataSource = new ChainDataSource(sdkBridge as any);
  const dataSource = new AutoDataSource(apiDataSource, chainDataSource);

  // Step 6: Create toolkit
  const toolkit = createToolkit({
    apiClient,
    dataSource,
    transferDem: (to, amount, memo) => sdkBridge.transferDem(to, amount, memo),
  });

  // Step 7: Create authenticated API call wrapper (Codex review fix #3)
  // sdkBridge captures AUTH_PENDING_TOKEN at construction — its apiCall never authenticates.
  const { apiCall: rawApiCall } = await import("../lib/network/sdk.js");
  const authenticatedApiCall = async (path: string, options?: RequestInit) => {
    const token = await getToken();
    return rawApiCall(path, token, options);
  };

  // Step 8: Resolve LLM provider (optional — null if no API keys configured)
  const llmProvider = resolveProvider(envPath);

  return { toolkit, sdkBridge, address, getToken, demos, authenticatedApiCall, llmProvider };
}
