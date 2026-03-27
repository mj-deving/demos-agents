/**
 * Exponential backoff with retry for 429 responses.
 *
 * Max 3 retries with exponential delay: 1s, 2s, 4s.
 * Returns the successful result or the final error.
 */

import type { ToolResult } from "../types.js";
import { demosError, err } from "../types.js";
import { sleep } from "./state-helpers.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Wrap a tool operation with 429 backoff retry.
 * The operation should return a ToolResult. If it returns a RATE_LIMITED
 * error with retryable=true, we retry with exponential backoff.
 */
export async function withBackoff<T>(
  operation: () => Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  let lastResult: ToolResult<T> | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }

    lastResult = await operation();

    // Success or non-retryable error — return immediately
    if (lastResult.ok || !lastResult.error?.retryable) {
      return lastResult;
    }

    // Only retry on RATE_LIMITED or NETWORK_ERROR
    if (
      lastResult.error.code !== "RATE_LIMITED" &&
      lastResult.error.code !== "NETWORK_ERROR"
    ) {
      return lastResult;
    }
  }

  // All retries exhausted — return the last error with updated message
  return err<T>(
    demosError(
      lastResult!.error!.code,
      `${lastResult!.error!.message} (after ${MAX_RETRIES} retries)`,
      false,
    ),
    lastResult!.provenance,
  );
}

