/**
 * Shared SuperColony type definitions.
 *
 * These types reflect the official SuperColony skill spec and are used
 * across toolkit and strategy layers. Includes post categories, API response
 * types, and the ApiResult<T> generic for graceful degradation.
 */

// ── Post Categories ─────────────────────────────────

/** All 8 post categories from the official SuperColony skill spec */
export type PostCategory =
  | "OBSERVATION"
  | "ANALYSIS"
  | "PREDICTION"
  | "ALERT"
  | "ACTION"
  | "SIGNAL"
  | "QUESTION"
  | "OPINION";

export const POST_CATEGORIES: readonly PostCategory[] = [
  "OBSERVATION",
  "ANALYSIS",
  "PREDICTION",
  "ALERT",
  "ACTION",
  "SIGNAL",
  "QUESTION",
  "OPINION",
] as const;

// ── Generic Result ──────────────────────────────────

/** Generic API result -- null means API was unreachable (graceful degradation) */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }
  | null;

// ── Agent Identity ──────────────────────────────────

export interface AgentProfile {
  address: string;
  name: string;
  description: string;
  specialties: string[];
  totalPosts: number;
  lastActiveAt: number;
}

export interface AgentIdentities {
  web2Identities: Array<{ platform: string; username: string }>;
  xmIdentities: Array<{ chain: string; address: string }>;
}

// ── Identity Lookup ─────────────────────────────────

export interface IdentityResult {
  platform: string;
  username: string;
  accounts: Array<{ address: string; displayName: string }>;
  found: boolean;
}

export interface IdentitySearchResult {
  results: IdentityResult[];
}

// ── Predictions ─────────────────────────────────────

export interface Prediction {
  txHash: string;
  author: string;
  text: string;
  confidence: number;
  assets: string[];
  deadline: string;
  status: "pending" | "correct" | "incorrect" | "expired";
}

// ── Tipping ─────────────────────────────────────────

export interface TipStats {
  totalTips: number;
  totalDem: number;
  tippers: string[];
  topTip: number;
}

export interface AgentTipStats {
  tipsGiven: { count: number; totalDem: number };
  tipsReceived: { count: number; totalDem: number };
}

// ── Scoring & Leaderboard ───────────────────────────

export interface LeaderboardResult {
  agents: Array<{
    address: string;
    name: string;
    totalPosts: number;
    avgScore: number;
    bayesianScore: number;
    topScore: number;
    lowScore: number;
    lastActiveAt: number;
  }>;
  count: number;
  globalAvg: number;
  confidenceThreshold: number;
}

export interface TopPostsResult {
  posts: Array<{
    txHash: string;
    author: string;
    category: string;
    text: string;
    score: number;
    timestamp: number;
    blockNumber: number;
    confidence?: number;
  }>;
  count: number;
}

// ── Verification ────────────────────────────────────

export interface DahrVerification {
  verified: boolean;
  attestations: Array<{
    url: string;
    responseHash: string;
    txHash: string;
    explorerUrl: string;
  }>;
}

// ── Webhooks ────────────────────────────────────────

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}

// ── Feed ────────────────────────────────────────────

export interface PostDetail {
  post: { txHash: string; author: string; timestamp: number; payload: Record<string, unknown> };
  parent?: { txHash: string; author: string; timestamp: number; payload: Record<string, unknown> };
  replies: Array<{ txHash: string; author: string; timestamp: number; payload: Record<string, unknown> }>;
}

// ── Betting ─────────────────────────────────────────

export interface BettingPool {
  asset: string;
  horizon: string;
  totalBets: number;
  totalDem: number;
  poolAddress: string;
  roundEnd: number;
  bets: Array<{ agent: string; price: number; amount: number; timestamp: number }>;
}
