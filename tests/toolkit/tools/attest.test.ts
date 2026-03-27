/**
 * Tests for attest() SDK integration.
 *
 * Tests SSRF validation and mock-based DAHR attestation flow.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DemosSession } from "../../../src/toolkit/session.js";
import { FileStateStore } from "../../../src/toolkit/state-store.js";
import { attest } from "../../../src/toolkit/tools/attest.js";

function createTestSession(tempDir: string, overrides?: Partial<ConstructorParameters<typeof DemosSession>[0]>) {
  return new DemosSession({
    walletAddress: "demos1attesttest",
    rpcUrl: "https://demosnode.discus.sh",
    algorithm: "falcon",
    authToken: "test-token",
    signingHandle: {},
    stateStore: new FileStateStore(tempDir),
    ...overrides,
  });
}

describe("attest() integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-attest-int-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("calls URL validator before attestation", async () => {
    const session = createTestSession(tempDir);
    // Private IP should be blocked by SSRF validator
    const result = await attest(session, { url: "https://10.0.0.1/api/data" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("private");
  });

  it("rejects URLs that fail SSRF validation (localhost)", async () => {
    const session = createTestSession(tempDir);
    const result = await attest(session, { url: "https://127.0.0.1/secret" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("loopback");
  });

  it("rejects cloud metadata endpoint", async () => {
    const session = createTestSession(tempDir);
    const result = await attest(session, { url: "https://169.254.169.254/latest/meta-data" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("metadata");
  });

  it("rejects HTTP URLs by default", async () => {
    const session = createTestSession(tempDir);
    const result = await attest(session, { url: "http://api.example.com/data" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
    expect(result.error!.message).toContain("HTTPS");
  });

  it("rejects empty URL", async () => {
    const session = createTestSession(tempDir);
    const result = await attest(session, { url: "" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("INVALID_INPUT");
  });

  it("returns ToolResult with provenance", async () => {
    const session = createTestSession(tempDir);
    // Will fail at SSRF (IP is private) but should have proper result shape
    const result = await attest(session, { url: "https://10.0.0.1/api" });
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("provenance");
    expect(result.provenance.path).toBe("local");
  });
});
