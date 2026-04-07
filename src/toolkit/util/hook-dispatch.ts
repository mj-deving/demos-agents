/**
 * Isolated hook runner with timeout.
 * Pure utility — no extension system knowledge.
 */

export interface HookResult<T> {
  ok: boolean;
  result?: T;
  error?: string;
  isTimeout: boolean;
  elapsedMs: number;
}

/**
 * Run an async hook function with a timeout guard.
 * Returns a structured result indicating success, error, or timeout.
 */
export async function runHookWithTimeout<T>(
  hookFn: () => Promise<T>,
  timeoutMs = 30_000,
  label?: string,
  observe?: (type: string, msg: string, meta?: Record<string, unknown>) => void,
): Promise<HookResult<T>> {
  const start = Date.now();

  try {
    const result = await Promise.race([
      hookFn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new TimeoutSentinel()), timeoutMs),
      ),
    ]);

    return {
      ok: true,
      result,
      isTimeout: false,
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    const elapsedMs = Date.now() - start;

    if (err instanceof TimeoutSentinel) {
      observe?.(
        "hook:timeout",
        `Hook ${label ?? "anonymous"} timed out after ${timeoutMs}ms`,
        { label, timeoutMs, elapsedMs },
      );
      return { ok: false, isTimeout: true, elapsedMs };
    }

    const message = err instanceof Error ? err.message : String(err);
    observe?.(
      "hook:error",
      `Hook ${label ?? "anonymous"} failed: ${message}`,
      { label, elapsedMs },
    );
    return { ok: false, isTimeout: false, error: message, elapsedMs };
  }
}

/** Internal sentinel to distinguish timeout from hook errors. */
class TimeoutSentinel extends Error {
  constructor() {
    super("timeout");
    this.name = "TimeoutSentinel";
  }
}
