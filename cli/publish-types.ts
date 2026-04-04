import type { Demos } from "@kynesyslabs/demosdk/websdk";

import type { StrategyAction } from "./v3-strategy-bridge.js";
import type { V3SessionState, PublishedPostRecord } from "../src/lib/state.js";
import type { AgentConfig } from "../src/lib/agent-config.js";
import type { AgentSourceView } from "../src/lib/sources/catalog.js";
import type { LLMProvider } from "../src/lib/llm/llm-provider.js";
import type { FileStateStore } from "../src/toolkit/state-store.js";
import type { ColonyDatabase } from "../src/toolkit/colony/schema.js";
import type {
  ProviderAdapter,
  FetchedResponse,
  CandidateRequest,
} from "../src/lib/sources/providers/types.js";
import type { SourceUsageTracker } from "../src/lib/attestation/attestation-planner.js";
import type { SpendingLedger, SpendingPolicyConfig } from "../src/lib/spending-policy.js";

export type PublishAttestationType = "DAHR" | "TLSN" | "none";

export interface ReplyContext {
  txHash: string;
  author: string;
  text: string;
}

export interface ResolvedActionSource {
  source: import("../src/lib/sources/catalog.js").SourceRecordV2;
  url: string;
  method: "DAHR" | "TLSN";
  sourceName: string;
  adapterCandidates?: CandidateRequest[];
}

export interface PrefetchedSourceData {
  llmContext?: {
    source: string;
    url: string;
    summary: string;
  };
  prefetchedResponses?: Map<string, FetchedResponse>;
}

export interface PublishActionResult {
  action: StrategyAction;
  success: boolean;
  txHash?: string;
  category?: string;
  textLength?: number;
  attestationType?: "DAHR" | "TLSN" | "none";
  error?: string;
}

export interface PublishExecutionResult {
  executed: PublishActionResult[];
  skipped: Array<{ action: StrategyAction; reason: string }>;
}

export interface PublishExecutorDeps {
  demos: Demos;
  walletAddress: string;
  provider: LLMProvider | null;
  agentConfig: AgentConfig;
  sourceView: AgentSourceView;
  state: V3SessionState;
  sessionsDir: string;
  observe: (type: string, message: string, meta?: Record<string, unknown>) => void;
  dryRun: boolean;
  stateStore: FileStateStore;
  colonyDb?: ColonyDatabase;
  calibrationOffset: number;
  scanContext: { activity_level: string; posts_per_hour: number; gaps?: string[] };
  adapters?: Map<string, ProviderAdapter>;
  usageTracker?: SourceUsageTracker;
  logSession: (entry: unknown) => void;
  logQuality: (data: unknown) => void;
  /** Optional spending guard for VOTE/BET session budget enforcement */
  spending?: { policy: SpendingPolicyConfig; ledger: SpendingLedger };
}
