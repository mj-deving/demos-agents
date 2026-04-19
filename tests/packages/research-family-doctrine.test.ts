import { describe, expect, it } from "vitest";
import {
  dossierForFamily,
  loadResearchFamilyDoctrineRegistry,
} from "../../packages/omniweb-toolkit/src/research-family-doctrine.js";

describe("research family doctrine", () => {
  it("loads the supported research family dossiers from YAML", () => {
    const registry = loadResearchFamilyDoctrineRegistry();

    expect(Object.keys(registry).sort()).toEqual([
      "etf-flows",
      "funding-structure",
      "network-activity",
      "spot-momentum",
      "stablecoin-supply",
      "vix-credit",
    ]);
    expect(registry["funding-structure"].baseline[0])
      .toBe("Funding and premium are positioning signals, not standalone direction calls.");
    expect(registry["stablecoin-supply"].falseInferenceGuards)
      .toContain("Do not use \"still at $1\" as the core insight.");
  });

  it("keeps unsupported topics on the generic fallback dossier", () => {
    const dossier = dossierForFamily("unsupported");

    expect(dossier.family).toBe("unsupported");
    expect(dossier.baseline).toEqual([
      "Use the fetched evidence as the center of gravity for the post.",
    ]);
  });
});
