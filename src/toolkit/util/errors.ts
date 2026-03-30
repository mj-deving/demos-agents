/**
 * Shared error utilities.
 *
 * Extracted from 8+ files that each defined this inline.
 */

/** Extract a human-readable message from an unknown catch value. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
