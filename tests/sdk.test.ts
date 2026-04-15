/**
 * Tests for tools/lib/sdk.ts — wallet loading, API calls, logging.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "node:path";
import { homedir } from "node:os";

// ── Mocks ──────────────────────────────────────────

// Mock filesystem
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

// Mock the SDK — prevent real NAPI loading.
// Use vi.hoisted to create mocks that are available during vi.mock hoisting.
const { mockConnect, mockConnectWallet } = vi.hoisted(() => ({
  mockConnect: vi.fn(async () => undefined),
  mockConnectWallet: vi.fn(async () => "0xTestAddress"),
}));

vi.mock("@kynesyslabs/demosdk/websdk", () => {
  return {
    Demos: function Demos(this: any) {
      this.connect = mockConnect;
      this.connectWallet = mockConnectWallet;
    },
  };
});

import { readFileSync, existsSync } from "node:fs";
import { Demos } from "@kynesyslabs/demosdk/websdk";
import {
  getRpcUrl,
  getApiUrl,
  loadMnemonic,
  connectWallet,
  apiCall,
  info,
  setLogAgent,
} from "../src/lib/network/sdk.js";

const XDG_CREDENTIALS = resolve(homedir(), ".config/demos/credentials");

// ── Setup ──────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Constants ──────────────────────────────────────

describe("config getters", () => {
  it("getRpcUrl returns the default demosnode URL", () => {
    expect(getRpcUrl()).toBe("https://demosnode.discus.sh/");
  });

  it("getApiUrl returns the default SuperColony URL", () => {
    expect(getApiUrl()).toBe("https://supercolony.ai");
  });
});

// ── loadMnemonic ───────────────────────────────────

describe("loadMnemonic", () => {
  it("parses double-quoted mnemonic", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue(
      'DEMOS_MNEMONIC="word1 word2 word3 word4"'
    );

    const result = loadMnemonic(".env");
    expect(result).toBe("word1 word2 word3 word4");
  });

  it("parses single-quoted mnemonic", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue(
      "DEMOS_MNEMONIC='alpha beta gamma delta'"
    );

    const result = loadMnemonic(".env");
    expect(result).toBe("alpha beta gamma delta");
  });

  it("parses unquoted mnemonic", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue(
      "DEMOS_MNEMONIC=word1 word2 word3"
    );

    const result = loadMnemonic(".env");
    expect(result).toBe("word1 word2 word3");
  });

  it("strips inline comments from unquoted values", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue(
      "DEMOS_MNEMONIC=word1 word2 # this is a comment"
    );

    const result = loadMnemonic(".env");
    expect(result).toBe("word1 word2");
  });

  it("skips comment lines", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue(
      '# DEMOS_MNEMONIC="old value"\nDEMOS_MNEMONIC="correct value"'
    );

    const result = loadMnemonic(".env");
    expect(result).toBe("correct value");
  });

  it("throws when no credentials file exists", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => loadMnemonic(".env")).toThrow(/No credentials file/);
  });

  it("throws when mnemonic key is missing from file", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue("OTHER_KEY=value\n");

    expect(() => loadMnemonic(".env")).toThrow(/No DEMOS_MNEMONIC/);
  });

  it("prefers XDG path over legacy .env", () => {
    const xdgContent = 'DEMOS_MNEMONIC="xdg-mnemonic"';
    const legacyContent = 'DEMOS_MNEMONIC="legacy-mnemonic"';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p) === XDG_CREDENTIALS) return xdgContent;
      return legacyContent;
    });

    // Default .env path — should prefer XDG
    const result = loadMnemonic(".env");
    expect(result).toBe("xdg-mnemonic");
  });

  it("explicit --env path overrides XDG", () => {
    const explicitPath = resolve("/custom/path/credentials");
    const explicitContent = 'DEMOS_MNEMONIC="explicit-mnemonic"';
    const xdgContent = 'DEMOS_MNEMONIC="xdg-mnemonic"';

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p) === explicitPath) return explicitContent;
      if (String(p) === XDG_CREDENTIALS) return xdgContent;
      return "";
    });

    const result = loadMnemonic("/custom/path/credentials");
    expect(result).toBe("explicit-mnemonic");
  });

  it("treats empty envPath as the default auto-resolved path", () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue(
      'DEMOS_MNEMONIC="auto-mnemonic"'
    );

    const result = loadMnemonic("");
    expect(result).toBe("auto-mnemonic");
    expect(readFileSync).toHaveBeenCalledWith(XDG_CREDENTIALS, "utf-8");
  });

  it("falls back to legacy when XDG does not exist", () => {
    const legacyPath = resolve(".env");

    vi.mocked(existsSync).mockImplementation((p) => {
      if (String(p) === XDG_CREDENTIALS) return false;
      if (String(p) === legacyPath) return true;
      return false;
    });
    vi.mocked(readFileSync).mockReturnValue('DEMOS_MNEMONIC="legacy"');

    const result = loadMnemonic(".env");
    expect(result).toBe("legacy");
  });
});

// ── connectWallet ──────────────────────────────────

describe("connectWallet", () => {
  it("returns demos instance and address", async () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue('DEMOS_MNEMONIC="test mnemonic"');

    const result = await connectWallet(".env");

    expect(result).toHaveProperty("demos");
    expect(result).toHaveProperty("address");
    expect(result.address).toBe("0xTestAddress");
  });

  it("calls Demos.connect with getRpcUrl()", async () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue('DEMOS_MNEMONIC="test mnemonic"');

    await connectWallet(".env");

    expect(mockConnect).toHaveBeenCalledWith(getRpcUrl());
  });

  it("calls connectWallet with loaded mnemonic", async () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue('DEMOS_MNEMONIC="my seed phrase"');

    await connectWallet(".env");

    expect(mockConnectWallet).toHaveBeenCalledWith("my seed phrase");
  });

  it("creates a fresh Demos instance each call", async () => {
    vi.mocked(existsSync).mockImplementation((p) =>
      String(p) === XDG_CREDENTIALS
    );
    vi.mocked(readFileSync).mockReturnValue('DEMOS_MNEMONIC="test"');

    const r1 = await connectWallet(".env");
    const r2 = await connectWallet(".env");

    expect(r1.demos).not.toBe(r2.demos);
  });

  it("propagates error when credentials missing", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    await expect(connectWallet(".env")).rejects.toThrow(/No credentials file/);
  });
});

// ── apiCall ────────────────────────────────────────

describe("apiCall", () => {
  function mockFetchResponse(
    status: number,
    body: any,
    ok?: boolean
  ): ReturnType<typeof vi.fn> {
    return mockFetch.mockResolvedValueOnce({
      ok: ok ?? (status >= 200 && status < 300),
      status,
      text: () => Promise.resolve(
        typeof body === "string" ? body : JSON.stringify(body)
      ),
    });
  }

  it("makes a GET request to relative path", async () => {
    mockFetchResponse(200, { success: true });

    const result = await apiCall("/api/feed", null);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://supercolony.ai/api/feed",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      })
    );
  });

  it("makes a GET request to absolute URL", async () => {
    mockFetchResponse(200, { ok: true });

    await apiCall("https://other.api.com/data", null);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://other.api.com/data",
      expect.any(Object)
    );
  });

  it("attaches bearer token for SuperColony relative paths", async () => {
    mockFetchResponse(200, {});

    await apiCall("/api/feed", "my-token");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer my-token",
        }),
      })
    );
  });

  it("strips www and attaches bearer token for absolute SuperColony URL", async () => {
    mockFetchResponse(200, {});

    await apiCall("https://www.supercolony.ai/api/feed", "my-token");

    // www. should be stripped before fetch
    expect(mockFetch).toHaveBeenCalledWith(
      "https://supercolony.ai/api/feed",
      expect.any(Object)
    );
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer my-token");
  });

  it("attaches bearer token for bare supercolony.ai domain", async () => {
    mockFetchResponse(200, {});

    await apiCall("https://supercolony.ai/api/feed", "my-token");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer my-token");
  });

  it("does NOT attach token to non-SuperColony URLs (origin check)", async () => {
    mockFetchResponse(200, {});

    await apiCall("https://supercolony.ai.evil.test/steal", "my-token");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("does NOT attach token to other domains", async () => {
    mockFetchResponse(200, {});

    await apiCall("https://example.com/api", "my-token");

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("does not retry 502 on POST", async () => {
    mockFetchResponse(502, "Bad Gateway", false);

    const result = await apiCall("/api/post", "tok", { method: "POST" });

    expect(result.status).toBe(502);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries 502 on GET up to 3 times", async () => {
    // Return 502 for first 3, then 200
    mockFetchResponse(502, "Bad Gateway", false);
    mockFetchResponse(502, "Bad Gateway", false);
    mockFetchResponse(502, "Bad Gateway", false);
    mockFetchResponse(200, { recovered: true });

    const result = await apiCall("/api/feed", null);

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ recovered: true });
    expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  }, 60_000);

  it("returns 502 after exhausting retries", async () => {
    mockFetchResponse(502, "Bad Gateway", false);
    mockFetchResponse(502, "Bad Gateway", false);
    mockFetchResponse(502, "Bad Gateway", false);
    mockFetchResponse(502, "Bad Gateway", false);

    const result = await apiCall("/api/feed", null);

    expect(result.status).toBe(502);
    // 1 initial + 3 retries = 4 total calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
  }, 60_000);

  it("handles JSON parse failure gracefully (returns text)", async () => {
    mockFetchResponse(200, "not-json-content");

    const result = await apiCall("/api/test", null);

    expect(result.ok).toBe(true);
    expect(result.data).toBe("not-json-content");
  });

  it("handles network errors without retrying", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await apiCall("/api/feed", null);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.data).toBe("ECONNREFUSED");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("passes through POST body and method", async () => {
    mockFetchResponse(201, { id: 1 });

    await apiCall("/api/post", "tok", {
      method: "POST",
      body: JSON.stringify({ text: "hello" }),
    });

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].method).toBe("POST");
    expect(callArgs[1].body).toBe(JSON.stringify({ text: "hello" }));
  });

  it("skips token when token is null", async () => {
    mockFetchResponse(200, {});

    await apiCall("/api/feed", null);

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });
});

// ── info / setLogAgent ─────────────────────────────

describe("info", () => {
  it("logs to stderr with agent prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    info("test message", "sentinel");

    expect(spy).toHaveBeenCalledWith("[sentinel] test message");
    spy.mockRestore();
  });

  it("uses custom agent name when provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    info("hello", "pioneer");

    expect(spy).toHaveBeenCalledWith("[pioneer] hello");
    spy.mockRestore();
  });
});

describe("setLogAgent", () => {
  it("changes the default agent name for info()", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    setLogAgent("crawler");
    info("log line");

    expect(spy).toHaveBeenCalledWith("[crawler] log line");
    spy.mockRestore();
  });

  it("ignores empty string", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    setLogAgent("myagent");
    setLogAgent("   ");
    info("should keep old name");

    expect(spy).toHaveBeenCalledWith("[myagent] should keep old name");
    spy.mockRestore();
  });

  it("trims whitespace from agent name", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    setLogAgent("  spaced  ");
    info("trimmed");

    expect(spy).toHaveBeenCalledWith("[spaced] trimmed");
    spy.mockRestore();
  });
});
