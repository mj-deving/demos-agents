/**
 * Tests for connect() — validation and error paths.
 *
 * Happy-path SDK connection tested in integration.test.ts with mocked bridge.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connect, disconnect } from "../../../src/toolkit/tools/connect.js";

describe("connect() validation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "demos-connect-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createWalletFile(content: string, mode: number = 0o600): string {
    const walletPath = join(tempDir, "credentials");
    writeFileSync(walletPath, content, { mode });
    return walletPath;
  }

  it("rejects mnemonic-only wallet files with clear error", async () => {
    const walletPath = createWalletFile(
      "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
    );

    await expect(connect({ walletPath })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("Mnemonic wallet files are not yet supported"),
    });
  });

  it("rejects HTTP rpcUrl with INVALID_INPUT error", async () => {
    const walletPath = createWalletFile(JSON.stringify({ address: "demos1test" }));

    await expect(connect({ walletPath, rpcUrl: "http://localhost:26657" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("HTTPS"),
    });
  });

  it("allows HTTP rpcUrl when allowInsecureUrls is true (fails later at SDK)", async () => {
    const walletPath = createWalletFile(JSON.stringify({ address: "demos1test" }));

    // Should pass HTTPS check but fail at SDK connect (no real RPC)
    await expect(
      connect({ walletPath, rpcUrl: "http://localhost:26657", allowInsecureUrls: true }),
    ).rejects.toMatchObject({
      code: "AUTH_FAILED", // Fails at SDK, NOT at HTTPS validation
    });
  });

  it("rejects wallet with invalid mnemonic word count", async () => {
    const walletPath = createWalletFile('DEMOS_MNEMONIC="word1 word2 word3"');

    await expect(connect({ walletPath })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("3 words"),
    });
  });

  it("disconnect expires session and clears sensitive data", async () => {
    const { DemosSession } = await import("../../../src/toolkit/session.js");
    const { FileStateStore } = await import("../../../src/toolkit/state-store.js");

    const session = new DemosSession({
      walletAddress: "demos1test",
      rpcUrl: "https://demosnode.discus.sh",
      algorithm: "falcon",
      authToken: "test-token",
      signingHandle: {},
      stateStore: new FileStateStore(tempDir),
    });

    expect(session.expired).toBe(false);
    disconnect(session);
    expect(session.expired).toBe(true);
    expect(() => session.getAuthToken()).toThrow("expired");
  });
});
