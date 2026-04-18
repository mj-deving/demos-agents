#!/usr/bin/env npx tsx

import { DEFAULT_BASE_URL, fetchText, getStringArg, hasFlag } from "./_shared.js";
import { deriveResearchSourceProfile } from "../src/research-source-profile.js";

type CoverageClass = "research-supported" | "other-archetype-supported" | "intentionally-unsupported";
type Archetype = "research-agent" | "market-analyst" | "engagement-optimizer" | null;

interface LiveSignalRow {
  topic: string;
  shortTopic?: string | null;
  direction?: string | null;
  confidence?: number | null;
  assets?: string[] | null;
  text?: string | null;
}

interface CoverageRow {
  topic: string;
  direction: string | null;
  confidence: number | null;
  assets: string[];
  classification: CoverageClass;
  ownerArchetype: Archetype;
  rationale: string;
  researchFamily: string | null;
  researchReason: string | null;
  nextFamilyCandidate: string | null;
}

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx scripts/check-topic-coverage.ts [--base-url URL]

Options:
  --base-url URL   SuperColony base URL (default: ${DEFAULT_BASE_URL})
  --help, -h       Show this help

Output: JSON report with live topic coverage classification
Exit codes: 0 = success, 1 = fetch/parse problem, 2 = invalid args`);
  process.exit(0);
}

const baseUrl = getStringArg(args, "--base-url") ?? DEFAULT_BASE_URL;

const signalsResponse = await fetchText("/api/signals", {
  baseUrl,
  timeoutMs: 15_000,
  accept: "application/json",
});

if (!signalsResponse.ok) {
  console.error(JSON.stringify({
    ok: false,
    reason: "signals_fetch_failed",
    status: signalsResponse.status,
    error: signalsResponse.error ?? null,
    url: signalsResponse.url,
  }, null, 2));
  process.exit(1);
}

let parsed: { consensusAnalysis?: LiveSignalRow[] };
try {
  parsed = JSON.parse(signalsResponse.body) as { consensusAnalysis?: LiveSignalRow[] };
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    reason: "signals_invalid_json",
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
}

const liveSignals = Array.isArray(parsed.consensusAnalysis) ? parsed.consensusAnalysis : [];
const rows = liveSignals
  .map(classifyTopic)
  .sort((left, right) => {
    const order = coverageRank(left.classification) - coverageRank(right.classification);
    if (order !== 0) return order;
    return left.topic.localeCompare(right.topic);
  });

const summary = {
  researchSupported: rows.filter((row) => row.classification === "research-supported").length,
  otherArchetypeSupported: rows.filter((row) => row.classification === "other-archetype-supported").length,
  intentionallyUnsupported: rows.filter((row) => row.classification === "intentionally-unsupported").length,
};

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  baseUrl,
  topicCount: rows.length,
  summary,
  topics: rows,
}, null, 2));

function classifyTopic(signal: LiveSignalRow): CoverageRow {
  const topic = normalizeTopic(signal.shortTopic ?? signal.topic ?? "");
  const assets = Array.isArray(signal.assets) ? signal.assets.filter((value): value is string => typeof value === "string") : [];
  const research = deriveResearchSourceProfile(topic);

  if (research.supported) {
    return {
      topic,
      direction: typeof signal.direction === "string" ? signal.direction : null,
      confidence: typeof signal.confidence === "number" ? signal.confidence : null,
      assets,
      classification: "research-supported",
      ownerArchetype: "research-agent",
      rationale: `Current research starter can ground this topic through the ${research.family} evidence family.`,
      researchFamily: research.family,
      researchReason: null,
      nextFamilyCandidate: null,
    };
  }

  const marketReason = classifyMarketTopic(topic, signal, assets);
  if (marketReason) {
    return {
      topic,
      direction: typeof signal.direction === "string" ? signal.direction : null,
      confidence: typeof signal.confidence === "number" ? signal.confidence : null,
      assets,
      classification: "other-archetype-supported",
      ownerArchetype: "market-analyst",
      rationale: marketReason,
      researchFamily: null,
      researchReason: research.reason,
      nextFamilyCandidate: null,
    };
  }

  const engagementReason = classifyEngagementTopic(topic, signal);
  if (engagementReason) {
    return {
      topic,
      direction: typeof signal.direction === "string" ? signal.direction : null,
      confidence: typeof signal.confidence === "number" ? signal.confidence : null,
      assets,
      classification: "other-archetype-supported",
      ownerArchetype: "engagement-optimizer",
      rationale: engagementReason,
      researchFamily: null,
      researchReason: research.reason,
      nextFamilyCandidate: null,
    };
  }

  return {
    topic,
    direction: typeof signal.direction === "string" ? signal.direction : null,
    confidence: typeof signal.confidence === "number" ? signal.confidence : null,
    assets,
    classification: "intentionally-unsupported",
    ownerArchetype: null,
    rationale: unsupportedReason(topic),
    researchFamily: null,
    researchReason: research.reason,
    nextFamilyCandidate: suggestNextFamily(topic),
  };
}

function classifyMarketTopic(topic: string, signal: LiveSignalRow, assets: string[]): string | null {
  const trackedAssets = new Set(["BTC", "ETH", "SOL"]);
  const hasTrackedAsset = assets.some((asset) => trackedAssets.has(asset));
  const normalized = topic.toLowerCase();

  if (!hasTrackedAsset) return null;

  if (normalized.includes("rotation")) {
    return "Current market starter tracks BTC/ETH/SOL and can cover this as a tradable cross-asset rotation thesis.";
  }

  if (normalized.includes("funding") || normalized.includes("price") || normalized.includes("momentum")) {
    return "Current market starter can cover this topic through its oracle-divergence or signal-price mismatch path for tracked assets.";
  }

  if (normalized.includes("carry trade") || normalized.includes("volatility")) {
    return "Current market starter can treat this as a BTC/ETH market-stress setup because the live signal already points at tracked assets.";
  }

  return null;
}

function classifyEngagementTopic(topic: string, signal: LiveSignalRow): string | null {
  const normalized = topic.toLowerCase();
  const text = `${topic} ${signal.text ?? ""}`.toLowerCase();

  if (normalized.includes("bot") || text.includes("coordinated posting") || text.includes("social engineering")) {
    return "This is better handled by the engagement optimizer as a community-health and trust/safety observation than by the current research starter.";
  }

  return null;
}

function suggestNextFamily(topic: string): string {
  const normalized = topic.toLowerCase();

  if (normalized.includes("etf")) return "etf-flows-asset-expansion";
  if (normalized.includes("reserve") || normalized.includes("regulatory")) return "stablecoin-reserve-risk";
  if (normalized.includes("rwa") || normalized.includes("yield")) return "rwa-yield";
  if (normalized.includes("bridge") || normalized.includes("sanctions") || normalized.includes("enforcement")) return "security-policy-risk";
  if (normalized.includes("oil") || normalized.includes("hormuz") || normalized.includes("pboc") || normalized.includes("boj") || normalized.includes("election") || normalized.includes("capex")) {
    return "macro-liquidity-and-geopolitics";
  }
  if (normalized.includes("l2") || normalized.includes("gaming") || normalized.includes("render") || normalized.includes("compute") || normalized.includes("memecoin")) {
    return "sector-rotation-and-adoption";
  }
  return "research-family-not-yet-modeled";
}

function unsupportedReason(topic: string): string {
  const normalized = topic.toLowerCase();

  if (normalized.includes("etf")) {
    return "This is a valid research shape, but the current registry only supports ETF flow coverage for BTC; the topic stays intentionally unsupported until the family expands.";
  }

  return "No shipped archetype can ground this topic honestly enough yet, so it remains intentionally unsupported until a dedicated family is added.";
}

function normalizeTopic(value: string): string {
  return value.trim();
}

function coverageRank(value: CoverageClass): number {
  switch (value) {
    case "research-supported":
      return 0;
    case "other-archetype-supported":
      return 1;
    default:
      return 2;
  }
}
