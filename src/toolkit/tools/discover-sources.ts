/**
 * discoverSources() — browse the bundled source catalog.
 *
 * Session required for withToolWrapper integration.
 * Returns sources filtered by domain, sorted by health score.
 */

import { readFile } from "node:fs/promises";

import type { DiscoverSourcesOptions, DiscoverSourcesResult, Source, SourceStatus, ToolResult } from "../types.js";
import { ok, err } from "../types.js";
import { DemosSession } from "../session.js";
import { validateInput, DiscoverSourcesOptionsSchema, CatalogEntrySchema } from "../schemas.js";
import type { CatalogEntry } from "../schemas.js";
import { safeParse } from "../guards/state-helpers.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";

// Module-level catalog cache (keyed by path — catalog is static per process)
const catalogCache = new Map<string, Source[]>();

/** Clear the catalog cache — exposed for test isolation (call in beforeEach). */
export function clearCatalogCache(): void {
  catalogCache.clear();
}

// Bundled catalog path — resolved relative to this file's location (no fragile regex)
const BUNDLED_CATALOG_PATH = new URL("../../../config/sources/catalog.json", import.meta.url).pathname;

/**
 * Discover available data sources from the bundled catalog.
 *
 * Session required for withToolWrapper integration — only sourceCatalogPath is used for logic.
 */
export async function discoverSources(
  session: DemosSession,
  opts?: DiscoverSourcesOptions,
): Promise<ToolResult<DiscoverSourcesResult>> {
  return withToolWrapper(session, "discoverSources", "INVALID_INPUT", async (start) => {
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
  const sources: Source[] = entries.map((raw: unknown) => {
    const parsed = CatalogEntrySchema.safeParse(raw);
    const entry: CatalogEntry = parsed.success ? parsed.data : (raw as CatalogEntry);
    return {
      id: entry.id ?? "",
      name: entry.name ?? entry.id ?? "",
      domain: entry.domain ?? (Array.isArray(entry.domainTags) ? entry.domainTags[0] : "unknown"),
      url: entry.url ?? "",
      status: normalizeStatus(entry.status),
      healthScore: typeof entry.healthScore === "number"
        ? entry.healthScore
        : (entry.rating?.overall ?? undefined),
    };
  });

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
