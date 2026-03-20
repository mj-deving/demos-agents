import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSkillDojoClient } from "../../../src/lib/skill-dojo-client.js";

describe("SkillDojoClient", () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends POST to /api/execute with correct body", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          skillId: "test-skill",
          executionTimeMs: 50,
          result: { status: "success", message: "ok", data: { foo: 1 }, timestamp: "2026-01-01T00:00:00Z" },
        }),
    });

    const client = createSkillDojoClient({ baseUrl: "https://test.local" });
    const res = await client.execute("test-skill", { mode: "balance" });

    expect(mockFetch).toHaveBeenCalledWith("https://test.local/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "test-skill", params: { mode: "balance" } }),
    });
    expect(res.ok).toBe(true);
    expect(res.skillId).toBe("test-skill");
    expect(res.result?.data).toEqual({ foo: 1 });
  });

  it("returns error response for non-ok HTTP status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const client = createSkillDojoClient({ baseUrl: "https://test.local" });
    const res = await client.execute("test-skill", {});

    expect(res.ok).toBe(false);
    expect(res.error).toBe("HTTP 500: Internal Server Error");
  });

  describe("rate limiting", () => {
    it("canExecute returns true when under budget", () => {
      const client = createSkillDojoClient({ maxRequestsPerHour: 3 });
      expect(client.canExecute()).toBe(true);
    });

    it("tracks remaining budget", () => {
      const client = createSkillDojoClient({ maxRequestsPerHour: 5 });
      const budget = client.getRemainingBudget();
      expect(budget.remaining).toBe(5);
      expect(budget.resetsAt).toBeGreaterThan(Date.now());
    });

    it("returns error when rate limit exceeded", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            skillId: "s",
            executionTimeMs: 1,
            result: { status: "success", message: "", data: {}, timestamp: "" },
          }),
      });

      const client = createSkillDojoClient({
        baseUrl: "https://test.local",
        maxRequestsPerHour: 2,
      });

      await client.execute("s", {});
      await client.execute("s", {});

      const res = await client.execute("s", {});
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/rate limit exceeded/i);
    });

    it("canExecute returns false when exhausted", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            skillId: "s",
            executionTimeMs: 1,
            result: { status: "success", message: "", data: {}, timestamp: "" },
          }),
      });

      const client = createSkillDojoClient({
        baseUrl: "https://test.local",
        maxRequestsPerHour: 1,
      });

      await client.execute("s", {});
      expect(client.canExecute()).toBe(false);
      expect(client.getRemainingBudget().remaining).toBe(0);
    });
  });

  it("uses default base URL and rate limit", () => {
    const client = createSkillDojoClient();
    expect(client.canExecute()).toBe(true);
    expect(client.getRemainingBudget().remaining).toBe(5);
  });
});
