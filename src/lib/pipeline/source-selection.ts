import type { AgentSourceView, SourceRecordV2 } from "../sources/catalog.js";
import type { ScanIntent } from "./source-intents.js";

const SCAN_ALLOWED_STATUSES = new Set(["active", "degraded"]);

/**
 * Select sources matching an intent using the source view's inverted index.
 * Matches on domain tags AND topic tokens, deduplicates, filters by status,
 * and respects maxSources.
 */
export function selectSourcesByIntent(
  intent: ScanIntent,
  sourceView: AgentSourceView,
): SourceRecordV2[] {
  const candidateIds = new Set<string>();

  for (const domain of intent.domains) {
    const ids = sourceView.index.byDomainTag.get(domain);
    if (!ids) continue;
    for (const id of ids) candidateIds.add(id);
  }

  for (const topic of intent.topics) {
    const tokens = topic.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 2);
    for (const token of tokens) {
      const ids = sourceView.index.byTopicToken.get(token);
      if (!ids) continue;
      for (const id of ids) candidateIds.add(id);
    }
  }

  const candidates: SourceRecordV2[] = [];
  for (const id of candidateIds) {
    const source = sourceView.index.byId.get(id);
    if (source && SCAN_ALLOWED_STATUSES.has(source.status)) {
      candidates.push(source);
    }
  }

  candidates.sort((a, b) => b.rating.overall - a.rating.overall);

  return candidates.slice(0, intent.maxSources ?? 10);
}
