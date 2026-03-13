/**
 * Sources module — runtime re-exports.
 *
 * This barrel file exports the runtime API for use by the session loop.
 * Admin operations (discover, test, updateRatings) are exported from admin.ts
 * and should never be imported by session-runner.ts.
 *
 * Phase 3 Step 3 will add: preflight, match
 */

// ── Types ──────────────────────────────────────────
export type {
  SourceRecordV2,
  SourceRecordV1,
  SourceCatalogFileV2,
  SourceIndex,
  SourceStatus,
  AgentName,
  AgentSourceConfig,
  AgentSourceView,
  SourceRegistryMode,
} from "./catalog.js";

// ── Constants ──────────────────────────────────────
export { ALL_AGENT_NAMES } from "./catalog.js";

// ── Catalog Operations ─────────────────────────────
export {
  loadCatalog,
  loadYamlRegistry,
  loadAgentSourceView,
  buildSourceIndex,
  normalizeSourceRecord,
  tokenizeTopic,
  sourceTopicTokens,
} from "./catalog.js";
