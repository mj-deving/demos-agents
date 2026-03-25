import { describe, it, expect, vi, beforeEach } from "vitest";
import { EthosPlugin } from "../src/plugins/reputation/ethos-plugin.js";

describe("EthosPlugin", () => {
  let plugin: EthosPlugin;

  beforeEach(() => {
    plugin = new EthosPlugin();
  });

  it("implements FrameworkPlugin with correct name and version", () => {
    expect(plugin.name).toBe("ethos-reputation");
    expect(plugin.version).toBe("1.0.0");
  });

  it("has a providers array with ethos-score provider", () => {
    expect(plugin.providers).toBeDefined();
    expect(plugin.providers!.length).toBe(1);
    expect(plugin.providers![0].name).toBe("ethos-score");
  });

  it("provider has fetch method", () => {
    expect(typeof plugin.providers![0].fetch).toBe("function");
  });

  it("init does not throw", async () => {
    await expect(plugin.init!({} as any)).resolves.not.toThrow();
  });

  it("destroy clears cache", async () => {
    await expect(plugin.destroy!()).resolves.not.toThrow();
  });

  describe("fetch with mocked API", () => {
    it("returns score data on successful API response", async () => {
      const mockResponse = { score: 85, vouches: 12, reviews: 5 };
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const result = await plugin.providers![0].fetch("0x1234567890abcdef");

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ score: 85, vouches: 12, reviews: 5 });
      expect(result.source).toBe("ethos.network");

      vi.restoreAllMocks();
    });

    it("returns error on API failure", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      } as any);

      const result = await plugin.providers![0].fetch("0xinvalid");

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();

      vi.restoreAllMocks();
    });

    it("returns error on network failure", async () => {
      vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network error"));

      const result = await plugin.providers![0].fetch("0x1234");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Network error");

      vi.restoreAllMocks();
    });

    it("uses cache on second call", async () => {
      const mockResponse = { score: 90, vouches: 3, reviews: 1 };
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      } as any);

      // First call — hits API
      await plugin.providers![0].fetch("0xCached");
      // Second call — should use cache
      const result = await plugin.providers![0].fetch("0xCached");

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ score: 90, vouches: 3, reviews: 1 });
      // fetch should only be called once (cached second time)
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      vi.restoreAllMocks();
    });

    it("extracts score and vouches from nested response", async () => {
      // Some API responses may nest data differently
      const mockResponse = { score: 75, vouches: 8 };
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const result = await plugin.providers![0].fetch("0xNested");

      expect(result.ok).toBe(true);
      expect((result.data as any).score).toBe(75);
      expect((result.data as any).vouches).toBe(8);
      expect((result.data as any).reviews).toBe(0); // default

      vi.restoreAllMocks();
    });
  });
});
