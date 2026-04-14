/**
 * Source fetch — shared HTTP fetch with retry, timeout, and rate-limit integration.
 *
 * Adapters generate URLs; this module fetches them. Centralizes retry logic,
 * timeout enforcement, and rate-limit checking so adapters stay pure.
 *
 * Does NOT own attestation — publish-pipeline.ts handles that.
 */

import type { SourceRecordV2 } from "./catalog.js";
import { fetchWithTimeout } from "../network/fetch-with-timeout.js";
import type { FetchedResponse } from "../providers/types.js";
import {
  acquireRateLimitToken,
  recordRateLimitResponse,
} from "./rate-limit.js";
import { toErrorMessage } from "../util/errors.js";

// ── Fetch Options ───────────────────────────────────

export interface FetchSourceOptions {
  /** Rate limit bucket key (typically provider name) */
  rateLimitBucket?: string;
  /** Rate limit: max requests per minute */
  rateLimitRpm?: number;
  /** Rate limit: max requests per day */
  rateLimitRpd?: number;
  /** Override timeout (ms). Falls back to source.runtime.timeoutMs */
  timeoutMs?: number;
  /** Override max retry attempts. Falls back to source.runtime.retry.maxAttempts */
  maxAttempts?: number;
}

// ── Fetch Result ────────────────────────────────────

export interface FetchSourceResult {
  ok: boolean;
  response?: FetchedResponse;
  error?: string;
  attempts: number;
  totalMs: number;
}

// ── Core Fetch ──────────────────────────────────────

/**
 * Fetch a URL with retry, timeout, and rate-limit checks.
 *
 * Uses the source record's runtime config for defaults, with optional overrides.
 * Retries on configured error classes (timeout, 5xx, 429).
 */
export async function fetchSource(
  url: string,
  source: SourceRecordV2,
  options: FetchSourceOptions = {}
): Promise<FetchSourceResult> {
  const timeoutMs = options.timeoutMs ?? source.runtime.timeoutMs;
  const maxAttempts = options.maxAttempts ?? source.runtime.retry.maxAttempts;
  const backoffMs = source.runtime.retry.backoffMs;
  const retryOn = new Set(source.runtime.retry.retryOn);
  const bucket = options.rateLimitBucket;

  // Rate limit check
  if (bucket) {
    const allowed = acquireRateLimitToken(
      bucket,
      options.rateLimitRpm,
      options.rateLimitRpd
    );
    if (!allowed) {
      return {
        ok: false,
        error: `Rate limited: bucket "${bucket}"`,
        attempts: 0,
        totalMs: 0,
      };
    }
  }

  const start = Date.now();
  let lastError = "";
  let attempts = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    attempts++;

    // Acquire rate-limit token per attempt (retries count against quota)
    if (bucket && attempt > 0) {
      const allowed = acquireRateLimitToken(
        bucket,
        options.rateLimitRpm,
        options.rateLimitRpd
      );
      if (!allowed) {
        lastError = `Rate limited during retry: bucket "${bucket}"`;
        break;
      }
    }

    try {
      const res = await fetchWithTimeout(url, timeoutMs, {
        method: "GET",
        headers: {
          "Accept": "application/json, application/xml, text/xml, */*",
          "User-Agent": "omniweb-agents/1.0",
        },
      });

      // Handle 429 with rate-limit recording
      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after");
        if (bucket) {
          const retrySeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 60;
          recordRateLimitResponse(bucket, retrySeconds);
        }
        if (retryOn.has("429") && attempt < maxAttempts - 1) {
          lastError = `HTTP 429 Too Many Requests`;
          await sleep(backoffMs * (attempt + 1));
          continue;
        }
      }

      // Handle 5xx with retry
      if (res.status >= 500 && retryOn.has("5xx") && attempt < maxAttempts - 1) {
        lastError = `HTTP ${res.status}`;
        await sleep(backoffMs * (attempt + 1));
        continue;
      }

      const bodyText = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      return {
        ok: res.status >= 200 && res.status < 400,
        response: {
          url,
          status: res.status,
          headers,
          bodyText,
        },
        attempts,
        totalMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const msg = toErrorMessage(err);

      // Timeout / abort
      if (msg.includes("abort") || msg.includes("timeout")) {
        lastError = `Timeout after ${timeoutMs}ms`;
        if (retryOn.has("timeout") && attempt < maxAttempts - 1) {
          await sleep(backoffMs * (attempt + 1));
          continue;
        }
      } else {
        lastError = msg;
        // Network errors — retry if 5xx is in retry set (generic network failure)
        if (retryOn.has("5xx") && attempt < maxAttempts - 1) {
          await sleep(backoffMs * (attempt + 1));
          continue;
        }
      }
    }
  }

  return {
    ok: false,
    error: lastError || "Unknown fetch error",
    attempts,
    totalMs: Date.now() - start,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
