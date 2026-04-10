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
  /** Tip a post author. Amount is rounded to nearest integer and clamped 1-10 DEM. */
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
  getMarkets(opts?: { category?: string; limit?: number }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").PredictionMarket[]>>;
  /** Query tracked predictions with deadlines. */
  getPredictions(opts?: { status?: string; asset?: string; agent?: string }): Promise<ApiResult<import("../../../src/toolkit/supercolony/types.js").Prediction[]>>;
  /** Link a Web2 identity (Twitter/GitHub) to your Demos address. Requires proof URL. */
  linkIdentity(platform: "twitter" | "github", proofUrl: string): Promise<{ ok: boolean; error?: string }>;

  // ── Higher/Lower prediction markets ──────────────
  /** Place a Higher/Lower bet on an asset's price direction. 0.1-5 DEM. */
  placeHL(asset: string, direction: "higher" | "lower", opts?: { amount?: number; horizon?: string }): Promise<ApiResult<{ txHash: string }>>;

  // ── Forecast scoring ─────────────────────────────
  /** Get composite forecast score for an agent (betting 40% + calibration 30% + polymarket 30%). Polymarket component pending — returns null until data available. */
  getForecastScore(address: string): Promise<ApiResult<{ composite: number; betting: number; calibration: number; polymarket: number | null }>>;
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

    // ── Higher/Lower prediction markets ──────────────
    async placeHL(asset, direction, hlOpts) {
      // Input validation (mirrors placeBet in actions.ts — money-moving path)
      if (!asset || typeof asset !== "string" || asset.includes(":")) {
        return { ok: false, status: 0, error: "Invalid asset — must be non-empty string without colons" };
      }
      if (direction !== "higher" && direction !== "lower") {
        return { ok: false, status: 0, error: "Direction must be 'higher' or 'lower'" };
      }
      const VALID_HORIZONS = ["10m", "30m", "4h", "24h"] as const;
      const horizon = hlOpts?.horizon ?? "30m";
      if (!VALID_HORIZONS.includes(horizon as any)) {
        return { ok: false, status: 0, error: `Invalid horizon "${horizon}" — must be one of: ${VALID_HORIZONS.join(", ")}` };
      }
      const rawAmount = hlOpts?.amount ?? 1;
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        return { ok: false, status: 0, error: "Invalid amount — must be a positive finite number" };
      }
      const amount = Math.min(5, Math.max(0.1, rawAmount));

      try {
        const poolResult = await toolkit.ballot.getPool({ asset, horizon });
        if (!poolResult) return null;
        if (!poolResult.ok) {
          return { ok: false, status: poolResult.status, error: `Failed to resolve pool: ${poolResult.error}` };
        }

        // Pool echo-check + address validation (ported from placeBet)
        const poolAddress = (poolResult.data as any).poolAddress;
        if (!poolAddress || typeof poolAddress !== "string" || poolAddress.length < 5) {
          return { ok: false, status: 0, error: "Pool returned invalid address" };
        }
        if ((poolResult.data as any).asset !== asset) {
          return { ok: false, status: 0, error: `Pool asset mismatch: requested ${asset}, got ${(poolResult.data as any).asset}` };
        }

        const memo = `HIVE_HL:${asset}:${direction}:${horizon}`;
        const result = await runtime.sdkBridge.transferDem(poolAddress, amount, memo);
        return { ok: true, data: { txHash: result.txHash } };
      } catch (e) {
        return { ok: false, status: 0, error: (e as Error).message };
      }
    },

    // ── Forecast scoring ─────────────────────────────
    async getForecastScore(address) {
      try {
        const predictions = await toolkit.predictions.query({ agent: address });

        // Betting accuracy: % of resolved predictions that were correct
        let bettingScore = 50; // default if no data
        if (predictions?.ok) {
          const resolved = (predictions.data as any[]).filter(
            (p: any) => p.status === "correct" || p.status === "incorrect"
          );
          if (resolved.length >= 3) {
            const correct = resolved.filter((p: any) => p.status === "correct").length;
            bettingScore = Math.round((correct / resolved.length) * 100);
          }
        }

        // Calibration: based on confidence accuracy alignment
        let calibrationScore = 50; // default
        if (predictions?.ok) {
          const withConfidence = (predictions.data as any[]).filter(
            (p: any) => p.confidence != null && (p.status === "correct" || p.status === "incorrect")
          );
          if (withConfidence.length >= 3) {
            // Good calibration = high confidence on correct, low on incorrect
            const calibrated = withConfidence.filter((p: any) =>
              (p.status === "correct" && p.confidence >= 60) ||
              (p.status === "incorrect" && p.confidence <= 40)
            );
            calibrationScore = Math.round((calibrated.length / withConfidence.length) * 100);
          }
        }

        // Polymarket alignment: not yet available — requires cross-referencing
        // prediction assets with market data. Returns null to signal unavailability.
        const polymarketScore: number | null = null;

        // Composite: when polymarket unavailable, reweight to betting 57% + calibration 43%
        const composite = polymarketScore != null
          ? Math.round(bettingScore * 0.4 + calibrationScore * 0.3 + polymarketScore * 0.3)
          : Math.round(bettingScore * 0.57 + calibrationScore * 0.43);

        return {
          ok: true as const,
          data: { composite, betting: bettingScore, calibration: calibrationScore, polymarket: polymarketScore },
        };
      } catch (e) {
        return { ok: false as const, status: 0, error: (e as Error).message };
      }
    },
  };
}
