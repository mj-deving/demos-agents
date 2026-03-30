import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("session-runner publish transcript wiring", () => {
  it("passes transcript context into post-generation source matching", () => {
    const source = readFileSync("cli/session-runner.ts", "utf-8");
    const publishAutoSection = source.slice(
      source.indexOf("async function runPublishAutonomous"),
      source.indexOf("async function runVerify")
    );

    expect(publishAutoSection).toMatch(/runAfterPublishDraft\([\s\S]*transcript/);
  });
});
