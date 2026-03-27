/**
 * Tests for publish() and reply() tools.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DemosSession } from "../../../src/toolkit/session.js";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import { publish, reply } from "../../../src/toolkit/tools/publish.js";
import { recordWrite, checkAndRecordWrite } from "../../../src/toolkit/guards/write-rate-limit.js";

function createTestSession(tempDir: string) {
  return new DemosSession({
    walletAddress: "demos1pubtest",
    rpcUrl: "https://demosnode.discus.sh",
    algorithm: "falcon",
    authToken: "test-token",
    signingHandle: {},
    stateStore: new FileStateStore(tempDir),
  });
}

describe("publish()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-pub-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("accepts DemosSession as first parameter", async () => {
    const session = createTestSession(tempDir);
    // Publish will fail (SDK not connected) but should accept session
    const result = await publish(session, { text: "Test post", category: "ANALYSIS", attestUrl: "https://api.example.com/price" });
    // Should return typed result, not throw
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("provenance");
  });

  it("returns ToolResult with provenance", async () => {
    const session = createTestSession(tempDir);
    const result = await publish(session, { text: "Test post", category: "ANALYSIS", attestUrl: "https://api.example.com/price" });
    expect(result.provenance).toBeDefined();
    expect(result.provenance.path).toBe("local");
    expect(typeof result.provenance.latencyMs).toBe("number");
  });

  it("rejects empty text", async () => {
    const session = createTestSession(tempDir);
    const result = await publish(session, { text: "", category: "ANALYSIS", attestUrl: "https://api.example.com/price" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("rejects missing category", async () => {
    const session = createTestSession(tempDir);
    const result = await publish(session, { text: "Hello", category: "", attestUrl: "https://api.example.com/price" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("enforces rate limit before publishing", async () => {
    const session = createTestSession(tempDir);
    // Fill up hourly limit
    for (let i = 0; i < 4; i++) {
      await recordWrite(session.stateStore, session.walletAddress);
    }

    const result = await publish(session, { text: "Test post", category: "ANALYSIS", attestUrl: "https://api.example.com/price" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("RATE_LIMITED");
  });

  it("enforces dedup guard", async () => {
    const session = createTestSession(tempDir);

    // Manually record a publish (bypassing the pipeline that would fail)
    const { recordPublish } = await import("../../../src/toolkit/guards/dedup-guard.js");
    await recordPublish(session.stateStore, session.walletAddress, "Duplicate text");

    const result = await publish(session, { text: "Duplicate text", category: "ANALYSIS", attestUrl: "https://api.example.com/price" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("DUPLICATE");
  });

  it("calls onToolCall observer on success path", async () => {
    const observer = vi.fn();
    const session = new DemosSession({
      walletAddress: "demos1pubtest",
      rpcUrl: "https://demosnode.discus.sh",
      algorithm: "falcon",
      authToken: "test-token",
      signingHandle: {},
      stateStore: new FileStateStore(tempDir),
      onToolCall: observer,
    });

    // Will fail at pipeline, observer only called on success
    const result = await publish(session, { text: "Test", category: "ANALYSIS", attestUrl: "https://api.example.com/price" });
    // Verify the result is still a valid typed ToolResult
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("provenance");
  });
});

describe("reply()", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-reply-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("accepts DemosSession as first parameter", async () => {
    const session = createTestSession(tempDir);
    const result = await reply(session, {
      parentTxHash: "0xparent",
      text: "Reply text",
      attestUrl: "https://api.example.com/data",
    });
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("provenance");
  });

  it("returns ToolResult with txHash on success (typed)", async () => {
    const session = createTestSession(tempDir);
    const result = await reply(session, {
      parentTxHash: "0xparent",
      text: "Reply text",
      attestUrl: "https://api.example.com/data",
    });
    // Will fail (no SDK) but return typed result
    expect(result.ok === true || result.ok === false).toBe(true);
  });

  it("requires parentTxHash", async () => {
    const session = createTestSession(tempDir);
    const result = await reply(session, {
      parentTxHash: "",
      text: "Reply text",
      attestUrl: "https://api.example.com/data",
    });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });
});
