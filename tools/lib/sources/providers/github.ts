/**
 * GitHub provider adapter — public API (no auth required for basic endpoints).
 *
 * Endpoints:
 *   - repo: api.github.com/repos/OWNER/REPO
 *   - search-repos: api.github.com/search/repositories?q=X
 *   - commits: api.github.com/repos/OWNER/REPO/commits
 *   - releases: api.github.com/repos/OWNER/REPO/releases
 *
 * Rate limits: 60/min (unauthenticated), 10/min for search.
 *
 * TLSN constraint: force per_page <= 3 to keep responses under 16KB.
 * DAHR: same URL is fine — all endpoints return JSON.
 */

import type { SourceRecordV2 } from "../catalog.js";
import type {
  ProviderAdapter,
  BuildCandidatesContext,
  CandidateRequest,
  CandidateValidation,
  FetchedResponse,
  ParsedAdapterResponse,
  EvidenceEntry,
} from "./types.js";

const BASE_URL = "https://api.github.com";

type GhOperation = "repo" | "search-repos" | "commits" | "releases";

const VALID_OPERATIONS: GhOperation[] = ["repo", "search-repos", "commits", "releases"];

/** Max per_page for TLSN to stay under 16KB */
const TLSN_MAX_PER_PAGE = 3;
/** Default per_page for DAHR */
const DAHR_DEFAULT_PER_PAGE = 10;

/**
 * Infer operation from source record URL or adapter config.
 */
function inferOperation(source: SourceRecordV2): GhOperation {
  const op = source.adapter?.operation;
  if (op && VALID_OPERATIONS.includes(op as GhOperation)) {
    return op as GhOperation;
  }
  const url = source.url.toLowerCase();
  if (url.includes("search/repositories")) return "search-repos";
  if (url.includes("/commits")) return "commits";
  if (url.includes("/releases")) return "releases";
  if (url.match(/\/repos\/[^/]+\/[^/]+$/)) return "repo";
  return "repo";
}

/**
 * Extract owner/repo from a GitHub API URL.
 */
function extractOwnerRepo(url: string): { owner: string; repo: string } | null {
  const match = url.match(/repos\/([^/]+)\/([^/?#]+)/i);
  if (match) return { owner: match[1], repo: match[2] };
  return null;
}

/**
 * Build the URL for a given operation.
 */
function buildUrl(
  operation: GhOperation,
  opts: { owner?: string; repo?: string; query?: string; perPage: number }
): string {
  switch (operation) {
    case "repo":
      return `${BASE_URL}/repos/${opts.owner}/${opts.repo}`;
    case "search-repos":
      return `${BASE_URL}/search/repositories?q=${encodeURIComponent(opts.query ?? "")}&per_page=${opts.perPage}&sort=stars&order=desc`;
    case "commits":
      return `${BASE_URL}/repos/${opts.owner}/${opts.repo}/commits?per_page=${opts.perPage}`;
    case "releases":
      return `${BASE_URL}/repos/${opts.owner}/${opts.repo}/releases?per_page=${opts.perPage}`;
  }
}

/**
 * Extract per_page from URL query parameters.
 */
function extractPerPage(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    const val = parsed.searchParams.get("per_page");
    if (val !== null && /^\d+$/.test(val)) return Number(val);
  } catch {
    // malformed URL
  }
  return undefined;
}

/**
 * Force per_page to max in a URL.
 */
function enforcePerPage(url: string, max: number): string {
  try {
    const parsed = new URL(url);
    const current = parsed.searchParams.get("per_page");
    if (current !== null && Number(current) > max) {
      parsed.searchParams.set("per_page", String(max));
      return parsed.toString();
    }
    if (current === null) {
      parsed.searchParams.set("per_page", String(max));
      return parsed.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export const adapter: ProviderAdapter = {
  provider: "github",
  domains: ["tech", "oss", "repos", "developer"],
  rateLimit: { bucket: "github", maxPerMinute: 60 },

  supports(source: SourceRecordV2): boolean {
    return (
      source.provider === "github" ||
      source.url.toLowerCase().includes("api.github.com")
    );
  },

  buildCandidates(ctx: BuildCandidatesContext): CandidateRequest[] {
    const operation = inferOperation(ctx.source);
    const perPage = ctx.attestation === "TLSN" ? TLSN_MAX_PER_PAGE : DAHR_DEFAULT_PER_PAGE;

    const ownerRepo = extractOwnerRepo(ctx.source.url);
    const query = ctx.vars.query || ctx.topic;

    let url: string;
    switch (operation) {
      case "repo":
        if (!ownerRepo) return [];
        url = buildUrl("repo", { owner: ownerRepo.owner, repo: ownerRepo.repo, perPage });
        break;
      case "search-repos":
        url = buildUrl("search-repos", { query, perPage });
        break;
      case "commits":
        if (!ownerRepo) return [];
        url = buildUrl("commits", { owner: ownerRepo.owner, repo: ownerRepo.repo, perPage });
        break;
      case "releases":
        if (!ownerRepo) return [];
        url = buildUrl("releases", { owner: ownerRepo.owner, repo: ownerRepo.repo, perPage });
        break;
    }

    return [
      {
        sourceId: ctx.source.id,
        provider: "github",
        operation,
        method: "GET" as const,
        url,
        attestation: ctx.attestation,
        estimatedSizeKb: operation === "repo" ? 4 : ctx.attestation === "TLSN" ? 10 : 20,
        matchHints: [
          ...(ownerRepo ? [ownerRepo.owner, ownerRepo.repo] : []),
          ...ctx.tokens.slice(0, 3),
        ],
      },
    ].slice(0, ctx.maxCandidates);
  },

  validateCandidate(candidate: CandidateRequest): CandidateValidation {
    if (candidate.attestation === "TLSN") {
      // repo endpoint has no per_page — single object, always safe
      if (candidate.operation === "repo") return { ok: true };

      const perPage = extractPerPage(candidate.url);
      if (perPage !== undefined && perPage > TLSN_MAX_PER_PAGE) {
        return {
          ok: true,
          reason: `per_page ${perPage} exceeds TLSN limit ${TLSN_MAX_PER_PAGE} — rewritten`,
          rewrittenUrl: enforcePerPage(candidate.url, TLSN_MAX_PER_PAGE),
        };
      }
      if (perPage === undefined && candidate.operation !== "repo") {
        return {
          ok: true,
          reason: `per_page not set — enforcing TLSN limit ${TLSN_MAX_PER_PAGE}`,
          rewrittenUrl: enforcePerPage(candidate.url, TLSN_MAX_PER_PAGE),
        };
      }
    }
    return { ok: true };
  },

  parseResponse(source: SourceRecordV2, response: FetchedResponse): ParsedAdapterResponse {
    if (response.status !== 200) {
      return { entries: [], normalized: null };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.bodyText);
    } catch {
      return { entries: [], normalized: null };
    }

    const operation = inferOperation(source);
    const entries: EvidenceEntry[] = [];

    switch (operation) {
      case "repo": {
        // Single repo object
        const repo = parsed as Record<string, unknown>;
        if (typeof repo === "object" && repo !== null && repo.id) {
          entries.push({
            id: String(repo.id),
            title: String(repo.full_name ?? repo.name ?? ""),
            summary: String(repo.description ?? ""),
            bodyText: String(repo.description ?? repo.full_name ?? ""),
            canonicalUrl: String(repo.html_url ?? ""),
            publishedAt: repo.created_at != null ? String(repo.created_at) : undefined,
            topics: [
              "github",
              ...(Array.isArray(repo.topics) ? repo.topics.filter((t: unknown) => typeof t === "string") : []),
              String(repo.language ?? "").toLowerCase(),
            ].filter(Boolean),
            metrics: {
              stars: typeof repo.stargazers_count === "number" ? repo.stargazers_count : 0,
              forks: typeof repo.forks_count === "number" ? repo.forks_count : 0,
              open_issues: typeof repo.open_issues_count === "number" ? repo.open_issues_count : 0,
              watchers: typeof repo.watchers_count === "number" ? repo.watchers_count : 0,
            },
            raw: repo,
          });
        }
        break;
      }

      case "search-repos": {
        // Response: { total_count, items: [...] }
        const searchResult = parsed as Record<string, unknown>;
        const items = Array.isArray(searchResult?.items) ? searchResult.items : [];
        for (const item of items) {
          if (typeof item !== "object" || item === null) continue;
          const repo = item as Record<string, unknown>;
          entries.push({
            id: String(repo.id ?? ""),
            title: String(repo.full_name ?? ""),
            summary: String(repo.description ?? ""),
            bodyText: `${repo.full_name}: ${repo.description ?? ""}`,
            canonicalUrl: String(repo.html_url ?? ""),
            publishedAt: repo.created_at != null ? String(repo.created_at) : undefined,
            topics: [
              "github",
              String(repo.language ?? "").toLowerCase(),
            ].filter(Boolean),
            metrics: {
              stars: typeof repo.stargazers_count === "number" ? repo.stargazers_count : 0,
              forks: typeof repo.forks_count === "number" ? repo.forks_count : 0,
            },
            raw: item,
          });
        }
        break;
      }

      case "commits": {
        // Response: [{ sha, commit: { message, author: { name, date } }, ... }]
        const commits = Array.isArray(parsed) ? parsed : [];
        for (const commit of commits) {
          if (typeof commit !== "object" || commit === null) continue;
          const c = commit as Record<string, unknown>;
          const commitData = (c.commit as Record<string, unknown>) ?? {};
          const author = (commitData.author as Record<string, unknown>) ?? {};
          entries.push({
            id: String(c.sha ?? "").slice(0, 12),
            title: String(commitData.message ?? "").split("\n")[0],
            bodyText: String(commitData.message ?? ""),
            canonicalUrl: String(c.html_url ?? ""),
            publishedAt: author.date != null ? String(author.date) : undefined,
            topics: ["github", "commit"],
            metrics: {
              sha: String(c.sha ?? "").slice(0, 7),
              author: String(author.name ?? ""),
            },
            raw: commit,
          });
        }
        break;
      }

      case "releases": {
        // Response: [{ id, tag_name, name, body, published_at, ... }]
        const releases = Array.isArray(parsed) ? parsed : [];
        for (const release of releases) {
          if (typeof release !== "object" || release === null) continue;
          const r = release as Record<string, unknown>;
          entries.push({
            id: String(r.id ?? ""),
            title: String(r.name || r.tag_name || ""),
            summary: String(r.body ?? "").slice(0, 500),
            bodyText: String(r.body ?? r.name ?? ""),
            canonicalUrl: String(r.html_url ?? ""),
            publishedAt: r.published_at != null ? String(r.published_at) : undefined,
            topics: ["github", "release", String(r.tag_name ?? "")],
            metrics: {
              tag: String(r.tag_name ?? ""),
              prerelease: r.prerelease === true ? 1 : 0,
              draft: r.draft === true ? 1 : 0,
            },
            raw: release,
          });
        }
        break;
      }
    }

    return { entries, normalized: parsed };
  },
};
