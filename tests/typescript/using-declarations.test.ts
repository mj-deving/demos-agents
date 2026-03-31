import { describe, expect, it } from "vitest";

describe("TypeScript ES2025 features", () => {
  it("supports using declarations with Symbol.dispose", () => {
    let disposed = false;

    {
      using _resource = {
        [Symbol.dispose]() {
          disposed = true;
        },
      };
      expect(disposed).toBe(false);
    }

    expect(disposed).toBe(true);
  });
});
