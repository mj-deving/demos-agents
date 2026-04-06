/**
 * Hive API — ColonyPublisher-compatible convenience layer.
 *
 * Maps the documented ColonyPublisher method names to our toolkit
 * primitives. Thin delegates — no logic, just routing.
 */

import type { AgentRuntime } from "../../../src/toolkit/agent-runtime.js";
import type { ApiResult } from "../../../src/toolkit/supercolony/types.js";

export interface HiveAPI {
  getFeed(opts?: { limit?: number; category?: string }): Promise<ApiResult<any>>;
  search(opts: { text?: string; category?: string }): Promise<ApiResult<any>>;
  tip(txHash: string, amount: number): Promise<ApiResult<any>>;
  react(txHash: string, type: "agree" | "disagree" | "flag"): Promise<ApiResult<any>>;
  getOracle(opts?: { assets?: string[] }): Promise<ApiResult<any>>;
  getPrices(assets: string[]): Promise<ApiResult<any>>;
  getBalance(): Promise<ApiResult<any>>;
  getPool(opts?: { asset?: string; horizon?: string }): Promise<ApiResult<any>>;
  getSignals(): Promise<ApiResult<any>>;
  getLeaderboard(opts?: { limit?: number }): Promise<ApiResult<any>>;
  getAgents(): Promise<ApiResult<any>>;
  placeBet(asset: string, price: number, opts?: { horizon?: string }): Promise<ApiResult<any>>;
  getReactions(txHash: string): Promise<ApiResult<any>>;
  getTipStats(txHash: string): Promise<ApiResult<any>>;
}

export function createHiveAPI(runtime: AgentRuntime): HiveAPI {
  const { toolkit } = runtime;
  return {
    getFeed: (opts) => toolkit.feed.getRecent(opts),
    search: (opts) => toolkit.feed.search(opts),
    tip: (txHash, amount) => toolkit.actions.tip(txHash, amount),
    react: (txHash, type) => toolkit.actions.react(txHash, type),
    getOracle: (opts) => toolkit.oracle.get(opts),
    getPrices: (assets) => toolkit.prices.get(assets),
    getBalance: () => toolkit.balance.get(runtime.address),
    getPool: (opts) => toolkit.ballot.getPool(opts),
    getSignals: () => toolkit.intelligence.getSignals(),
    getLeaderboard: (opts) => toolkit.scores.getLeaderboard(opts),
    getAgents: () => toolkit.agents.list(),
    placeBet: (asset, price, opts) => toolkit.actions.placeBet(asset, price, opts),
    getReactions: (txHash) => toolkit.actions.getReactions(txHash),
    getTipStats: (txHash) => toolkit.actions.getTipStats(txHash),
  };
}
