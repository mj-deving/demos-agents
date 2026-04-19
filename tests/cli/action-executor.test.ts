import { describe, expect, it, vi } from "vitest";

import {
  executeStrategyActions,
  type ActionExecutorDeps,
} from "../../cli/action-executor.js";
import type { StrategyAction } from "../../src/toolkit/strategy/types.js";

function makeAction(overrides: Partial<StrategyAction> = {}): StrategyAction {
  return {
    type: "ENGAGE",
    priority: 100,
    reason: "test action",
    ...overrides,
  };
}

function createDeps(overrides: Partial<ActionExecutorDeps> = {}): ActionExecutorDeps {
  return {
    bridge: {
      apiCall: vi.fn().mockResolvedValue({ ok: true, status: 200, data: { success: true } }),
      publishHivePost: vi.fn().mockResolvedValue({ txHash: "0xpost" }),
      transferDem: vi.fn().mockResolvedValue({ txHash: "0xtip" }),
    },
    attestAndPublish: vi.fn().mockResolvedValue({ txHash: "0xattested-post" }),
    generateText: vi.fn().mockResolvedValue("generated text"),
    dryRun: false,
    observe: vi.fn(),
    ...overrides,
  };
}

describe("executeStrategyActions", () => {
  it("routes ENGAGE actions to API react endpoint", async () => {
    const deps = createDeps();
    const action = makeAction({ type: "ENGAGE", target: "0xabc" });

    const result = await executeStrategyActions([action], deps);

    expect(deps.bridge.apiCall).toHaveBeenCalledWith(
      "/api/feed/0xabc/react",
      { method: "POST", body: JSON.stringify({ type: "agree" }) },
    );
    expect(result.executed).toEqual([
      { action, success: true },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("routes REPLY actions through generateText and attestAndPublish when attestUrl is present", async () => {
    const deps = createDeps();
    const action = makeAction({
      type: "REPLY",
      target: "0xparent",
      metadata: { attestUrl: "https://example.test/reply.json" },
    });

    const result = await executeStrategyActions([action], deps);

    expect(deps.generateText).toHaveBeenCalledWith(action);
    expect(deps.attestAndPublish).toHaveBeenCalledWith({
      text: "generated text",
      category: "discussion",
      tags: [],
      confidence: 70,
      replyTo: "0xparent",
    }, "https://example.test/reply.json");
    expect(deps.bridge.publishHivePost).not.toHaveBeenCalled();
    expect(result.executed).toEqual([
      { action, success: true, txHash: "0xattested-post" },
    ]);
  });

  it("routes PUBLISH actions through generateText and attestAndPublish when attestUrl is present", async () => {
    const deps = createDeps();
    const action = makeAction({
      type: "PUBLISH",
      metadata: { attestUrl: "https://example.test/publish.json" },
    });

    const result = await executeStrategyActions([action], deps);

    expect(deps.generateText).toHaveBeenCalledWith(action);
    expect(deps.attestAndPublish).toHaveBeenCalledWith({
      text: "generated text",
      category: "analysis",
      tags: [],
      confidence: 70,
    }, "https://example.test/publish.json");
    expect(deps.bridge.publishHivePost).not.toHaveBeenCalled();
    expect(result.executed).toEqual([
      { action, success: true, txHash: "0xattested-post" },
    ]);
  });

  it("routes TIP actions to transferDem", async () => {
    const deps = createDeps();
    const action = makeAction({
      type: "TIP",
      target: "demos1tippee",
      metadata: { amount: 4 },
    });

    const result = await executeStrategyActions([action], deps);

    expect(deps.bridge.transferDem).toHaveBeenCalledWith("demos1tippee", 4);
    expect(result.executed).toEqual([
      { action, success: true, txHash: "0xtip" },
    ]);
  });

  it("TIP aborts when API returns non-ok status (4xx/5xx hard denial)", async () => {
    const deps = createDeps({
      bridge: {
        apiCall: vi.fn().mockResolvedValue({ ok: false, status: 429, data: "rate limited" }),
        publishHivePost: vi.fn().mockResolvedValue({ txHash: "0xpost" }),
        transferDem: vi.fn().mockResolvedValue({ txHash: "0xtip" }),
      },
    });
    const action = makeAction({
      type: "TIP",
      target: "demos1tippee",
      metadata: { amount: 3 },
    });

    const result = await executeStrategyActions([action], deps);

    // Must NOT call transferDem when API explicitly denies
    expect(deps.bridge.transferDem).not.toHaveBeenCalled();
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toMatch(/429/);
  });

  it("TIP falls back to direct transfer on network error (catch path)", async () => {
    const deps = createDeps({
      bridge: {
        apiCall: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
        publishHivePost: vi.fn().mockResolvedValue({ txHash: "0xpost" }),
        transferDem: vi.fn().mockResolvedValue({ txHash: "0xtip" }),
      },
    });
    const action = makeAction({
      type: "TIP",
      target: "demos1tippee",
      metadata: { amount: 5 },
    });

    const result = await executeStrategyActions([action], deps);

    // Network failure = transport error, falls back to direct transfer
    expect(deps.bridge.transferDem).toHaveBeenCalledWith("demos1tippee", 5);
    expect(result.executed).toHaveLength(1);
    expect(result.executed[0].success).toBe(true);
  });

  it("TIP uses recipient from API validation response", async () => {
    const deps = createDeps({
      bridge: {
        apiCall: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          data: { ok: true, recipient: "demos1validated_recipient" },
        }),
        publishHivePost: vi.fn().mockResolvedValue({ txHash: "0xpost" }),
        transferDem: vi.fn().mockResolvedValue({ txHash: "0xtip" }),
      },
    });
    const action = makeAction({
      type: "TIP",
      target: "demos1original_target",
      metadata: { amount: 2 },
    });

    const result = await executeStrategyActions([action], deps);

    // Should use the validated recipient, not the original target
    expect(deps.bridge.transferDem).toHaveBeenCalledWith("demos1validated_recipient", 2);
    expect(result.executed[0].success).toBe(true);
  });

  it("does not call bridge methods in dryRun mode", async () => {
    const deps = createDeps({ dryRun: true });
    const actions = [
      makeAction({ type: "ENGAGE", target: "0xengage" }),
      makeAction({ type: "REPLY", target: "0xreply" }),
      makeAction({ type: "PUBLISH" }),
      makeAction({ type: "TIP", target: "demos1tippee", metadata: { amount: 7 } }),
    ];

    const result = await executeStrategyActions(actions, deps);

    expect(deps.generateText).not.toHaveBeenCalled();
    expect(deps.bridge.apiCall).not.toHaveBeenCalled();
    expect(deps.bridge.publishHivePost).not.toHaveBeenCalled();
    expect(deps.bridge.transferDem).not.toHaveBeenCalled();
    expect(result.executed).toEqual([
      { action: actions[0], success: true },
      { action: actions[1], success: true },
      { action: actions[2], success: true },
      { action: actions[3], success: true },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("clamps TIP amounts to the 1-10 DEM range", async () => {
    const deps = createDeps();
    const actions = [
      makeAction({ type: "TIP", target: "demos1low", metadata: { amount: 0 } }),
      makeAction({ type: "TIP", target: "demos1high", metadata: { amount: 42 } }),
      makeAction({ type: "TIP", target: "demos1bad", metadata: { amount: Number.NaN } }),
    ];

    await executeStrategyActions(actions, deps);

    expect(deps.bridge.transferDem).toHaveBeenNthCalledWith(1, "demos1low", 1);
    expect(deps.bridge.transferDem).toHaveBeenNthCalledWith(2, "demos1high", 10);
    expect(deps.bridge.transferDem).toHaveBeenNthCalledWith(3, "demos1bad", 1);
  });

  it("skips REPLY actions when no text generator is available", async () => {
    const deps = createDeps({ generateText: undefined });
    const action = makeAction({ type: "REPLY", target: "0xparent" });

    const result = await executeStrategyActions([action], deps);

    expect(deps.bridge.publishHivePost).not.toHaveBeenCalled();
    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([
      { action, reason: "no text generator" },
    ]);
  });

  it("skips PUBLISH actions when no text generator is available", async () => {
    const deps = createDeps({ generateText: undefined });
    const action = makeAction({ type: "PUBLISH" });

    const result = await executeStrategyActions([action], deps);

    expect(deps.bridge.publishHivePost).not.toHaveBeenCalled();
    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([
      { action, reason: "no text generator" },
    ]);
  });

  it("fails closed on REPLY when no attested publish path is wired", async () => {
    const deps = createDeps({ attestAndPublish: undefined });
    const action = makeAction({
      type: "REPLY",
      target: "0xparent",
      metadata: { attestUrl: "https://example.test/reply.json" },
    });

    const result = await executeStrategyActions([action], deps);

    expect(deps.generateText).not.toHaveBeenCalled();
    expect(deps.bridge.publishHivePost).not.toHaveBeenCalled();
    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([
      { action, reason: "attested publish path required for REPLY" },
    ]);
  });

  it("fails closed on PUBLISH when no attested publish path is wired", async () => {
    const deps = createDeps({ attestAndPublish: undefined });
    const action = makeAction({
      type: "PUBLISH",
      metadata: { attestUrl: "https://example.test/publish.json" },
    });

    const result = await executeStrategyActions([action], deps);

    expect(deps.generateText).not.toHaveBeenCalled();
    expect(deps.bridge.publishHivePost).not.toHaveBeenCalled();
    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([
      { action, reason: "attested publish path required for PUBLISH" },
    ]);
  });

  it("fails closed on PUBLISH when attestUrl is missing", async () => {
    const deps = createDeps();
    const action = makeAction({ type: "PUBLISH" });

    const result = await executeStrategyActions([action], deps);

    expect(deps.generateText).not.toHaveBeenCalled();
    expect(deps.attestAndPublish).not.toHaveBeenCalled();
    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([
      { action, reason: "missing attestUrl for PUBLISH" },
    ]);
  });

  it("fails closed on REPLY when attestUrl is missing", async () => {
    const deps = createDeps();
    const action = makeAction({
      type: "REPLY",
      target: "0xparent",
    });

    const result = await executeStrategyActions([action], deps);

    expect(deps.generateText).not.toHaveBeenCalled();
    expect(deps.attestAndPublish).not.toHaveBeenCalled();
    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([
      { action, reason: "missing attestUrl for REPLY" },
    ]);
  });

  it("continues after a failed action and executes subsequent actions", async () => {
    const deps = createDeps({
      bridge: {
        apiCall: vi.fn().mockResolvedValue({ ok: false, status: 500, data: "error" }),
        publishHivePost: vi.fn().mockResolvedValue({ txHash: "0xpost" }),
        transferDem: vi.fn().mockResolvedValue({ txHash: "0xtip" }),
      },
    });
    const actions = [
      makeAction({ type: "ENGAGE", target: "0xfail" }),
      makeAction({
        type: "PUBLISH",
        reason: "second action",
        metadata: { attestUrl: "https://example.test/publish.json" },
      }),
      makeAction({ type: "TIP", target: "demos1tippee", metadata: { amount: 2 } }),
    ];

    const result = await executeStrategyActions(actions, deps);

    // ENGAGE fails (reaction API error), PUBLISH succeeds, TIP skipped (API returns 500 = hard denial)
    expect(result.executed).toEqual([
      { action: actions[0], success: false, error: "Reaction API returned 500" },
      { action: actions[1], success: true, txHash: "0xattested-post" },
    ]);
    expect(result.skipped).toEqual([
      { action: actions[2], reason: "Tip API rejected: status 500" },
    ]);
    expect(deps.attestAndPublish).toHaveBeenCalledTimes(1);
    expect(deps.bridge.publishHivePost).not.toHaveBeenCalled();
    expect(deps.bridge.transferDem).not.toHaveBeenCalled();
  });

  it("returns empty results for an empty action list", async () => {
    const deps = createDeps();

    const result = await executeStrategyActions([], deps);

    expect(result).toEqual({ executed: [], skipped: [] });
  });

  it("skips unknown action types", async () => {
    const deps = createDeps();
    const action = {
      ...makeAction(),
      type: "UNKNOWN",
    } as StrategyAction;

    const result = await executeStrategyActions([action], deps);

    expect(deps.bridge.apiCall).not.toHaveBeenCalled();
    expect(deps.bridge.publishHivePost).not.toHaveBeenCalled();
    expect(deps.bridge.transferDem).not.toHaveBeenCalled();
    expect(result.executed).toEqual([]);
    expect(result.skipped).toEqual([
      { action, reason: "unknown action type" },
    ]);
  });
});
