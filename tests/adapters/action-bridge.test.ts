import { describe, it, expect, vi } from "vitest";
import { bridgeAction } from "../../src/adapters/eliza/action-bridge.js";
import type { Action } from "../../src/types.js";
import type { ElizaRuntime, ElizaMessage } from "../../src/adapters/eliza/types.js";

function mockAction(overrides: Partial<Action> = {}): Action {
  return {
    name: "test-action",
    description: "A test action",
    aliases: ["test", "tst"],
    validate: vi.fn().mockResolvedValue(true),
    execute: vi.fn().mockResolvedValue({ success: true, text: "done", data: { id: 1 } }),
    ...overrides,
  };
}

const runtime: ElizaRuntime = { log: vi.fn() };
const message: ElizaMessage = { content: { text: "hello" } };

describe("bridgeAction", () => {
  it("maps name, similes, and description from demos Action", () => {
    const action = mockAction();
    const bridged = bridgeAction(action);

    expect(bridged.name).toBe("test-action");
    expect(bridged.similes).toEqual(["test", "tst"]);
    expect(bridged.description).toBe("A test action");
    expect(bridged.examples).toEqual([]);
  });

  it("defaults similes to empty array when aliases is undefined", () => {
    const action = mockAction({ aliases: undefined });
    const bridged = bridgeAction(action);
    expect(bridged.similes).toEqual([]);
  });

  it("delegates validate to demos Action.validate with correct input shape", async () => {
    const action = mockAction();
    const bridged = bridgeAction(action);
    const state = { topic: "crypto" };

    const result = await bridged.validate(runtime, message, state);

    expect(result).toBe(true);
    expect(action.validate).toHaveBeenCalledWith({
      context: { runtime, message, topic: "crypto" },
      metadata: {},
    });
  });

  it("delegates handler to demos Action.execute and normalizes result", async () => {
    const action = mockAction();
    const bridged = bridgeAction(action);

    const result = await bridged.handler(runtime, message);

    expect(result).toEqual({
      success: true,
      text: "done",
      values: { data: { id: 1 } },
      data: { id: 1 },
    });
    expect(action.execute).toHaveBeenCalledWith({
      context: { runtime, message },
      metadata: {},
    });
  });

  it("returns undefined values when execute result has no data", async () => {
    const action = mockAction({
      execute: vi.fn().mockResolvedValue({ success: true, text: "ok" }),
    });
    const bridged = bridgeAction(action);

    const result = await bridged.handler(runtime, message);

    expect(result.values).toBeUndefined();
    expect(result.data).toBeUndefined();
  });

  it("propagates validate returning false", async () => {
    const action = mockAction({
      validate: vi.fn().mockResolvedValue(false),
    });
    const bridged = bridgeAction(action);

    const result = await bridged.validate(runtime, message);
    expect(result).toBe(false);
  });

  it("propagates execute failure", async () => {
    const action = mockAction({
      execute: vi.fn().mockResolvedValue({ success: false, error: "boom" }),
    });
    const bridged = bridgeAction(action);

    const result = await bridged.handler(runtime, message);
    expect(result.success).toBe(false);
  });
});
