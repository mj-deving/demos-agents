import { loadAgentSourceView } from "../../../src/toolkit/sources/catalog.js";
import { match } from "../../../src/toolkit/sources/matcher.js";

import {
  toPreflightCandidates,
  type MinimalAttestationPlan,
} from "./minimal-attestation-plan.js";
import type { FetchResearchEvidenceSummaryResult } from "./research-evidence.js";

export interface MatchResearchDraftToPlanOptions {
  topic: string;
  text: string;
  tags: string[];
  attestationPlan: MinimalAttestationPlan;
  evidenceReads: FetchResearchEvidenceSummaryResult[];
}

export interface MatchResearchDraftToPlanResult {
  pass: boolean;
  reason: string;
  bestSourceId: string | null;
}

export async function matchResearchDraftToPlan(
  opts: MatchResearchDraftToPlanOptions,
): Promise<MatchResearchDraftToPlanResult> {
  if (!opts.attestationPlan.catalogPath || opts.attestationPlan.catalogPath === "feed-attested") {
    return {
      pass: true,
      reason: "catalog-backed-source-view-unavailable",
      bestSourceId: null,
    };
  }

  const candidates = toPreflightCandidates(opts.attestationPlan);
  if (candidates.length === 0) {
    return {
      pass: false,
      reason: "no catalog-backed preflight candidates",
      bestSourceId: null,
    };
  }

  const sourceView = loadAgentSourceView(
    opts.attestationPlan.agent,
    opts.attestationPlan.catalogPath,
    opts.attestationPlan.catalogPath,
    "catalog-only",
  );
  const prefetchedResponses = new Map(
    opts.evidenceReads.flatMap((entry) =>
      entry.ok && entry.prefetchedResponse ? [[entry.summary.url, entry.prefetchedResponse] as const] : []),
  );

  const result = await match({
    topic: opts.topic,
    postText: opts.text,
    postTags: opts.tags,
    candidates,
    sourceView,
    llm: null,
    prefetchedResponses,
  });

  return {
    pass: result.pass,
    reason: result.reason,
    bestSourceId: result.best?.sourceId ?? null,
  };
}
