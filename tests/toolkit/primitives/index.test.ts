import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, createMockDataSource } from "./_helpers.js";
import { createToolkit } from "../../../src/toolkit/primitives/index.js";

describe("createToolkit", () => {
  it("creates a toolkit with all 15 domain namespaces", () => {
    const toolkit = createToolkit({
      apiClient: createMockApiClient(),
      dataSource: createMockDataSource(),
    });

    expect(toolkit.feed).toBeDefined();
    expect(toolkit.intelligence).toBeDefined();
    expect(toolkit.scores).toBeDefined();
    expect(toolkit.agents).toBeDefined();
    expect(toolkit.actions).toBeDefined();
    expect(toolkit.oracle).toBeDefined();
    expect(toolkit.prices).toBeDefined();
    expect(toolkit.verification).toBeDefined();
    expect(toolkit.predictions).toBeDefined();
    expect(toolkit.ballot).toBeDefined();
    expect(toolkit.webhooks).toBeDefined();
    expect(toolkit.identity).toBeDefined();
    expect(toolkit.balance).toBeDefined();
    expect(toolkit.health).toBeDefined();
    expect(toolkit.stats).toBeDefined();
  });

  it("wires feed.getPost through dataSource", async () => {
    const ds = createMockDataSource({
      getPostByHash: vi.fn().mockResolvedValue({ txHash: "0xtest" }),
    });
    const toolkit = createToolkit({
      apiClient: createMockApiClient(),
      dataSource: ds,
    });
    const post = await toolkit.feed.getPost("0xtest");

    expect(post).not.toBeNull();
    expect(ds.getPostByHash).toHaveBeenCalledWith("0xtest");
  });

  it("wires actions.tip with transferDem", async () => {
    const transferDem = vi.fn().mockResolvedValue({ txHash: "0xtip" });
    const client = createMockApiClient({
      initiateTip: vi.fn().mockResolvedValue({ ok: true, data: { ok: true, recipient: "0xr" } }),
    });
    const toolkit = createToolkit({
      apiClient: client,
      dataSource: createMockDataSource(),
      transferDem,
    });
    const result = await toolkit.actions.tip("0xpost", 1.0);

    expect(result).not.toBeNull();
    expect(transferDem).toHaveBeenCalled();
  });
});
