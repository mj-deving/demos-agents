/**
 * Shared watermark extraction — finds the latest item by timestamp.
 * Used by all event sources to avoid duplicating the reduce pattern.
 */

/**
 * Extract watermark from the latest item in a timestamped array.
 * Returns null for empty arrays.
 *
 * @param items Array of items with a timestamp field
 * @param toWatermark Function to build the watermark from the latest item
 */
export function extractLatestWatermark<T extends { timestamp: number }, W>(
  items: T[],
  toWatermark: (item: T) => W,
): W | null {
  if (items.length === 0) return null;
  const latest = items.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
  return toWatermark(latest);
}
