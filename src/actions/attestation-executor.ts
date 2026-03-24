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

export interface ExecutionOptions {
  /** Agent attestation policy — when "dahr_only", forces DAHR regardless of planner/size. */
  attestationMode?: "dahr_only" | "tlsn_preferred" | "tlsn_only";
}

/**
 * Execute an attestation plan sequentially.
 *
 * For each candidate:
 * 1. Acquire rate limit token using candidate.rateLimitBucket
 * 2. Try TLSN if small enough, fall back to DAHR
 * 3. Skip on rate-limit denial, log observation
 *
 * Respects agent attestation policy: dahr_only forces DAHR for all candidates.
 */
export async function executeAttestationPlan(
  plan: AttestationPlan,
  demos: Demos,
  options?: ExecutionOptions,
): Promise<ExecutionResult> {
  const mode = options?.attestationMode ?? "dahr_only";
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

    // Respect agent attestation policy first, then planner's method choice, then size-based
    const useTlsn = mode === "dahr_only"
      ? false
      : mode === "tlsn_only"
        ? true
        : candidate.plannedMethod
          ? candidate.plannedMethod === "TLSN"
          : candidate.estimatedSizeBytes <= TLSN_MAX_SIZE_BYTES;

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
    } catch (firstErr: any) {
      // Retry once after 2s backoff (transient network/RPC failures)
      try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        observe("insight", `Retrying attestation for ${candidate.provider} after failure: ${String(firstErr?.message || firstErr)}`, {
          substage: "publish",
          source: "attestation-executor.ts",
          data: { provider: candidate.provider, url: candidate.url },
        });
        const retryResult = await attestDahr(demos, candidate.url);
        results.push(retryResult);
      } catch (retryErr: any) {
        observe("error", `Attestation failed after retry for ${candidate.url}: ${String(retryErr?.message || retryErr)}`, {
          substage: "publish",
          source: "attestation-executor.ts",
          data: { provider: candidate.provider, url: candidate.url },
        });
        failed.push(candidate);
      }
    }
  }

  return { results, skipped, failed };
}
