import { describe, it, expect, vi } from "vitest";
import {
  prefetchWithFallback,
  type PrefetchCandidate,
  type PrefetchResult,
} from "../../../src/toolkit/sources/prefetch-cascade.js";

// ── Helpers ────────────────────────────────────────

function candidate(id: string, url = `https://example.com/${id}`): PrefetchCandidate {
  return { sourceId: id, url };
}

function succeedingFetch(data: unknown = { ok: true }) {
  return vi.fn<(c: PrefetchCandidate) => Promise<unknown>>().mockResolvedValue(data);
}

function failingFetch(error = "network error") {
  return vi.fn<(c: PrefetchCandidate) => Promise<unknown>>().mockRejectedValue(new Error(error));
}

// ── Tests ──────────────────────────────────────────

describe("prefetchWithFallback", () => {
  it("returns first candidate on success", async () => {
    const candidates = [candidate("a"), candidate("b")];
    const fetchFn = succeedingFetch({ price: 42 });

    const result = await prefetchWithFallback(candidates, fetchFn);

    expect(result.success).toBe(true);
    expect(result.attemptIndex).toBe(0);
    expect(result.totalAttempts).toBe(1);
    expect(result.data).toEqual({ price: 42 });
    expect(result.candidate).toEqual(candidates[0]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to second candidate when first fails", async () => {
    const candidates = [candidate("a"), candidate("b")];
    const fetchFn = vi.fn<(c: PrefetchCandidate) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ fallback: true });

    const result = await prefetchWithFallback(candidates, fetchFn);

    expect(result.success).toBe(true);
    expect(result.attemptIndex).toBe(1);
    expect(result.totalAttempts).toBe(2);
    expect(result.data).toEqual({ fallback: true });
    expect(result.candidate).toEqual(candidates[1]);
  });

  it("returns failure when all candidates fail", async () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c")];
    const fetchFn = failingFetch("server down");

    const result = await prefetchWithFallback(candidates, fetchFn);

    expect(result.success).toBe(false);
    expect(result.error).toBe("server down");
    expect(result.totalAttempts).toBe(3);
    expect(result.data).toBeUndefined();
  });

  it("respects maxAttempts limit", async () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c"), candidate("d")];
    const fetchFn = failingFetch("fail");

    const result = await prefetchWithFallback(candidates, fetchFn, undefined, 2);

    expect(result.success).toBe(false);
    expect(result.totalAttempts).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("defaults maxAttempts to 3", async () => {
    const candidates = [candidate("a"), candidate("b"), candidate("c"), candidate("d"), candidate("e")];
    const fetchFn = failingFetch("fail");

    const result = await prefetchWithFallback(candidates, fetchFn);

    expect(result.totalAttempts).toBe(3);
  });

  it("maxAttempts cannot exceed candidate count", async () => {
    const candidates = [candidate("a"), candidate("b")];
    const fetchFn = failingFetch("fail");

    const result = await prefetchWithFallback(candidates, fetchFn, undefined, 5);

    expect(result.totalAttempts).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("calls observe on fallback", async () => {
    const candidates = [candidate("src-1"), candidate("src-2")];
    const fetchFn = vi.fn<(c: PrefetchCandidate) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("dns fail"))
      .mockResolvedValueOnce({ ok: true });
    const observe = vi.fn();

    await prefetchWithFallback(candidates, fetchFn, observe);

    expect(observe).toHaveBeenCalledWith(
      "insight",
      expect.stringContaining("Source prefetch fallback"),
      expect.objectContaining({
        candidateIndex: 0,
        sourceId: "src-1",
        error: "dns fail",
      }),
    );
  });

  it("does not call observe when first candidate succeeds", async () => {
    const observe = vi.fn();
    await prefetchWithFallback([candidate("a")], succeedingFetch(), observe);
    expect(observe).not.toHaveBeenCalled();
  });

  it("handles empty candidates array", async () => {
    const result = await prefetchWithFallback([], succeedingFetch());

    expect(result.success).toBe(false);
    expect(result.totalAttempts).toBe(0);
  });

  it("preserves optional fields on candidate", async () => {
    const c: PrefetchCandidate = {
      sourceId: "x",
      url: "https://example.com",
      method: "POST",
      score: 0.95,
    };
    const fetchFn = succeedingFetch();

    const result = await prefetchWithFallback([c], fetchFn);

    expect(result.candidate.method).toBe("POST");
    expect(result.candidate.score).toBe(0.95);
    expect(fetchFn).toHaveBeenCalledWith(c);
  });

  it("captures non-Error throw as string", async () => {
    const fetchFn = vi.fn<(c: PrefetchCandidate) => Promise<unknown>>()
      .mockRejectedValue("raw string error");

    const result = await prefetchWithFallback([candidate("a")], fetchFn);

    expect(result.success).toBe(false);
    expect(result.error).toBe("raw string error");
  });
});
