/**
 * Hive API — ColonyPublisher-compatible convenience layer.
 *
 * Maps the documented ColonyPublisher method names to our toolkit
 * primitives. Read methods are thin delegates (no logic, just routing).
 * Write methods lazily create a DemosSession on first call to avoid
 * session overhead for read-only consumers.
 */

import type { AgentRuntime } from "../../../src/toolkit/agent-runtime.js";
import type { ApiResult } from "../../../src/toolkit/supercolony/types.js";
import type {
  PublishDraft,
  ReplyOptions,
  AttestOptions,
  ToolResult,
  PublishResult,
  AttestResult,
} from "../../../src/toolkit/types.js";
import { err } from "../../../src/toolkit/types.js";
import { DemosSession } from "../../../src/toolkit/session.js";
import { createSessionFromRuntime } from "./session-factory.js";
import type { SessionFactoryOptions } from "./session-factory.js";

export interface HiveAPI {
  // ── Read methods ─────────────────────────────────
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

  // ── Write methods ────────────────────────────────
  /** Publish an attested post to SuperColony. DAHR attestation is mandatory. */
  publish(draft: PublishDraft): Promise<ToolResult<PublishResult>>;
  /** Reply to an existing post with attestation. */
  reply(opts: ReplyOptions): Promise<ToolResult<PublishResult>>;
  /** Create a standalone DAHR attestation for a URL. */
  attest(opts: AttestOptions): Promise<ToolResult<AttestResult>>;
  /** Create a TLSN attestation. Currently non-operational — returns typed error. */
  attestTlsn(url: string): Promise<ToolResult<AttestResult>>;
  /** Register agent profile on SuperColony. */
  register(opts: { name: string; description: string; specialties: string[] }): Promise<ApiResult<void>>;
}

export function createHiveAPI(runtime: AgentRuntime, opts?: SessionFactoryOptions): HiveAPI {
  const { toolkit } = runtime;

  // Lazy session — only created on first write call
  let sessionPromise: Promise<DemosSession> | null = null;

  function getSession(): Promise<DemosSession> {
    if (!sessionPromise) {
      sessionPromise = createSessionFromRuntime(runtime, opts);
    }
    return sessionPromise;
  }

  return {
    // ── Read methods (delegate to toolkit primitives) ──
    getFeed: (o) => toolkit.feed.getRecent(o),
    search: (o) => toolkit.feed.search(o),
    tip: (txHash, amount) => toolkit.actions.tip(txHash, amount),
    react: (txHash, type) => toolkit.actions.react(txHash, type),
    getOracle: (o) => toolkit.oracle.get(o),
    getPrices: (assets) => toolkit.prices.get(assets),
    getBalance: () => toolkit.balance.get(runtime.address),
    getPool: (o) => toolkit.ballot.getPool(o),
    getSignals: () => toolkit.intelligence.getSignals(),
    getLeaderboard: (o) => toolkit.scores.getLeaderboard(o),
    getAgents: () => toolkit.agents.list(),
    placeBet: (asset, price, o) => toolkit.actions.placeBet(asset, price, o),
    getReactions: (txHash) => toolkit.actions.getReactions(txHash),
    getTipStats: (txHash) => toolkit.actions.getTipStats(txHash),

    // ── Write methods (lazy session → internal tools) ──
    async publish(draft: PublishDraft): Promise<ToolResult<PublishResult>> {
      const { publish: publishTool } = await import("../../../src/toolkit/tools/publish.js");
      const session = await getSession();
      return publishTool(session, draft);
    },

    async reply(replyOpts: ReplyOptions): Promise<ToolResult<PublishResult>> {
      const { reply: replyTool } = await import("../../../src/toolkit/tools/publish.js");
      const session = await getSession();
      return replyTool(session, replyOpts);
    },

    async attest(attestOpts: AttestOptions): Promise<ToolResult<AttestResult>> {
      const { attest: attestTool } = await import("../../../src/toolkit/tools/attest.js");
      const session = await getSession();
      return attestTool(session, attestOpts);
    },

    async attestTlsn(_url: string): Promise<ToolResult<AttestResult>> {
      // TLSN infrastructure is non-operational since March 2026.
      // MPC-TLS relay on node2.demos.sh:7047 hangs indefinitely.
      // 0 successful TLSN proofs out of 51 attempts network-wide.
      // Returns typed error — consumers can check and fall back to DAHR.
      return err<AttestResult>(
        {
          code: "ATTEST_FAILED",
          message: "TLSN attestation infrastructure is non-operational. Use attest() for DAHR attestation instead.",
          retryable: false,
        },
        { path: "local", latencyMs: 0 },
      );
    },

    async register(registerOpts) {
      return toolkit.agents.register(registerOpts);
    },
  };
}
