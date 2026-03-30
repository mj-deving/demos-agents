/**
 * EventLoop — poll-diff-filter-dispatch-save orchestrator.
 *
 * Manages multiple EventSources, dispatches events to EventHandlers,
 * persists watermarks, and implements adaptive polling with backoff.
 */

import type {
  AgentEvent,
  EventActionLike,
  EventHandler,
  EventSource,
  OmniwebAction,
  WatermarkStore,
} from "./types.js";

export interface EventLoopConfig {
  /** Agent name (for logging) */
  agent: string;
  /** Graceful shutdown period in ms (default: 5000) */
  shutdownGracePeriodMs?: number;
}

export interface SourceRegistration<T = unknown> {
  source: EventSource<T>;
  /** Base polling interval in ms */
  intervalMs: number;
  /** Minimum interval (floor) in ms */
  minIntervalMs?: number;
  /** Maximum interval (ceiling) in ms */
  maxIntervalMs?: number;
  /** Backoff multiplier when no events detected (default: 1.5) */
  backoffFactor?: number;
}

export interface EventLoopStats {
  /** Total events detected since start */
  totalEvents: number;
  /** Total actions dispatched since start */
  totalActions: number;
  /** Total handler errors since start */
  totalErrors: number;
  /** Events per source */
  eventsBySource: Record<string, number>;
  /** Current adaptive interval per source (ms) */
  currentIntervals: Record<string, number>;
}

export interface AdaptiveInterval {
  current: number;
  base: number;
  min: number;
  max: number;
  backoffFactor: number;
  consecutiveEmpty: number;
}

export interface EventLoop<TAction extends EventActionLike = OmniwebAction> {
  /** Gracefully stop the loop */
  stop(): Promise<void>;
  /** Get current stats */
  stats(): EventLoopStats;
  /** Phantom type anchor for compile-time action typing. */
  readonly __actionType__?: TAction;
}

/** Calculate next interval based on whether events were found. */
export function nextInterval(state: AdaptiveInterval, hadEvents: boolean): AdaptiveInterval {
  if (hadEvents) {
    return { ...state, current: state.base, consecutiveEmpty: 0 };
  }
  const newEmpty = state.consecutiveEmpty + 1;
  const raw = state.base * Math.pow(state.backoffFactor, newEmpty);
  const clamped = Math.min(state.max, Math.max(state.min, raw));
  return { ...state, current: clamped, consecutiveEmpty: newEmpty };
}

/**
 * Create and start an event loop.
 *
 * The loop polls sources at their configured intervals,
 * diffs snapshots against prior state, dispatches events to
 * matching handlers, and persists watermarks.
 */
export function startEventLoop<TAction extends EventActionLike = OmniwebAction>(
  config: EventLoopConfig,
  sources: SourceRegistration[],
  handlers: EventHandler<TAction>[],
  store: WatermarkStore,
  onAction: (event: AgentEvent, action: TAction) => Promise<unknown>,
  onError?: (event: AgentEvent, error: Error) => void,
): EventLoop<TAction> {
  let running = true;
  const activeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  const stats: EventLoopStats = {
    totalEvents: 0,
    totalActions: 0,
    totalErrors: 0,
    eventsBySource: {},
    currentIntervals: {},
  };

  const intervals: Record<string, AdaptiveInterval> = {};
  const snapshots: Record<string, unknown> = {};
  const seeded: Set<string> = new Set();

  for (const reg of sources) {
    const min = reg.minIntervalMs ?? Math.max(10_000, reg.intervalMs * 0.5);
    const max = reg.maxIntervalMs ?? Math.max(reg.intervalMs * 10, 900_000);
    intervals[reg.source.id] = {
      current: reg.intervalMs,
      base: reg.intervalMs,
      min,
      max,
      backoffFactor: reg.backoffFactor ?? 1.5,
      consecutiveEmpty: 0,
    };
    stats.eventsBySource[reg.source.id] = 0;
    stats.currentIntervals[reg.source.id] = reg.intervalMs;
  }

  async function pollSource<T>(reg: SourceRegistration<T>): Promise<void> {
    if (!running) return;

    const src = reg.source;
    try {
      const isWarmup = !seeded.has(src.id);
      if (isWarmup) {
        const savedWatermark = await store.load(src.id);
        seeded.add(src.id);

        if (savedWatermark !== null) {
          const warmupSnapshot = await src.poll();
          snapshots[src.id] = warmupSnapshot;
          const watermark = src.extractWatermark(warmupSnapshot);
          if (watermark !== null) await store.save(src.id, watermark);
          if (running) {
            const timer = setTimeout(() => pollSource(reg), intervals[src.id].current);
            activeTimers.set(src.id, timer);
          }
          return;
        }
      }

      const curr = await src.poll();
      const prev = (snapshots[src.id] as T | undefined) ?? null;
      const events = src.diff(prev, curr);

      snapshots[src.id] = curr;

      for (const event of events) {
        stats.totalEvents++;
        stats.eventsBySource[src.id] = (stats.eventsBySource[src.id] || 0) + 1;

        for (const handler of handlers) {
          if (!handler.eventTypes.includes(event.type)) continue;

          try {
            const action = await handler.handle(event);
            if (action) {
              stats.totalActions++;
              await onAction(event, action);
            }
          } catch (err) {
            stats.totalErrors++;
            onError?.(event, err instanceof Error ? err : new Error(String(err)));
          }
        }
      }

      if (events.length > 0) {
        const watermark = src.extractWatermark(curr);
        await store.save(src.id, watermark);
      }

      const hadEvents = events.length > 0;
      intervals[src.id] = nextInterval(intervals[src.id], hadEvents);
      stats.currentIntervals[src.id] = intervals[src.id].current;
    } catch (err) {
      const dummyEvent: AgentEvent = {
        id: `error:${src.id}:${Date.now()}`,
        sourceId: src.id,
        type: "poll_error",
        detectedAt: Date.now(),
        payload: null,
        watermark: null,
      };
      stats.totalErrors++;
      onError?.(dummyEvent, err instanceof Error ? err : new Error(String(err)));
    }

    if (running) {
      const timer = setTimeout(() => pollSource(reg), intervals[src.id].current);
      activeTimers.set(src.id, timer);
    }
  }

  for (const reg of sources) {
    const jitter = Math.random() * Math.min(reg.intervalMs * 0.5, 2000);
    const timer = setTimeout(() => pollSource(reg), jitter);
    activeTimers.set(reg.source.id, timer);
  }

  return {
    async stop(): Promise<void> {
      running = false;
      for (const timer of activeTimers.values()) clearTimeout(timer);
      activeTimers.clear();
      const grace = config.shutdownGracePeriodMs ?? 5000;
      await new Promise((resolve) => setTimeout(resolve, Math.min(grace, 1000)));
    },
    stats(): EventLoopStats {
      return {
        ...stats,
        eventsBySource: { ...stats.eventsBySource },
        currentIntervals: { ...stats.currentIntervals },
      };
    },
  };
}
