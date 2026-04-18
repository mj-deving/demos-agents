import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inferAssetAlias } from "../../../src/toolkit/chain/asset-helpers.js";
import {
  loadAgentSourceView,
  type AgentName,
  type SourceRecordV2,
} from "../../../src/toolkit/sources/catalog.js";
import {
  selectSourceForTopicV2,
  resolveSourceSelectionForSourceId,
  type SourceSelectionResult,
} from "../../../src/toolkit/sources/policy.js";

export interface MinimalAttestationCandidate {
  sourceId: string;
  sourceRecord?: SourceRecordV2 | null;
  name: string;
  provider: string;
  status: SourceRecordV2["status"];
  trustTier: SourceRecordV2["trustTier"];
  responseFormat: SourceRecordV2["responseFormat"];
  ratingOverall: number;
  dahrSafe: boolean;
  tlsnSafe: boolean;
  url: string;
  score: number;
}

export interface MinimalAttestationPlan {
  topic: string;
  agent: AgentName;
  catalogPath: string | null;
  ready: boolean;
  reason:
    | "ready"
    | "source_catalog_unavailable"
    | "no_matching_source"
    | "insufficient_supporting_sources";
  primary: MinimalAttestationCandidate | null;
  supporting: MinimalAttestationCandidate[];
  fallbacks: MinimalAttestationCandidate[];
  warnings: string[];
}

export interface BuildMinimalAttestationPlanOptions {
  topic: string;
  agent?: AgentName;
  catalogPath?: string;
  maxCandidates?: number;
  minSupportingSources?: number;
  preferredSourceIds?: string[];
  supportingPreferredSourceIds?: string[];
  allowTopicFallback?: boolean;
}

export interface BuildMinimalAttestationPlanFromUrlsOptions {
  topic: string;
  urls: string[];
  agent?: AgentName;
  minSupportingSources?: number;
}

const DEFAULT_AGENT: AgentName = "sentinel";
const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_MIN_SUPPORTING_SOURCES = 1;

export function buildMinimalAttestationPlan(
  opts: BuildMinimalAttestationPlanOptions,
): MinimalAttestationPlan {
  const topic = opts.topic.trim();
  const agent = opts.agent ?? DEFAULT_AGENT;
  const catalogPath = resolveCatalogPath(opts.catalogPath);

  if (!catalogPath) {
    return {
      topic,
      agent,
      catalogPath: null,
      ready: false,
      reason: "source_catalog_unavailable",
      primary: null,
      supporting: [],
      fallbacks: [],
      warnings: [
        "No source catalog was found. Set OMNIWEB_SOURCE_CATALOG or run from the repo root so the starter can plan real attestation sources.",
      ],
    };
  }

  const sourceView = loadAgentSourceView(agent, catalogPath, catalogPath, "catalog-only");
  const maxCandidates = Math.max(1, opts.maxCandidates ?? DEFAULT_MAX_CANDIDATES);
  const primaryPreferred = resolvePreferredCandidates(
    topic,
    sourceView,
    opts.preferredSourceIds ?? [],
  );
  const supportingPreferred = resolvePreferredCandidates(
    topic,
    sourceView,
    opts.supportingPreferredSourceIds ?? [],
  );
  const preferred = primaryPreferred.length > 0
    ? [...primaryPreferred, ...supportingPreferred.filter((candidate) =>
      !primaryPreferred.some((existing) => existing.source.id === candidate.source.id))]
    : [];
  const ranked = preferred.length > 0
    ? preferred
    : selectSourceForTopicV2(
      topic,
      sourceView,
      "DAHR",
      maxCandidates,
    );
  const rankedOrFallback = ranked.length > 0
    ? ranked
    : opts.allowTopicFallback === false
      ? []
      : selectFallbackCandidates(topic, sourceView, maxCandidates);

  if (rankedOrFallback.length === 0) {
    return {
      topic,
      agent,
      catalogPath,
      ready: false,
      reason: "no_matching_source",
      primary: null,
      supporting: [],
      fallbacks: [],
      warnings: [
        `No DAHR-safe source candidates matched topic "${topic}" for agent scope ${agent}.`,
      ],
    };
  }

  const primary = mapCandidate(rankedOrFallback[0]);
  const supporting = rankedOrFallback.slice(1, 1 + Math.max(0, opts.minSupportingSources ?? DEFAULT_MIN_SUPPORTING_SOURCES))
    .map(mapCandidate);
  const fallbacks = rankedOrFallback.slice(1 + supporting.length).map(mapCandidate);
  const warnings: string[] = [];

  if (primary.status !== "active") {
    warnings.push(`Primary source ${primary.name} is ${primary.status}, not active.`);
  }
  if (primary.ratingOverall < 50) {
    warnings.push(`Primary source ${primary.name} has low ratingOverall=${primary.ratingOverall}.`);
  }

  const minSupportingSources = Math.max(0, opts.minSupportingSources ?? DEFAULT_MIN_SUPPORTING_SOURCES);
  if (supporting.length < minSupportingSources) {
    warnings.push(
      `Only ${supporting.length} supporting source(s) were found; target is ${minSupportingSources} for analysis-grade publishes.`,
    );
  }

  return {
    topic,
    agent,
    catalogPath,
    ready: supporting.length >= minSupportingSources,
    reason: supporting.length >= minSupportingSources ? "ready" : "insufficient_supporting_sources",
    primary,
    supporting,
    fallbacks,
    warnings,
  };
}

export function buildMinimalAttestationPlanFromUrls(
  opts: BuildMinimalAttestationPlanFromUrlsOptions,
): MinimalAttestationPlan {
  const topic = opts.topic.trim();
  const agent = opts.agent ?? DEFAULT_AGENT;
  const minSupportingSources = Math.max(0, opts.minSupportingSources ?? 0);
  const uniqueUrls = Array.from(new Set(opts.urls.map((url) => url.trim()).filter(Boolean)));

  if (uniqueUrls.length === 0) {
    return {
      topic,
      agent,
      catalogPath: "feed-attested",
      ready: false,
      reason: "no_matching_source",
      primary: null,
      supporting: [],
      fallbacks: [],
      warnings: [
        "No attested source URLs were available in the selected evidence packet.",
      ],
    };
  }

  const candidates = uniqueUrls.map(mapUrlCandidate);
  const primary = candidates[0] ?? null;
  const supporting = candidates.slice(1, 1 + minSupportingSources);
  const fallbacks = candidates.slice(1 + supporting.length);
  const warnings = [
    "Reusing attested source URLs from the selected colony post; catalog scoring is unavailable for this path.",
  ];

  if (supporting.length < minSupportingSources) {
    warnings.push(
      `Only ${supporting.length} supporting source(s) were available; target is ${minSupportingSources}.`,
    );
  }

  return {
    topic,
    agent,
    catalogPath: "feed-attested",
    ready: primary != null && supporting.length >= minSupportingSources,
    reason: primary != null && supporting.length >= minSupportingSources ? "ready" : "insufficient_supporting_sources",
    primary,
    supporting,
    fallbacks,
    warnings,
  };
}

function selectFallbackCandidates(
  topic: string,
  sourceView: ReturnType<typeof loadAgentSourceView>,
  maxCandidates: number,
): SourceSelectionResult[] {
  const alias = inferAssetAlias(topic);
  if (!alias) {
    return [];
  }

  const alternateTopics = [
    `${alias.symbol} crypto prices`,
    `${alias.asset} crypto prices`,
    `${alias.asset} fundamentals`,
  ];

  for (const alternateTopic of alternateTopics) {
    const ranked = selectSourceForTopicV2(alternateTopic, sourceView, "DAHR", maxCandidates);
    if (ranked.length > 0) {
      return ranked;
    }
  }

  return [];
}

function resolvePreferredCandidates(
  topic: string,
  sourceView: ReturnType<typeof loadAgentSourceView>,
  preferredSourceIds: string[],
): SourceSelectionResult[] {
  const resolved: SourceSelectionResult[] = [];

  for (const sourceId of preferredSourceIds) {
    const source = sourceView.index.byId.get(sourceId);
    if (!source || source.dahr_safe !== true) continue;

    const direct = resolveSourceSelectionForSourceId(topic, sourceView, sourceId, "DAHR");
    if (direct) {
      resolved.push(direct);
    }
  }

  return resolved;
}

function resolveCatalogPath(explicitPath?: string): string | null {
  const candidates = [
    explicitPath,
    process.env.OMNIWEB_SOURCE_CATALOG,
    resolve(process.cwd(), "config", "sources", "catalog.json"),
    fileURLToPath(new URL("../../../config/sources/catalog.json", import.meta.url)),
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function mapCandidate(candidate: SourceSelectionResult): MinimalAttestationCandidate {
  return {
    sourceId: candidate.source.id,
    sourceRecord: candidate.source,
    name: candidate.source.name,
    provider: candidate.source.provider,
    status: candidate.source.status,
    trustTier: candidate.source.trustTier,
    responseFormat: candidate.source.responseFormat,
    ratingOverall: candidate.source.rating.overall,
    dahrSafe: candidate.source.dahr_safe === true,
    tlsnSafe: candidate.source.tlsn_safe === true,
    url: candidate.url,
    score: candidate.score,
  };
}

function mapUrlCandidate(url: string, index: number): MinimalAttestationCandidate {
  let hostname = "attested-source";
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "") || hostname;
  } catch {
    hostname = `attested-source-${index + 1}`;
  }

  return {
    sourceId: `${hostname}-${index + 1}`,
    sourceRecord: null,
    name: hostname,
    provider: hostname,
    status: "active",
    trustTier: "established",
    responseFormat: url.includes(".json") ? "json" : "html",
    ratingOverall: 60,
    dahrSafe: true,
    tlsnSafe: false,
    url,
    score: Math.max(1, 10 - index),
  };
}

export function toPreflightCandidates(plan: MinimalAttestationPlan) {
  return [
    plan.primary,
    ...plan.supporting,
    ...plan.fallbacks,
  ]
    .filter((candidate): candidate is MinimalAttestationCandidate => candidate != null)
    .filter((candidate) => candidate.sourceRecord != null)
    .map((candidate) => ({
      sourceId: candidate.sourceId,
      source: candidate.sourceRecord!,
      method: "DAHR" as const,
      url: candidate.url,
      score: candidate.score,
      adapterCandidates: undefined,
    }));
}
