import { describe, it, expect, vi } from "vitest";
import { createMockApiClient, mockOk } from "./_helpers.js";
import { createWebhooksPrimitives } from "../../../src/toolkit/primitives/webhooks.js";

describe("webhooks.list", () => {
  it("delegates to apiClient.listWebhooks", async () => {
    const data = { webhooks: [{ id: "w1", url: "https://example.com", events: ["post"], active: true }] };
    const client = createMockApiClient({ listWebhooks: vi.fn().mockResolvedValue(mockOk(data)) });
    const wh = createWebhooksPrimitives({ apiClient: client });
    const result = await wh.list();

    expect(result).toEqual(mockOk(data));
  });
});

describe("webhooks.create", () => {
  it("delegates to apiClient.createWebhook", async () => {
    const client = createMockApiClient({ createWebhook: vi.fn().mockResolvedValue(mockOk(undefined)) });
    const wh = createWebhooksPrimitives({ apiClient: client });
    await wh.create("https://example.com/hook", ["post", "reaction"]);

    expect(client.createWebhook).toHaveBeenCalledWith("https://example.com/hook", ["post", "reaction"]);
  });
});

describe("webhooks.delete", () => {
  it("delegates to apiClient.deleteWebhook", async () => {
    const client = createMockApiClient({ deleteWebhook: vi.fn().mockResolvedValue(mockOk(undefined)) });
    const wh = createWebhooksPrimitives({ apiClient: client });
    await wh.delete("w1");

    expect(client.deleteWebhook).toHaveBeenCalledWith("w1");
  });
});
