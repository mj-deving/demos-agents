#!/usr/bin/env npx tsx

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadConnect, loadPackageExport } from "./_shared.ts";

type MatrixFamily =
  | "funding-structure"
  | "etf-flows"
  | "spot-momentum"
  | "network-activity"
  | "stablecoin-supply"
  | "vix-credit";

interface FeedSample {
  txHash: string | null;
  category: string | null;
  text: string;
  author: string | null;
  timestamp: number | null;
}

interface SignalSample {
  topic: string | null;
  confidence: number | null;
  direction: string | null;
}

interface MatrixFamilyResult {
  family: MatrixFamily;
  status:
    | "no_live_candidate"
    | "attestation_plan_not_ready"
    | "evidence_not_ready"
    | "draft_rejected"
    | "match_failed"
    | "draft_ready"
    | "published"
    | "publish_failed";
  topic?: string;
  opportunityKind?: string;
  rationale?: string;
  reason?: string;
  evidenceSource?: string | null;
  supportingSources?: string[];
  promptProvider?: string | null;
  draft?: {
    text: string;
    category: string;
    confidence: number;
  };
  qualityGate?: unknown;
  match?: unknown;
  verification?: unknown;
  publish?: {
    txHash?: string;
    provenance?: unknown;
    error?: unknown;
  };
  notes?: string[];
}

interface ResearchOpportunityLike {
  kind: string;
  topic: string;
  score: number;
  rationale: string;
  sourceProfile: {
    family: string;
    supported: boolean;
  };
  matchedSignal: {
    confidence: number | null;
  };
  matchingFeedPosts: FeedSample[];
  contradictionSignals?: string[];
  attestationPlan: any;
}

const SUPPORTED_FAMILIES: MatrixFamily[] = [
  "funding-structure",
  "etf-flows",
  "spot-momentum",
  "network-activity",
  "stablecoin-supply",
  "vix-credit",
];

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/check-research-e2e-matrix.ts [options]

Options:
  --broadcast-family FAMILY   Execute one real publish for the named family
  --out PATH                  Write the JSON report to a file as well as stdout
  --verify-timeout-ms N       Visibility verification timeout when broadcasting (default: 45000)
  --verify-poll-ms N          Visibility poll interval when broadcasting (default: 5000)
  --verify-limit N            Feed limit for visibility checks (default: 50)
  --state-dir PATH            Forwarded to connect()
  --allow-insecure            Forwarded to connect() for local debugging only
  --help, -h                  Show this help
`);
  process.exit(0);
}

const broadcastFamily = getOptionalArg("--broadcast-family");
if (broadcastFamily && !SUPPORTED_FAMILIES.includes(broadcastFamily as MatrixFamily)) {
  console.error(`Unsupported --broadcast-family value: ${broadcastFamily}`);
  process.exit(2);
}

const outputPath = getOptionalArg("--out");
const verifyTimeoutMs = getPositiveInt("--verify-timeout-ms", 45_000);
const verifyPollMs = getPositiveInt("--verify-poll-ms", 5_000);
const verifyLimit = getPositiveInt("--verify-limit", 50);

const getPrimaryAttestUrl = await loadPackageExport<
  (plan: { primary?: { url?: string | null } | null } | null | undefined) => string | null
>(
  "../dist/agent.js",
  "../src/agent.ts",
  "getPrimaryAttestUrl",
);

const getPrimaryAttestationCandidate = await loadPackageExport<
  <T extends { primary?: unknown } | null | undefined>(plan: T) => T extends { primary?: infer U } ? Exclude<U, undefined> | null : null
>(
  "../dist/agent.js",
  "../src/agent.ts",
  "getPrimaryAttestationCandidate",
);
const stateDir = getOptionalArg("--state-dir");
const allowInsecureUrls = args.includes("--allow-insecure");

const connect = await loadConnect();
const deriveResearchOpportunities = await loadPackageExport<
  (opts: { signals: SignalSample[]; posts: FeedSample[] }) => ResearchOpportunityLike[]
>(
  "../dist/agent.js",
  "../src/agent.ts",
  "deriveResearchOpportunities",
);
const fetchResearchEvidenceSummary = await loadPackageExport<
  (opts: { source: any; topic: string }) => Promise<any>
>(
  "../dist/agent.js",
  "../src/agent.ts",
  "fetchResearchEvidenceSummary",
);
const buildResearchDraft = await loadPackageExport<
  (opts: {
    opportunity: ResearchOpportunityLike;
    feedCount: number;
    leaderboardCount: number;
    availableBalance: number;
    evidenceSummary: any;
    supportingEvidenceSummaries?: any[];
    llmProvider?: unknown;
    minTextLength?: number;
  }) => Promise<any>
>(
  "../dist/agent.js",
  "../src/agent.ts",
  "buildResearchDraft",
);
const matchResearchDraftToPlan = await loadPackageExport<
  (opts: {
    topic: string;
    text: string;
    tags: string[];
    attestationPlan: any;
    evidenceReads: any[];
  }) => Promise<any>
>(
  "../dist/agent.js",
  "../src/agent.ts",
  "matchResearchDraftToPlan",
);
const verifyPublishVisibility = await loadPackageExport<
  (omni: any, txHash: string | undefined, text: string, opts: {
    timeoutMs: number;
    pollMs: number;
    limit: number;
  }) => Promise<any>
>(
  "../dist/publish-visibility.js",
  "../src/publish-visibility.ts",
  "verifyPublishVisibility",
);
const omni = await connect({ stateDir, allowInsecureUrls });
const startedAt = new Date().toISOString();

const [feedRead, signalsRead, leaderboardRead, balanceRead] = await Promise.allSettled([
  omni.colony.getFeed({ limit: 30 }),
  omni.colony.getSignals(),
  omni.colony.getLeaderboard({ limit: 10 }),
  omni.colony.getBalance(),
]);

const reads = {
  feed: unwrap(feedRead),
  signals: unwrap(signalsRead),
  leaderboard: unwrap(leaderboardRead),
  balance: unwrap(balanceRead),
};

if (!reads.feed.ok || !reads.signals.ok || !reads.balance.ok) {
  const failure = {
    checkedAt: startedAt,
    ok: false,
    reason: "core_reads_failed",
    readStatus: {
      feed: describeRead(reads.feed),
      signals: describeRead(reads.signals),
      leaderboard: describeRead(reads.leaderboard),
      balance: describeRead(reads.balance),
    },
  };
  await maybeWriteOutput(outputPath, failure);
  console.log(JSON.stringify(failure, null, 2));
  process.exit(1);
}

const posts = extractFeedPosts(reads.feed.data);
const signals = extractSignals(reads.signals.data);
const leaderboardAgents = extractLeaderboardAgents(reads.leaderboard.data);
const availableBalance = extractAvailableBalance(reads.balance.data);
const opportunities = deriveResearchOpportunities({
  signals,
  posts,
});

const candidatesByFamily = new Map<MatrixFamily, ResearchOpportunityLike>();
for (const opportunity of opportunities) {
  const family = opportunity.sourceProfile.family;
  if (!SUPPORTED_FAMILIES.includes(family as MatrixFamily)) continue;
  if (!candidatesByFamily.has(family as MatrixFamily)) {
    candidatesByFamily.set(family as MatrixFamily, opportunity);
  }
}

const familyResults: MatrixFamilyResult[] = [];
for (const family of SUPPORTED_FAMILIES) {
  const opportunity = candidatesByFamily.get(family);
  if (!opportunity) {
    familyResults.push({
      family,
      status: "no_live_candidate",
      reason: "No current live colony signal mapped to this supported research family.",
    });
    continue;
  }

  const primaryAttestationCandidate = getPrimaryAttestationCandidate(opportunity.attestationPlan);
  if (!opportunity.attestationPlan.ready || !primaryAttestationCandidate) {
    familyResults.push({
      family,
      status: "attestation_plan_not_ready",
      topic: opportunity.topic,
      opportunityKind: opportunity.kind,
      rationale: opportunity.rationale,
      reason: opportunity.attestationPlan.reason,
      notes: opportunity.attestationPlan.warnings,
    });
    continue;
  }

  const evidenceReads = await Promise.allSettled([
    fetchResearchEvidenceSummary({ source: primaryAttestationCandidate, topic: opportunity.topic }),
    ...opportunity.attestationPlan.supporting.map((source) =>
      fetchResearchEvidenceSummary({ source, topic: opportunity.topic })),
  ]);
  const primaryEvidence = evidenceReads[0];
  const supportingEvidence = evidenceReads.slice(1);
  const supportingNotes = supportingEvidence.flatMap((entry, index) => {
    const source = opportunity.attestationPlan.supporting[index];
    if (!source) return [];
    if (entry.status === "rejected") return [`Supporting evidence fetch failed for ${source.name}: ${String(entry.reason)}`];
    if (!entry.value.ok) return [`Supporting evidence unavailable for ${source.name}: ${entry.value.note}`];
    return [];
  });

  if (!primaryEvidence || primaryEvidence.status !== "fulfilled" || !primaryEvidence.value.ok) {
    familyResults.push({
      family,
      status: "evidence_not_ready",
      topic: opportunity.topic,
      opportunityKind: opportunity.kind,
      rationale: opportunity.rationale,
      reason: primaryEvidence?.status === "fulfilled"
        ? primaryEvidence.value.note
        : `Primary evidence fetch failed: ${String(primaryEvidence?.reason)}`,
      notes: supportingNotes,
    });
    continue;
  }

  const supportingSummaries = supportingEvidence.flatMap((entry) =>
    entry.status === "fulfilled" && entry.value.ok ? [entry.value.summary] : []);
  const prefetchResults = evidenceReads.flatMap((entry) =>
    entry.status === "fulfilled" ? [entry.value] : []);
  const draft = await buildResearchDraft({
    opportunity,
    feedCount: posts.length,
    leaderboardCount: leaderboardAgents.length,
    availableBalance,
    evidenceSummary: primaryEvidence.value.summary,
    supportingEvidenceSummaries: supportingSummaries,
    llmProvider: omni.runtime.llmProvider,
    minTextLength: 300,
  });

  if (!draft.ok) {
    familyResults.push({
      family,
      status: "draft_rejected",
      topic: opportunity.topic,
      opportunityKind: opportunity.kind,
      rationale: opportunity.rationale,
      reason: draft.reason,
      qualityGate: draft.qualityGate,
      promptProvider: omni.runtime.llmProvider?.name ?? null,
      notes: draft.notes,
    });
    continue;
  }

  const match = await matchResearchDraftToPlan({
    topic: opportunity.topic,
    text: draft.text,
    tags: draft.tags,
    attestationPlan: opportunity.attestationPlan,
    evidenceReads: prefetchResults,
  });

  if (!match.pass) {
    familyResults.push({
      family,
      status: "match_failed",
      topic: opportunity.topic,
      opportunityKind: opportunity.kind,
      rationale: opportunity.rationale,
      reason: match.reason,
      evidenceSource: primaryEvidence.value.summary.source,
      supportingSources: supportingSummaries.map((entry) => entry.source),
      draft: {
        text: draft.text,
        category: draft.category,
        confidence: draft.confidence,
      },
      qualityGate: draft.qualityGate,
      match,
      notes: supportingNotes,
    });
    continue;
  }

  const readyResult: MatrixFamilyResult = {
    family,
    status: "draft_ready",
    topic: opportunity.topic,
    opportunityKind: opportunity.kind,
    rationale: opportunity.rationale,
    evidenceSource: primaryEvidence.value.summary.source,
    supportingSources: supportingSummaries.map((entry) => entry.source),
    promptProvider: omni.runtime.llmProvider?.name ?? null,
    draft: {
      text: draft.text,
      category: draft.category,
      confidence: draft.confidence,
    },
    qualityGate: draft.qualityGate,
    match,
    notes: supportingNotes,
  };

  if (broadcastFamily === family) {
    const attestUrl = getPrimaryAttestUrl(opportunity.attestationPlan);
    if (!attestUrl) {
      readyResult.status = "publish_failed";
      readyResult.publish = {
        error: { message: "missing_primary_attest_url" },
        provenance: null,
      };
      familyResults.push(readyResult);
      continue;
    }
    const publishResult = await omni.colony.publish({
      text: draft.text,
      category: draft.category,
      attestUrl,
      confidence: draft.confidence,
    });

    if (!publishResult.ok) {
      readyResult.status = "publish_failed";
      readyResult.publish = {
        error: publishResult.error ?? null,
        provenance: publishResult.provenance,
      };
    } else {
      const verification = await verifyPublishVisibility(
        omni,
        publishResult.data?.txHash,
        draft.text,
        {
          timeoutMs: verifyTimeoutMs,
          pollMs: verifyPollMs,
          limit: verifyLimit,
        },
      );
      readyResult.status = "published";
      readyResult.publish = {
        txHash: publishResult.data?.txHash,
        provenance: publishResult.provenance,
      };
      readyResult.verification = verification;
    }
  }

  familyResults.push(readyResult);
}

const report = {
  checkedAt: startedAt,
  ok: true,
  broadcastFamily: broadcastFamily ?? null,
  availableBalance,
  readStatus: {
    feed: describeRead(reads.feed),
    signals: describeRead(reads.signals),
    leaderboard: describeRead(reads.leaderboard),
    balance: describeRead(reads.balance),
  },
  opportunitiesConsidered: opportunities.length,
  familyResults,
};

await maybeWriteOutput(outputPath, report);
console.log(JSON.stringify(report, null, 2));

function getOptionalArg(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function getPositiveInt(flag: string, fallback: number): number {
  const raw = getOptionalArg(flag);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flag} value: ${raw}`);
  }
  return parsed;
}

function unwrap<T extends { ok?: boolean }>(
  result: PromiseSettledResult<T>,
): { ok: boolean; data: T | null; error: string | null } {
  if (result.status === "rejected") {
    return {
      ok: false,
      data: null,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  }
  if (result.value?.ok !== true) {
    return {
      ok: false,
      data: result.value,
      error: "api_not_ok",
    };
  }
  return { ok: true, data: result.value, error: null };
}

function describeRead(result: { ok: boolean; error: string | null }): { ok: boolean; error: string | null } {
  return { ok: result.ok, error: result.error };
}

function extractFeedPosts(feed: unknown): FeedSample[] {
  if (!feed || typeof feed !== "object") return [];
  const posts = (feed as { data?: { posts?: unknown } }).data?.posts;
  if (!Array.isArray(posts)) return [];
  return posts.map((post) => samplePost(post));
}

function extractSignals(signals: unknown): SignalSample[] {
  if (!signals || typeof signals !== "object") return [];
  const list = (signals as { data?: unknown }).data;
  if (!Array.isArray(list)) return [];
  return list.map((signal) => ({
    topic: signalTopic(signal),
    confidence: signalConfidence(signal),
    direction:
      signal && typeof signal === "object" && typeof (signal as { direction?: unknown }).direction === "string"
        ? (signal as { direction: string }).direction
        : null,
  }));
}

function extractLeaderboardAgents(leaderboard: unknown): unknown[] {
  if (!leaderboard || typeof leaderboard !== "object") return [];
  const data = (leaderboard as { data?: unknown }).data;
  if (Array.isArray(data)) return data;
  const agents = (data as { agents?: unknown } | undefined)?.agents;
  return Array.isArray(agents) ? agents : [];
}

function extractAvailableBalance(balance: unknown): number {
  if (!balance || typeof balance !== "object") return 0;
  const direct = (balance as { balance?: unknown }).balance;
  if (typeof direct === "number") return direct;
  if (typeof direct === "string") {
    const parsed = Number.parseFloat(direct.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const nested = (balance as { data?: { balance?: unknown } }).data?.balance;
  if (typeof nested === "number") return nested;
  if (typeof nested === "string") {
    const parsed = Number.parseFloat(nested.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function signalTopic(signal: unknown): string | null {
  if (!signal || typeof signal !== "object") return null;
  const candidate = (signal as { shortTopic?: unknown; topic?: unknown }).shortTopic
    ?? (signal as { shortTopic?: unknown; topic?: unknown }).topic;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function signalConfidence(signal: unknown): number | null {
  if (!signal || typeof signal !== "object") return null;
  const candidate = (signal as { confidence?: unknown }).confidence;
  return typeof candidate === "number" ? candidate : null;
}

function postText(post: unknown): string {
  if (!post || typeof post !== "object") return "";
  const payload = (post as { payload?: { text?: unknown } }).payload;
  const payloadText = payload?.text;
  if (typeof payloadText === "string") return payloadText;
  const direct = (post as { text?: unknown }).text;
  return typeof direct === "string" ? direct : "";
}

function samplePost(post: unknown): FeedSample {
  if (!post || typeof post !== "object") {
    return {
      txHash: null,
      category: null,
      text: "",
      author: null,
      timestamp: null,
    };
  }
  const payload = (post as { payload?: { cat?: unknown } }).payload;
  return {
    txHash: typeof (post as { txHash?: unknown }).txHash === "string" ? (post as { txHash: string }).txHash : null,
    category: typeof payload?.cat === "string" ? payload.cat : null,
    text: postText(post),
    author: typeof (post as { author?: unknown }).author === "string" ? (post as { author: string }).author : null,
    timestamp: typeof (post as { timestamp?: unknown }).timestamp === "number" ? (post as { timestamp: number }).timestamp : null,
  };
}

async function maybeWriteOutput(path: string | undefined, report: unknown): Promise<void> {
  if (!path) return;
  const absolute = resolve(process.cwd(), path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
