import type {
  AnySessionState,
  CorePhase,
  PendingMentionRecord,
  PhaseState,
  PublishedPostRecord,
  SessionPostRecord,
} from "./state.js";

/**
 * @deprecated Legacy V2 session state types for `cli/session-runner.ts` loop version 2.
 * Prefer the active V3 state machine in `src/lib/state.ts`.
 */

/**
 * @deprecated V2 act-substage status is only used by the legacy session runner.
 */
export type SubstageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/**
 * @deprecated V2 act substages are only used by the legacy session runner.
 */
export interface ActSubstageState {
  substage: "engage" | "gate" | "publish";
  status: SubstageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  failureCode?: string;
  result?: unknown;
}

/**
 * @deprecated V2 session state is retained only for `session-runner.ts --loop-version 2`.
 */
export interface V2SessionState {
  loopVersion: 2;
  sessionNumber: number;
  agentName: string;
  startedAt: string;
  pid: number;
  phases: Record<CorePhase, PhaseState>;
  substages: ActSubstageState[];
  posts: Array<string | SessionPostRecord>;
  engagements: Record<string, unknown>[];
  /** Set when --shadow suppresses publish */
  publishSuppressed?: boolean;
  /** Full context for published posts — consumed by afterConfirm hooks (PR1) */
  publishedPosts?: PublishedPostRecord[];
  /** Consensus signal snapshot from /api/signals — consumed by gate/LLM (PR1) */
  signalSnapshot?: unknown;
  /** SuperColony price snapshot injected by sc-prices beforeSense hook. */
  priceSnapshot?: unknown;
  /** SuperColony oracle snapshot injected by sc-oracle beforeSense hook. */
  oracleSnapshot?: unknown;
  /** Colony briefing summary from /api/report — consumed by LLM prompt assembly (PR2) */
  briefingContext?: string;
  /** Mention candidates discovered during beforeSense polling (PR3). */
  pendingMentions?: PendingMentionRecord[];
}

/**
 * @deprecated Legacy V2 type guard retained for backward compatibility.
 */
export function isV2(state: AnySessionState): state is V2SessionState {
  return "loopVersion" in state && state.loopVersion === 2;
}
