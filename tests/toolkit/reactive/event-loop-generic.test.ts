import { describe, expect, expectTypeOf, it, vi, afterEach } from "vitest";

import {
  nextInterval,
  startEventLoop,
  type AdaptiveInterval,
  type EventLoop,
} from "../../../src/toolkit/reactive/event-loop.js";
import { createMemoryWatermarkStore } from "../../../src/toolkit/reactive/watermark-store.js";
import type { AgentEvent, EventHandler, EventSource } from "../../../src/types.js";

type CustomAction =
  | { type: "email"; params: { to: string; subject: string } }
  | { type: "webhook"; params: { url: string; body: string } };

function makeEvent(id: string, payload: number): AgentEvent<number> {
  return {
    id,
    sourceId: "custom-source",
    type: "custom-event",
    detectedAt: Date.now(),
    payload,
    watermark: payload,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toolkit reactive EventLoop generics", () => {
  it("accepts a custom action union unrelated to OmniwebActionType", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const source: EventSource<number> = {
      id: "custom-source",
      description: "custom source",
      eventTypes: ["custom-event"],
      poll: vi.fn(async () => 7),
      diff: vi.fn((prev, curr) => prev === null ? [makeEvent("evt-1", curr)] : []),
      extractWatermark: (snapshot) => snapshot,
    };

    const handler: EventHandler<CustomAction> = {
      name: "custom-handler",
      eventTypes: ["custom-event"],
      handle: vi.fn(async (event) => ({
        type: "email",
        params: {
          to: "ops@example.com",
          subject: `event:${event.payload}`,
        },
      })),
    };

    const onAction = vi.fn(async (_event: AgentEvent, action: CustomAction) => action.type);

    expectTypeOf(handler.handle).returns.toEqualTypeOf<Promise<CustomAction | null>>();

    const loop = startEventLoop<CustomAction>(
      { agent: "toolkit-test", shutdownGracePeriodMs: 0 },
      [{ source, intervalMs: 20, minIntervalMs: 20, maxIntervalMs: 50 }],
      [handler],
      createMemoryWatermarkStore(),
      onAction,
    );

    expectTypeOf(loop).toEqualTypeOf<EventLoop<CustomAction>>();

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt-1" }),
      {
        type: "email",
        params: {
          to: "ops@example.com",
          subject: "event:7",
        },
      },
    );

    await loop.stop();
  });

  it("preserves basic poll-diff-dispatch behavior", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    let pollCount = 0;
    const source: EventSource<number> = {
      id: "counter",
      description: "counter source",
      eventTypes: ["tick"],
      poll: async () => ++pollCount,
      diff: (prev, curr) => prev === null || prev !== curr
        ? [{
            id: `tick-${curr}`,
            sourceId: "counter",
            type: "tick",
            detectedAt: Date.now(),
            payload: curr,
            watermark: curr,
          }]
        : [],
      extractWatermark: (snapshot) => snapshot,
    };

    const handled: string[] = [];
    const handler: EventHandler<CustomAction> = {
      name: "counter-handler",
      eventTypes: ["tick"],
      handle: async (event) => {
        handled.push(event.id);
        return {
          type: "webhook",
          params: {
            url: "https://example.com/hook",
            body: String(event.payload),
          },
        };
      },
    };

    const store = createMemoryWatermarkStore();
    const onAction = vi.fn(async () => undefined);

    const loop = startEventLoop<CustomAction>(
      { agent: "toolkit-test", shutdownGracePeriodMs: 0 },
      [{ source, intervalMs: 25, minIntervalMs: 25, maxIntervalMs: 60 }],
      [handler],
      store,
      onAction,
    );

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(handled.length).toBeGreaterThan(0);
    expect(onAction).toHaveBeenCalled();
    expect(loop.stats().totalEvents).toBeGreaterThan(0);
    expect(loop.stats().totalActions).toBeGreaterThan(0);
    expect(await store.load("counter")).not.toBeNull();

    await loop.stop();
  });

  it("adapts polling intervals based on empty vs active polls", () => {
    const state: AdaptiveInterval = {
      current: 1000,
      base: 1000,
      min: 500,
      max: 5000,
      backoffFactor: 2,
      consecutiveEmpty: 0,
    };

    const firstEmpty = nextInterval(state, false);
    const secondEmpty = nextInterval(firstEmpty, false);
    const afterEvent = nextInterval(secondEmpty, true);

    expect(firstEmpty.current).toBe(2000);
    expect(secondEmpty.current).toBe(4000);
    expect(secondEmpty.consecutiveEmpty).toBe(2);
    expect(afterEvent.current).toBe(1000);
    expect(afterEvent.consecutiveEmpty).toBe(0);
  });
});
