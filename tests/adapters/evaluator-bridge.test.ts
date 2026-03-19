import { describe, it, expect, vi } from "vitest";
import { bridgeEvaluator } from "../../src/adapters/eliza/evaluator-bridge.js";
import type { Evaluator } from "../../src/types.js";
import type { ElizaRuntime, ElizaMessage } from "../../src/adapters/eliza/types.js";

function mockEvaluator(overrides: Partial<Evaluator> = {}): Evaluator {
  return {
    name: "quality-check",
    description: "Checks content quality",
    evaluate: vi.fn().mockResolvedValue({ pass: true, reason: "good", score: 85 }),
    ...overrides,
  };
}

describe("bridgeEvaluator", () => {
  it("maps name and description from demos Evaluator", () => {
    const evaluator = mockEvaluator();
    const bridged = bridgeEvaluator(evaluator);

    expect(bridged.name).toBe("quality-check");
    expect(bridged.description).toBe("Checks content quality");
    expect(bridged.similes).toEqual([]);
    expect(bridged.examples).toEqual([]);
    expect(bridged.alwaysRun).toBe(false);
  });

  it("validate always returns true", async () => {
    const bridged = bridgeEvaluator(mockEvaluator());
    const result = await bridged.validate({} as ElizaRuntime, {} as ElizaMessage);
    expect(result).toBe(true);
  });

  it("delegates handler to demos evaluate with message text", async () => {
    const evaluator = mockEvaluator();
    const runtime: ElizaRuntime = { log: vi.fn() };
    const message: ElizaMessage = { content: { text: "test content" } };
    const bridged = bridgeEvaluator(evaluator);

    await bridged.handler(runtime, message);

    expect(evaluator.evaluate).toHaveBeenCalledWith({
      text: "test content",
      context: { runtime, message },
    });
  });

  it("logs failure when evaluate returns pass: false", async () => {
    const logFn = vi.fn();
    const evaluator = mockEvaluator({
      evaluate: vi.fn().mockResolvedValue({ pass: false, reason: "too short" }),
    });
    const runtime: ElizaRuntime = { log: logFn };
    const message: ElizaMessage = { content: { text: "hi" } };
    const bridged = bridgeEvaluator(evaluator);

    await bridged.handler(runtime, message);

    expect(logFn).toHaveBeenCalledWith("Evaluator quality-check failed: too short");
  });

  it("does not log when evaluate passes", async () => {
    const logFn = vi.fn();
    const evaluator = mockEvaluator();
    const runtime: ElizaRuntime = { log: logFn };
    const message: ElizaMessage = { content: { text: "good content" } };
    const bridged = bridgeEvaluator(evaluator);

    await bridged.handler(runtime, message);

    expect(logFn).not.toHaveBeenCalled();
  });

  it("handles missing message content gracefully", async () => {
    const evaluator = mockEvaluator();
    const bridged = bridgeEvaluator(evaluator);

    await bridged.handler({} as ElizaRuntime, {} as ElizaMessage);

    expect(evaluator.evaluate).toHaveBeenCalledWith({
      text: "",
      context: { runtime: {}, message: {} },
    });
  });
});
