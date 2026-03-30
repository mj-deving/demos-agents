/**
 * Fetch with AbortController timeout.
 * Guarantees timer cleanup via finally block.
 */
export async function fetchWithTimeout(
  url: string,
  timeoutMs: number = 8000,
  options?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
