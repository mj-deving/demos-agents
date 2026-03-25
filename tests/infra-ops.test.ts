/**
 * Tests for the infra-ops agent cluster.
 *
 * Covers:
 * - FrameworkPlugin interface compliance and evaluator behavior
 * - StatusMonitorSource poll, diff, and watermark extraction
 * - IncidentAlertHandler event classification
 * - Agent YAML file existence and structure
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadAgentConfig, type AgentConfig } from "../src/lib/agent-config.js";
import { makeAgentEvent } from "./fixtures/event-fixtures.js";

// ── Plugin ──
import { createInfraOpsPlugin } from "../src/plugins/infra-ops-plugin.js";
import { createPluginRegistry } from "../src/types.js";

// ── Event Source ──
import {
  createStatusMonitorSource,
  type ServiceStatus,
  type StatusSnapshot,
} from "../src/reactive/event-sources/status-monitor.js";

// ── Event Handler ──
import { createIncidentAlertHandler } from "../src/reactive/event-handlers/incident-alert-handler.js";

// ── Test Fixtures ──

function makeStatus(overrides: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    id: "svc-1",
    service: "rpc-primary",
    status: "healthy",
    timestamp: 1000,
    latencyMs: 85,
    ...overrides,
  };
}

function makeSnapshot(
  statuses: ServiceStatus[],
  timestamp = Date.now(),
): StatusSnapshot {
  return { timestamp, statuses };
}

function makeInfraEvent(type: string, payload: unknown = {}) {
  return makeAgentEvent({
    type,
    sourceId: "infra:status-monitor",
    payload,
    id: `infra:status-monitor:1000:svc-1`,
  });
}

// ════════════════════════════════════════════
// FRAMEWORK PLUGIN
// ════════════════════════════════════════════

describe("InfraOpsPlugin", () => {
  it("has name and version", () => {
    const plugin = createInfraOpsPlugin();
    expect(plugin.name).toBe("infra-ops");
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has a description", () => {
    const plugin = createInfraOpsPlugin();
    expect(typeof plugin.description).toBe("string");
    expect(plugin.description!.length).toBeGreaterThan(0);
  });

  it("has operational-relevance evaluator", () => {
    const plugin = createInfraOpsPlugin();
    expect(plugin.evaluators).toBeDefined();
    expect(plugin.evaluators).toHaveLength(1);
    expect(plugin.evaluators![0].name).toBe("operational-relevance");
  });

  it("evaluator passes infra-relevant text", async () => {
    const plugin = createInfraOpsPlugin();
    const evaluator = plugin.evaluators![0];
    const result = await evaluator.evaluate({
      text: "RPC node latency increased to 250ms, validator set experiencing consensus delays with degraded finality",
      context: {},
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.reason).toContain("infrastructure operational signals");
  });

  it("evaluator fails non-infra text", async () => {
    const plugin = createInfraOpsPlugin();
    const evaluator = plugin.evaluators![0];
    const result = await evaluator.evaluate({
      text: "The weather today is sunny with a high of 72 degrees",
      context: {},
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe(
      "No infrastructure operational signals detected",
    );
  });

  it("evaluator scores proportionally to keyword matches", async () => {
    const plugin = createInfraOpsPlugin();
    const evaluator = plugin.evaluators![0];

    // 1 keyword = 15 points (below 30 threshold)
    const oneMatch = await evaluator.evaluate({
      text: "The validator is running well",
      context: {},
    });
    expect(oneMatch.score).toBe(15);
    expect(oneMatch.pass).toBe(false);

    // 2 keywords = 30 points (at threshold)
    const twoMatch = await evaluator.evaluate({
      text: "The validator node is responding",
      context: {},
    });
    expect(twoMatch.score).toBe(30);
    expect(twoMatch.pass).toBe(true);
  });

  it("evaluator caps score at 100", async () => {
    const plugin = createInfraOpsPlugin();
    const evaluator = plugin.evaluators![0];
    const result = await evaluator.evaluate({
      text: "rpc validator node uptime latency block consensus bridge outage incident upgrade fork network throughput finality",
      context: {},
    });
    expect(result.score).toBe(100);
  });

  it("registers in PluginRegistry", () => {
    const registry = createPluginRegistry();
    const plugin = createInfraOpsPlugin();
    expect(() => registry.register(plugin)).not.toThrow();
    expect(registry.get("infra-ops")).toBeDefined();
    expect(registry.get("infra-ops")!.name).toBe("infra-ops");
  });

  it("init() can be called without error", async () => {
    const plugin = createInfraOpsPlugin();
    const mockConfig = { name: "infra-ops" } as AgentConfig;
    await expect(plugin.init!(mockConfig)).resolves.not.toThrow();
  });

  it("destroy() can be called without error", async () => {
    const plugin = createInfraOpsPlugin();
    await expect(plugin.destroy!()).resolves.not.toThrow();
  });
});

// ════════════════════════════════════════════
// STATUS MONITOR SOURCE
// ════════════════════════════════════════════

describe("StatusMonitorSource", () => {
  function makeSource(statuses: ServiceStatus[]) {
    return createStatusMonitorSource({
      fetchStatuses: vi.fn().mockResolvedValue(statuses),
    });
  }

  it("has correct id and eventTypes", () => {
    const source = makeSource([]);
    expect(source.id).toBe("infra:status-monitor");
    expect(source.eventTypes).toEqual([
      "status_change",
      "degradation",
      "outage",
      "recovery",
    ]);
  });

  it("poll returns snapshot with statuses", async () => {
    const statuses = [
      makeStatus({ id: "s1", service: "rpc-primary" }),
      makeStatus({ id: "s2", service: "rpc-backup" }),
    ];
    const source = makeSource(statuses);
    const snapshot = await source.poll();
    expect(snapshot.statuses).toHaveLength(2);
    expect(snapshot.statuses).toEqual(statuses);
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  it("diff returns empty on first poll (warm-up pattern)", () => {
    const source = makeSource([]);
    const curr = makeSnapshot([
      makeStatus({ id: "s1", status: "healthy" }),
      makeStatus({ id: "s2", status: "degraded" }),
    ]);
    const events = source.diff(null, curr);
    expect(events).toHaveLength(0);
  });

  it("diff detects status changes", () => {
    const source = makeSource([]);
    const prev = makeSnapshot([
      makeStatus({ id: "s1", service: "rpc-primary", status: "healthy" }),
    ]);
    const curr = makeSnapshot([
      makeStatus({
        id: "s1",
        service: "rpc-primary",
        status: "maintenance",
        timestamp: 2000,
      }),
    ]);
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("status_change");
    expect(events[0].sourceId).toBe("infra:status-monitor");
  });

  it("diff detects outage events", () => {
    const source = makeSource([]);
    const prev = makeSnapshot([
      makeStatus({ id: "s1", service: "rpc-primary", status: "healthy" }),
    ]);
    const curr = makeSnapshot([
      makeStatus({
        id: "s1",
        service: "rpc-primary",
        status: "down",
        timestamp: 2000,
      }),
    ]);
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("outage");
    expect(events[0].payload.status).toBe("down");
  });

  it("diff detects degradation events", () => {
    const source = makeSource([]);
    const prev = makeSnapshot([
      makeStatus({ id: "s1", service: "rpc-primary", status: "healthy" }),
    ]);
    const curr = makeSnapshot([
      makeStatus({
        id: "s1",
        service: "rpc-primary",
        status: "degraded",
        timestamp: 2000,
      }),
    ]);
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("degradation");
  });

  it("diff detects recovery events", () => {
    const source = makeSource([]);
    const prev = makeSnapshot([
      makeStatus({ id: "s1", service: "rpc-primary", status: "down" }),
    ]);
    const curr = makeSnapshot([
      makeStatus({
        id: "s1",
        service: "rpc-primary",
        status: "healthy",
        timestamp: 2000,
      }),
    ]);
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("recovery");
  });

  it("diff ignores unchanged services", () => {
    const source = makeSource([]);
    const prev = makeSnapshot([
      makeStatus({ id: "s1", service: "rpc-primary", status: "healthy" }),
      makeStatus({ id: "s2", service: "rpc-backup", status: "degraded" }),
    ]);
    const curr = makeSnapshot([
      makeStatus({ id: "s1", service: "rpc-primary", status: "healthy" }),
      makeStatus({ id: "s2", service: "rpc-backup", status: "degraded" }),
    ]);
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(0);
  });

  it("diff detects new services not in prev", () => {
    const source = makeSource([]);
    const prev = makeSnapshot([
      makeStatus({ id: "s1", service: "rpc-primary", status: "healthy" }),
    ]);
    const curr = makeSnapshot([
      makeStatus({ id: "s1", service: "rpc-primary", status: "healthy" }),
      makeStatus({
        id: "s2",
        service: "rpc-backup",
        status: "healthy",
        timestamp: 2000,
      }),
    ]);
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("status_change");
    expect(events[0].payload.service).toBe("rpc-backup");
  });

  it("extractWatermark returns null for empty snapshot", () => {
    const source = makeSource([]);
    expect(source.extractWatermark(makeSnapshot([]))).toBeNull();
  });

  it("extractWatermark returns latest status", () => {
    const source = makeSource([]);
    const snapshot = makeSnapshot([
      makeStatus({ id: "s1", timestamp: 100 }),
      makeStatus({ id: "s3", timestamp: 500 }),
      makeStatus({ id: "s2", timestamp: 300 }),
    ]);
    const wm = source.extractWatermark(snapshot) as {
      id: string;
      timestamp: number;
    };
    expect(wm.id).toBe("s3");
    expect(wm.timestamp).toBe(500);
  });
});

// ════════════════════════════════════════════
// INCIDENT ALERT HANDLER
// ════════════════════════════════════════════

describe("IncidentAlertHandler", () => {
  const handler = createIncidentAlertHandler();

  it("has correct name and eventTypes", () => {
    expect(handler.name).toBe("incident-alert");
    expect(handler.eventTypes).toEqual([
      "status_change",
      "degradation",
      "outage",
      "recovery",
    ]);
  });

  it("handles outage events with critical severity", async () => {
    const payload = makeStatus({ service: "rpc-primary", status: "down" });
    const event = makeInfraEvent("outage", payload);
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.severity).toBe("critical");
    expect(action!.params.reason).toContain("Service outage detected");
    expect(action!.params.reason).toContain("rpc-primary");
  });

  it("handles degradation events with warning severity", async () => {
    const payload = makeStatus({ service: "bridge", status: "degraded" });
    const event = makeInfraEvent("degradation", payload);
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.severity).toBe("warning");
    expect(action!.params.reason).toContain("Service degradation");
  });

  it("handles recovery events with info severity", async () => {
    const payload = makeStatus({ service: "rpc-primary", status: "healthy" });
    const event = makeInfraEvent("recovery", payload);
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.severity).toBe("info");
    expect(action!.params.reason).toContain("Service recovered");
  });

  it("handles generic status_change events with info severity", async () => {
    const payload = makeStatus({
      service: "validator",
      status: "maintenance",
    });
    const event = makeInfraEvent("status_change", payload);
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.severity).toBe("info");
    expect(action!.params.reason).toContain("Status change");
  });

  it("never returns null — all event types produce actions", async () => {
    for (const type of [
      "outage",
      "degradation",
      "recovery",
      "status_change",
    ]) {
      const action = await handler.handle(makeInfraEvent(type));
      expect(action).not.toBeNull();
    }
  });
});

// ════════════════════════════════════════════
// AGENT YAML FILES
// ════════════════════════════════════════════

describe("Infra-Ops Agent YAML", () => {
  const agentDir = resolve(
    import.meta.dirname ?? __dirname,
    "..",
    "agents",
    "infra-ops",
  );

  it("AGENT.yaml exists and has required fields", () => {
    const filePath = resolve(agentDir, "AGENT.yaml");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    const doc = parseYaml(content);

    expect(doc.apiVersion).toBe("demos-agents/v1");
    expect(doc.kind).toBe("AgentDefinition");
    expect(doc.metadata.name).toBe("infra-ops");
    expect(doc.metadata.displayName).toBeTruthy();
    expect(doc.identity.role).toBeTruthy();
    expect(doc.identity.mission).toBeTruthy();
    expect(doc.identity.tone).toBeTruthy();
    expect(doc.identity.strengths).toBeInstanceOf(Array);
    expect(doc.identity.avoids).toBeInstanceOf(Array);
    expect(doc.constraints.hardRules).toBeInstanceOf(Array);
    expect(doc.constraints.hardRules.length).toBeGreaterThanOrEqual(5);
    expect(doc.selfImprovement.predictionTracking).toBe(true);
  });

  it("persona.yaml exists and can be parsed", () => {
    const filePath = resolve(agentDir, "persona.yaml");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    const doc = parseYaml(content);

    expect(doc.apiVersion).toBe("demos-agents/v1");
    expect(doc.kind).toBe("PersonaConfig");
    expect(doc.name).toBe("infra-ops");
    expect(doc.displayName).toBe("Infra Ops");
    expect(doc.topics.primary).toBeInstanceOf(Array);
    expect(doc.topics.primary).toContain("infrastructure");
    // Infra overrides attestation keywords
    expect(doc.attestation.highSensitivityKeywords).toContain("outage");
    expect(doc.attestation.highSensitivityKeywords).toContain("downtime");
  });

  it("loadAgentConfig merges base defaults for infra-ops", () => {
    const config = loadAgentConfig("infra-ops");
    expect(config.name).toBe("infra-ops");
    expect(config.topics.primary).toContain("infrastructure");
    expect(config.topics.secondary).toContain("rpc-performance");
    expect(config.scan.qualityFloor).toBe(70);
    expect(config.scan.modes).toEqual(["lightweight", "since-last"]);
    expect(config.attestation.defaultMode).toBe("tlsn_preferred");
    expect(config.attestation.highSensitivityKeywords).toContain("outage");
    expect(config.gate.predictedReactionsThreshold).toBe(1);
    expect(config.calibration.offset).toBe(0);
    expect(config.loopExtensions).toBeInstanceOf(Array);
  });

  it("persona.md exists", () => {
    const filePath = resolve(agentDir, "persona.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("Infra Ops");
    expect(content).toContain("P0");
    expect(content).toContain("P1");
    expect(content).toContain("severity");
  });

  it("strategy.yaml extends base-loop with 4 phases", () => {
    const filePath = resolve(agentDir, "strategy.yaml");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    const doc = parseYaml(content);
    expect(doc.extends).toContain("base-loop.yaml");
    expect(doc.name).toBe("infra-ops-demo");
    expect(doc.phases).toBeInstanceOf(Array);
    expect(doc.phases).toHaveLength(4);
    const phaseIds = doc.phases.map((p: any) => p.id);
    expect(phaseIds).toEqual(["observe", "act", "verify", "learn"]);
  });

  it("sources-registry.yaml has infra example sources", () => {
    const filePath = resolve(agentDir, "sources-registry.yaml");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    const doc = parseYaml(content);
    expect(doc.version).toBe(1);
    expect(doc.sources).toBeInstanceOf(Array);
    expect(doc.sources.length).toBeGreaterThanOrEqual(2);
    const names = doc.sources.map((s: any) => s.name);
    expect(names).toContain("etherscan-gas");
  });

  it("source-config.yaml references correct agent", () => {
    const filePath = resolve(agentDir, "source-config.yaml");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    const doc = parseYaml(content);
    expect(doc.agent).toBe("infra-ops");
    expect(doc.allowStatuses).toBeInstanceOf(Array);
  });
});
