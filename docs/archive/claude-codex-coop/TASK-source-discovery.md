# Codex Review: Source Discovery (Design Review)

## Context

We have 45 active + 93 quarantined sources in the catalog. The quarantined sources were imported from agent YAML registries. There's no automated way to discover NEW sources — adding sources is manual.

Source discovery automates finding new data sources by:
1. Analyzing topics the agent posts about but has no good source for
2. Searching known APIs/platforms for relevant endpoints
3. Adding discovered sources as quarantined entries in the catalog
4. The lifecycle engine (PR8) then tests and promotes them

The crawler agent already has `source-discovery` as a declared strength and a constraint of "Max 5 new source discoveries per session."

## Design

### New file: `tools/lib/sources/discovery.ts`

**Core types:**
```typescript
interface DiscoveryCandidate {
  name: string;
  provider: string;
  url: string;
  urlPattern: string;
  topics: string[];
  domainTags: string[];
  responseFormat: "json" | "xml" | "html";
  attestation: { tlsn: boolean; dahr: boolean };
  reason: string;  // Why this source was discovered
}

interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  coverage: { topic: string; sourceCount: number }[];  // current coverage gaps
  skipped: { url: string; reason: string }[];  // duplicates, blocked domains
}
```

**Discovery strategies (ordered by implementation priority):**

1. **Coverage gap analysis**: Compare agent's topic list against existing source coverage. Identify topics with < 2 active sources.

2. **Provider expansion**: For existing providers (coingecko, hn-algolia, github, etc.), check if there are additional API operations/endpoints not yet in the catalog. E.g., CoinGecko has simple-price but not trending, markets, etc.

3. **Known API directory**: A curated list of public APIs suitable for attestation (no auth, JSON, small responses). Check which ones aren't in the catalog yet.

**Key functions:**
```typescript
// Analyze which topics lack source coverage
function analyzeCoverage(sources: SourceRecordV2[], agentTopics: string[]): CoverageGap[];

// Discover new sources from existing provider expansion
function discoverFromProviders(existingProviders: string[], gaps: CoverageGap[]): DiscoveryCandidate[];

// Discover from curated API directory
function discoverFromDirectory(gaps: CoverageGap[]): DiscoveryCandidate[];

// Deduplicate against existing catalog
function deduplicateCandidates(candidates: DiscoveryCandidate[], catalog: SourceRecordV2[]): DiscoveryCandidate[];

// Add candidates to catalog as quarantined sources
function addToCatalog(catalogPath: string, candidates: DiscoveryCandidate[]): void;
```

### New file: `tools/source-discover.ts`

CLI tool:
```bash
# Analyze coverage gaps
npx tsx tools/source-discover.ts gaps --agent sentinel --pretty

# Discover new sources
npx tsx tools/source-discover.ts find --agent sentinel --max 5 --pretty

# Add discovered sources to catalog (as quarantined)
npx tsx tools/source-discover.ts add --agent sentinel --max 5 --pretty
```

### Provider expansion registry

A data structure mapping existing providers to unexplored operations:
```typescript
const PROVIDER_EXPANSIONS: Record<string, { operation: string; url: string; topics: string[] }[]> = {
  coingecko: [
    { operation: "trending", url: "https://api.coingecko.com/api/v3/search/trending", topics: ["crypto", "trending"] },
    { operation: "markets", url: "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10", topics: ["crypto", "market-cap"] },
  ],
  "hn-algolia": [
    { operation: "show-hn", url: "https://hn.algolia.com/api/v1/search?tags=show_hn", topics: ["tech", "startups", "launches"] },
  ],
  // ... more providers
};
```

### Curated API directory

Known public APIs good for attestation:
```typescript
const API_DIRECTORY: DiscoveryCandidate[] = [
  { name: "stackexchange-hot", provider: "stackexchange", url: "https://api.stackexchange.com/2.3/questions?order=desc&sort=hot&site=stackoverflow", ... },
  { name: "reddit-tech", provider: "reddit", url: "https://www.reddit.com/r/technology/top.json?limit=10", ... },
  { name: "npm-search", provider: "npm", url: "https://registry.npmjs.org/-/v1/search?text={query}&size=5", ... },
  // ... more APIs
];
```

## Test Contracts

### discovery.test.ts

**analyzeCoverage:**
- returns gaps for topics with 0 active sources
- returns gaps for topics with 1 active source (below threshold of 2)
- returns no gaps for topics with 2+ active sources
- ignores quarantined/deprecated sources in coverage count

**discoverFromProviders:**
- returns candidates for provider operations not in catalog
- skips operations already represented in catalog
- only returns candidates matching coverage gap topics

**deduplicateCandidates:**
- removes candidates whose URL pattern matches existing catalog entries
- removes candidates whose provider+operation combo exists
- preserves unique candidates

**addToCatalog:**
- creates valid SourceRecordV2 entries with status: quarantined
- sets lifecycle.discoveredBy to "auto-discovery"
- generates correct hashed IDs
- does not duplicate existing entries
- atomic write to catalog.json

## Questions for Review

Q1: Should discovery be an extension hook (runs every session) or CLI-only (manual/scheduled)? Crawler's constraint says "Max 5 per session" which implies it could be automated.

Q2: Is the provider expansion approach better than LLM-based discovery? LLM could suggest URLs but they'd need validation. Provider expansion is deterministic and safe.

Q3: Should discovered sources be scoped to the discovering agent only, or global? If sentinel discovers a source, should crawler also use it?

Q4: How should we handle auth-required APIs? Some valuable sources need API keys. Should discovery flag them as "needs-auth" or skip entirely?

Q5: Should the curated API directory be a TypeScript const or a YAML file? YAML is easier to maintain but adds parsing. TypeScript is type-safe and inline.

## Files to Read

```bash
cat tools/lib/sources/catalog.ts | head -120
cat tools/lib/sources/lifecycle.ts
cat agents/crawler/AGENT.yaml
cat agents/sentinel/persona.yaml | head -50
cat sources/catalog.json | head -60
```

## Output Format

Write findings to `claude-codex-coop/REVIEW-source-discovery.md`. Answer Q1-Q5. Flag any missing test contracts. Do NOT modify source code.
