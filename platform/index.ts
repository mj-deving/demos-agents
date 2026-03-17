/**
 * Platform module — SuperColony/Demos-specific implementations.
 *
 * These modules depend on the Demos SDK and SuperColony APIs.
 * They may import from core/ but never from agents/.
 */

// SDK — wallet, API calls
export { connectWallet, apiCall, loadMnemonic, info, setLogAgent, RPC_URL, SUPERCOLONY_API } from "../tools/lib/sdk.js";

// Auth — challenge-response, token cache
export { ensureAuth, loadAuthCache } from "../tools/lib/auth.js";

// Publishing pipeline — DAHR/TLSN attestation + HIVE post
export { attestDahr, attestTlsn, publishPost, attestAndPublish } from "../tools/lib/publish-pipeline.js";
export type { PublishInput, PublishResult, AttestResult } from "../tools/lib/publish-pipeline.js";

// Write rate limiting — persistent publish quotas
export { canPublish, recordPublish, loadWriteRateLedger, saveWriteRateLedger } from "../tools/lib/write-rate-limit.js";

// Spending policy — DEM caps, dry-run, signing guard
export { canSpend, recordSpend, defaultSpendingPolicy, createSigningGuard, loadSpendingLedger, saveSpendingLedger } from "../tools/lib/spending-policy.js";
export type { SpendingPolicyConfig, SpendDecision, SigningGuard } from "../tools/lib/spending-policy.js";

// Signals — consensus tracking
export { fetchSignals, scoreSignalAlignment } from "../tools/lib/signals.js";

// Predictions — calibration, registration
export { loadPredictions, savePredictions, registerPrediction, resolvePendingPredictions, getCalibrationAdjustment } from "../tools/lib/predictions.js";

// Tips — autonomous tipping
export { executeTip, selectTipCandidates, loadTipState, saveTipState } from "../tools/lib/tips.js";

// Mentions — polling
export { fetchMentions, loadMentionState, saveMentionState } from "../tools/lib/mentions.js";

// Feed filtering
export { filterPosts, combinedTopicSearch, buildTopicIndex, buildAgentIndex } from "../tools/lib/feed-filter.js";
export type { FilteredPost, QualityFilter } from "../tools/lib/feed-filter.js";

// LLM text generation (uses persona/strategy — SuperColony-specific)
export { generatePost } from "../tools/lib/llm.js";
export type { PostDraft, GeneratePostInput } from "../tools/lib/llm.js";
