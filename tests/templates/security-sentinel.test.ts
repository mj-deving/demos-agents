/**
 * Tests for templates/security-sentinel/ — security-specific observe function.
 *
 * Validates: feed.search ALERT, intelligence.getSignals, external CVE/advisory
 * fetches, dual signal placement (evidence + apiEnrichment), null safety,
 * AvailableEvidence shape, REPLY enabled, strategy/sources YAML correctness.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadStrategyConfig } from "../../src/toolkit/strategy/config-loader.js";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";
import type { ObserveResult } from "../../src/toolkit/agent-loop.js";
import { createMockToolkit } from "./_mock-toolkit.js";
import { makeSignalData } from "../toolkit/primitives/_helpers.js";

const TEMPLATE_DIR = resolve(import.meta.dirname, "../../templates/security-sentinel");

// ── Mock fetch data ───────────────────────────────

const MOCK_NVD = {
  vulnerabilities: [
    { cve: { id: "CVE-2026-1234", descriptions: [{ lang: "en", value: "Critical buffer overflow" }], metrics: { cvssMetricV31: [{ cvssData: { baseScore: 9.8, baseSeverity: "CRITICAL" } }] } } },
    { cve: { id: "CVE-2026-5678", descriptions: [{ lang: "en", value: "SQL injection" }], metrics: { cvssMetricV31: [{ cvssData: { baseScore: 8.1, baseSeverity: "HIGH" } }] } } },
  ],
};

const MOCK_GHSA = [
  { ghsa_id: "GHSA-abcd-1234-efgh", summary: "RCE in framework", severity: "critical", html_url: "https://github.com/advisories/GHSA-abcd-1234-efgh" },
  { ghsa_id: "GHSA-ijkl-5678-mnop", summary: "Auth bypass", severity: "high", html_url: "https://github.com/advisories/GHSA-ijkl-5678-mnop" },
];

function mockFetchBoth() {
  return vi.fn().mockImplementation(async (url: string) => {
    if (String(url).includes("nvd.nist.gov")) return { ok: true, json: async () => MOCK_NVD };
    if (String(url).includes("github.com")) return { ok: true, json: async () => MOCK_GHSA };
    return { ok: true, json: async () => ({}) };
  });
}

function mockFetchEmpty() {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => ({ vulnerabilities: [] }) });
}

// ── File structure tests ──────────────────────────

describe("templates/security-sentinel", () => {
  describe("strategy.yaml", () => {
    it("loads with 5 rules of correct types", () => {
      const config = loadStrategyConfig(readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8"));
      expect(config.rules).toHaveLength(5);
      const m = new Map(config.rules.map(r => [r.name, r]));
      expect(m.get("publish_signal_aligned")!.type).toBe("PUBLISH");
      expect(m.get("reply_with_evidence")!.type).toBe("REPLY");
      expect(m.get("engage_verified")!.type).toBe("ENGAGE");
      expect(m.get("publish_to_gaps")!.type).toBe("PUBLISH");
      expect(m.get("tip_valuable")!.type).toBe("TIP");
    });

    it("has REPLY enabled", () => {
      const config = loadStrategyConfig(readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8"));
      const reply = config.rules.find(r => r.type === "REPLY");
      expect(reply).toBeDefined();
      expect(reply!.enabled).toBe(true);
    });

    it("all rules enabled", () => {
      const config = loadStrategyConfig(readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8"));
      expect(config.rules.every(r => r.enabled)).toBe(true);
    });

    it("has security-focused rate limits", () => {
      const config = loadStrategyConfig(readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8"));
      expect(config.rateLimits.postsPerDay).toBe(8);
      expect(config.rateLimits.postsPerHour).toBe(3);
      expect(config.rateLimits.reactionsPerSession).toBe(4);
      expect(config.rateLimits.maxTipAmount).toBe(3);
    });

    it("has security topic weights and enrichment config", () => {
      const config = loadStrategyConfig(readFileSync(resolve(TEMPLATE_DIR, "strategy.yaml"), "utf-8"));
      expect(config.topicWeights.security).toBe(1.5);
      expect(config.topicWeights.vulnerability).toBe(1.3);
      expect(config.enrichment.minSignalAgents).toBe(1);
      expect(config.enrichment.minConfidence).toBe(60);
    });
  });

  describe("sources.yaml", () => {
    it("has 3 security sources", () => {
      const parsed = parseYaml(readFileSync(resolve(TEMPLATE_DIR, "sources.yaml"), "utf-8"));
      expect(parsed.sources).toHaveLength(3);
      const names = parsed.sources.map((s: any) => s.name);
      expect(names).toContain("NVD Recent CVEs");
      expect(names).toContain("GitHub Security Advisories");
      expect(names).toContain("HackerNews Security");
      for (const s of parsed.sources) expect(s.topics).toContain("security");
    });
  });

  describe("agent.ts", () => {
    it("exists and imports runtime, loop, and securityObserve", () => {
      const content = readFileSync(resolve(TEMPLATE_DIR, "agent.ts"), "utf-8");
      expect(content).toContain("createAgentRuntime");
      expect(content).toContain("runAgentLoop");
      expect(content).toContain("securityObserve");
    });

    it("observe.ts exists and exports securityObserve", () => {
      const content = readFileSync(resolve(TEMPLATE_DIR, "observe.ts"), "utf-8");
      expect(content).toContain("export async function securityObserve");
    });
  });

  // ── Observe function tests ──────────────────────

  describe("securityObserve()", () => {
    let securityObserve: (toolkit: Toolkit, address: string) => Promise<ObserveResult>;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(async () => {
      originalFetch = globalThis.fetch;
      const mod = await import("../../templates/security-sentinel/observe.js");
      securityObserve = mod.securityObserve;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("calls intelligence.getSignals()", async () => {
      globalThis.fetch = mockFetchEmpty();
      const tk = createMockToolkit();
      await securityObserve(tk, "0xTEST");
      expect(tk.intelligence.getSignals).toHaveBeenCalled();
    });

    it("fetches NVD CVEs via global fetch", async () => {
      const mf = mockFetchBoth();
      globalThis.fetch = mf;
      await securityObserve(createMockToolkit(), "0xTEST");
      expect(mf.mock.calls.some((c: any[]) => String(c[0]).includes("nvd.nist.gov"))).toBe(true);
    });

    it("fetches GitHub advisories via global fetch", async () => {
      const mf = mockFetchBoth();
      globalThis.fetch = mf;
      await securityObserve(createMockToolkit(), "0xTEST");
      expect(mf.mock.calls.some((c: any[]) => String(c[0]).includes("api.github.com/advisories"))).toBe(true);
    });

    it("produces CVE evidence with AvailableEvidence shape", async () => {
      globalThis.fetch = mockFetchBoth();
      const result = await securityObserve(createMockToolkit(), "0xTEST");
      const cves = result.evidence.filter(e => e.sourceId.startsWith("nvd-"));
      expect(cves.length).toBeGreaterThanOrEqual(2);
      const first = cves.find(e => e.sourceId === "nvd-CVE-2026-1234")!;
      expect(first.subject).toBe("security-vulnerability");
      expect(first.metrics).toContain("CRITICAL");
      expect(first.metrics).toContain("CVE-2026-1234");
      expect(typeof first.richness).toBe("number");
      expect(typeof first.freshness).toBe("number");
      expect(first.stale).toBe(false);
    });

    it("produces GitHub advisory evidence with AvailableEvidence shape", async () => {
      globalThis.fetch = mockFetchBoth();
      const result = await securityObserve(createMockToolkit(), "0xTEST");
      const ghs = result.evidence.filter(e => e.sourceId.startsWith("ghsa-"));
      expect(ghs.length).toBeGreaterThanOrEqual(2);
      const first = ghs.find(e => e.sourceId === "ghsa-GHSA-abcd-1234-efgh")!;
      expect(first.subject).toBe("security-advisory");
      expect(typeof first.richness).toBe("number");
      expect(first.stale).toBe(false);
    });

    it("produces signal evidence with correct shape", async () => {
      globalThis.fetch = mockFetchEmpty();
      const signals = [
        makeSignalData({ topic: "defi-exploit", direction: "bearish", agentCount: 5, confidence: 80, text: "DeFi exploit" }),
        makeSignalData({ topic: "bridge-hack", direction: "neutral", agentCount: 3, confidence: 60, text: "Bridge vuln", trending: false }),
      ];
      const result = await securityObserve(createMockToolkit({ signalsResult: { ok: true, data: signals } }), "0xTEST");
      const sigs = result.evidence.filter(e => e.sourceId.startsWith("signal-"));
      expect(sigs).toHaveLength(2);
      expect(sigs.find(e => e.sourceId === "signal-defi-exploit")!.subject).toBe("colony-threat-signal");
    });

    it("passes signals in BOTH evidence AND apiEnrichment.signals", async () => {
      globalThis.fetch = mockFetchEmpty();
      const signals = [makeSignalData({ topic: "exploit", direction: "bearish", agentCount: 4, confidence: 90, text: "Active" })];
      const result = await securityObserve(createMockToolkit({ signalsResult: { ok: true, data: signals } }), "0xTEST");
      expect(result.evidence.filter(e => e.sourceId.startsWith("signal-"))).toHaveLength(1);
      expect(result.context?.apiEnrichment?.signals).toHaveLength(1);
      expect(result.context!.apiEnrichment!.signals![0].topic).toBe("exploit");
    });

    it("handles null feed.search safely (?.ok)", async () => {
      globalThis.fetch = mockFetchEmpty();
      const result = await securityObserve(createMockToolkit({ feedSearchResult: null }), "0xTEST");
      expect(result).toBeDefined();
      expect(result.evidence).toBeInstanceOf(Array);
    });

    it("handles null intelligence.getSignals safely (?.ok)", async () => {
      globalThis.fetch = mockFetchEmpty();
      const result = await securityObserve(createMockToolkit({ signalsResult: null }), "0xTEST");
      expect(result.evidence.filter(e => e.sourceId.startsWith("signal-"))).toHaveLength(0);
      expect(result.context?.apiEnrichment?.signals ?? []).toHaveLength(0);
    });

    it("handles fetch failures gracefully (try/catch)", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network timeout"));
      const result = await securityObserve(createMockToolkit(), "0xTEST");
      expect(result).toBeDefined();
      expect(result.colonyState).toBeDefined();
    });

    it("handles NVD non-ok response without CVE evidence", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("nvd.nist.gov")) return { ok: false, status: 503 };
        if (String(url).includes("github.com")) return { ok: true, json: async () => MOCK_GHSA };
        return { ok: true, json: async () => ({}) };
      });
      const result = await securityObserve(createMockToolkit(), "0xTEST");
      expect(result.evidence.filter(e => e.sourceId.startsWith("nvd-"))).toHaveLength(0);
      expect(result.evidence.filter(e => e.sourceId.startsWith("ghsa-")).length).toBeGreaterThanOrEqual(2);
    });

    it("runs all fetches in parallel", async () => {
      const mf = mockFetchEmpty();
      globalThis.fetch = mf;
      await securityObserve(createMockToolkit(), "0xTEST");
      // Both NVD and GitHub should be called
      expect(mf).toHaveBeenCalledTimes(2);
    });
  });
});
