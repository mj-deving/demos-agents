/**
 * Tests for MACRO_ENTITY_MAP and inferMacroEntity — non-crypto entity resolution.
 */

import { describe, it, expect } from "vitest";
import { inferMacroEntity, inferAssetAlias } from "../src/lib/attestation-policy.js";

describe("inferMacroEntity", () => {
  it("resolves GDP to FRED series + World Bank indicator", () => {
    const result = inferMacroEntity("GDP");
    expect(result).not.toBeNull();
    expect(result!.series).toBe("GDP");
    expect(result!.indicator).toBe("NY.GDP.MKTP.CD");
    expect(result!.asset).toBe("gdp");
  });

  it("resolves unemployment", () => {
    const result = inferMacroEntity("unemployment rate at 4.2%");
    expect(result).not.toBeNull();
    expect(result!.series).toBe("UNRATE");
    expect(result!.asset).toBe("unemployment");
  });

  it("resolves inflation and CPI", () => {
    expect(inferMacroEntity("inflation")!.series).toBe("CPIAUCSL");
    expect(inferMacroEntity("CPI at 3.2%")!.series).toBe("CPIAUCSL");
  });

  it("resolves interest rate and fed funds", () => {
    expect(inferMacroEntity("interest rate")!.series).toBe("FEDFUNDS");
    expect(inferMacroEntity("fed funds rate")!.series).toBe("FEDFUNDS");
  });

  it("resolves national debt", () => {
    const result = inferMacroEntity("national debt at $34T");
    expect(result).not.toBeNull();
    expect(result!.asset).toBe("debt");
  });

  it("resolves earthquake", () => {
    const result = inferMacroEntity("earthquake magnitude 6.5");
    expect(result).not.toBeNull();
    expect(result!.asset).toBe("earthquake");
  });

  it("resolves money supply / M2", () => {
    expect(inferMacroEntity("M2 money supply")!.series).toBe("M2SL");
    expect(inferMacroEntity("money supply")!.series).toBe("M2SL");
  });

  it("resolves population (World Bank indicator)", () => {
    const result = inferMacroEntity("population growth");
    expect(result).not.toBeNull();
    expect(result!.indicator).toBe("SP.POP.TOTL");
  });

  it("returns null for unknown entities", () => {
    expect(inferMacroEntity("random text")).toBeNull();
    expect(inferMacroEntity("weather forecast")).toBeNull();
  });

  it("does not collide with crypto entities", () => {
    // These should be handled by inferAssetAlias, not inferMacroEntity
    expect(inferAssetAlias("bitcoin")).not.toBeNull();
    expect(inferMacroEntity("bitcoin")).toBeNull();
    expect(inferAssetAlias("ethereum")).not.toBeNull();
    expect(inferMacroEntity("ethereum")).toBeNull();
  });
});
