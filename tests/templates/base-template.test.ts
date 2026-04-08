/**
 * Tests for templates/base/ — verify the base template is well-formed.
 *
 * - strategy.yaml loads successfully via loadStrategyConfig
 * - strategy.yaml has expected rules
 * - .env.example exists
 * - agent.ts exists and exports are resolvable
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadStrategyConfig } from "../../src/toolkit/strategy/config-loader.js";

const TEMPLATE_DIR = resolve(import.meta.dirname, "../../templates/base");

describe("templates/base", () => {
  describe("strategy.yaml", () => {
    it("exists", () => {
      expect(existsSync(resolve(TEMPLATE_DIR, "strategy.yaml"))).toBe(true);
    });

    it("loads via loadStrategyConfig without errors", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);
      expect(config).toBeDefined();
      expect(config.rules).toBeInstanceOf(Array);
    });

    it("has 5 Learn-first rules with engagement before publishing", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);

      expect(config.rules).toHaveLength(5);
      const ruleNames = config.rules.map(r => r.name);
      expect(ruleNames).toContain("reply_with_evidence");
      expect(ruleNames).toContain("engage_verified");
      expect(ruleNames).toContain("publish_to_gaps");
      expect(ruleNames).toContain("publish_signal_aligned");
      expect(ruleNames).toContain("tip_valuable");
    });

    it("has correct action types for each rule", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);

      const ruleMap = new Map(config.rules.map(r => [r.name, r]));
      expect(ruleMap.get("reply_with_evidence")!.type).toBe("REPLY");
      expect(ruleMap.get("engage_verified")!.type).toBe("ENGAGE");
      expect(ruleMap.get("publish_to_gaps")!.type).toBe("PUBLISH");
      expect(ruleMap.get("publish_signal_aligned")!.type).toBe("PUBLISH");
      expect(ruleMap.get("tip_valuable")!.type).toBe("TIP");
    });

    it("has all rules enabled", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);
      expect(config.rules.every(r => r.enabled)).toBe(true);
    });

    it("has rate limits configured", () => {
      const yaml = readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8");
      const config = loadStrategyConfig(yaml);
      expect(config.rateLimits.postsPerDay).toBe(8);
      expect(config.rateLimits.postsPerHour).toBe(3);
      expect(config.rateLimits.reactionsPerSession).toBe(6);
      expect(config.rateLimits.maxTipAmount).toBe(5);
    });
  });

  describe(".env.example", () => {
    it("exists", () => {
      expect(existsSync(resolve(TEMPLATE_DIR, ".env.example"))).toBe(true);
    });

    it("contains DEMOS_MNEMONIC", () => {
      const content = readFileSync(resolve(TEMPLATE_DIR, ".env.example"), "utf-8");
      expect(content).toContain("DEMOS_MNEMONIC");
    });
  });

  describe("agent.ts", () => {
    it("exists", () => {
      expect(existsSync(resolve(TEMPLATE_DIR, "agent.ts"))).toBe(true);
    });

    it("imports createAgentRuntime, runAgentLoop, and learnFirstObserve", () => {
      const content = readFileSync(resolve(TEMPLATE_DIR, "agent.ts"), "utf-8");
      expect(content).toContain("createAgentRuntime");
      expect(content).toContain("runAgentLoop");
      expect(content).toContain("learnFirstObserve");
    });

    it("has a separate observe.ts file (Learn-first pattern)", () => {
      expect(existsSync(resolve(TEMPLATE_DIR, "observe.ts"))).toBe(true);
    });

    it("defaults to dry-run for safety (real DEM on mainnet)", () => {
      const content = readFileSync(resolve(TEMPLATE_DIR, "agent.ts"), "utf-8");
      expect(content).toContain("DRY_RUN");
      expect(content).not.toMatch(/dryRun:\s*false/);
    });
  });
});
