/**
 * Event service — wraps demos EventSource/EventHandler into an ElizaOS Service.
 *
 * Polls sources on a 30s interval, diffs snapshots, and dispatches matching
 * events to handlers. Emits 'demos:action' on the runtime when a handler
 * produces an action.
 */

import type { EventSource, EventHandler } from "../../types.js";
import type { ElizaService, ElizaRuntime } from "./types.js";
import { toErrorMessage } from "../../toolkit/util/errors.js";

export class EventSourceService implements ElizaService {
  readonly serviceType = "demos-event-source";
  readonly capabilityDescription = "Demos event source polling";
  private running = false;
  private timers: ReturnType<typeof setInterval>[] = [];
  private runtime?: ElizaRuntime;

  constructor(
    private sources: EventSource[],
    private handlers: EventHandler[],
    runtime?: ElizaRuntime,
  ) {
    this.runtime = runtime;
  }

  /** Set the runtime after construction (e.g., when ElizaOS provides it at plugin init). */
  setRuntime(runtime: ElizaRuntime): void {
    this.runtime = runtime;
  }

  async start(): Promise<void> {
    this.running = true;
    for (const source of this.sources) {
      let prev: unknown = null;
      let polling = false;  // in-flight guard
      const timer = setInterval(async () => {
        if (!this.running || polling) return;
        polling = true;
        try {
          const curr = await source.poll();
          const events = source.diff(prev, curr);
          prev = curr;
          for (const event of events) {
            for (const handler of this.handlers) {
              if (handler.eventTypes.includes(event.type)) {
                const action = await handler.handle(event);
                if (action) {
                  this.runtime?.emit?.("demos:action", { event, action });
                }
              }
            }
          }
        } catch (err) {
          this.runtime?.log?.(`EventSourceService poll error: ${toErrorMessage(err)}`);
        } finally {
          polling = false;
        }
      }, 30_000);
      this.timers.push(timer);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }
}
