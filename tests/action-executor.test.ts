/**
 * Tests for action-executor — extracted from event-runner.ts.
 *
 * Tests the createActionExecutor factory and all 5 action types
 * with fully mocked context (no SDK, no API, no file I/O).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createActionExecutor,
  type ActionExecutorContext,
} from "../src/actions/action-executor.js";
import type { AgentEvent, EventAction } from "../src/types.js";

// ── Fixtures ────────────────────────────────────────

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: "test:reply:1000:evt-1",
    sourceId: "test-source",
    type: "reply",
    timestamp: 1000,
    data: {},
    ...overrides,
  };
}

function makeAction(type: EventAction["type"], params: Record<string, unknown> = {}): EventAction {
  return { type, params };
}

function createMockContext(overrides: Partial<ActionExecutorContext> = {}): ActionExecutorContext {
  return {
    agentName: "test-agent",
    address: "0xTestAddress",
    dryRun: false,
    getToken: vi.fn().mockResolvedValue("mock-token"),
    dailyReactive: 4,
    hourlyReactive: 2,
    calibrationOffset: 0,
    personaMdPath: "/tmp/persona.md",
    strategyYamlPath: "/tmp/strategy.yaml",
    llm: { name: "mock", complete: vi.fn().mockResolvedValue("response") } as any,
    ownTxHashes: new Set<string>(),
    apiCall: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    generatePost: vi.fn().mockResolvedValue({
      text: "Generated reply text over 200 chars for testing purposes",
      category: "ANALYSIS",
      tags: ["test"],
      confidence: 75,
      hypothesis: "test hypothesis",
      predicted_reactions: 5,
    }),
    attestAndPublish: vi.fn().mockResolvedValue({
      txHash: "tx-new-123",
      category: "ANALYSIS",
      textLength: 55,
    }),
    transfer: vi.fn().mockResolvedValue({ hash: "tx-transfer" }),
    stateStore: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      lock: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined)),
    } as any,
    checkWriteRate: vi.fn().mockResolvedValue({ allowed: true, reason: "ok" }),
    recordWrite: vi.fn().mockResolvedValue(undefined),
    observe: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    ...overrides,
  };
}

// ════════════════════════════════════════════════════
// 1. log_only
// ════════════════════════════════════════════════════

describe("log_only action", () => {
  it("calls info and observe, no API calls", async () => {
    const ctx = createMockContext();
    const exec = createActionExecutor(ctx);
    const event = makeEvent();
    const action = makeAction("log_only", { reason: "test reason" });

    await exec(event, action);

    expect(ctx.info).toHaveBeenCalledWith(expect.stringContaining("test reason"));
    expect(ctx.observe).toHaveBeenCalled();
    expect(ctx.apiCall).not.toHaveBeenCalled();
    expect(ctx.getToken).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════
// 2. dry-run mode
// ════════════════════════════════════════════════════

describe("dry-run mode", () => {
  const dryRunTypes: EventAction["type"][] = ["react", "reply", "publish", "tip"];

  it.each(dryRunTypes)("skips execution for %s action", async (type) => {
    const ctx = createMockContext({ dryRun: true });
    const exec = createActionExecutor(ctx);
    const event = makeEvent();
    const action = makeAction(type, { txHash: "tx-1", reaction: "agree", text: "test" });

    await exec(event, action);

    expect(ctx.info).toHaveBeenCalledWith(expect.stringContaining("[dry-run]"));
    expect(ctx.apiCall).not.toHaveBeenCalled();
    expect(ctx.attestAndPublish).not.toHaveBeenCalled();
    expect(ctx.transfer).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════
// 3. react
// ════════════════════════════════════════════════════

describe("react action", () => {
  it("calls apiCall with correct endpoint and body", async () => {
    const ctx = createMockContext();
    const exec = createActionExecutor(ctx);
    const event = makeEvent();
    const action = makeAction("react", { txHash: "tx-post-1", reaction: "agree" });

    await exec(event, action);

    expect(ctx.apiCall).toHaveBeenCalledWith(
      "/api/feed/tx-post-1/react",
      "mock-token",
      { method: "POST", body: JSON.stringify({ type: "agree" }) },
    );
  });

  it("observes success on ok response", async () => {
    const ctx = createMockContext();
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("react", { txHash: "tx-1", reaction: "disagree" }));

    expect(ctx.observe).toHaveBeenCalledWith(
      "insight",
      expect.stringContaining("Reacted disagree"),
      expect.any(Object),
    );
  });

  it("warns on API failure", async () => {
    const ctx = createMockContext({
      apiCall: vi.fn().mockResolvedValue({ ok: false, status: 400, data: { error: "bad" } }),
    });
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("react", { txHash: "tx-1", reaction: "agree" }));

    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining("React failed"));
    expect(ctx.observe).toHaveBeenCalledWith("failure", expect.any(String), expect.any(Object));
  });
});

// ════════════════════════════════════════════════════
// 4. reply
// ════════════════════════════════════════════════════

describe("reply action", () => {
  it("generates post, publishes, updates ownTxHashes and ledger", async () => {
    const ctx = createMockContext();
    const exec = createActionExecutor(ctx);
    const action = makeAction("reply", {
      parentTx: "tx-parent-1",
      question: "What about staking?",
      author: "0xAsker",
    });

    await exec(makeEvent(), action);

    // generatePost called with reply input
    expect(ctx.generatePost).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "What about staking?",
        category: "ANALYSIS",
        replyTo: expect.objectContaining({ txHash: "tx-parent-1" }),
      }),
      ctx.llm,
      expect.objectContaining({ agentName: "test-agent" }),
    );

    // attestAndPublish called with draft
    expect(ctx.attestAndPublish).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "tx-parent-1" }),
      undefined,
      { feedToken: "mock-token" },
    );

    // ownTxHashes updated
    expect(ctx.ownTxHashes.has("tx-new-123")).toBe(true);

    // write rate recorded after publish
    expect(ctx.recordWrite).toHaveBeenCalledWith(ctx.stateStore, "0xTestAddress");
  });
});

// ════════════════════════════════════════════════════
// 5. reply without LLM
// ════════════════════════════════════════════════════

describe("reply without LLM", () => {
  it("warns and does not publish", async () => {
    const ctx = createMockContext({ llm: null });
    const exec = createActionExecutor(ctx);
    const action = makeAction("reply", { parentTx: "tx-1", question: "test" });

    await exec(makeEvent(), action);

    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining("No LLM"));
    expect(ctx.attestAndPublish).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════
// 6. publish
// ════════════════════════════════════════════════════

describe("publish action", () => {
  it("calls attestAndPublish and updates ledger", async () => {
    const ctx = createMockContext();
    const exec = createActionExecutor(ctx);
    const action = makeAction("publish", {
      text: "Protocol analysis post",
      category: "ANALYSIS",
      tags: ["tvl"],
      confidence: 80,
    });

    await exec(makeEvent(), action);

    expect(ctx.attestAndPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Protocol analysis post",
        category: "ANALYSIS",
        tags: ["tvl"],
        confidence: 80,
      }),
      undefined,
      { feedToken: "mock-token" },
    );
    expect(ctx.ownTxHashes.has("tx-new-123")).toBe(true);
    expect(ctx.recordWrite).toHaveBeenCalledWith(ctx.stateStore, "0xTestAddress");
  });
});

// ════════════════════════════════════════════════════
// 7. tip
// ════════════════════════════════════════════════════

describe("tip action", () => {
  it("validates via API then transfers", async () => {
    const ctx = createMockContext({
      apiCall: vi.fn().mockResolvedValue({ ok: true, data: { recipient: "0xRecipient" } }),
    });
    const exec = createActionExecutor(ctx);
    const action = makeAction("tip", { txHash: "tx-post-tipped", amount: 5 });

    await exec(makeEvent(), action);

    // API validation call
    expect(ctx.apiCall).toHaveBeenCalledWith(
      "/api/tip",
      "mock-token",
      { method: "POST", body: JSON.stringify({ postTxHash: "tx-post-tipped", amount: 5 }) },
    );

    // SDK transfer
    expect(ctx.transfer).toHaveBeenCalledWith(
      "0xrecipient", // lowercased
      5,
      "",
    );
  });
});

// ════════════════════════════════════════════════════
// 8. tip validation failure
// ════════════════════════════════════════════════════

describe("tip validation failure", () => {
  it("does not transfer when API returns not ok", async () => {
    const ctx = createMockContext({
      apiCall: vi.fn().mockResolvedValue({ ok: false, status: 400, data: { error: "invalid" } }),
    });
    const exec = createActionExecutor(ctx);
    const action = makeAction("tip", { txHash: "tx-bad", amount: 1 });

    await exec(makeEvent(), action);

    expect(ctx.transfer).not.toHaveBeenCalled();
    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining("Tip validation failed"));
  });
});

// ════════════════════════════════════════════════════
// 9. budget exhaustion
// ════════════════════════════════════════════════════

describe("budget exhaustion", () => {
  it("blocks publish when budget exhausted", async () => {
    const ctx = createMockContext({
      checkWriteRate: vi.fn().mockResolvedValue({ allowed: false, reason: "daily limit" }),
    });
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("publish", { text: "test" }));

    expect(ctx.attestAndPublish).not.toHaveBeenCalled();
    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining("budget exhausted"));
  });

  it("blocks reply when budget exhausted", async () => {
    const ctx = createMockContext({
      checkWriteRate: vi.fn().mockResolvedValue({ allowed: false, reason: "hourly limit" }),
    });
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("reply", { parentTx: "tx-1", question: "test" }));

    expect(ctx.generatePost).not.toHaveBeenCalled();
    expect(ctx.attestAndPublish).not.toHaveBeenCalled();
  });

  it("does NOT block react (no budget check)", async () => {
    const ctx = createMockContext({
      checkWriteRate: vi.fn().mockResolvedValue({ allowed: false, reason: "limit" }),
    });
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("react", { txHash: "tx-1", reaction: "agree" }));

    expect(ctx.apiCall).toHaveBeenCalled();
  });

  it("does NOT block tip (no budget check)", async () => {
    const ctx = createMockContext({
      apiCall: vi.fn().mockResolvedValue({ ok: true, data: { recipient: "0xR" } }),
      checkWriteRate: vi.fn().mockResolvedValue({ allowed: false, reason: "limit" }),
    });
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("tip", { txHash: "tx-1", amount: 1 }));

    expect(ctx.transfer).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════
// 10. error handling
// ════════════════════════════════════════════════════

describe("error handling", () => {
  it("warns and observes failure on react error", async () => {
    const ctx = createMockContext({
      apiCall: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("react", { txHash: "tx-1", reaction: "agree" }));

    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining("network down"));
    expect(ctx.observe).toHaveBeenCalledWith("failure", expect.any(String), expect.any(Object));
  });

  it("warns and observes failure on publish error", async () => {
    const ctx = createMockContext({
      attestAndPublish: vi.fn().mockRejectedValue(new Error("publish failed")),
    });
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("publish", { text: "test" }));

    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining("publish failed"));
  });

  it("warns and observes failure on tip error", async () => {
    const ctx = createMockContext({
      apiCall: vi.fn().mockResolvedValue({ ok: true, data: { recipient: "0xR" } }),
      transfer: vi.fn().mockRejectedValue(new Error("insufficient funds")),
    });
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("tip", { txHash: "tx-1", amount: 10 }));

    expect(ctx.warn).toHaveBeenCalledWith(expect.stringContaining("insufficient funds"));
  });
});

// ════════════════════════════════════════════════════
// 11. token refresh
// ════════════════════════════════════════════════════

describe("token refresh", () => {
  it("calls getToken before API actions", async () => {
    const ctx = createMockContext();
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("react", { txHash: "tx-1", reaction: "agree" }));

    expect(ctx.getToken).toHaveBeenCalled();
  });

  it("does NOT call getToken for log_only", async () => {
    const ctx = createMockContext();
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("log_only", { reason: "test" }));

    expect(ctx.getToken).not.toHaveBeenCalled();
  });

  it("does NOT call getToken in dry-run", async () => {
    const ctx = createMockContext({ dryRun: true });
    const exec = createActionExecutor(ctx);
    await exec(makeEvent(), makeAction("react", { txHash: "tx-1", reaction: "agree" }));

    expect(ctx.getToken).not.toHaveBeenCalled();
  });
});
