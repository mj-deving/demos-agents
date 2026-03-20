/**
 * Skill Dojo HTTP client with sliding-window rate limiting.
 *
 * Rate state is per-instance, in-memory — resets on process restart.
 * For cron agents (each session is a fresh process), this is sufficient.
 * For multi-process deployments, the server-side 5 req/hr per IP limit
 * is the actual shared constraint — this client-side budget is advisory.
 */

// ── Types ──────────────────────────────────────────

export interface SkillDojoClientConfig {
  baseUrl?: string;
  maxRequestsPerHour?: number;
}

export interface SkillDojoResponse<T = unknown> {
  ok: boolean;
  skillId: string;
  executionTimeMs: number;
  result?: {
    status: string;
    message: string;
    data: T;
    timestamp: string;
  };
  error?: string;
}

export interface SkillDojoClient {
  execute<T = unknown>(
    skillId: string,
    params: Record<string, unknown>,
  ): Promise<SkillDojoResponse<T>>;
  canExecute(): boolean;
  getRemainingBudget(): { remaining: number; resetsAt: number };
}

// ── Implementation ─────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_BASE_URL =
  "https://skillsdojo-production.up.railway.app";
const DEFAULT_MAX_PER_HOUR = 5;

export function createSkillDojoClient(
  config?: SkillDojoClientConfig,
): SkillDojoClient {
  const baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;
  const maxPerHour = config?.maxRequestsPerHour ?? DEFAULT_MAX_PER_HOUR;
  const timestamps: number[] = [];

  function pruneWindow(): void {
    const cutoff = Date.now() - HOUR_MS;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
  }

  function canExecute(): boolean {
    pruneWindow();
    return timestamps.length < maxPerHour;
  }

  function getRemainingBudget(): { remaining: number; resetsAt: number } {
    pruneWindow();
    const remaining = Math.max(0, maxPerHour - timestamps.length);
    const resetsAt =
      timestamps.length > 0 ? timestamps[0] + HOUR_MS : Date.now() + HOUR_MS;
    return { remaining, resetsAt };
  }

  async function execute<T = unknown>(
    skillId: string,
    params: Record<string, unknown>,
  ): Promise<SkillDojoResponse<T>> {
    if (!canExecute()) {
      const { resetsAt } = getRemainingBudget();
      return {
        ok: false,
        skillId,
        executionTimeMs: 0,
        error: `Rate limit exceeded (${maxPerHour}/hr). Resets at ${new Date(resetsAt).toISOString()}`,
      };
    }

    timestamps.push(Date.now());

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId, params }),
      });
    } catch (err) {
      return {
        ok: false,
        skillId,
        executionTimeMs: 0,
        error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        skillId,
        executionTimeMs: 0,
        error: `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    try {
      return (await res.json()) as SkillDojoResponse<T>;
    } catch {
      return {
        ok: false,
        skillId,
        executionTimeMs: 0,
        error: "Invalid JSON response from Skill Dojo",
      };
    }
  }

  return { execute, canExecute, getRemainingBudget };
}
