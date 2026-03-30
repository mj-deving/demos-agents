import { describe, expect, expectTypeOf, it } from "vitest";

import type { LLMProvider as CoreLLMProvider } from "@demos-agents/core";
import type { LLMProvider as ToolkitLLMProvider } from "../../src/toolkit/index.js";

describe("phase 1 smoke", () => {
  it("re-exports LLMProvider from the toolkit barrel and core package", () => {
    const provider: ToolkitLLMProvider = {
      name: "stub",
      complete: async () => "ok",
    };

    const readProviderName = (value: CoreLLMProvider): string => value.name;

    expect(readProviderName(provider)).toBe("stub");
    expectTypeOf<CoreLLMProvider>().toEqualTypeOf<ToolkitLLMProvider>();
  });

  it("exposes supercolony scoring from the toolkit namespace", async () => {
    const scoring = await import("../../src/toolkit/supercolony/scoring.js");

    expect(scoring.SCORE_BASE).toBe(20);
    expect(scoring.SCORE_MAX).toBe(100);
    expect(scoring.calculateExpectedScore({
      hasAttestation: true,
      hasConfidence: true,
      textLength: 300,
      reactions: 15,
    })).toBe(100);
  });

  it("exposes supercolony scoring from the core package subpath", async () => {
    const scoring = await import("@demos-agents/core/supercolony/scoring");

    expect(scoring.SCORE_ATTESTATION).toBe(40);
    expect(scoring.ENGAGEMENT_T1_THRESHOLD).toBe(5);
    expect(scoring.calculateExpectedScore({
      hasAttestation: true,
      hasConfidence: false,
      textLength: 50,
      reactions: 0,
    })).toBe(60);
  });
});
