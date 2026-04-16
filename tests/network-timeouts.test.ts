import { describe, expect, it, vi } from "vitest";

import { withTimeout } from "../src/lib/network/timeouts.js";

describe("withTimeout", () => {
  it("returns the resolved value before the timeout", async () => {
    await expect(withTimeout("fast-op", 50, Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("rejects when the work does not finish in time", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(
      "slow-op",
      25,
      new Promise<never>(() => {}),
    );

    const assertion = expect(pending).rejects.toThrow("slow-op timed out after 25ms");
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    vi.useRealTimers();
  });
});
