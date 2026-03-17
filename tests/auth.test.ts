/**
 * Tests for tools/lib/auth.ts — auth cache and challenge-response flow.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { homedir } from "node:os";

// ── Mocks ──────────────────────────────────────────

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("../tools/lib/sdk.js", () => ({
  apiCall: vi.fn(),
  info: vi.fn(),
}));

// Mock the SDK type import (not used at runtime, but needed for module resolution)
vi.mock("@kynesyslabs/demosdk/websdk", () => ({
  Demos: vi.fn(),
}));

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { apiCall, info } from "../tools/lib/sdk.js";
import { loadAuthCache, ensureAuth } from "../tools/lib/auth.js";

const AUTH_CACHE_PATH = resolve(homedir(), ".supercolony-auth.json");
const TEST_ADDRESS = "0xTestAddress123";
const OTHER_ADDRESS = "0xOtherAddress456";

// ── Helpers ────────────────────────────────────────

/** Create a future ISO timestamp (minutes from now). */
function futureExpiry(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

/** Create a past ISO timestamp. */
function pastExpiry(): string {
  return new Date(Date.now() - 60 * 1000).toISOString();
}

/** Build a namespaced cache object. */
function namespacedCache(
  address: string,
  token: string,
  expiresAt: string
): Record<string, any> {
  return { [address]: { token, expiresAt } };
}

/** Build a legacy flat cache object. */
function legacyCache(
  address: string,
  token: string,
  expiresAt: string
): Record<string, any> {
  return { token, address, expiresAt };
}

// ── Setup ──────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── loadAuthCache ──────────────────────────────────

describe("loadAuthCache", () => {
  it("returns null when cache file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(loadAuthCache(TEST_ADDRESS)).toBeNull();
  });

  it("returns cached token from namespaced format", () => {
    const expiry = futureExpiry(30);
    const cache = namespacedCache(TEST_ADDRESS, "ns-token", expiry);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));

    const result = loadAuthCache(TEST_ADDRESS);

    expect(result).not.toBeNull();
    expect(result!.token).toBe("ns-token");
    expect(result!.address).toBe(TEST_ADDRESS);
  });

  it("returns null when namespaced token is expired", () => {
    const cache = namespacedCache(TEST_ADDRESS, "expired-tok", pastExpiry());

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));

    expect(loadAuthCache(TEST_ADDRESS)).toBeNull();
  });

  it("returns null when token expires within 5-minute margin", () => {
    // 4 minutes from now — within the 5-min margin
    const cache = namespacedCache(TEST_ADDRESS, "almost-expired", futureExpiry(4));

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));

    expect(loadAuthCache(TEST_ADDRESS)).toBeNull();
  });

  it("returns token that expires in exactly 6 minutes (outside margin)", () => {
    const cache = namespacedCache(TEST_ADDRESS, "valid-tok", futureExpiry(6));

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));

    const result = loadAuthCache(TEST_ADDRESS);
    expect(result).not.toBeNull();
    expect(result!.token).toBe("valid-tok");
  });

  it("reads legacy flat format when no namespaced entry", () => {
    const expiry = futureExpiry(30);
    const cache = legacyCache(TEST_ADDRESS, "legacy-tok", expiry);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));

    const result = loadAuthCache(TEST_ADDRESS);

    expect(result).not.toBeNull();
    expect(result!.token).toBe("legacy-tok");
    expect(result!.address).toBe(TEST_ADDRESS);
  });

  it("returns null for legacy format with wrong address", () => {
    const cache = legacyCache(OTHER_ADDRESS, "legacy-tok", futureExpiry(30));

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));

    expect(loadAuthCache(TEST_ADDRESS)).toBeNull();
  });

  it("returns legacy token when no address filter provided", () => {
    const cache = legacyCache(TEST_ADDRESS, "legacy-tok", futureExpiry(30));

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));

    const result = loadAuthCache();

    expect(result).not.toBeNull();
    expect(result!.token).toBe("legacy-tok");
  });

  it("prefers namespaced entry over legacy when both exist", () => {
    const expiry = futureExpiry(30);
    const cache = {
      // Legacy flat fields
      token: "legacy-tok",
      address: TEST_ADDRESS,
      expiresAt: expiry,
      // Namespaced entry
      [TEST_ADDRESS]: { token: "ns-tok", expiresAt: expiry },
    };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));

    const result = loadAuthCache(TEST_ADDRESS);

    expect(result!.token).toBe("ns-tok");
  });

  it("returns null on malformed JSON", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("not valid json {{{");

    expect(loadAuthCache(TEST_ADDRESS)).toBeNull();
  });

  it("returns null when entry has no token field", () => {
    const cache = { [TEST_ADDRESS]: { expiresAt: futureExpiry(30) } };

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));

    expect(loadAuthCache(TEST_ADDRESS)).toBeNull();
  });
});

// ── ensureAuth ─────────────────────────────────────

describe("ensureAuth", () => {
  /** Build a mock Demos instance. */
  function mockDemos() {
    return {
      signMessage: vi.fn().mockResolvedValue({
        data: "0xSignatureData",
        type: "secp256k1",
      }),
    } as any;
  }

  /** Set up apiCall to handle challenge + verify flow. */
  function setupAuthFlow(token = "fresh-token", expiresAt?: string) {
    const expiry = expiresAt || futureExpiry(1440); // 24h
    vi.mocked(apiCall)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { challenge: "challenge-id", message: "Sign this message" },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { token, expiresAt: expiry },
      });
    return expiry;
  }

  it("returns cached token when valid", async () => {
    const expiry = futureExpiry(30);
    const cache = namespacedCache(TEST_ADDRESS, "cached-tok", expiry);

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));

    const result = await ensureAuth(mockDemos(), TEST_ADDRESS);

    expect(result).toBe("cached-tok");
    // Should NOT call apiCall when cache is valid
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("performs challenge-response when no cache exists", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    setupAuthFlow("new-token");

    const demos = mockDemos();
    const result = await ensureAuth(demos, TEST_ADDRESS);

    expect(result).toBe("new-token");
    expect(demos.signMessage).toHaveBeenCalledWith("Sign this message");

    // Verify challenge request
    expect(apiCall).toHaveBeenCalledWith(
      `/api/auth/challenge?address=${TEST_ADDRESS}`,
      null
    );

    // Verify signature submission
    expect(apiCall).toHaveBeenCalledWith(
      "/api/auth/verify",
      null,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"signature":"0xSignatureData"'),
      })
    );
  });

  it("saves token to cache after successful auth", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const expiry = setupAuthFlow("saved-token");

    await ensureAuth(mockDemos(), TEST_ADDRESS);

    expect(writeFileSync).toHaveBeenCalledWith(
      AUTH_CACHE_PATH,
      expect.stringContaining('"saved-token"'),
      { mode: 0o600 }
    );
  });

  it("forces refresh even when cache is valid", async () => {
    const cache = namespacedCache(TEST_ADDRESS, "old-tok", futureExpiry(30));

    vi.mocked(existsSync).mockImplementation((p) => {
      // Cache exists for load, but not for save (fresh)
      return String(p) === AUTH_CACHE_PATH;
    });
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(cache));
    setupAuthFlow("refreshed-token");

    const result = await ensureAuth(mockDemos(), TEST_ADDRESS, true);

    expect(result).toBe("refreshed-token");
    expect(apiCall).toHaveBeenCalled();
  });

  it("throws on challenge failure", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: false,
      status: 500,
      data: { error: "Server error" },
    });

    await expect(
      ensureAuth(mockDemos(), TEST_ADDRESS)
    ).rejects.toThrow(/Auth challenge failed/);
  });

  it("throws on verify failure", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    vi.mocked(apiCall)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { challenge: "c1", message: "Sign" },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        data: { error: "Invalid signature" },
      });

    await expect(
      ensureAuth(mockDemos(), TEST_ADDRESS)
    ).rejects.toThrow(/Auth verify failed/);
  });

  it("throws when verify returns ok but no token", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    vi.mocked(apiCall)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { challenge: "c1", message: "Sign" },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { success: true }, // no token field
      });

    await expect(
      ensureAuth(mockDemos(), TEST_ADDRESS)
    ).rejects.toThrow(/Auth verify failed/);
  });

  it("generates default expiry when server omits expiresAt", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    vi.mocked(apiCall)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { challenge: "c1", message: "Sign" },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { token: "no-expiry-token" }, // no expiresAt
      });

    const result = await ensureAuth(mockDemos(), TEST_ADDRESS);

    expect(result).toBe("no-expiry-token");
    // Should still save to cache with a generated expiry
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("sends correct verify payload shape", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    setupAuthFlow();

    const demos = mockDemos();
    await ensureAuth(demos, TEST_ADDRESS);

    const verifyCall = vi.mocked(apiCall).mock.calls[1];
    const body = JSON.parse(verifyCall[2]!.body as string);

    expect(body).toEqual({
      address: TEST_ADDRESS,
      challenge: "challenge-id",
      signature: "0xSignatureData",
      algorithm: "secp256k1",
    });
  });
});
