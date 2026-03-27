/**
 * discoverSources() — browse the bundled source catalog.
 *
 * Read-only, no session required (optional — for custom catalog path).
 * Returns sources filtered by domain, sorted by health score.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DiscoverSourcesOptions, DiscoverSourcesResult, Source, SourceStatus, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { validateInput, DiscoverSourcesOptionsSchema } from "../schemas.js";
import { safeParse } from "../guards/state-helpers.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";

// Module-level catalog cache (keyed by path — catalog is static per process)
const catalogCache = new Map<string, Source[]>();

// Bundled catalog path (relative to project root)
const BUNDLED_CATALOG_PATH = resolve(
  fileURLToPath(import.meta.url).replace(/\/src\/toolkit\/tools\/.*$/, ""),
  "config",
  "sources",
  "catalog.json",
);

/**
 * Discover available data sources from the bundled catalog.
 */
export async function discoverSources(
  session: DemosSession,
  opts?: DiscoverSourcesOptions,
): Promise<ToolResult<DiscoverSourcesResult>> {
  return withToolWrapper(session, "discoverSources", "NETWORK_ERROR", async (start) => {
    const inputError = validateInput(DiscoverSourcesOptionsSchema, opts);
    if (inputError) {
      return err(inputError, localProvenance(start));
    }

    const catalogPath = session.sourceCatalogPath ?? BUNDLED_CATALOG_PATH;
    const sources = await loadCatalog(catalogPath);

    const filtered = opts?.domain
      ? sources.filter((s) => s.domain === opts.domain)
      : sources;

    // Exclude non-available sources
    const excludedStatuses = new Set<string>(["quarantined", "stale", "deprecated", "archived"]);
    const active = filtered.filter((s) => !excludedStatuses.has(s.status));
    const sorted = active.sort((a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0));

    return ok<DiscoverSourcesResult>(
      { sources: sorted },
      localProvenance(start),
    );
  });
}

async function loadCatalog(catalogPath: string): Promise<Source[]> {
  // Check cache first
  const cached = catalogCache.get(catalogPath);
  if (cached) return cached;

  const raw = await readFile(catalogPath, "utf-8");
  const catalog = safeParse(raw) as Record<string, unknown>;

  const entries = Array.isArray(catalog) ? catalog : (catalog.sources ?? []) as unknown[];
  const sources: Source[] = entries.map((entry: Record<string, unknown>) => ({
    id: (entry.id as string) ?? "",
    name: (entry.name as string) ?? (entry.id as string) ?? "",
    domain: (entry.domain as string) ?? (Array.isArray(entry.domainTags) ? (entry.domainTags as string[])[0] : "unknown"),
    url: (entry.url as string) ?? "",
    status: normalizeStatus(entry.status as string),
    healthScore: typeof entry.healthScore === "number"
      ? entry.healthScore
      : (entry.rating && typeof (entry.rating as Record<string, unknown>).overall === "number"
        ? (entry.rating as Record<string, number>).overall
        : undefined),
  }));

  catalogCache.set(catalogPath, sources);
  return sources;
}

const VALID_STATUSES = new Set<string>(["active", "degraded", "quarantined", "stale", "deprecated", "archived"]);

function normalizeStatus(status: string | undefined): SourceStatus {
  if (status && VALID_STATUSES.has(status)) {
    return status as SourceStatus;
  }
  return "active";
}
