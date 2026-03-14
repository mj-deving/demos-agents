/**
 * DefiLlama provider adapter — DeFi protocol analytics (TVL, yields, DEX volume).
 *
 * Endpoints:
 *   - tvl: api.llama.fi/tvl/{protocol}
 *   - protocol: api.llama.fi/protocol/{protocol}
 *   - chains: api.llama.fi/chains
 *   - yields: yields.llama.fi/pools
 *   - dexs: api.llama.fi/overview/dexs
 *
 * Rate limits: 60/min (no auth required).
 *
 * TLSN constraint: only tvl/{protocol} is compact enough (returns a single
 * number). protocol/{name} and chains can be very large (100KB+).
 * yields and dexs are DAHR-only.
 */

import type { SourceRecordV2 } from "../catalog.js";
import type {
  ProviderAdapter,
  BuildCandidatesContext,
  CandidateRequest,
  CandidateValidation,
  FetchedResponse,
  ParsedAdapterResponse,
  EvidenceEntry,
} from "./types.js";

type DlOperation = "tvl" | "protocol" | "chains" | "yields" | "dexs";

const VALID_OPERATIONS: DlOperation[] = ["tvl", "protocol", "chains", "yields", "dexs"];

/** Operations safe for TLSN (very small response bodies) */
const TLSN_SAFE_OPS: DlOperation[] = ["tvl"];

/**
 * Build the URL for a given operation and protocol.
 */
function buildUrl(operation: DlOperation, protocol: string): string {
  switch (operation) {
    case "tvl":
      return `https://api.llama.fi/tvl/${encodeURIComponent(protocol)}`;
    case "protocol":
      return `https://api.llama.fi/protocol/${encodeURIComponent(protocol)}`;
    case "chains":
      return "https://api.llama.fi/chains";
    case "yields":
      return "https://yields.llama.fi/pools";
    case "dexs":
      return "https://api.llama.fi/overview/dexs";
  }
}

/**
 * Infer operation from source record URL or adapter config.
 */
function inferOperation(source: SourceRecordV2): DlOperation {
  const op = source.adapter?.operation;
  if (op && VALID_OPERATIONS.includes(op as DlOperation)) {
    return op as DlOperation;
  }
  const url = source.url.toLowerCase();
  if (url.includes("/tvl/")) return "tvl";
  if (url.includes("/protocol/")) return "protocol";
  if (url.includes("/chains")) return "chains";
  if (url.includes("yields.llama.fi") || url.includes("/pools")) return "yields";
  if (url.includes("/overview/dexs")) return "dexs";
  return "tvl";
}

/**
 * Extract protocol slug from a URL path like /tvl/aave or /protocol/uniswap.
 */
function extractProtocol(url: string): string | undefined {
  const match = url.match(/\/(tvl|protocol)\/([^/?#]+)/i);
  return match?.[2];
}

export const adapter: ProviderAdapter = {
  provider: "defillama",
  domains: ["defi", "tvl", "protocol", "yield", "dex"],
  rateLimit: { bucket: "defillama", maxPerMinute: 60 },

  supports(source: SourceRecordV2): boolean {
    return (
      source.provider === "defillama" ||
      source.url.toLowerCase().includes("llama.fi")
    );
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    const operation = inferOperation(ctx.source);
    const protocol =
      ctx.vars.asset ||
      ctx.vars.protocol ||
      extractProtocol(ctx.source.url) ||
      ctx.topic.toLowerCase().replace(/\s+/g, "-");

    // TLSN safety: only tvl endpoint is compact enough
    if (ctx.attestation === "TLSN" && !TLSN_SAFE_OPS.includes(operation)) {
      return [];
    }

    const url = buildUrl(operation, protocol);

    // Estimate response size
    let estimatedSizeKb: number;
    switch (operation) {
      case "tvl":
        estimatedSizeKb = 1;
        break;
      case "protocol":
        estimatedSizeKb = 50;
        break;
      case "chains":
        estimatedSizeKb = 30;
        break;
      case "yields":
        estimatedSizeKb = 200;
        break;
      case "dexs":
        estimatedSizeKb = 40;
        break;
      default:
        estimatedSizeKb = 10;
    }

    return [
      {
        sourceId: ctx.source.id,
        provider: "defillama",
        operation,
        method: "GET" as const,
        url,
        attestation: ctx.attestation,
        estimatedSizeKb,
        matchHints: [protocol, ...ctx.tokens.slice(0, 3)],
      },
    ].slice(0, ctx.maxCandidates);
  },

  validateCandidate(candidate: CandidateRequest): CandidateValidation {
    if (candidate.attestation === "TLSN") {
      const op = candidate.operation as DlOperation;
      if (!TLSN_SAFE_OPS.includes(op)) {
        return {
          ok: false,
          reason: `Operation "${op}" response too large for TLSN (DAHR-only)`,
        };
      }
    }
    return { ok: true };
  },

  parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    if (response.status !== 200) {
      return { entries: [], normalized: null };
    }

    const operation = inferOperation(source);
    const entries: EvidenceEntry[] = [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.bodyText);
    } catch {
      return { entries: [], normalized: null };
    }

    switch (operation) {
      case "tvl": {
        // Response is a single number: 1234567890.12
        const tvl = typeof parsed === "number" ? parsed : 0;
        const protocol = extractProtocol(response.url) || source.name;
        entries.push({
          id: `tvl-${protocol}`,
          title: `${protocol} TVL`,
          bodyText: `${protocol} total value locked: $${tvl.toLocaleString()}`,
          topics: ["defi", "tvl", protocol],
          metrics: { tvl },
          raw: parsed,
        });
        break;
      }

      case "protocol": {
        // Response: { id, name, symbol, chains: [], currentChainTvls: {}, tvl: [...] }
        const proto = parsed as Record<string, unknown>;
        if (typeof proto === "object" && proto !== null) {
          const chains = Array.isArray(proto.chains) ? proto.chains : [];
          const currentTvls = (proto.currentChainTvls as Record<string, number>) ?? {};
          const totalTvl = Object.values(currentTvls).reduce(
            (sum, v) => sum + (typeof v === "number" ? v : 0),
            0
          );
          entries.push({
            id: String(proto.id ?? proto.name ?? source.id),
            title: String(proto.name ?? ""),
            summary: `${proto.name} — ${chains.length} chains, TVL: $${totalTvl.toLocaleString()}`,
            bodyText: `Protocol ${proto.name} (${proto.symbol ?? "?"}) across ${chains.length} chains`,
            canonicalUrl: `https://defillama.com/protocol/${String(proto.slug ?? proto.name ?? "").toLowerCase()}`,
            topics: ["defi", "protocol", String(proto.symbol ?? "").toLowerCase()],
            metrics: {
              tvl: totalTvl,
              chains: chains.length,
              ...(typeof proto.mcap === "number" ? { market_cap: proto.mcap } : {}),
            },
            raw: proto,
          });
        }
        break;
      }

      case "chains": {
        // Response: [{ name, tvl, tokenSymbol, ... }]
        const chains = Array.isArray(parsed) ? parsed : [];
        for (const chain of chains.slice(0, 30)) {
          if (typeof chain !== "object" || chain === null) continue;
          const c = chain as Record<string, unknown>;
          entries.push({
            id: String(c.name ?? "").toLowerCase(),
            title: String(c.name ?? ""),
            bodyText: `Chain ${c.name}: TVL $${typeof c.tvl === "number" ? c.tvl.toLocaleString() : "?"}`,
            topics: ["defi", "chain", String(c.name ?? "").toLowerCase()],
            metrics: {
              tvl: typeof c.tvl === "number" ? c.tvl : 0,
              ...(c.tokenSymbol ? { symbol: String(c.tokenSymbol) } : {}),
            },
            raw: chain,
          });
        }
        break;
      }

      case "yields": {
        // Response: { status, data: [{ pool, chain, project, tvlUsd, apy, ... }] }
        const yieldsData = parsed as Record<string, unknown>;
        const pools = Array.isArray(yieldsData?.data) ? yieldsData.data : [];
        for (const pool of pools.slice(0, 20)) {
          if (typeof pool !== "object" || pool === null) continue;
          const p = pool as Record<string, unknown>;
          entries.push({
            id: String(p.pool ?? ""),
            title: `${p.project ?? "?"} — ${p.symbol ?? "?"}`,
            bodyText: `Yield pool ${p.symbol} on ${p.chain}: APY ${typeof p.apy === "number" ? p.apy.toFixed(2) : "?"}%`,
            topics: ["defi", "yield", String(p.chain ?? "").toLowerCase()],
            metrics: {
              apy: typeof p.apy === "number" ? p.apy : 0,
              tvl_usd: typeof p.tvlUsd === "number" ? p.tvlUsd : 0,
            },
            raw: pool,
          });
        }
        break;
      }

      case "dexs": {
        // Response: { protocols: [{ name, totalVolume24h, ... }] }
        const dexData = parsed as Record<string, unknown>;
        const protocols = Array.isArray(dexData?.protocols) ? dexData.protocols : [];
        for (const dex of protocols.slice(0, 20)) {
          if (typeof dex !== "object" || dex === null) continue;
          const d = dex as Record<string, unknown>;
          entries.push({
            id: String(d.name ?? "").toLowerCase().replace(/\s+/g, "-"),
            title: String(d.name ?? ""),
            bodyText: `DEX ${d.name}: 24h volume $${typeof d.totalVolume24h === "number" ? d.totalVolume24h.toLocaleString() : "?"}`,
            topics: ["defi", "dex", String(d.name ?? "").toLowerCase()],
            metrics: {
              volume_24h: typeof d.totalVolume24h === "number" ? d.totalVolume24h : 0,
              change_24h: typeof d.change_1d === "number" ? d.change_1d : 0,
            },
            raw: dex,
          });
        }
        break;
      }
    }

    return { entries, normalized: parsed };
  },
};
