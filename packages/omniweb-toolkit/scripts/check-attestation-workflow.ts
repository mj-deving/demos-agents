#!/usr/bin/env npx tsx

import { resolve } from "node:path";

import { checkPublishQuality } from "../../../src/toolkit/publish/quality-gate.js";
import {
  inferProvider,
  loadAgentSourceView,
  type SourceRecordV2,
} from "../../../src/toolkit/sources/catalog.js";
import { selectSourceForTopicV2 } from "../../../src/toolkit/sources/policy.js";
import { validateUrl } from "../../../src/toolkit/url-validator.js";
import {
  REPO_ROOT,
  getNumberArg,
  getStringArg,
  hasFlag,
} from "./_shared.js";

type AgentName = "sentinel" | "crawler" | "pioneer";

type CheckResult = {
  name: string;
  pass: boolean;
  severity: "blocker" | "warning" | "info";
  detail: string;
};

type CatalogMatch = {
  source: SourceRecordV2;
  score: number;
  hostMatches: boolean;
  providerMatches: boolean;
  staticPathMatches: number;
  staticQueryMatches: number;
};

type SourceAssessment = {
  url: string;
  hostname: string | null;
  provider: string | null;
  urlValidation: {
    ok: boolean;
    reason?: string;
  };
  catalogMatch: {
    found: boolean;
    source?: {
      id: string;
      name: string;
      provider: string;
      status: string;
      trustTier: string;
      responseFormat: string;
      dahrSafe: boolean;
      tlsnSafe: boolean;
      ratingOverall: number;
      note: string | null;
    };
    score?: number;
  };
  checks: CheckResult[];
};

const DEFAULT_AGENT: AgentName = "sentinel";
const DEFAULT_CATEGORY = "ANALYSIS";
const SUPPORTED_AGENTS: AgentName[] = ["sentinel", "crawler", "pioneer"];
const SUPPORTING_SOURCE_FLAG = "--supporting-url";
const ANALYSIS_CATEGORIES = new Set(["ANALYSIS", "OBSERVATION", "PREDICTION"]);

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/check-attestation-workflow.ts [options]

Options:
  --attest-url URL          Primary URL to use in publish({ attestUrl })
  --supporting-url URL      Additional supporting source URL (repeatable)
  --topic TEXT              Topic to score against the bundled source catalog
  --text TEXT               Draft text to validate against publish-quality expectations
  --category CAT            Draft category (default: ANALYSIS)
  --confidence N            Intended confidence score (0-100)
  --agent NAME              Source-catalog scope: sentinel | crawler | pioneer (default: sentinel)
  --allow-insecure          Allow HTTP URLs (local dev only)
  --help, -h                Show this help

This script is a non-destructive operator preflight. It checks:
  - whether the primary and supporting URLs look DAHR-safe
  - whether the URLs map cleanly to the bundled source catalog
  - whether the evidence chain is too narrow for an analysis-style post
  - whether the draft text and confidence match package publish expectations

Example:
  npm run check:attestation -- \\
    --topic "BTC oracle divergence" \\
    --attest-url "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd" \\
    --supporting-url "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT" \\
    --supporting-url "https://api.llama.fi/tvl/uniswap" \\
    --text "BTC is showing a 3.4% divergence between observed oracle state and spot pricing..." \\
    --category ANALYSIS \\
    --confidence 68

Exit codes:
  0 = no blockers
  1 = blockers found
  2 = invalid args`);
  process.exit(0);
}

const attestUrl = getStringArg(args, "--attest-url");
const topic = getStringArg(args, "--topic")?.trim() || null;
const text = getStringArg(args, "--text")?.trim() || null;
const category = normalizeCategory(getStringArg(args, "--category") ?? DEFAULT_CATEGORY);
const confidence = getNumberArg(args, "--confidence");
const allowInsecure = hasFlag(args, "--allow-insecure");
const agent = parseAgent(getStringArg(args, "--agent") ?? DEFAULT_AGENT);
const supportingUrls = getMultiStringArgs(args, SUPPORTING_SOURCE_FLAG);

if (!attestUrl) {
  console.error("Error: --attest-url URL is required");
  process.exit(2);
}

if (!agent) {
  console.error(`Error: --agent must be one of ${SUPPORTED_AGENTS.join(", ")}`);
  process.exit(2);
}

if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 100)) {
  console.error("Error: --confidence must be a number between 0 and 100");
  process.exit(2);
}

for (const flag of ["--attest-url", "--topic", "--text", "--category", "--confidence", "--agent", SUPPORTING_SOURCE_FLAG]) {
  validateFlagHasValue(flag, args);
}

const catalogPath = resolve(REPO_ROOT, "config", "sources", "catalog.json");
const sourceView = loadAgentSourceView(agent, catalogPath, catalogPath, "catalog-only");
const allUrls = [attestUrl, ...supportingUrls];
const uniqueHosts = new Set<string>();
const uniqueProviders = new Set<string>();

const primaryAssessment = await assessUrl(attestUrl, allowInsecure, sourceView);
const supportingAssessments = await Promise.all(
  supportingUrls.map((url) => assessUrl(url, allowInsecure, sourceView)),
);

for (const assessment of [primaryAssessment, ...supportingAssessments]) {
  if (assessment.hostname) uniqueHosts.add(assessment.hostname);
  if (assessment.provider) uniqueProviders.add(assessment.provider);
}

const topicCandidates = topic
  ? selectSourceForTopicV2(topic, sourceView, "DAHR", 5)
  : [];
const recommendedCatalogCandidates = topicCandidates.map((candidate) => ({
  id: candidate.source.id,
  name: candidate.source.name,
  provider: candidate.source.provider,
  status: candidate.source.status,
  ratingOverall: candidate.source.rating.overall,
  url: candidate.url,
  score: candidate.score,
}));

const evidenceChecks = buildEvidenceChecks({
  category,
  primaryAssessment,
  supportingAssessments,
  uniqueHosts,
  uniqueProviders,
});

const publishQualityChecks = buildPublishQualityChecks({
  text,
  category,
  confidence,
  supportingCount: supportingAssessments.length,
});

const topicAlignmentChecks = buildTopicAlignmentChecks(topic, primaryAssessment, recommendedCatalogCandidates);

const allChecks = [
  ...primaryAssessment.checks,
  ...supportingAssessments.flatMap((assessment) => assessment.checks),
  ...evidenceChecks,
  ...publishQualityChecks,
  ...topicAlignmentChecks,
];

const blockers = allChecks.filter((check) => !check.pass && check.severity === "blocker");
const warnings = allChecks.filter((check) => !check.pass && check.severity === "warning");

const recommendations = buildRecommendations({
  category,
  topic,
  text,
  confidence,
  primaryAssessment,
  supportingAssessments,
  topicCandidates: recommendedCatalogCandidates,
  warnings,
});

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  ok: blockers.length === 0,
  readiness: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "needs_attention" : "ready",
  topic,
  agent,
  draft: {
    category,
    textLength: text?.length ?? 0,
    confidence: confidence ?? null,
    primaryAttestUrl: attestUrl,
    supportingUrls,
  },
  sourceCatalog: {
    path: catalogPath,
    sourceCount: sourceView.sources.length,
    recommendedDahrCandidates: recommendedCatalogCandidates,
  },
  primaryAttestation: primaryAssessment,
  supportingEvidence: supportingAssessments,
  evidenceChain: {
    totalSources: allUrls.length,
    supportingSourceCount: supportingAssessments.length,
    uniqueHosts: Array.from(uniqueHosts).sort(),
    uniqueProviders: Array.from(uniqueProviders).sort(),
    checks: evidenceChecks,
  },
  publishQuality: {
    checks: publishQualityChecks,
  },
  topicAlignment: {
    checks: topicAlignmentChecks,
  },
  blockers,
  warnings,
  recommendations,
}, null, 2));

process.exit(blockers.length === 0 ? 0 : 1);

function buildEvidenceChecks(input: {
  category: string;
  primaryAssessment: SourceAssessment;
  supportingAssessments: SourceAssessment[];
  uniqueHosts: Set<string>;
  uniqueProviders: Set<string>;
}): CheckResult[] {
  const totalSources = 1 + input.supportingAssessments.length;
  const analysisStyle = ANALYSIS_CATEGORIES.has(input.category);
  const matchedSources = [input.primaryAssessment, ...input.supportingAssessments].filter((assessment) => assessment.catalogMatch.found);
  const allMatchedSourcesHealthy = matchedSources.every((assessment) => {
    const source = assessment.catalogMatch.source;
    return source && source.status === "active" && source.ratingOverall >= 50;
  });

  return [
    {
      name: "analysis-style-post-has-supporting-sources",
      pass: !analysisStyle || totalSources >= 2,
      severity: "warning",
      detail: analysisStyle
        ? `${totalSources} total source(s) for ${input.category}`
        : `${input.category} does not require multi-source evidence by default`,
    },
    {
      name: "supporting-sources-add-provider-diversity",
      pass: input.supportingAssessments.length === 0 || input.uniqueProviders.size >= 2,
      severity: "warning",
      detail: `${input.uniqueProviders.size} unique provider(s) across ${totalSources} source(s)`,
    },
    {
      name: "supporting-sources-add-host-diversity",
      pass: input.supportingAssessments.length === 0 || input.uniqueHosts.size >= 2,
      severity: "warning",
      detail: `${input.uniqueHosts.size} unique host(s) across ${totalSources} source(s)`,
    },
    {
      name: "catalog-matched-sources-are-healthy",
      pass: matchedSources.length === 0 || allMatchedSourcesHealthy,
      severity: "warning",
      detail: matchedSources.length === 0
        ? "no catalog-backed source matches were found"
        : `${matchedSources.length} catalog-backed source(s) matched`,
    },
  ];
}

function buildPublishQualityChecks(input: {
  text: string | null;
  category: string;
  confidence: number | undefined;
  supportingCount: number;
}): CheckResult[] {
  if (!input.text) {
    return [
      {
        name: "draft-text-provided",
        pass: false,
        severity: "warning",
        detail: "No draft text provided, so publish-quality checks were skipped",
      },
    ];
  }

  const qualityGate = checkPublishQuality(
    { text: input.text, category: input.category },
    {
      minTextLength: ANALYSIS_CATEGORIES.has(input.category) ? 220 : 200,
    },
  );

  const checks: CheckResult[] = [
    {
      name: "publish-quality-gate",
      pass: qualityGate.pass,
      severity: "blocker",
      detail: qualityGate.reason ?? "quality gate passed",
    },
    {
      name: "draft-references-concrete-numbers",
      pass: /\d/.test(input.text),
      severity: "warning",
      detail: "Analysis-style attestations should cite concrete numbers, counts, or percentages",
    },
    {
      name: "draft-signals-evidence-synthesis",
      pass: !ANALYSIS_CATEGORIES.has(input.category) || /(because|while|despite|source|signal|evidence|data)/i.test(input.text),
      severity: "warning",
      detail: "Draft should explain why the attested evidence supports the claim",
    },
  ];

  if (input.confidence === undefined) {
    checks.push({
      name: "confidence-is-explicit",
      pass: false,
      severity: "warning",
      detail: "Confidence was not provided",
    });
  } else {
    checks.push({
      name: "confidence-stays-in-practical-range",
      pass: input.confidence >= 50 && input.confidence <= 90,
      severity: "warning",
      detail: `confidence=${input.confidence} (expected 50-90 for attested publish workflows)`,
    });
  }

  if (ANALYSIS_CATEGORIES.has(input.category)) {
    checks.push({
      name: "analysis-draft-has-supporting-evidence-plan",
      pass: input.supportingCount >= 1,
      severity: "warning",
      detail: `${input.supportingCount} supporting source(s) supplied`,
    });
  }

  return checks;
}

function buildTopicAlignmentChecks(
  topic: string | null,
  primaryAssessment: SourceAssessment,
  recommendedCatalogCandidates: Array<{ id: string; name: string; provider: string; status: string; ratingOverall: number; url: string; score: number }>,
): CheckResult[] {
  if (!topic || recommendedCatalogCandidates.length === 0) {
    return [];
  }

  const matchedId = primaryAssessment.catalogMatch.source?.id ?? null;
  const topCandidate = recommendedCatalogCandidates[0];

  return [
    {
      name: "primary-source-aligns-with-topic-candidates",
      pass: matchedId !== null && recommendedCatalogCandidates.some((candidate) => candidate.id === matchedId),
      severity: "warning",
      detail: matchedId
        ? `primary matched ${matchedId}; top topic candidate is ${topCandidate.id}`
        : `primary URL did not map to the top topic candidates (best=${topCandidate.id})`,
    },
  ];
}

function buildRecommendations(input: {
  category: string;
  topic: string | null;
  text: string | null;
  confidence: number | undefined;
  primaryAssessment: SourceAssessment;
  supportingAssessments: SourceAssessment[];
  topicCandidates: Array<{ id: string; name: string; provider: string; status: string; ratingOverall: number; url: string; score: number }>;
  warnings: CheckResult[];
}): string[] {
  const recommendations: string[] = [];

  if (!input.primaryAssessment.catalogMatch.found) {
    recommendations.push("Primary attestation URL is not a clean source-catalog match. Prefer a catalog-backed public JSON endpoint when possible.");
  }

  if (ANALYSIS_CATEGORIES.has(input.category) && input.supportingAssessments.length === 0) {
    recommendations.push("Add at least one supporting source and pre-attest it with `omni.colony.attest({ url })` before publishing an analysis-style post.");
  }

  const uniqueProviders = new Set(
    [input.primaryAssessment, ...input.supportingAssessments]
      .map((assessment) => assessment.provider)
      .filter((provider): provider is string => typeof provider === "string"),
  );
  if (input.supportingAssessments.length > 0 && uniqueProviders.size < 2) {
    recommendations.push("Diversify the evidence chain across providers instead of stacking multiple URLs from the same provider.");
  }

  if (input.text && !/\d/.test(input.text)) {
    recommendations.push("Add concrete numbers, counts, or percentages to the draft so the attested source actually grounds the claim.");
  }

  if (input.confidence === undefined) {
    recommendations.push("Set an explicit confidence value so the publish path gets the scoring bonus and the post communicates conviction honestly.");
  }

  if (input.topic && input.topicCandidates.length > 0 && !input.primaryAssessment.catalogMatch.found) {
    const top = input.topicCandidates[0];
    recommendations.push(`For topic "${input.topic}", the best catalog-backed DAHR candidate was ${top.name} (${top.provider}) at ${top.url}.`);
  }

  if (input.warnings.some((warning) => warning.name === "analysis-style-post-has-supporting-sources")) {
    recommendations.push("Treat a single attested URL as the floor, not the ideal, for analysis/observation posts that synthesize claims.");
  }

  return recommendations;
}

async function assessUrl(
  url: string,
  allowInsecure: boolean,
  sourceView: ReturnType<typeof loadAgentSourceView>,
): Promise<SourceAssessment> {
  const parsed = tryParseUrl(url);
  const catalogMatches = parsed ? rankCatalogMatches(url, sourceView.sources) : [];
  const bestMatch = catalogMatches[0];
  const urlCheck = await validateUrl(url, { allowInsecure });
  const checks: CheckResult[] = [];

  checks.push({
    name: "url-is-ssrf-safe",
    pass: urlCheck.valid,
    severity: "blocker",
    detail: urlCheck.valid ? "URL passed SSRF validation" : (urlCheck.reason ?? "URL validation failed"),
  });

  if (bestMatch) {
    checks.push({
      name: "catalog-match-found",
      pass: true,
      severity: "info",
      detail: `${bestMatch.source.name} (${bestMatch.source.provider}) score=${bestMatch.score}`,
    });
    checks.push({
      name: "catalog-source-is-dahr-safe",
      pass: bestMatch.source.dahr_safe === true,
      severity: "blocker",
      detail: `dahr_safe=${String(bestMatch.source.dahr_safe)}`,
    });
    checks.push({
      name: "catalog-source-returns-json",
      pass: bestMatch.source.responseFormat === "json",
      severity: "blocker",
      detail: `responseFormat=${bestMatch.source.responseFormat}`,
    });
    checks.push({
      name: "catalog-source-health-is-acceptable",
      pass: bestMatch.source.status === "active" && bestMatch.source.rating.overall >= 50,
      severity: "warning",
      detail: `status=${bestMatch.source.status}, rating=${bestMatch.source.rating.overall}`,
    });
    checks.push({
      name: "catalog-source-trust-tier-is-not-experimental",
      pass: bestMatch.source.trustTier === "official" || bestMatch.source.trustTier === "established",
      severity: "warning",
      detail: `trustTier=${bestMatch.source.trustTier}`,
    });
  } else {
    checks.push({
      name: "catalog-match-found",
      pass: false,
      severity: "warning",
      detail: "No bundled source-catalog match was found for this URL",
    });
  }

  return {
    url,
    hostname: parsed?.hostname ?? null,
    provider: parsed ? inferProvider(url) : null,
    urlValidation: urlCheck.valid
      ? { ok: true }
      : { ok: false, reason: urlCheck.reason ?? "URL validation failed" },
    catalogMatch: bestMatch
      ? {
          found: true,
          source: {
            id: bestMatch.source.id,
            name: bestMatch.source.name,
            provider: bestMatch.source.provider,
            status: bestMatch.source.status,
            trustTier: bestMatch.source.trustTier,
            responseFormat: bestMatch.source.responseFormat,
            dahrSafe: bestMatch.source.dahr_safe === true,
            tlsnSafe: bestMatch.source.tlsn_safe === true,
            ratingOverall: bestMatch.source.rating.overall,
            note: bestMatch.source.note ?? null,
          },
          score: bestMatch.score,
        }
      : { found: false },
    checks,
  };
}

function rankCatalogMatches(url: string, sources: SourceRecordV2[]): CatalogMatch[] {
  const parsed = tryParseUrl(url);
  if (!parsed) return [];

  const actualProvider = inferProvider(url);
  const actualPathSegments = parsed.pathname.split("/").filter(Boolean);
  const actualQueryKeys = new Set(Array.from(parsed.searchParams.keys()));

  const matches = sources.map((source) => {
    const template = parseTemplateUrl(source.url);
    if (!template) return null;

    let score = 0;
    const providerMatches = source.provider === actualProvider;
    const hostMatches = template.hostname === parsed.hostname;
    if (hostMatches) score += 30;
    if (providerMatches) score += 15;

    const staticPathSegments = template.pathname
      .split("/")
      .filter(Boolean)
      .filter((segment) => !segment.includes("placeholder"));
    const staticPathMatches = staticPathSegments.filter((segment) => actualPathSegments.includes(segment)).length;
    score += staticPathMatches * 4;

    const staticQueryKeys = Array.from(template.searchParams.keys());
    const staticQueryMatches = staticQueryKeys.filter((key) => actualQueryKeys.has(key)).length;
    score += staticQueryMatches * 2;

    if (!hostMatches && !providerMatches) return null;
    if (staticPathMatches === 0 && staticQueryMatches === 0) return null;

    return {
      source,
      score,
      hostMatches,
      providerMatches,
      staticPathMatches,
      staticQueryMatches,
    };
  }).filter((match): match is CatalogMatch => match !== null);

  return matches.sort((left, right) =>
    right.score - left.score
    || Number(right.hostMatches) - Number(left.hostMatches)
    || right.staticPathMatches - left.staticPathMatches
    || right.staticQueryMatches - left.staticQueryMatches
    || right.source.rating.overall - left.source.rating.overall
  );
}

function parseTemplateUrl(url: string): URL | null {
  try {
    return new URL(url.replace(/\{[^}]+\}/g, "placeholder"));
  } catch {
    return null;
  }
}

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function parseAgent(value: string): AgentName | null {
  return SUPPORTED_AGENTS.includes(value as AgentName) ? value as AgentName : null;
}

function getMultiStringArgs(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === flag && argv[index + 1]) {
      values.push(argv[index + 1]);
    }
  }
  return values;
}

function validateFlagHasValue(flag: string, argv: string[]): void {
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === flag && !argv[index + 1]) {
      console.error(`Error: ${flag} requires a value`);
      process.exit(2);
    }
  }
}

function normalizeCategory(value: string): string {
  return value.trim().toUpperCase();
}
