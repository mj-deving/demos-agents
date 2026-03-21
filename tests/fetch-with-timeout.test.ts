import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchWithTimeout } from "../src/lib/fetch-with-timeout.js";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes options to fetch and returns response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as any);

    const res = await fetchWithTimeout("https://example.com", 5000, {
      headers: { Accept: "application/json" },
    });

    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith("https://example.com", expect.objectContaining({
      headers: { Accept: "application/json" },
      signal: expect.any(AbortSignal),
    }));
  });

  it("aborts after timeout", async () => {
    vi.spyOn(global, "fetch").mockImplementation((_url, opts) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    );

    await expect(fetchWithTimeout("https://slow.example.com", 50)).rejects.toThrow("Aborted");
  });

  it("clears timer on success (no leaked timers)", async () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    vi.spyOn(global, "fetch").mockResolvedValueOnce({ ok: true } as any);

    await fetchWithTimeout("https://example.com", 5000);

    expect(clearSpy).toHaveBeenCalled();
  });

  it("clears timer on error (no leaked timers)", async () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network error"));

    await expect(fetchWithTimeout("https://fail.example.com", 5000)).rejects.toThrow("Network error");
    expect(clearSpy).toHaveBeenCalled();
  });
});
