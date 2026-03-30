/**
 * Rate limiter — in-memory token bucket per provider.
 *
 * Process-global, not persisted (Phase 4 runtime scope).
 * Phase 6 may add file-backed buckets for parallel test runs.
 *
 * Buckets are keyed by provider/auth identity, not adapter instance.
 */

// ── Bucket State ────────────────────────────────────

interface BucketState {
  /** Tokens available for immediate use */
  tokens: number;
  /** Max tokens (per-minute limit) */
  maxTokens: number;
  /** Last time tokens were replenished */
  lastRefill: number;
  /** Refill rate: tokens per millisecond */
  refillRate: number;
  /** Retry-After deadline (if provider sent 429) — epoch ms */
  retryAfter: number;
  /** Daily request count */
  dailyCount: number;
  /** Daily limit */
  dailyMax: number;
  /** Day start timestamp for daily reset */
  dayStart: number;
}

const buckets = new Map<string, BucketState>();

// ── Bucket Management ───────────────────────────────

function getOrCreateBucket(
  key: string,
  maxPerMinute?: number,
  maxPerDay?: number
): BucketState {
  let bucket = buckets.get(key);
  if (bucket) return bucket;

  const rpm = maxPerMinute ?? 60; // default: 60 rpm
  bucket = {
    tokens: rpm,
    maxTokens: rpm,
    lastRefill: Date.now(),
    refillRate: rpm / 60_000, // tokens per ms
    retryAfter: 0,
    dailyCount: 0,
    dailyMax: maxPerDay ?? Infinity,
    dayStart: dayStartMs(),
  };
  buckets.set(key, bucket);
  return bucket;
}

function dayStartMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function refillTokens(bucket: BucketState): void {
  const now = Date.now();
  const elapsed = now - bucket.lastRefill;
  if (elapsed <= 0) return;

  bucket.tokens = Math.min(
    bucket.maxTokens,
    bucket.tokens + elapsed * bucket.refillRate
  );
  bucket.lastRefill = now;

  // Reset daily counter at day boundary
  const today = dayStartMs();
  if (today > bucket.dayStart) {
    bucket.dailyCount = 0;
    bucket.dayStart = today;
  }
}

// ── Public API ──────────────────────────────────────

/**
 * Try to acquire a rate limit token for the given bucket.
 * Returns true if the request is allowed, false if rate-limited.
 *
 * @param bucketKey - Provider bucket key (e.g., "hn-algolia")
 * @param maxPerMinute - Max requests per minute for this bucket
 * @param maxPerDay - Max requests per day for this bucket
 */
export function acquireRateLimitToken(
  bucketKey: string,
  maxPerMinute?: number,
  maxPerDay?: number
): boolean {
  const bucket = getOrCreateBucket(bucketKey, maxPerMinute, maxPerDay);
  refillTokens(bucket);

  // Check retry-after deadline
  if (Date.now() < bucket.retryAfter) return false;

  // Check daily limit
  if (bucket.dailyCount >= bucket.dailyMax) return false;

  // Check per-minute tokens
  if (bucket.tokens < 1) return false;

  bucket.tokens -= 1;
  bucket.dailyCount += 1;
  return true;
}

/**
 * Record a rate-limit response (429) from a provider.
 * Sets the retry-after deadline for the bucket.
 *
 * @param bucketKey - Provider bucket key
 * @param retryAfterSeconds - Retry-After header value (seconds from now)
 */
export function recordRateLimitResponse(
  bucketKey: string,
  retryAfterSeconds?: number
): void {
  const bucket = buckets.get(bucketKey);
  if (!bucket) return;

  const delay = (retryAfterSeconds ?? 60) * 1000;
  bucket.retryAfter = Date.now() + delay;
  bucket.tokens = 0; // drain remaining tokens
}

/**
 * Check if a bucket is currently rate-limited without consuming a token.
 */
export function isRateLimited(bucketKey: string): boolean {
  const bucket = buckets.get(bucketKey);
  if (!bucket) return false;

  refillTokens(bucket);
  if (Date.now() < bucket.retryAfter) return true;
  if (bucket.dailyCount >= bucket.dailyMax) return true;
  if (bucket.tokens < 1) return true;
  return false;
}

/**
 * Reset all rate limit state (for testing).
 */
export function resetRateLimits(): void {
  buckets.clear();
}
