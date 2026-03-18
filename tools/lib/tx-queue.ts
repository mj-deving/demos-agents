/**
 * Transaction queue — serializes concurrent publish calls via async mutex.
 *
 * When multiple agents share a wallet, concurrent transactions can collide
 * on nonce values. This queue ensures only one transaction is in-flight
 * at a time, incrementing nonce after each successful tx.
 *
 * Usage:
 *   const queue = createTxQueue();
 *   const result = await queue.enqueue(async (nonce) => {
 *     return await publishWithNonce(nonce);
 *   });
 */

// ── Types ──────────────────────────────────────────

export interface TxResult {
  success: boolean;
  txHash?: string;
  error?: string;
  nonce: number;
}

export interface TxQueue {
  /** Enqueue a transaction. Resolves when the tx completes (success or failure). */
  enqueue(fn: (nonce: number) => Promise<TxResult>): Promise<TxResult>;
  /** Current nonce value (for diagnostics). */
  currentNonce(): number;
  /** Number of transactions waiting in queue. */
  pending(): number;
  /** Reset nonce to a specific value (e.g., after querying chain state). */
  resetNonce(nonce: number): void;
}

export interface TxQueueOptions {
  /** Initial nonce value (default: 0, should be fetched from chain). */
  initialNonce?: number;
  /** Timeout in ms for each transaction (default: 30000). */
  timeoutMs?: number;
}

// ── Mutex Implementation ───────────────────────────

/**
 * Simple async mutex — guarantees one-at-a-time execution.
 * Uses a promise chain pattern (no external deps).
 */
function createMutex() {
  let chain: Promise<void> = Promise.resolve();

  return {
    acquire<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        chain = chain
          .then(() => fn())
          .then(resolve, reject);
      });
    },
  };
}

// ── Queue Factory ──────────────────────────────────

/**
 * Create a transaction queue with mutex-based serialization.
 *
 * Each enqueued transaction receives the current nonce.
 * On success, nonce is incremented. On failure, nonce stays.
 */
export function createTxQueue(options: TxQueueOptions = {}): TxQueue {
  const { initialNonce = 0, timeoutMs = 30_000 } = options;
  let nonce = initialNonce;
  let pendingCount = 0;
  const mutex = createMutex();

  return {
    enqueue(fn: (nonce: number) => Promise<TxResult>): Promise<TxResult> {
      pendingCount++;

      return mutex.acquire(async () => {
        const currentNonce = nonce;

        let timer: ReturnType<typeof setTimeout>;
        try {
          const result = await Promise.race([
            fn(currentNonce),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`Transaction timed out after ${timeoutMs}ms`)), timeoutMs);
            }),
          ]);
          clearTimeout(timer!);

          if (result.success) {
            nonce++;
          }

          return { ...result, nonce: currentNonce };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { success: false, error: message, nonce: currentNonce };
        } finally {
          pendingCount--;
        }
      });
    },

    currentNonce(): number {
      return nonce;
    },

    pending(): number {
      return pendingCount;
    },

    resetNonce(newNonce: number): void {
      nonce = newNonce;
    },
  };
}
