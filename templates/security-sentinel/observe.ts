/**
 * Security Sentinel — custom observe function.
 *
 * Fetches from NVD, GitHub Security Advisories, and colony intelligence
 * in parallel. Evidence is dual-placed: in the evidence array (for the
 * strategy engine) AND in apiEnrichment.signals (for enrichment rules).
 *
 * Separated from agent.ts so tests can import without pulling in SDK.
 */
import { buildColonyStateFromFeed, mapFeedPosts } from "../../src/toolkit/agent-loop.js";
import type { ObserveResult } from "../../src/toolkit/agent-loop.js";
import type { Toolkit } from "../../src/toolkit/primitives/types.js";
import type { AvailableEvidence } from "../../src/toolkit/colony/available-evidence.js";
import type { SignalData } from "../../src/toolkit/supercolony/types.js";

const FETCH_TIMEOUT_MS = 10_000;

// ── External source URLs ───────────────────────
const NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=20";
const GITHUB_ADVISORIES_URL = "https://api.github.com/advisories?type=reviewed&severity=critical,high&per_page=10";

// ── NVD CVE → AvailableEvidence ────────────────

interface NvdVulnerability {
  cve: {
    id: string;
    descriptions: Array<{ lang: string; value: string }>;
    metrics?: {
      cvssMetricV31?: Array<{ cvssData: { baseScore: number; baseSeverity: string } }>;
    };
  };
}

function nvdToEvidence(vulns: NvdVulnerability[]): AvailableEvidence[] {
  return vulns.map(v => {
    const severity = v.cve.metrics?.cvssMetricV31?.[0]?.cvssData.baseSeverity ?? "UNKNOWN";
    const desc = v.cve.descriptions.find(d => d.lang === "en")?.value ?? "";
    return {
      sourceId: `nvd-${v.cve.id}`,
      subject: "security-vulnerability",
      metrics: [severity, v.cve.id],
      richness: desc.length,
      freshness: 0,
      stale: false,
    };
  });
}

// ── GitHub Advisory → AvailableEvidence ────────

interface GhAdvisory {
  ghsa_id: string;
  summary: string;
  severity: string;
  html_url: string;
}

function ghsaToEvidence(advisories: GhAdvisory[]): AvailableEvidence[] {
  return advisories.map(a => ({
    sourceId: `ghsa-${a.ghsa_id}`,
    subject: "security-advisory",
    metrics: [a.severity, a.ghsa_id],
    richness: a.summary.length,
    freshness: 0,
    stale: false,
  }));
}

// ── Colony Signal → AvailableEvidence ──────────

function signalToEvidence(signals: SignalData[]): AvailableEvidence[] {
  return signals.map(s => ({
    sourceId: `signal-${s.topic}`,
    subject: "colony-threat-signal",
    metrics: [`consensus:${s.consensus}`, `agents:${s.agentCount}`],
    richness: s.text.length,
    freshness: 0,
    stale: false,
  }));
}

// ── External fetchers (try/catch + AbortSignal.timeout) ──

async function fetchNvd(): Promise<AvailableEvidence[]> {
  try {
    const res = await fetch(NVD_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json() as { vulnerabilities?: NvdVulnerability[] };
    return nvdToEvidence(data.vulnerabilities ?? []);
  } catch {
    return [];
  }
}

async function fetchGhsa(): Promise<AvailableEvidence[]> {
  try {
    const res = await fetch(GITHUB_ADVISORIES_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json() as GhAdvisory[];
    return ghsaToEvidence(Array.isArray(data) ? data : []);
  } catch {
    return [];
  }
}

// ── Security Observe (exported for tests) ──────

export async function securityObserve(toolkit: Toolkit, ourAddress: string): Promise<ObserveResult> {
  // Run all data sources in parallel
  const [feedResult, signalsResult, nvdResult, ghsaResult] = await Promise.all([
    toolkit.feed.getRecent({ limit: 100 }),
    toolkit.intelligence.getSignals(),
    fetchNvd(),
    fetchGhsa(),
  ]);

  // Build colony state from feed using shared mapper
  const posts = mapFeedPosts(feedResult as any);
  const colonyState = buildColonyStateFromFeed(posts, ourAddress);

  // Collect evidence from all sources
  const evidence: AvailableEvidence[] = [...nvdResult, ...ghsaResult];

  // Signals: dual-place in evidence AND apiEnrichment (null-safe)
  const signals: SignalData[] = signalsResult?.ok
    ? (Array.isArray(signalsResult.data) ? signalsResult.data : [])
    : [];
  evidence.push(...signalToEvidence(signals));

  return {
    colonyState,
    evidence,
    context: {
      apiEnrichment: {
        signals: signals.length > 0 ? signals : undefined,
      },
    },
  };
}
