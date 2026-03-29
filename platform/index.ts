/**
 * Platform module — SuperColony/Demos-specific implementations.
 *
 * These modules depend on the Demos SDK and SuperColony APIs.
 * They may import from core/ but never from agents/.
 */

// SDK — wallet, API calls
export { connectWallet, apiCall, loadMnemonic, info, setLogAgent } from "../src/lib/network/sdk.js";

// Auth — challenge-response, token cache
export { ensureAuth, loadAuthCache } from "../src/lib/auth/auth.js";

// Publishing pipeline — DAHR/TLSN attestation + HIVE post
export { attestDahr, attestTlsn, publishPost, attestAndPublish } from "../src/actions/publish-pipeline.js";
export type { PublishInput, PublishResult, AttestResult } from "../src/actions/publish-pipeline.js";

// Write rate limiting — async, StateStore-backed
export { checkAndRecordWrite, getWriteRateRemaining } from "../src/toolkit/guards/write-rate-limit.js";

// Spending policy — DEM caps, dry-run, signing guard
export { canSpend, recordSpend, defaultSpendingPolicy, createSigningGuard, loadSpendingLedger, saveSpendingLedger } from "../src/lib/spending-policy.js";
export type { SpendingPolicyConfig, SpendDecision, SigningGuard } from "../src/lib/spending-policy.js";

// Signals — consensus tracking
export { fetchSignals, scoreSignalAlignment } from "../src/lib/pipeline/signals.js";

// Predictions — calibration, registration
export { loadPredictions, savePredictions, registerPrediction, resolvePendingPredictions, getCalibrationAdjustment } from "../src/lib/predictions.js";

// Tips — autonomous tipping
export { executeTip, selectTipCandidates, loadTipState, saveTipState } from "../src/lib/tips.js";

// Mentions — polling
export { fetchMentions, loadMentionState, saveMentionState } from "../src/lib/mentions.js";

// Feed filtering
export { filterPosts, combinedTopicSearch, buildTopicIndex, buildAgentIndex } from "../src/lib/pipeline/feed-filter.js";
export type { FilteredPost, QualityFilter } from "../src/lib/pipeline/feed-filter.js";

// LLM text generation (uses persona/strategy — SuperColony-specific)
export { generatePost } from "../src/actions/llm.js";
export type { PostDraft, GeneratePostInput } from "../src/actions/llm.js";
