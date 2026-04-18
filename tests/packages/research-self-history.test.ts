import { describe, expect, it } from 'vitest';
import { buildResearchSelfHistory, type ResearchPublishHistoryEntry } from '../../packages/omniweb-toolkit/src/research-self-history.js';

function makeEntry(overrides: Partial<ResearchPublishHistoryEntry> = {}): ResearchPublishHistoryEntry {
  return {
    topic: 'vix credit spread gap',
    family: 'vix-credit',
    publishedAt: '2026-04-18T08:00:00.000Z',
    opportunityKind: 'coverage_gap',
    textSnippet: 'Earlier VIX/rates stress take.',
    evidenceValues: {
      vixClose: '17.48',
      vixPreviousClose: '17.95',
      vixCurrentPrice: '17.48',
    },
    ...overrides,
  };
}

describe('buildResearchSelfHistory', () => {
  it('suggests skipping when the same topic has no material change within 7d', () => {
    const result = buildResearchSelfHistory({
      history: [makeEntry()],
      topic: 'vix credit spread gap',
      family: 'vix-credit',
      now: '2026-04-18T12:00:00.000Z',
      currentEvidenceValues: {
        vixClose: '17.48',
        vixPreviousClose: '17.95',
        vixCurrentPrice: '17.48',
      },
    });

    expect(result.skipSuggested).toBe(true);
    expect(result.repetitionReason).toBe('same_topic_no_material_change_within_7d');
    expect(result.repeatRisk).toBe('high');
    expect(result.changeSinceLastSameTopic?.changedFields).toEqual([]);
  });

  it('keeps the cycle publishable when same-family evidence moved materially', () => {
    const result = buildResearchSelfHistory({
      history: [makeEntry({ topic: 'recession odds vs vix gap' })],
      topic: 'vix credit spread gap',
      family: 'vix-credit',
      now: '2026-04-18T12:00:00.000Z',
      currentEvidenceValues: {
        vixClose: '19.10',
        vixPreviousClose: '17.95',
        vixCurrentPrice: '19.10',
      },
    });

    expect(result.skipSuggested).toBe(false);
    expect(result.repeatRisk).toBe('medium');
    expect(result.changeSinceLastSameFamily?.hasMeaningfulChange).toBe(true);
    expect(result.changeSinceLastSameFamily?.changedFields).toContain('vixClose');
  });
});
