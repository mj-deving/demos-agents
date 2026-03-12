#!/usr/bin/env npx tsx
/**
 * Standalone publish tool for lean autonomous loop.
 *
 * Responsibilities:
 * - Select attestation source from agent sources-registry.yaml
 * - Generate post text through provider-agnostic LLM adapter
 * - Enforce post quality gates (hard rejects + soft warnings)
 * - Optionally attest + publish on-chain (or dry-run)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { resolveAgentName, loadAgentConfig } from "./lib/agent-config.js";
import { resolveProvider } from "./lib/llm-provider.js";
import { generatePost, type PostDraft } from "./lib/llm.js";
import { connectWallet, apiCall, info, setLogAgent } from "./lib/sdk.js";
import { ensureAuth } from "./lib/auth.js";
import { attestDahr, publishPost, type AttestResult, type PublishResult } from "./lib/publish-pipeline.js";
import { readSessionLog, appendSessionLog, resolveLogPath, type SessionLogEntry } from "./lib/log.js";

// ── Types ──────────────────────────────────────────

interface SourceRecord {
  name: string;
  url: string;
  topics?: string[];
  dahr_safe?: boolean;
  max_response_kb?: number;
  note?: string;
}

interface SourceRegistry {
  sources?: SourceRecord[];
}

interface PublishCandidate {
  topic: string;
  category: "ANALYSIS" | "PREDICTION" | "QUESTION";
  text?: string;
  predicted_reactions?: number;
}

interface CandidateResult {
  topic: string;
  category: string;
  status: "dry-run" | "published" | "rejected" | "failed";
  warnings: string[];
  reject_reasons: string[];
  source?: { name: string; url: string };
  txHash?: string;
  attestation?: { txHash: string; responseHash: string };
  text_preview?: string;
  confidence?: number;
  predicted_reactions?: number;
  error?: string;
}

interface PublishOutput {
  timestamp: string;
  agent: string;
  dryRun: boolean;
  modelProvider: string | null;
  results: CandidateResult[];
  summary: {
    total: number;
    published: number;
    dryRun: number;
    rejected: number;
    failed: number;
  };
}

// ── Arg Parsing ────────────────────────────────────

const ASSET_MAP: Array<[RegExp, string, string]> = [
  [/\bbitcoin|\bbtc\b/, "bitcoin", "BTC"],
  [/\bethereum|\beth\b/, "ethereum", "ETH"],
  [/\bsolana|\bsol\b/, "solana", "SOL"],
  [/\bchainlink|\blink\b/, "chainlink", "LINK"],
];

function parseArgs(): { flags: Record<string, string> } {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      printHelp();
      process.exit(0);
    }
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }

  return { flags };
}

function printHelp(): void {
  console.log(`
Standalone Publish Tool

USAGE:
  npx tsx tools/publish.ts [flags]

FLAGS:
  --agent NAME         Agent name (default: sentinel)
  --topic TEXT         Single topic to publish
  --category TYPE      Category for --topic (ANALYSIS/PREDICTION/QUESTION, default ANALYSIS)
  --gated-file PATH    JSON file with gated topics/posts
  --scan-file PATH     Scan output JSON (room-temp) for context
  --scan-context PATH  Alias of --scan-file
  --text TEXT          Use provided post text verbatim (skip LLM text generation)
  --predicted-reactions N  Override predicted reactions in session log
  --env PATH           Path to .env file (default: .env)
  --log PATH           Session log path (default: ~/.{agent}-session-log.jsonl)
  --dry-run            Generate + validate only, no chain publish
  --pretty             Human-readable output
  --json               Compact JSON output
  --help, -h           Show this help

EXAMPLES:
  npx tsx tools/publish.ts --agent sentinel --topic "ETH" --dry-run
  npx tsx tools/publish.ts --agent pioneer --topic "quantum" --category QUESTION --text "..." --predicted-reactions 14
  npx tsx tools/publish.ts --agent crawler --gated-file /tmp/gated.json --scan-file /tmp/scan.json --json
`);
}

function parsePredictedOverride(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--predicted-reactions must be a non-negative integer, got "${raw}"`);
  }
  return Number(raw);
}

// ── Candidate & Source Helpers ─────────────────────

function loadCandidates(flags: Record<string, string>): PublishCandidate[] {
  const out: PublishCandidate[] = [];

  const flagCategoryRaw = String(flags["category"] || "").toUpperCase();
  const flagCategory: PublishCandidate["category"] =
    flagCategoryRaw === "PREDICTION"
      ? "PREDICTION"
      : flagCategoryRaw === "QUESTION"
        ? "QUESTION"
        : "ANALYSIS";

  if (flags["topic"]) {
    out.push({ topic: flags["topic"], category: flagCategory });
  }

  if (flags["gated-file"]) {
    const raw = JSON.parse(readFileSync(resolve(flags["gated-file"]), "utf-8"));
    const arr: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.posts)
        ? raw.posts
        : Array.isArray(raw?.gated)
          ? raw.gated
          : [];

    for (const item of arr) {
      const topic = String(item?.topic || "").trim();
      if (!topic) continue;
      const rawCategory = String(item?.category || "ANALYSIS").toUpperCase();
      const category: PublishCandidate["category"] =
        rawCategory === "PREDICTION"
          ? "PREDICTION"
          : rawCategory === "QUESTION"
            ? "QUESTION"
            : "ANALYSIS";

      const text = typeof item?.text === "string" && item.text.trim()
        ? item.text.trim()
        : undefined;

      const rawPred = item?.predicted_reactions;
      const predicted_reactions = typeof rawPred === "number" && Number.isFinite(rawPred) && rawPred >= 0
        ? Math.round(rawPred)
        : undefined;

      out.push({ topic, category, text, predicted_reactions });
    }
  }

  if (out.length === 0) {
    throw new Error("Provide --topic or --gated-file with at least one topic");
  }

  // Deduplicate by topic/category while preserving order
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.category}:${c.topic.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function loadScanContext(flags: Record<string, string>): any {
  const scanPath = flags["scan-file"] || flags["scan-context"];
  if (!scanPath) return {};
  const resolved = resolve(scanPath);
  if (!existsSync(resolved)) return {};
  return JSON.parse(readFileSync(resolved, "utf-8"));
}

function loadSourceRegistry(path: string): SourceRecord[] {
  if (!existsSync(path)) return [];
  const parsed = parseYaml(readFileSync(path, "utf-8")) as SourceRegistry;
  const sources = Array.isArray(parsed?.sources) ? parsed.sources : [];
  return sources.filter((s) => !!s?.name && !!s?.url);
}

function extractTopicVars(topic: string): Record<string, string> {
  const t = topic.toLowerCase();
  const firstWord = (t.match(/[a-z0-9-]+/)?.[0] || "topic").replace(/[^a-z0-9-]/g, "");

  let asset = firstWord;
  let symbol = "";
  for (const [rx, a, s] of ASSET_MAP) {
    if (rx.test(t)) {
      asset = a;
      symbol = s;
      break;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const query = topic;

  return {
    asset,
    symbol,
    query,
    protocol: firstWord,
    package: firstWord,
    title: firstWord,
    name: firstWord,
    date: today,
    base: "USD",
    lang: "en",
  };
}

/**
 * Fill URL template placeholders. Unfilled placeholders (no matching var)
 * are left as-is so the caller can see the source URL wasn't fully resolved.
 */

function fillUrlTemplate(url: string, vars: Record<string, string>): string {
  return url.replace(/\{([^}]+)\}/g, (match, key: string) => {
    if (key in vars) return encodeURIComponent(vars[key]);
    return match; // Leave unresolved placeholders visible
  });
}

function tokenizeTopic(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 2)
  );
}

function sourceTopicTokens(source: SourceRecord): Set<string> {
  const out = new Set<string>();
  for (const tag of source.topics || []) {
    for (const tok of String(tag).toLowerCase().split(/[^a-z0-9]+/)) {
      if (tok.length >= 2) out.add(tok);
    }
  }
  return out;
}

function unresolvedPlaceholders(url: string): string[] {
  const matches = url.match(/\{([^}]+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1));
}

function inferAssetAlias(topic: string): { asset: string; symbol: string } | null {
  const t = topic.toLowerCase();
  for (const [rx, asset, symbol] of ASSET_MAP) {
    if (rx.test(t)) return { asset, symbol };
  }
  return null;
}

function selectSource(topic: string, sources: SourceRecord[]): { source: SourceRecord; url: string } | null {
  if (sources.length === 0) return null;

  const vars = extractTopicVars(topic);
  const topicWords = tokenizeTopic(topic);
  // Add canonical asset/symbol aliases so "ETH" can match "ethereum" topic tags.
  const alias = inferAssetAlias(topic);
  if (alias) {
    topicWords.add(alias.asset.toLowerCase());
    topicWords.add(alias.symbol.toLowerCase());
  }

  const ranked = sources
    .map((source) => {
      let score = 0;
      let overlap = 0;
      const tags = sourceTopicTokens(source);
      for (const w of topicWords) {
        if (tags.has(w)) overlap++;
      }
      if (overlap > 0) {
        score += overlap * 4;
      }

      // Only apply weak name-match boosts when we already have topical overlap.
      if (overlap > 0) {
        for (const w of topicWords) {
          if (w.length >= 3 && source.name.toLowerCase().includes(w)) score += 1;
        }
      }
      if (source.dahr_safe) score += 2;
      if ((source.max_response_kb || 999) <= 16) score += 1;

      const resolvedUrl = fillUrlTemplate(source.url, vars);
      const unresolved = unresolvedPlaceholders(resolvedUrl);
      return { source, score, overlap, resolvedUrl, unresolved };
    })
    .filter((x) => x.source.dahr_safe === true)
    .filter((x) => x.overlap > 0)
    .filter((x) => x.unresolved.length === 0)
    .sort((a, b) => b.score - a.score || (a.source.max_response_kb || 999) - (b.source.max_response_kb || 999));

  const chosen = ranked[0];
  if (!chosen) return null;
  return { source: chosen.source, url: chosen.resolvedUrl };
}

// ── Quality Validation ─────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const v of a) if (b.has(v)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function maxSimilarity(text: string, entries: SessionLogEntry[]): number {
  const a = tokenize(text);
  let max = 0;
  for (const e of entries.slice(-25)) {
    const b = tokenize(String(e.text_preview || ""));
    const sim = jaccard(a, b);
    if (sim > max) max = sim;
  }
  return +max.toFixed(3);
}

function validateHard(
  draft: PostDraft,
  entries: SessionLogEntry[]
): { reasons: string[]; similarity: number } {
  const reasons: string[] = [];

  if (draft.text.length < 200) {
    reasons.push(`text ${draft.text.length} chars (<200)`);
  }

  const selfRef = /\b(i think|my analysis|i believe|i predict|i'm|our strategy)\b/i;
  if (selfRef.test(draft.text)) {
    reasons.push("self-referential phrasing detected");
  }

  const hasNumeric = /\d/.test(draft.text);
  const hasCitation = /(https?:\/\/|tx\s*[:#]?\s*[a-f0-9]{8,})/i.test(draft.text);
  if (!hasNumeric && !hasCitation) {
    reasons.push("no numeric data or citation markers");
  }

  const similarity = maxSimilarity(draft.text, entries);
  if (similarity > 0.8) {
    reasons.push(`too similar to recent post (${similarity})`);
  }

  return { reasons, similarity };
}

async function collectSoftWarnings(
  draft: PostDraft,
  topic: string,
  threshold: number,
  token: string | null,
  ourAddress: string | null
): Promise<string[]> {
  const warnings: string[] = [];

  if (draft.predicted_reactions < threshold) {
    warnings.push(`predicted reactions ${draft.predicted_reactions} below threshold ${threshold}`);
  }

  if (draft.text.length > 600) {
    warnings.push(`text ${draft.text.length} chars (>600)`);
  }

  if (token && ourAddress) {
    const res = await apiCall(`/api/feed/search?text=${encodeURIComponent(topic)}&limit=30`, token);
    if (res.ok) {
      const raw = res.data?.posts ?? res.data;
      const posts = Array.isArray(raw) ? raw : [];
      const attestedFromOthers = posts.filter((p: any) => {
        const hasAttestation =
          (p.payload?.sourceAttestations && p.payload.sourceAttestations.length > 0) ||
          (p.payload?.tlsnAttestations && p.payload.tlsnAttestations.length > 0);
        return hasAttestation && String(p.author || "").toLowerCase() !== ourAddress.toLowerCase();
      }).length;
      if (attestedFromOthers >= 3) {
        warnings.push(`topic already has ${attestedFromOthers} attested posts from other agents`);
      }
    }
  } else {
    warnings.push("topic saturation check skipped (dry-run)");
  }

  return warnings;
}

function summarizeAttestedData(data: any): string {
  try {
    const raw = typeof data === "string" ? data : JSON.stringify(data);
    return raw.slice(0, 400);
  } catch {
    return "attested data available";
  }
}

async function retry502<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const delays = [3000, 6000, 12000];

  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg = String(err?.message || err || "");
      const is502 = /\b502\b|bad gateway/i.test(msg);
      if (!is502 || i >= delays.length) {
        throw err;
      }
      const wait = delays[i];
      info(`${name} got 502; retry ${i + 1}/${delays.length} in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw new Error(`${name} failed after retries`);
}

function fallbackDraft(topic: string, category: "ANALYSIS" | "PREDICTION" | "QUESTION"): PostDraft {
  const text = `${topic}: Attested market snapshot indicates measurable signal divergence across major participants. Current observation includes at least 3 comparable data points and a confidence-backed stance. If engagement exceeds 5 reactions, this topic likely remains actionable in the next session window.`;
  return {
    text,
    category,
    tags: [topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "analysis"],
    confidence: 70,
    hypothesis: "Data-backed framing should outperform generic commentary.",
    predicted_reactions: 8,
  };
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const { flags } = parseArgs();

  const agentName = resolveAgentName(flags);
  setLogAgent(agentName);
  const config = loadAgentConfig(agentName);
  const envPath = flags["env"] || resolve(process.cwd(), ".env");
  const dryRun = flags["dry-run"] === "true";
  const pretty = flags["pretty"] === "true";
  const jsonMode = flags["json"] === "true";
  const logPath = resolveLogPath(flags["log"], agentName);
  const operatorText = flags["text"]?.trim() || undefined;
  const operatorPredicted = parsePredictedOverride(flags["predicted-reactions"]);

  const candidates = loadCandidates(flags);
  const scanContext = loadScanContext(flags);
  const sources = loadSourceRegistry(config.paths.sourcesRegistry);

  const provider = resolveProvider(envPath);
  if (!provider && !dryRun) {
    throw new Error("No LLM provider resolved. Configure LLM_PROVIDER and credentials.");
  }

  const recentEntries = readSessionLog(logPath);

  // Non-dry-run needs wallet + auth for publish + soft checks
  let demos: any = null;
  let token: string | null = null;
  let address: string | null = null;
  if (!dryRun) {
    const connected = await connectWallet(envPath);
    demos = connected.demos;
    address = connected.address;
    token = await ensureAuth(demos, address);
  }

  const results: CandidateResult[] = [];

  for (const candidate of candidates) {
    const row: CandidateResult = {
      topic: candidate.topic,
      category: candidate.category,
      status: dryRun ? "dry-run" : "failed",
      warnings: [],
      reject_reasons: [],
    };

    try {
      const selection = selectSource(candidate.topic, sources);
      if (selection) {
        row.source = { name: selection.source.name, url: selection.url };
      }

      let attested: AttestResult | undefined;
      let attestedSummary: string | undefined;

      if (!dryRun && selection) {
        attested = await retry502("DAHR attestation", () => attestDahr(demos, selection.url));
        row.attestation = { txHash: attested.txHash, responseHash: attested.responseHash };
        attestedSummary = summarizeAttestedData(attested.data);
      }

      let draft: PostDraft;
      const candidateText = candidate.text?.trim() || undefined;
      const forcedText = operatorText || candidateText;
      const forcedPredicted = operatorPredicted ?? candidate.predicted_reactions;

      if (forcedText) {
        if (forcedText.length < 200) {
          row.status = "rejected";
          row.warnings.push(`Operator text too short (${forcedText.length} chars, need ≥200)`);
          results.push(row);
          continue;
        }
        draft = fallbackDraft(candidate.topic, candidate.category);
        draft.text = forcedText;
        draft.category = candidate.category;
        if (forcedPredicted !== undefined) {
          draft.predicted_reactions = forcedPredicted;
        }
        row.warnings.push("Operator-provided text used verbatim; skipped LLM generation");
      } else if (provider) {
        draft = await generatePost(
          {
            topic: candidate.topic,
            category: candidate.category,
            calibrationOffset: config.calibration.offset,
            modelTier: "standard",
            scanContext: {
              activity_level: scanContext?.activity?.level || "unknown",
              posts_per_hour: Number(scanContext?.activity?.posts_per_hour || 0),
              hot_topic: scanContext?.heat?.topic,
              hot_reactions: scanContext?.heat?.reactions,
              gaps: scanContext?.gaps?.topics,
              meta_saturation: scanContext?.meta_saturation?.level === "HIGH",
            },
            attestedData: selection
              ? {
                  source: selection.source.name,
                  url: selection.url,
                  summary: attestedSummary || "Source selected; run without --dry-run to include live attested payload.",
                }
              : undefined,
          },
          provider,
          {
            personaMdPath: config.paths.personaMd,
            strategyYamlPath: config.paths.strategyYaml,
            agentName,
          }
        );
      } else {
        // Dry-run fallback when no provider is configured.
        draft = fallbackDraft(candidate.topic, candidate.category);
        row.warnings.push("LLM provider unavailable; used deterministic dry-run fallback draft");
      }

      if (!forcedText && forcedPredicted !== undefined) {
        draft.predicted_reactions = forcedPredicted;
        row.warnings.push("Operator-provided predicted reactions override applied");
      }

      row.text_preview = draft.text.slice(0, 140);
      row.confidence = draft.confidence;
      row.predicted_reactions = draft.predicted_reactions;

      const hard = validateHard(draft, recentEntries);
      row.reject_reasons.push(...hard.reasons);

      const softWarnings = await collectSoftWarnings(
        draft,
        candidate.topic,
        config.gate.predictedReactionsThreshold,
        token,
        address
      );
      row.warnings.push(...softWarnings);

      if (row.reject_reasons.length > 0) {
        row.status = "rejected";
        results.push(row);
        continue;
      }

      if (dryRun) {
        row.status = "dry-run";
        results.push(row);
        continue;
      }

      const publish = await retry502("HIVE publish", () =>
        publishPost(demos, {
          text: draft.text,
          category: draft.category,
          tags: draft.tags,
          confidence: draft.confidence,
          replyTo: draft.replyTo,
          sourceAttestations: attested ? [{
            url: attested.url,
            responseHash: attested.responseHash,
            txHash: attested.txHash,
            timestamp: Date.now(),
          }] : undefined,
        })
      );

      row.status = "published";
      row.txHash = publish.txHash;

      appendSessionLog(
        {
          timestamp: new Date().toISOString(),
          txHash: publish.txHash,
          category: draft.category,
          attestation_type: attested ? "DAHR" : "none",
          attestation_url: attested?.url,
          hypothesis: draft.hypothesis || "",
          predicted_reactions: draft.predicted_reactions,
          agents_referenced: [],
          topic: candidate.topic,
          confidence: draft.confidence,
          text_preview: draft.text.slice(0, 100),
          tags: draft.tags,
          agent: agentName,
        },
        logPath
      );

      results.push(row);
    } catch (err: any) {
      row.status = "failed";
      row.error = err.message;
      results.push(row);
    }
  }

  const output: PublishOutput = {
    timestamp: new Date().toISOString(),
    agent: agentName,
    dryRun,
    modelProvider: provider?.name || null,
    results,
    summary: {
      total: results.length,
      published: results.filter((r) => r.status === "published").length,
      dryRun: results.filter((r) => r.status === "dry-run").length,
      rejected: results.filter((r) => r.status === "rejected").length,
      failed: results.filter((r) => r.status === "failed").length,
    },
  };

  if (pretty) {
    console.log("\n" + "═".repeat(72));
    console.log(`  ${agentName.toUpperCase()} PUBLISH ${dryRun ? "(dry-run)" : ""}`);
    console.log("═".repeat(72));
    for (const r of output.results) {
      console.log(`  - ${r.topic} [${r.status}] ${r.txHash ? `tx=${r.txHash.slice(0, 16)}...` : ""}`);
      if (r.reject_reasons.length > 0) console.log(`    rejects: ${r.reject_reasons.join(" | ")}`);
      if (r.warnings.length > 0) console.log(`    warns: ${r.warnings.join(" | ")}`);
      if (r.error) console.log(`    error: ${r.error}`);
    }
    console.log(`\n  Summary: ${output.summary.published} published, ${output.summary.dryRun} dry-run, ${output.summary.rejected} rejected, ${output.summary.failed} failed`);
    console.log("═".repeat(72));
  } else if (jsonMode) {
    console.log(JSON.stringify(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }

  if (!dryRun && output.summary.published === 0 && output.summary.total > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[publish] ERROR: ${err.message}`);
  process.exit(1);
});
