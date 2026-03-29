#!/usr/bin/env npx tsx
/**
 * Feed Mine — Extract source URLs from SuperColony feed attestations.
 *
 * Scans feed posts for sourceAttestations, extracts unique URLs,
 * deduplicates against existing catalog, validates content, and
 * persists new sources as quarantined entries.
 *
 * Usage:
 *   npx tsx cli/feed-mine.ts --agent sentinel --pretty
 *   npx tsx cli/feed-mine.ts --agent sentinel --dry-run --limit 500
 */

import { webcrypto } from "node:crypto";
if (!globalThis.crypto) (globalThis as any).crypto = webcrypto;

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connectWallet, apiCall, info, warn, setLogAgent, getRpcUrl } from "../src/lib/network/sdk.js";
import { loadAgentConfig } from "../src/lib/agent-config.js";
import { ensureAuth } from "../src/lib/auth/auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ── Types ──────────────────────────────────────────

interface MinedSource {
  url: string;
  fromPosts: number;      // how many posts referenced this URL
  fromAgents: string[];   // which agents used it
  responseHash?: string;
}

interface FeedMineResult {
  scanned: number;
  withAttestations: number;
  uniqueUrls: number;
  newUrls: number;        // not in catalog
  added: number;          // actually persisted
  skipped: number;        // failed validation
  sources: MinedSource[];
}

// ── Flags ──────────────────────────────────────────

function parseFlags(): {
  agent: string;
  env: string;
  limit: number;
  dryRun: boolean;
  pretty: boolean;
} {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") { flags.dryRun = "true"; continue; }
    if (args[i] === "--pretty") { flags.pretty = "true"; continue; }
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return {
    agent: flags.agent ?? "sentinel",
    env: flags.env ?? ".env",
    limit: parseInt(flags.limit ?? "500", 10),
    startOffset: parseInt(flags["start-offset"] ?? "0", 10),
    dryRun: flags.dryRun === "true",
    pretty: flags.pretty === "true",
  };
}

// ── Catalog Dedup ──────────────────────────────────

function loadCatalogUrls(catalogPath: string): Set<string> {
  const urls = new Set<string>();
  if (!existsSync(catalogPath)) return urls;

  try {
    const raw = JSON.parse(readFileSync(catalogPath, "utf-8"));
    const sources = raw.sources ?? raw;
    if (Array.isArray(sources)) {
      for (const s of sources) {
        if (s.url) urls.add(normalizeUrl(s.url));
      }
    }
  } catch { /* ignore parse errors */ }
  return urls;
}

/**
 * Filter out URLs that are not reusable data sources.
 * We want APIs and feeds, not tweets, PDFs, or article pages.
 */
function isReusableSource(url: string): boolean {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();

  // ── ALLOW LIST (always keep these) ──
  // API endpoints
  if (path.includes("/api/") || path.includes("/v1/") || path.includes("/v2/") || path.includes("/v3/")) return true;
  // RSS/XML feeds
  if (path.endsWith(".xml") || path.endsWith("/rss") || path.endsWith("/feed") || path.endsWith("/feed/")
    || path.includes("/rss/") || path.includes("/feeds/") || path.includes("/feed/")) return true;
  // JSON endpoints
  if (path.endsWith(".json")) return true;
  // Known API hosts
  const apiHosts = ["api.coingecko.com", "api.binance.com", "fapi.binance.com", "api.llama.fi",
    "hn.algolia.com", "api.dexscreener.com", "api.etherscan.io", "api.npmjs.org",
    "gamma-api.polymarket.com", "api.geckoterminal.com", "api.frankfurter.dev",
    "earthquake.usgs.gov", "api.gdeltproject.org", "fred.stlouisfed.org",
    "hacker-news.firebaseio.com", "mempool.space", "ll.thespacedevs.com",
    "kauai.ccmc.gsfc.nasa.gov", "moltbook.com", "api.mainnet-beta.solana.com",
    "reference-data-directory.vercel.app", "site.api.espn.com"];
  if (apiHosts.some(h => host === h || host.endsWith("." + h))) return true;

  // ── DENY LIST (skip these) ──
  // Social media individual posts
  if (host.includes("x.com") || host.includes("twitter.com")) return false;
  if (host.includes("reddit.com")) return false;
  if (host.includes("truthsocial.com")) return false;
  if (host.includes("instagram.com")) return false;
  if (host.includes("t.me")) return false; // individual Telegram posts
  if (host.includes("threadreaderapp.com")) return false;

  // Archive/mirror sites (individual snapshots, not data sources)
  if (host.includes("archive.ph") || host.includes("archive.org") || host.includes("archive.is")
    || host.includes("archive.today") || host.includes("archive.vn")) return false;

  // Individual news articles (not feeds/APIs)
  if (host.includes("disclose.tv") && path.includes("/id/")) return false;
  if (host.includes("daily.dev") && path.includes("/posts/")) return false;

  // PDFs and documents
  if (path.endsWith(".pdf") || path.endsWith(".doc") || path.endsWith(".docx")) return false;

  // Blog/article platforms (individual posts, not feeds)
  if (host.includes("substack.com") && !path.includes("/feed")) return false;
  if (host.includes("medium.com") && !path.includes("/feed")) return false;

  // Wikipedia (reference, not live data)
  if (host.includes("wikipedia.org")) return false;

  // Individual news article heuristics: path looks like /news/YYYY/ or /article/ or /story/
  if (/\/(article|story|news\/\d{4}|opinion|analysis)\//i.test(path)) return false;

  // File hosting
  if (host.includes("catbox.moe") || host.includes("libgen")) return false;

  // If none of the above matched, allow it (may be a feed/API we don't know about)
  return true;
}

function normalizeUrl(url: string): string {
  // Remove query params that vary (like timestamps, api keys)
  try {
    const u = new URL(url);
    // Keep path, remove most query params except meaningful ones
    const keepParams = ["ids", "vs_currencies", "q", "query", "tags", "category"];
    const filtered = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      if (keepParams.includes(k)) filtered.set(k, v);
    }
    return `${u.origin}${u.pathname}${filtered.toString() ? "?" + filtered.toString() : ""}`;
  } catch {
    return url;
  }
}

// ── URL Validation ─────────────────────────────────

async function validateUrl(url: string): Promise<{ ok: boolean; sizeKb?: number; format?: string; error?: string }> {
  try {
    const response = await globalThis.fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "Accept": "application/json, text/html, application/xml" },
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const sizeKb = Math.round(text.length / 1024);

    let format: string = "unknown";
    if (contentType.includes("json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
      format = "json";
    } else if (contentType.includes("xml") || text.trim().startsWith("<?xml") || text.trim().startsWith("<rss")) {
      format = contentType.includes("rss") ? "rss" : "xml";
    } else if (contentType.includes("html")) {
      format = "html";
    }

    return { ok: true, sizeKb, format };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Source Persistence ─────────────────────────────

function persistSource(
  catalogPath: string,
  url: string,
  mined: MinedSource,
  validation: { sizeKb?: number; format?: string },
): boolean {
  try {
    const raw = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, "utf-8")) : { version: 2, sources: [] };
    const sources: any[] = raw.sources ?? raw;

    // Generate deterministic ID
    const normalized = normalizeUrl(url);
    const idHash = Buffer.from(normalized).toString("base64url").slice(0, 8);
    const provider = new URL(url).hostname.split(".").slice(-2, -1)[0] ?? "unknown";
    const id = `${provider}-${idHash}`;

    // Check dedup
    if (sources.some((s: any) => s.id === id || normalizeUrl(s.url ?? "") === normalized)) {
      return false;
    }

    const newSource = {
      id,
      name: `${provider}-mined-${idHash}`,
      provider,
      url,
      urlPattern: normalized,
      topics: [], // will be populated by lifecycle engine
      domainTags: [],
      tlsn_safe: (validation.sizeKb ?? 999) <= 16,
      dahr_safe: true,
      max_response_kb: validation.sizeKb ?? 0,
      responseFormat: validation.format ?? "json",
      scope: {
        visibility: "global" as const,
        importedFrom: mined.fromAgents,
      },
      runtime: { timeoutMs: 8000, retry: { maxAttempts: 2, backoffMs: 1000, retryOn: ["timeout", "5xx"] } },
      trustTier: "experimental" as const,
      status: "quarantined" as const,
      rating: { overall: 0, uptime: 0, relevance: 0, freshness: 0, sizeStability: 0, engagement: 0, trust: 0, testCount: 0, successCount: 0, consecutiveFailures: 0 },
      lifecycle: {
        discoveredAt: new Date().toISOString(),
        discoveredBy: "feed-mine" as const,
        statusChangedAt: new Date().toISOString(),
      },
    };

    sources.push(newSource);

    // Atomic write
    const tmpPath = catalogPath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify({ ...raw, sources }, null, 2));
    renameSync(tmpPath, catalogPath);

    return true;
  } catch (err) {
    warn(`Failed to persist source: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

// ── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  const flags = parseFlags();
  setLogAgent(flags.agent);
  const config = loadAgentConfig(flags.agent);

  info("Feed mine starting...");
  info(`Agent: ${flags.agent}, limit: ${flags.limit}, dry-run: ${flags.dryRun}`);

  // Connect + auth
  const { demos, address } = await connectWallet(flags.env, flags.agent);
  let token = await ensureAuth(demos, address);

  if (!token) {
    console.error("API unavailable — feed-mine requires API access");
    process.exit(1);
  }

  // Load feed via API (paginated — API caps at 100/request)
  info("Fetching feed...");
  const PAGE_SIZE = 100;
  const posts: any[] = [];
  let offset = flags.startOffset;

  while (posts.length < flags.limit) {
    const feedRes = await apiCall(`/api/feed?limit=${PAGE_SIZE}&offset=${offset}`, token);
    if (!feedRes.ok) {
      if (posts.length === 0) {
        console.error("Failed to fetch feed:", feedRes.data);
        process.exit(1);
      }
      warn(`Feed page at offset=${offset} failed, stopping pagination`);
      break;
    }

    const feedData = feedRes.data;
    const page: any[] = Array.isArray(feedData) ? feedData
      : Array.isArray(feedData?.posts) ? feedData.posts
      : Array.isArray(feedData?.data) ? feedData.data
      : Array.isArray(feedData?.feed) ? feedData.feed
      : [];

    if (page.length === 0) break; // no more posts
    posts.push(...page);
    offset += page.length;

    if (page.length < PAGE_SIZE) break; // last page
    if (posts.length % 1000 === 0) info(`  ...fetched ${posts.length} posts`);
  }

  info(`Feed: ${posts.length} posts loaded (${Math.ceil(posts.length / PAGE_SIZE)} pages)`);
  const scanned = Math.min(posts.length, flags.limit);
  info(`Feed: ${posts.length} posts (scanning ${scanned})`);

  // Extract sourceAttestations
  const urlMap = new Map<string, MinedSource>();
  let withAttestations = 0;

  for (let i = 0; i < scanned; i++) {
    const post = posts[i] as any;
    const attestations = post?.payload?.sourceAttestations;
    if (!Array.isArray(attestations) || attestations.length === 0) continue;

    withAttestations++;
    const author = String(post?.author || post?.address || "unknown").toLowerCase();

    for (const att of attestations) {
      const url = att?.url;
      if (!url || typeof url !== "string") continue;

      const normalized = normalizeUrl(url);
      const existing = urlMap.get(normalized);
      if (existing) {
        existing.fromPosts++;
        if (!existing.fromAgents.includes(author)) {
          existing.fromAgents.push(author);
        }
      } else {
        urlMap.set(normalized, {
          url,
          fromPosts: 1,
          fromAgents: [author],
          responseHash: att.responseHash,
        });
      }
    }
  }

  info(`Found ${withAttestations} posts with attestations, ${urlMap.size} unique URLs`);

  // Dedup against catalog
  const catalogPath = config.paths.sourceCatalog;
  const existingUrls = loadCatalogUrls(catalogPath);
  const newSources: MinedSource[] = [];

  let filteredOut = 0;
  for (const [normalized, mined] of urlMap) {
    if (existingUrls.has(normalized)) continue;
    try {
      if (!isReusableSource(mined.url)) {
        filteredOut++;
        continue;
      }
    } catch { filteredOut++; continue; }
    newSources.push(mined);
  }

  if (filteredOut > 0) info(`Filtered out ${filteredOut} non-API URLs (tweets, PDFs, articles)`);

  info(`New URLs not in catalog: ${newSources.length}`);

  // Validate and persist
  let added = 0;
  let skipped = 0;

  for (const mined of newSources) {
    info(`Validating: ${mined.url.slice(0, 80)}...`);
    const validation = await validateUrl(mined.url);

    if (!validation.ok) {
      warn(`  Skip: ${validation.error}`);
      skipped++;
      continue;
    }

    info(`  OK: ${validation.sizeKb}KB ${validation.format}`);

    if (flags.dryRun) {
      info(`  [DRY-RUN] Would add as quarantined`);
      added++;
    } else {
      const persisted = persistSource(catalogPath, mined.url, mined, validation);
      if (persisted) {
        info(`  ✅ Added to catalog as quarantined`);
        added++;
      } else {
        info(`  Skip: already in catalog (race condition)`);
        skipped++;
      }
    }
  }

  // Report
  const result: FeedMineResult = {
    scanned,
    withAttestations,
    uniqueUrls: urlMap.size,
    newUrls: newSources.length,
    added,
    skipped,
    sources: newSources,
  };

  if (flags.pretty) {
    console.log("\n═══ Feed Mine Results ════════════════════");
    console.log(`  Scanned:           ${result.scanned} posts`);
    console.log(`  With attestations: ${result.withAttestations}`);
    console.log(`  Unique URLs:       ${result.uniqueUrls}`);
    console.log(`  New (not in cat):  ${result.newUrls}`);
    console.log(`  Added:             ${result.added}${flags.dryRun ? " (dry-run)" : ""}`);
    console.log(`  Skipped:           ${result.skipped}`);
    if (newSources.length > 0) {
      console.log("\n  New Sources:");
      for (const s of newSources) {
        console.log(`    ${s.url.slice(0, 80)}`);
        console.log(`      refs: ${s.fromPosts} posts, ${s.fromAgents.length} agents`);
      }
    }
    console.log("══════════════════════════════════════════\n");
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
