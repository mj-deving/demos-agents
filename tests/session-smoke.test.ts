/**
 * End-to-end smoke tests for session runner.
 *
 * Validates that each agent (sentinel, pioneer, crawler) can:
 * 1. Load its config from persona.yaml
 * 2. Resolve correct phase ordering
 * 3. Initialize observer and state machinery
 * 4. Start a session and progress through phases
 *
 * These tests exercise real config loading and phase orchestration paths —
 * the critical integration surface that must survive refactoring.
 */

import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

// Real imports — these are what we're smoke-testing
import { loadAgentConfig, resolveAgentName } from "../tools/lib/agent-config.js";
import {
  getPhaseOrder,
  startSession,
  loadState,
  beginPhase,
  completePhase,
  clearState,
  type AnySessionState,
} from "../tools/lib/state.js";
import { resolveLogPath } from "../tools/lib/log.js";
import { initObserver, setObserverPhase, observe } from "../tools/lib/observe.js";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const AGENTS = ["sentinel", "pioneer", "crawler"] as const;

// ── Agent Config Loading ────────────────────────────

describe("e2e smoke — agent config loading", () => {
  for (const agent of AGENTS) {
    describe(`${agent} agent`, () => {
      it("persona.yaml exists on disk", () => {
        const yamlPath = resolve(REPO_ROOT, "agents", agent, "persona.yaml");
        expect(existsSync(yamlPath)).toBe(true);
      });

      it("loadAgentConfig returns valid config", () => {
        const config = loadAgentConfig(agent);
        expect(config.name).toBe(agent);
        expect(config.displayName).toBeTruthy();
        expect(config.topics.primary).toBeInstanceOf(Array);
        expect(config.topics.secondary).toBeInstanceOf(Array);
        expect(config.scan.modes).toBeInstanceOf(Array);
        expect(config.scan.modes.length).toBeGreaterThan(0);
        expect(config.attestation.defaultMode).toMatch(/^(dahr_only|tlsn_preferred|tlsn_only)$/);
        expect(config.gate.predictedReactionsThreshold).toBeGreaterThan(0);
        expect(config.paths.personaMd).toContain(agent);
        expect(config.paths.logFile).toContain(agent);
      });

      it("has required path fields pointing to real locations", () => {
        const config = loadAgentConfig(agent);
        expect(existsSync(config.paths.personaMd)).toBe(true);
        expect(existsSync(config.paths.strategyYaml)).toBe(true);
      });

      it("source catalog path resolves to existing file", () => {
        const config = loadAgentConfig(agent);
        expect(existsSync(config.paths.sourceCatalog)).toBe(true);
      });
    });
  }
});

// ── Agent Name Resolution ───────────────────────────

describe("e2e smoke — agent name resolution", () => {
  it("defaults to sentinel with no flags", () => {
    expect(resolveAgentName({})).toBe("sentinel");
  });

  it("accepts each agent name via flag", () => {
    for (const agent of AGENTS) {
      expect(resolveAgentName({ agent })).toBe(agent);
    }
  });

  it("rejects invalid names (path traversal)", () => {
    expect(() => resolveAgentName({ agent: "../etc" })).toThrow();
    expect(() => resolveAgentName({ agent: "sentinel/../../root" })).toThrow();
  });

  it("rejects uppercase names", () => {
    expect(() => resolveAgentName({ agent: "Sentinel" })).toThrow();
  });
});

// ── Phase Ordering ──────────────────────────────────

describe("e2e smoke — phase ordering", () => {
  it("v1 returns 8 phases starting with audit", () => {
    const phases = getPhaseOrder(); // no state = v1 default
    expect(phases.length).toBe(8);
    expect(phases[0]).toBe("audit");
    expect(phases[phases.length - 1]).toBe("harden");
  });

  it("includes the critical sequence: audit → scan → engage → gate → publish", () => {
    const phases = getPhaseOrder();
    const auditIdx = phases.indexOf("audit");
    const scanIdx = phases.indexOf("scan");
    const engageIdx = phases.indexOf("engage");
    const gateIdx = phases.indexOf("gate");
    const publishIdx = phases.indexOf("publish");
    expect(auditIdx).toBeLessThan(scanIdx);
    expect(scanIdx).toBeLessThan(engageIdx);
    expect(engageIdx).toBeLessThan(gateIdx);
    expect(gateIdx).toBeLessThan(publishIdx);
  });
});

// ── Session State Machine ───────────────────────────

describe("e2e smoke — session state machine", () => {
  let tmpDir: string;

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  for (const agent of AGENTS) {
    it(`${agent}: can start session, begin/complete phases`, () => {
      tmpDir = mkdtempSync(resolve(tmpdir(), `smoke-${agent}-`));
      const sessionNum = 1;

      const state = startSession(sessionNum, agent, tmpDir);
      expect(state).toBeTruthy();
      expect(state.agentName).toBe(agent);
      expect(state.sessionNumber).toBe(sessionNum);

      // Begin and complete first phase
      beginPhase(state, "audit", tmpDir);
      const afterBegin = loadState(sessionNum, tmpDir, agent);
      expect(afterBegin).toBeTruthy();
      expect((afterBegin!.phases as any).audit.status).toBe("in_progress");

      completePhase(state, "audit", { result: "smoke-test" }, tmpDir);
      const afterComplete = loadState(sessionNum, tmpDir, agent);
      expect((afterComplete!.phases as any).audit.status).toBe("completed");

      clearState(sessionNum, tmpDir, agent);
    });
  }
});

// ── Observer Integration ────────────────────────────

describe("e2e smoke — observer initialization per agent", () => {
  for (const agent of AGENTS) {
    it(`${agent}: initObserver + observe does not throw`, () => {
      expect(() => initObserver(agent, 9999)).not.toThrow();
      expect(() => setObserverPhase("audit")).not.toThrow();
      expect(() => observe("pattern", `Smoke test for ${agent}`, {
        phase: "audit",
        source: "session-smoke.test.ts",
      })).not.toThrow();
    });
  }
});

// ── Log Path Resolution ─────────────────────────────

describe("e2e smoke — log paths per agent", () => {
  for (const agent of AGENTS) {
    it(`${agent}: resolveLogPath includes agent name`, () => {
      const logPath = resolveLogPath(undefined, agent);
      expect(logPath).toContain(agent);
      expect(logPath).toMatch(/\.jsonl$/);
    });
  }
});

// ── Pioneer-specific config ─────────────────────────

describe("e2e smoke — pioneer-specific config", () => {
  it("pioneer has gate.mode set to pioneer", () => {
    const config = loadAgentConfig("pioneer");
    expect(config.gate.mode).toBe("pioneer");
  });

  it("pioneer has noveltyCheck enabled", () => {
    const config = loadAgentConfig("pioneer");
    expect(config.gate.noveltyCheck).toBe(true);
  });
});

// ── Crawler-specific config ─────────────────────────

describe("e2e smoke — crawler-specific config", () => {
  it("crawler has deeper scan depth than sentinel", () => {
    const sentinel = loadAgentConfig("sentinel");
    const crawler = loadAgentConfig("crawler");
    expect(crawler.scan.depth).toBeGreaterThanOrEqual(sentinel.scan.depth);
  });
});
