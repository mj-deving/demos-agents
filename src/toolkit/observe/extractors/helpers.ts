/** 24 hours in milliseconds — default staleness threshold for evidence. */
export const STALE_THRESHOLD_MS = 86_400_000;

/** Cap richness at 95 (evidence scoring ceiling). */
export function capRichness(value: number): number {
  return Math.min(95, value);
}

/** Truncate evidence subject to max length. */
export function truncateSubject(text: string, maxLen = 80): string {
  return text.slice(0, maxLen);
}
