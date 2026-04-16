export const DEMOS_NETWORK_TIMEOUT_MS = {
  connect: 15_000,
  store: 10_000,
  confirm: 30_000,
  broadcast: 15_000,
  createDahr: 10_000,
  startProxy: 30_000,
  http: 10_000,
} as const;

export async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  work: Promise<T>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}
