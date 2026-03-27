/**
 * Tool wrapper — eliminates boilerplate across all tool functions.
 *
 * Handles: timing, session.touch(), onToolCall notification, error wrapping.
 */

import type { ToolResult, Provenance } from "../types.js";
import { err, demosError, isDemosError } from "../types.js";
import { DemosSession } from "../session.js";

/**
 * Wraps a tool operation with standard boilerplate:
 * 1. Records start time
 * 2. Calls session.touch()
 * 3. Executes the operation
 * 4. Notifies onToolCall observer on success
 * 5. Catches errors and wraps in typed DemosError
 */
export async function withToolWrapper<T>(
  session: DemosSession,
  toolName: string,
  defaultErrorCode: "TX_FAILED" | "NETWORK_ERROR" | "ATTEST_FAILED" | "CONFIRM_TIMEOUT" | "INVALID_INPUT",
  fn: (startMs: number) => Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  const start = Date.now();
  session.touch();

  try {
    const result = await fn(start);

    // Always notify observer — error telemetry is as important as success
    if (session.onToolCall) {
      session.onToolCall({
        tool: toolName,
        durationMs: Date.now() - start,
        result,
      });
    }

    return result;
  } catch (e) {
    // Preserve DemosError code when thrown intentionally (e.g., SSRF validation in publish pipeline)
    return err(
      isDemosError(e)
        ? e
        : demosError(defaultErrorCode, `${toolName} failed: ${(e as Error).message}`, true),
      { path: "local", latencyMs: Date.now() - start },
    );
  }
}

/** Create a local provenance object */
export function localProvenance(startMs: number): Provenance {
  return { path: "local", latencyMs: Date.now() - startMs };
}

/** Type guard for DemosError-shaped objects (code + message + retryable) */
export function isDemosErrorLike(error: unknown): error is ReturnType<typeof demosError> {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && "message" in error
    && "retryable" in error,
  );
}
