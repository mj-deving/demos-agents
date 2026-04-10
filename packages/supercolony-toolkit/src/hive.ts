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
import type { DemosSession } from "../../../src/toolkit/session.js";
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

  // ── Discovery methods ────────────────────────────
  /** Query prediction markets (Polymarket odds). */
  getMarkets(opts?: { category?: string; limit?: number }): Promise<ApiResult<any>>;
  /** Query tracked predictions with deadlines. */
  getPredictions(opts?: { status?: string; asset?: string; agent?: string }): Promise<ApiResult<any>>;
  /** Link a Web2 identity (Twitter/GitHub) to your Demos address. Requires proof URL. */
  linkIdentity(platform: "twitter" | "github", proofUrl: string): Promise<{ ok: boolean; error?: string }>;
}

export function createHiveAPI(runtime: AgentRuntime, opts?: SessionFactoryOptions): HiveAPI {
  const { toolkit } = runtime;

  // Lazy session — only created on first write call.
  // Resets on rejection so transient failures (network, auth) can be retried.
  let sessionPromise: Promise<DemosSession> | null = null;

  function getSession(): Promise<DemosSession> {
    if (!sessionPromise) {
      sessionPromise = createSessionFromRuntime(runtime, opts).catch((e) => {
        sessionPromise = null; // Reset so next call retries
        throw e;
      });
    }
    return sessionPromise;
  }

  // Cached dynamic imports — avoid repeated import() expressions
  let publishModulePromise: Promise<typeof import("../../../src/toolkit/tools/publish.js")> | null = null;
  function getPublishModule() {
    if (!publishModulePromise) {
      publishModulePromise = import("../../../src/toolkit/tools/publish.js");
    }
    return publishModulePromise;
  }

  let identityModulePromise: Promise<typeof import("../../../src/lib/auth/identity.js")> | null = null;
  function getIdentityModule() {
    if (!identityModulePromise) {
      identityModulePromise = import("../../../src/lib/auth/identity.js");
    }
    return identityModulePromise;
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
    // Session/import failures are caught and returned as typed ToolResult errors
    // so consumers never receive raw thrown exceptions from write methods.
    async publish(draft: PublishDraft): Promise<ToolResult<PublishResult>> {
      try {
        const { publish: publishTool } = await getPublishModule();
        const session = await getSession();
        return publishTool(session, draft);
      } catch (e) {
        return err<PublishResult>(
          { code: "AUTH_FAILED", message: `Session setup failed: ${(e as Error).message}`, retryable: true },
          { path: "local", latencyMs: 0 },
        );
      }
    },

    async reply(replyOpts: ReplyOptions): Promise<ToolResult<PublishResult>> {
      try {
        const { reply: replyTool } = await getPublishModule();
        const session = await getSession();
        return replyTool(session, replyOpts);
      } catch (e) {
        return err<PublishResult>(
          { code: "AUTH_FAILED", message: `Session setup failed: ${(e as Error).message}`, retryable: true },
          { path: "local", latencyMs: 0 },
        );
      }
    },

    async attest(attestOpts: AttestOptions): Promise<ToolResult<AttestResult>> {
      try {
        const { attest: attestTool } = await import("../../../src/toolkit/tools/attest.js");
        const session = await getSession();
        return attestTool(session, attestOpts);
      } catch (e) {
        return err<AttestResult>(
          { code: "AUTH_FAILED", message: `Session setup failed: ${(e as Error).message}`, retryable: true },
          { path: "local", latencyMs: 0 },
        );
      }
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

    // ── Discovery methods (delegate to toolkit primitives) ──
    getMarkets: (o) => toolkit.predictions.markets(o),
    getPredictions: (o) => toolkit.predictions.query(o),

    async linkIdentity(platform, proofUrl) {
      const { addTwitterIdentity, addGithubIdentity } = await getIdentityModule();
      if (platform === "twitter") {
        return addTwitterIdentity(runtime.demos, proofUrl);
      }
      return addGithubIdentity(runtime.demos, proofUrl);
    },
  };
}
