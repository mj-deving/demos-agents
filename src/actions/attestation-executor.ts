/**
 * Attestation executor — runs attestation plans against the Demos network.
 *
 * Platform-bound: imports Demos SDK, lives in src/actions/.
 * Separated from the planner (src/lib/) per Codex finding #1.
 *
 * Sequential execution to avoid 429 storms.
 */

import type { Demos } from "@kynesyslabs/demosdk/websdk";
import type { SurgicalCandidate } from "../lib/sources/providers/types.js";
import { TLSN_MAX_SIZE_BYTES } from "../lib/attestation-planner.js";
import type { AttestationPlan } from "../lib/attestation-planner.js";
import type { AttestResult } from "./publish-pipeline.js";
import { attestDahr, attestTlsn } from "./publish-pipeline.js";
import { acquireRateLimitToken } from "../lib/sources/rate-limit.js";
import { observe } from "../lib/observe.js";

// ── Types ─────────────────────────────────────────

export interface ExecutionResult {
  results: AttestResult[];
  skipped: SurgicalCandidate[];
  failed: SurgicalCandidate[];
}

// ── Execution ─────────────────────────────────────

/**
 * Execute an attestation plan sequentially.
 *
 * For each candidate:
 * 1. Acquire rate limit token using candidate.rateLimitBucket
 * 2. Try TLSN if small enough, fall back to DAHR
 * 3. Skip on rate-limit denial, log observation
 */
export async function executeAttestationPlan(
  plan: AttestationPlan,
  demos: Demos,
): Promise<ExecutionResult> {
  const allCandidates = [plan.primary, ...plan.secondary];
  const results: AttestResult[] = [];
  const skipped: SurgicalCandidate[] = [];
  const failed: SurgicalCandidate[] = [];

  for (const candidate of allCandidates) {
    // Rate limit check
    if (candidate.rateLimitBucket) {
      const allowed = acquireRateLimitToken(candidate.rateLimitBucket);
      if (!allowed) {
        observe("insight", `Rate limited for ${candidate.provider}, skipping attestation`, {
          substage: "publish",
          source: "attestation-executor.ts",
          data: { provider: candidate.provider, url: candidate.url },
        });
        skipped.push(candidate);
        continue;
      }
    }

    // Determine method: TLSN if small enough, else DAHR
    const useTlsn = candidate.estimatedSizeBytes <= TLSN_MAX_SIZE_BYTES;

    try {
      let result: AttestResult;
      if (useTlsn) {
        try {
          result = await attestTlsn(demos, candidate.url);
        } catch {
          // TLSN failed → fall back to DAHR
          result = await attestDahr(demos, candidate.url);
        }
      } else {
        result = await attestDahr(demos, candidate.url);
      }
      results.push(result);
    } catch (err: any) {
      observe("error", `Attestation failed for ${candidate.url}: ${String(err?.message || err)}`, {
        substage: "publish",
        source: "attestation-executor.ts",
        data: { provider: candidate.provider, url: candidate.url },
      });
      failed.push(candidate);
    }
  }

  return { results, skipped, failed };
}
