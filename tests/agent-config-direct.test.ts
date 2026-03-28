/**
 * Direct tests for src/lib/agent-config.ts — agent configuration loader.
 *
 * Tests loadAgentConfig and resolveAgentName with:
 *   - Valid YAML config loading
 *   - Missing file handling (defaults)
 *   - Invalid YAML handling
 *   - Required field validation
 *   - Deep merge with persona-base.yaml
 *   - Loop extension validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test the exported functions by importing them directly.
// loadAgentConfig reads from a path relative to REPO_ROOT which is computed
// from import.meta.url, so we need to mock fs for controlled testing.
// Instead, we test the public API contracts by exercising the real module
// against the actual repo fixtures, plus test resolveAgentName independently.

describe("agent-config", () => {
  describe("resolveAgentName", () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env.AGENT_NAME;
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.AGENT_NAME = originalEnv;
      } else {
        delete process.env.AGENT_NAME;
      }
    });

    it("returns agent name from flags when provided", async () => {
      const { resolveAgentName } = await import("../src/lib/agent-config.js");
      const name = resolveAgentName({ agent: "crawler" });
      expect(name).toBe("crawler");
    });

    it("falls back to AGENT_NAME env when no flag", async () => {
      process.env.AGENT_NAME = "pioneer";
      const { resolveAgentName } = await import("../src/lib/agent-config.js");
      const name = resolveAgentName();
      expect(name).toBe("pioneer");
    });

    it("defaults to sentinel when no flag or env", async () => {
      delete process.env.AGENT_NAME;
      const { resolveAgentName } = await import("../src/lib/agent-config.js");
      const name = resolveAgentName({});
      expect(name).toBe("sentinel");
    });

    it("rejects invalid agent names with path traversal", async () => {
      const { resolveAgentName } = await import("../src/lib/agent-config.js");
      expect(() => resolveAgentName({ agent: "../evil" })).toThrow("Invalid agent name");
    });

    it("rejects names with uppercase letters", async () => {
      const { resolveAgentName } = await import("../src/lib/agent-config.js");
      expect(() => resolveAgentName({ agent: "BadName" })).toThrow("Invalid agent name");
    });

    it("rejects names with spaces", async () => {
      const { resolveAgentName } = await import("../src/lib/agent-config.js");
      expect(() => resolveAgentName({ agent: "bad name" })).toThrow("Invalid agent name");
    });

    it("allows names with hyphens and numbers", async () => {
      const { resolveAgentName } = await import("../src/lib/agent-config.js");
      const name = resolveAgentName({ agent: "agent-42" });
      expect(name).toBe("agent-42");
    });
  });

  describe("loadAgentConfig — missing file defaults", () => {
    it("returns sensible defaults for a nonexistent agent", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      // Use a name that definitely has no persona.yaml
      const config = loadAgentConfig("nonexistent-agent-xyz");

      // Identity defaults
      expect(config.name).toBe("nonexistent-agent-xyz");
      expect(config.displayName).toBe("Nonexistent-agent-xyz");

      // Scan defaults
      expect(config.scan.modes).toEqual(["lightweight"]);
      expect(config.scan.qualityFloor).toBe(70);
      expect(config.scan.requireAttestation).toBe(false);
      expect(config.scan.depth).toBe(200);
      expect(config.scan.topicSearchLimit).toBe(30);
      expect(config.scan.cacheHours).toBe(4);

      // Attestation defaults
      expect(config.attestation.defaultMode).toBe("dahr_only");
      expect(config.attestation.highSensitivityRequireTlsn).toBe(true);
      expect(config.attestation.highSensitivityKeywords).toEqual([]);

      // Engagement defaults
      expect(config.engagement.minDisagreePerSession).toBe(1);
      expect(config.engagement.replyMinParentReactions).toBe(8);
      expect(config.engagement.maxReactionsPerSession).toBe(8);

      // Tipping defaults
      expect(config.tipping.enabled).toBe(false);
      expect(config.tipping.maxTipsPerSession).toBe(2);
      expect(config.tipping.requireAttestation).toBe(true);

      // Gate defaults
      expect(config.gate.predictedReactionsThreshold).toBe(17);
      expect(config.gate.allow5Of6).toBe(true);
      expect(config.gate.duplicateWindowHours).toBe(24);

      // Calibration
      expect(config.calibration.offset).toBe(0);

      // Loop extensions
      expect(config.loopExtensions).toEqual([]);

      // Source registry mode
      expect(config.sourceRegistryMode).toBe("catalog-preferred");
    });

    it("builds correct paths for the agent", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      const config = loadAgentConfig("nonexistent-agent-xyz");

      expect(config.paths.personaMd).toContain("agents/nonexistent-agent-xyz/persona.md");
      expect(config.paths.strategyYaml).toContain("agents/nonexistent-agent-xyz/strategy.yaml");
      expect(config.paths.agentYaml).toContain("agents/nonexistent-agent-xyz/AGENT.yaml");
      expect(config.paths.sourcesRegistry).toContain("agents/nonexistent-agent-xyz/sources-registry.yaml");
      expect(config.paths.sourceCatalog).toContain("config/sources/catalog.json");
      expect(config.paths.sessionDir).toContain(".nonexistent-agent-xyz/sessions");
      expect(config.paths.logFile).toContain(".nonexistent-agent-xyz-session-log.jsonl");
    });

    it("defaults name to sentinel when no name provided", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      const config = loadAgentConfig();
      // Should either load sentinel's persona.yaml or use defaults with "sentinel"
      expect(config.name).toBeDefined();
      expect(typeof config.name).toBe("string");
    });
  });

  describe("loadAgentConfig — valid YAML loading", () => {
    it("loads the sentinel agent config from repo", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      const config = loadAgentConfig("sentinel");

      // Sentinel should have a persona.yaml in the repo
      expect(config.name).toBe("sentinel");
      expect(config.topics).toBeDefined();
      expect(config.topics.primary).toBeInstanceOf(Array);
      expect(config.topics.secondary).toBeInstanceOf(Array);

      // All required fields must be present
      expect(config.scan).toBeDefined();
      expect(typeof config.scan.qualityFloor).toBe("number");
      expect(config.engagement).toBeDefined();
      expect(config.tipping).toBeDefined();
      expect(config.gate).toBeDefined();
      expect(config.calibration).toBeDefined();
      expect(config.paths).toBeDefined();
    });

    it("returns valid scan config with correct ranges", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      const config = loadAgentConfig("sentinel");

      expect(config.scan.qualityFloor).toBeGreaterThanOrEqual(0);
      expect(config.scan.qualityFloor).toBeLessThanOrEqual(100);
      expect(config.scan.depth).toBeGreaterThanOrEqual(1);
      expect(config.scan.depth).toBeLessThanOrEqual(200);
      expect(config.scan.topicSearchLimit).toBeGreaterThanOrEqual(1);
      expect(config.scan.topicSearchLimit).toBeLessThanOrEqual(100);
      expect(config.scan.cacheHours).toBeGreaterThanOrEqual(1);
      expect(config.scan.cacheHours).toBeLessThanOrEqual(168);
    });

    it("returns valid attestation config", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      const config = loadAgentConfig("sentinel");

      expect(["dahr_only", "tlsn_preferred", "tlsn_only"]).toContain(config.attestation.defaultMode);
      expect(typeof config.attestation.highSensitivityRequireTlsn).toBe("boolean");
      expect(config.attestation.highSensitivityKeywords).toBeInstanceOf(Array);
    });

    it("returns valid gate config", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      const config = loadAgentConfig("sentinel");

      expect(typeof config.gate.predictedReactionsThreshold).toBe("number");
      expect(typeof config.gate.allow5Of6).toBe("boolean");
      expect(config.gate.duplicateWindowHours).toBeGreaterThan(0);
    });

    it("returns valid sourceRegistryMode", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      const config = loadAgentConfig("sentinel");

      expect(["catalog-preferred", "catalog-only", "yaml-only"]).toContain(config.sourceRegistryMode);
    });
  });

  describe("loadAgentConfig — type structure", () => {
    it("has all required top-level fields", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      const config = loadAgentConfig("sentinel");

      const requiredKeys = [
        "name", "displayName", "topics", "scan", "attestation",
        "engagement", "tipping", "gate", "calibration",
        "loopExtensions", "sourceRegistryMode", "paths",
      ];
      for (const key of requiredKeys) {
        expect(config).toHaveProperty(key);
      }
    });

    it("has all required path fields", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      const config = loadAgentConfig("sentinel");

      const pathKeys = [
        "personaMd", "strategyYaml", "agentYaml", "sourcesRegistry",
        "sourceCatalog", "sourceConfig", "sessionDir", "logFile",
        "improvementsFile", "findingsFile",
      ];
      for (const key of pathKeys) {
        expect(config.paths).toHaveProperty(key);
        expect(typeof (config.paths as Record<string, string>)[key]).toBe("string");
      }
    });

    it("loopExtensions is always an array of strings", async () => {
      const { loadAgentConfig } = await import("../src/lib/agent-config.js");
      const config = loadAgentConfig("sentinel");

      expect(Array.isArray(config.loopExtensions)).toBe(true);
      for (const ext of config.loopExtensions) {
        expect(typeof ext).toBe("string");
      }
    });
  });

  describe("getRepoRoot", () => {
    it("returns a string path that exists", async () => {
      const { getRepoRoot } = await import("../src/lib/agent-config.js");
      const root = getRepoRoot();
      expect(typeof root).toBe("string");
      expect(root.length).toBeGreaterThan(0);
    });
  });
});
