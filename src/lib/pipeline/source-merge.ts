/**
 * A topic suggestion compatible with session-runner's TopicSuggestion type.
 * Used by mergeAndDedup to produce a unified suggestion list.
 */
export interface TopicSuggestion {
  topic: string;
  category: string;
  reason: string;
  replyTo?: { txHash: string; author: string; text: string };
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 2),
  );
}

/**
 * Merge feed-scan and source-scan suggestions, deduplicating by topic token overlap.
 * Source suggestions appear first (attestation is free).
 *
 * Dedup logic: if two suggestions share any token (from tokenizing their topic),
 * the first one wins. Since source suggestions are placed first, they win ties.
 */
export function mergeAndDedup(
  feedSuggestions: TopicSuggestion[],
  sourceSuggestions: TopicSuggestion[],
): TopicSuggestion[] {
  const merged: TopicSuggestion[] = [];
  const seenTokens = new Set<string>();

  for (const suggestion of [...sourceSuggestions, ...feedSuggestions]) {
    const tokens = tokenize(suggestion.topic);
    let isDuplicate = false;

    for (const token of tokens) {
      if (seenTokens.has(token)) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) continue;

    for (const token of tokens) {
      seenTokens.add(token);
    }

    merged.push(suggestion);
  }

  return merged;
}
