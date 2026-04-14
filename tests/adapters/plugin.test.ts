import { describe, it, expect, vi } from "vitest";
import { createElizaPlugin } from "../../src/adapters/eliza/plugin.js";
import { EventSourceService } from "../../src/adapters/eliza/event-service.js";
import type { FrameworkPlugin, EventPlugin, Action, DataProvider, Evaluator, EventSource, EventHandler } from "../../src/types.js";

function mockAction(name: string): Action {
  return {
    name,
    description: `Action ${name}`,
    validate: vi.fn().mockResolvedValue(true),
    execute: vi.fn().mockResolvedValue({ success: true }),
  };
}

function mockProvider(name: string): DataProvider {
  return {
    name,
    description: `Provider ${name}`,
    fetch: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function mockEvaluator(name: string): Evaluator {
  return {
    name,
    description: `Evaluator ${name}`,
    evaluate: vi.fn().mockResolvedValue({ pass: true, reason: "ok" }),
  };
}

function mockFrameworkPlugin(name: string, opts: { actions?: Action[]; providers?: DataProvider[]; evaluators?: Evaluator[] } = {}): FrameworkPlugin {
  return {
    name,
    version: "1.0.0",
    actions: opts.actions,
    providers: opts.providers,
    evaluators: opts.evaluators,
  };
}

describe("createElizaPlugin", () => {
  it("returns plugin with correct name and description", () => {
    const plugin = createElizaPlugin([]);
    expect(plugin.name).toBe("omniweb-agents");
    expect(plugin.description).toBe("Demos agents framework bridge for ElizaOS");
  });

  it("bridges actions from framework plugins", () => {
    const p1 = mockFrameworkPlugin("p1", { actions: [mockAction("a1"), mockAction("a2")] });
    const p2 = mockFrameworkPlugin("p2", { actions: [mockAction("a3")] });

    const plugin = createElizaPlugin([p1, p2]);

    expect(plugin.actions).toHaveLength(3);
    expect(plugin.actions!.map((a) => a.name)).toEqual(["a1", "a2", "a3"]);
  });

  it("bridges providers from framework plugins", () => {
    const p1 = mockFrameworkPlugin("p1", { providers: [mockProvider("dp1")] });

    const plugin = createElizaPlugin([p1]);

    expect(plugin.providers).toHaveLength(1);
  });

  it("bridges evaluators from framework plugins", () => {
    const p1 = mockFrameworkPlugin("p1", { evaluators: [mockEvaluator("e1")] });

    const plugin = createElizaPlugin([p1]);

    expect(plugin.evaluators).toHaveLength(1);
    expect(plugin.evaluators![0].name).toBe("e1");
  });

  it("creates EventSourceService when event plugins have sources", () => {
    const source: EventSource = {
      id: "feed",
      description: "Feed source",
      eventTypes: ["reply"],
      poll: vi.fn(),
      diff: vi.fn().mockReturnValue([]),
      extractWatermark: vi.fn(),
    };
    const handler: EventHandler = {
      name: "reply-handler",
      eventTypes: ["reply"],
      handle: vi.fn(),
    };
    const eventPlugin: EventPlugin = {
      name: "ep1",
      version: "1.0.0",
      sources: [source],
      handlers: [handler],
    };

    const plugin = createElizaPlugin([], [eventPlugin]);

    expect(plugin.services).toHaveLength(1);
    expect(plugin.services![0]).toBeInstanceOf(EventSourceService);
    expect(plugin.services![0].serviceType).toBe("demos-event-source");
  });

  it("does not create service when no event sources exist", () => {
    const eventPlugin: EventPlugin = {
      name: "ep1",
      version: "1.0.0",
      sources: [],
      handlers: [],
    };

    const plugin = createElizaPlugin([], [eventPlugin]);

    expect(plugin.services).toHaveLength(0);
  });

  it("handles plugins with no actions/providers/evaluators", () => {
    const plugin = createElizaPlugin([mockFrameworkPlugin("empty")]);

    expect(plugin.actions).toEqual([]);
    expect(plugin.providers).toEqual([]);
    expect(plugin.evaluators).toEqual([]);
    expect(plugin.services).toEqual([]);
  });
});
