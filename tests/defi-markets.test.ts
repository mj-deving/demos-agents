/**
 * Tests for DeFi Markets agent cluster.
 *
 * Covers:
 * - FrameworkPlugin interface compliance and evaluator behavior
 * - ProtocolEventSource poll, diff, extractWatermark
 * - MarketAlertHandler for all event types
 * - Agent YAML file existence and parsing
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "yaml";
import { createPluginRegistry } from "../core/types.js";
import { makeAgentEvent } from "./fixtures/event-fixtures.js";
import { loadAgentConfig, type AgentConfig } from "../tools/lib/agent-config.js";
import { createDefiMarketsPlugin } from "../core/plugins/defi-markets-plugin.js";
import {
  createProtocolEventSource,
  type ProtocolEvent,
  type ProtocolEventSnapshot,
} from "../tools/lib/event-sources/protocol-events.js";
import { createMarketAlertHandler } from "../tools/lib/event-handlers/market-alert-handler.js";

// ── Test Fixtures ──

function makeProtocolEvent(overrides: Partial<ProtocolEvent> = {}): ProtocolEvent {
  return {
    id: "evt-1",
    protocol: "aave-v3",
    type: "tvl_change",
    timestamp: 1000,
    data: { tvlDelta: -120_000_000, newTvl: 1_280_000_000 },
    ...overrides,
  };
}

function makeDefiEvent(overrides: Partial<{ type: string; payload: ProtocolEvent }> = {}) {
  const payload = overrides.payload ?? makeProtocolEvent();
  return makeAgentEvent({
    type: overrides.type ?? payload.type,
    sourceId: "defi:protocol-events",
    payload,
    id: `defi:protocol-events:${payload.timestamp}:${payload.id}`,
    watermark: { id: payload.id, timestamp: payload.timestamp },
  });
}

// ════════════════════════════════════════════
// DEFI MARKETS FRAMEWORK PLUGIN
// ════════════════════════════════════════════

describe("DefiMarketsPlugin", () => {
  it("has correct name and version", () => {
    const plugin = createDefiMarketsPlugin();
    expect(plugin.name).toBe("defi-markets");
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has a market-relevance evaluator", () => {
    const plugin = createDefiMarketsPlugin();
    expect(plugin.evaluators).toBeDefined();
    expect(plugin.evaluators).toHaveLength(1);
    expect(plugin.evaluators![0].name).toBe("market-relevance");
  });

  it("evaluator passes DeFi-relevant text", async () => {
    const plugin = createDefiMarketsPlugin();
    const evaluator = plugin.evaluators![0];
    const result = await evaluator.evaluate({
      text: "Aave v3 TVL dropped 8.2% while lending APY on USDC yield pool increased to 4.2%",
      context: {},
    });
    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.reason).toContain("DeFi signals");
  });

  it("evaluator fails non-DeFi text", async () => {
    const plugin = createDefiMarketsPlugin();
    const evaluator = plugin.evaluators![0];
    const result = await evaluator.evaluate({
      text: "The weather in San Francisco is nice today with clear skies",
      context: {},
    });
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0);
    expect(result.reason).toBe("No DeFi signals detected");
  });

  it("evaluator score caps at 100", async () => {
    const plugin = createDefiMarketsPlugin();
    const evaluator = plugin.evaluators![0];
    const result = await evaluator.evaluate({
      text: "tvl apy yield liquidity protocol defi amm lending borrowing swap pool vault stake",
      context: {},
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("registers in PluginRegistry", () => {
    const registry = createPluginRegistry();
    const plugin = createDefiMarketsPlugin();
    registry.register(plugin);
    expect(registry.get("defi-markets")).toBeDefined();
    expect(registry.get("defi-markets")!.name).toBe("defi-markets");
    expect(registry.getEvaluators()).toHaveLength(1);
  });

  it("init and destroy can be called", async () => {
    const plugin = createDefiMarketsPlugin();
    await expect(plugin.init!({ name: "test" } as AgentConfig)).resolves.not.toThrow();
    await expect(plugin.destroy!()).resolves.not.toThrow();
  });
});

// ════════════════════════════════════════════
// PROTOCOL EVENT SOURCE
// ════════════════════════════════════════════

describe("ProtocolEventSource", () => {
  function makeSource(events: ProtocolEvent[]) {
    return createProtocolEventSource({
      fetchEvents: vi.fn().mockResolvedValue(events),
    });
  }

  it("has correct id and eventTypes", () => {
    const source = makeSource([]);
    expect(source.id).toBe("defi:protocol-events");
    expect(source.eventTypes).toEqual(["tvl_change", "rate_change", "governance", "exploit"]);
  });

  it("poll returns snapshot with events", async () => {
    const events = [
      makeProtocolEvent({ id: "e1" }),
      makeProtocolEvent({ id: "e2", type: "rate_change" }),
    ];
    const source = makeSource(events);
    const snapshot = await source.poll();
    expect(snapshot.events).toHaveLength(2);
    expect(snapshot.events).toEqual(events);
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  it("poll returns empty snapshot when no events", async () => {
    const source = makeSource([]);
    const snapshot = await source.poll();
    expect(snapshot.events).toHaveLength(0);
  });

  it("diff returns empty on first poll (warm-up pattern)", () => {
    const source = makeSource([]);
    const curr: ProtocolEventSnapshot = {
      timestamp: 1000,
      events: [
        makeProtocolEvent({ id: "e1" }),
        makeProtocolEvent({ id: "e2", type: "exploit" }),
      ],
    };
    const events = source.diff(null, curr);
    expect(events).toHaveLength(0);
  });

  it("diff ignores already-seen events", () => {
    const source = makeSource([]);
    const prev: ProtocolEventSnapshot = {
      timestamp: 1000,
      events: [makeProtocolEvent({ id: "e1" })],
    };
    const curr: ProtocolEventSnapshot = {
      timestamp: 2000,
      events: [
        makeProtocolEvent({ id: "e1" }),
        makeProtocolEvent({ id: "e2", type: "governance" }),
      ],
    };
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].payload.id).toBe("e2");
  });

  it("diff returns empty for no changes", () => {
    const source = makeSource([]);
    const prev: ProtocolEventSnapshot = {
      timestamp: 1000,
      events: [makeProtocolEvent({ id: "e1" })],
    };
    const curr: ProtocolEventSnapshot = {
      timestamp: 2000,
      events: [makeProtocolEvent({ id: "e1" })],
    };
    const events = source.diff(prev, curr);
    expect(events).toHaveLength(0);
  });

  it("extractWatermark returns null for empty snapshot", () => {
    const source = makeSource([]);
    expect(source.extractWatermark({ timestamp: 0, events: [] })).toBeNull();
  });

  it("extractWatermark returns latest event", () => {
    const source = makeSource([]);
    const snapshot: ProtocolEventSnapshot = {
      timestamp: 5000,
      events: [
        makeProtocolEvent({ id: "e1", timestamp: 100 }),
        makeProtocolEvent({ id: "e3", timestamp: 500 }),
        makeProtocolEvent({ id: "e2", timestamp: 300 }),
      ],
    };
    const wm = source.extractWatermark(snapshot) as { id: string; timestamp: number };
    expect(wm.id).toBe("e3");
    expect(wm.timestamp).toBe(500);
  });
});

// ════════════════════════════════════════════
// MARKET ALERT HANDLER
// ════════════════════════════════════════════

describe("MarketAlertHandler", () => {
  const handler = createMarketAlertHandler();

  it("has correct name and eventTypes", () => {
    expect(handler.name).toBe("market-alert");
    expect(handler.eventTypes).toEqual(["tvl_change", "rate_change", "governance", "exploit"]);
  });

  it("handles exploit events with critical severity", async () => {
    const event = makeDefiEvent({
      type: "exploit",
      payload: makeProtocolEvent({
        id: "exploit-1",
        type: "exploit",
        protocol: "curve-3pool",
        data: { lossUsd: 50_000_000 },
      }),
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.severity).toBe("critical");
    expect(action!.params.reason).toContain("exploit");
    expect(action!.params.protocol).toBe("curve-3pool");
  });

  it("handles governance events with info severity", async () => {
    const event = makeDefiEvent({
      type: "governance",
      payload: makeProtocolEvent({
        id: "gov-1",
        type: "governance",
        protocol: "compound-v3",
        data: { proposalId: "42", title: "Adjust collateral factors" },
      }),
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.severity).toBe("info");
    expect(action!.params.reason).toContain("Governance");
    expect(action!.params.protocol).toBe("compound-v3");
  });

  it("handles tvl_change events with info severity", async () => {
    const event = makeDefiEvent({
      type: "tvl_change",
      payload: makeProtocolEvent({
        id: "tvl-1",
        type: "tvl_change",
        protocol: "aave-v3",
        data: { tvlDelta: -120_000_000 },
      }),
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.severity).toBe("info");
    expect(action!.params.reason).toContain("tvl_change");
    expect(action!.params.protocol).toBe("aave-v3");
  });

  it("handles rate_change events with info severity", async () => {
    const event = makeDefiEvent({
      type: "rate_change",
      payload: makeProtocolEvent({
        id: "rate-1",
        type: "rate_change",
        protocol: "morpho",
        data: { asset: "USDC", oldRate: 3.8, newRate: 4.5 },
      }),
    });
    const action = await handler.handle(event);
    expect(action).not.toBeNull();
    expect(action!.type).toBe("log_only");
    expect(action!.params.severity).toBe("info");
    expect(action!.params.reason).toContain("rate_change");
  });

  it("only handles its declared event types", () => {
    expect(handler.eventTypes).toContain("tvl_change");
    expect(handler.eventTypes).toContain("rate_change");
    expect(handler.eventTypes).toContain("governance");
    expect(handler.eventTypes).toContain("exploit");
    expect(handler.eventTypes).not.toContain("reply");
    expect(handler.eventTypes).not.toContain("ask_mention");
  });

  it("preserves protocol data in action params", async () => {
    const data = { tvlDelta: -50_000_000, newTvl: 800_000_000 };
    const event = makeDefiEvent({
      type: "tvl_change",
      payload: makeProtocolEvent({ data }),
    });
    const action = await handler.handle(event);
    expect(action!.params.data).toEqual(data);
  });
});

// ════════════════════════════════════════════
// AGENT YAML FILES
// ════════════════════════════════════════════

describe("DeFi Markets agent YAML files", () => {
  const agentDir = path.resolve(__dirname, "../agents/defi-markets");

  it("AGENT.yaml exists and has required fields", () => {
    const filePath = path.join(agentDir, "AGENT.yaml");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    const doc = yaml.parse(content);
    expect(doc.apiVersion).toBe("demos-agents/v1");
    expect(doc.kind).toBe("AgentDefinition");
    expect(doc.metadata.name).toBe("defi-markets");
    expect(doc.identity.role).toBeDefined();
    expect(doc.identity.mission).toBeDefined();
    expect(doc.identity.tone).toBeDefined();
    expect(doc.identity.strengths).toBeInstanceOf(Array);
    expect(doc.identity.avoids).toBeInstanceOf(Array);
    expect(doc.constraints.hardRules).toBeInstanceOf(Array);
    expect(doc.selfImprovement.predictionTracking).toBe(true);
  });

  it("persona.yaml can be parsed and has PersonaConfig structure", () => {
    const filePath = path.join(agentDir, "persona.yaml");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    const doc = yaml.parse(content);
    expect(doc.apiVersion).toBe("demos-agents/v1");
    expect(doc.kind).toBe("PersonaConfig");
    expect(doc.name).toBe("defi-markets");
    expect(doc.topics.primary).toBeInstanceOf(Array);
    expect(doc.topics.primary).toContain("defi");
  });

  it("loadAgentConfig merges base defaults for defi-markets", () => {
    const config = loadAgentConfig("defi-markets");
    expect(config.name).toBe("defi-markets");
    expect(config.topics.primary).toContain("defi");
    expect(config.scan.qualityFloor).toBe(70);
    expect(config.attestation.defaultMode).toBe("dahr_only");
    expect(config.gate.predictedReactionsThreshold).toBe(10);
    expect(config.calibration.offset).toBe(0);
    expect(config.loopExtensions).toBeInstanceOf(Array);
  });

  it("persona.md exists", () => {
    const filePath = path.join(agentDir, "persona.md");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("DeFi Markets");
    expect(content).toContain("quantitative");
  });
});
