import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before import
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("../../src/lib/agent-config.js", () => ({
  loadAgentConfig: vi.fn(),
}));

import { readFileSync } from "node:fs";
import { loadAgentConfig } from "../../src/lib/agent-config.js";
import { personaToCharacter } from "../../src/adapters/eliza/config-bridge.js";

const mockReadFileSync = vi.mocked(readFileSync);
const mockLoadAgentConfig = vi.mocked(loadAgentConfig);

describe("personaToCharacter", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadAgentConfig.mockReturnValue({
      name: "sentinel",
      displayName: "Sentinel",
      topics: {
        primary: ["crypto", "defi"],
        secondary: ["governance"],
      },
      paths: {
        agentYaml: "/agents/sentinel/AGENT.yaml",
        personaMd: "/agents/sentinel/persona.md",
        strategyYaml: "/agents/sentinel/strategy.yaml",
        sourcesRegistry: "/agents/sentinel/sources-registry.yaml",
        sourceCatalog: "/config/sources/catalog.json",
        sourceConfig: "/agents/sentinel/source-config.yaml",
        sessionDir: "/home/.sentinel/sessions",
        logFile: "/home/.sentinel-session-log.jsonl",
        improvementsFile: "/home/.sentinel-improvements.json",
        findingsFile: "/home/.sentinel-review-findings.json",
      },
      scan: { modes: ["lightweight"], qualityFloor: 70, requireAttestation: false, depth: 200, topicSearchLimit: 30, cacheHours: 4 },
      attestation: { defaultMode: "dahr_only", highSensitivityRequireTlsn: true, highSensitivityKeywords: [] },
      engagement: { minDisagreePerSession: 1, replyMinParentReactions: 8, maxReactionsPerSession: 8 },
      tipping: { enabled: false, maxTipsPerSession: 2, maxPerRecipientPerDay: 2, minMinutesBetweenTips: 5, minSessionsBeforeLive: 3, minScore: 80, requireAttestation: true },
      gate: { predictedReactionsThreshold: 17, allow5Of6: true, duplicateWindowHours: 24 },
      calibration: { offset: 0 },
      loopExtensions: [],
      sourceRegistryMode: "catalog-preferred",
    } as any);

    // AGENT.yaml content
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).includes("AGENT.yaml")) {
        return `
identity:
  role: "Network intelligence analyst"
  mission: "Monitor and report on network activity"
capabilities:
  skills:
    - supercolony
    - attestation
`;
      }
      if (String(path).includes("persona.md")) {
        return "Line one\n\nLine two\n  \nLine three\n";
      }
      return "";
    });
  });

  it("maps displayName to Character name", () => {
    const char = personaToCharacter("sentinel");
    expect(char.name).toBe("Sentinel");
  });

  it("builds bio from identity role and mission", () => {
    const char = personaToCharacter("sentinel");
    expect(char.bio).toBe("Network intelligence analyst. Monitor and report on network activity");
  });

  it("merges primary and secondary topics", () => {
    const char = personaToCharacter("sentinel");
    expect(char.topics).toEqual(["crypto", "defi", "governance"]);
  });

  it("extracts non-empty lines from persona.md into style.post", () => {
    const char = personaToCharacter("sentinel");
    expect(char.style.post).toEqual(["Line one", "Line two", "Line three"]);
  });

  it("maps capabilities.skills to plugins", () => {
    const char = personaToCharacter("sentinel");
    expect(char.plugins).toEqual(["supercolony", "attestation"]);
  });

  it("sets modelProvider from LLM_PROVIDER env", () => {
    process.env.LLM_PROVIDER = "openai";
    const char = personaToCharacter("sentinel");
    expect(char.settings.modelProvider).toBe("openai");
    delete process.env.LLM_PROVIDER;
  });

  it("handles missing identity fields gracefully", () => {
    mockReadFileSync.mockImplementation((path: any) => {
      if (String(path).includes("AGENT.yaml")) return "capabilities:\n  skills: []";
      return "";
    });
    const char = personaToCharacter("sentinel");
    expect(char.bio).toBe(".");
  });

  it("handles missing topics gracefully", () => {
    mockLoadAgentConfig.mockReturnValue({
      displayName: "Test",
      topics: undefined,
      paths: { agentYaml: "/a.yaml", personaMd: "/p.md" },
    } as any);
    mockReadFileSync.mockReturnValue("name: test");
    const char = personaToCharacter("test");
    expect(char.topics).toEqual([]);
  });
});
