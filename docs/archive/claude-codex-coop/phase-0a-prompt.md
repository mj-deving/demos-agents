# Phase 0A: Publish Preflight — Implementation Task

## What to Build

Add a `preflight()` function that checks whether an attestable source exists for a topic BEFORE spending time on LLM generation or gate checks. This saves LLM costs and time by rejecting unattestable topics early.

## Exact Changes

### 1. Add `preflight()` to `tools/lib/attestation-policy.ts`

Add this function after the existing `resolveAttestationPlan()` function:

```typescript
export interface PreflightResult {
  pass: boolean;
  reason: string;
  reasonCode: "PASS" | "NO_MATCHING_SOURCE" | "TLSN_REQUIRED_NO_TLSN_SOURCE" | "SOURCE_PRECHECK_HTTP_ERROR";
}

/**
 * Quick check: can we attest a source for this topic?
 * Uses existing selectSourceForTopic + resolveAttestationPlan.
 * Does NOT do network calls — just checks registry availability.
 */
export function preflight(
  topic: string,
  sources: SourceRecord[],
  config: AgentConfig
): PreflightResult {
  const plan = resolveAttestationPlan(topic, config);

  const hasRequired = selectSourceForTopic(topic, sources, plan.required) !== null;
  const hasFallback = plan.fallback
    ? selectSourceForTopic(topic, sources, plan.fallback) !== null
    : false;

  if (hasRequired) {
    return { pass: true, reason: `${plan.required} source available`, reasonCode: "PASS" };
  }
  if (hasFallback) {
    return { pass: true, reason: `Fallback ${plan.fallback} source available`, reasonCode: "PASS" };
  }

  // Specific reason codes
  if (plan.required === "TLSN" && !plan.fallback) {
    return {
      pass: false,
      reason: `Topic "${topic}" requires TLSN but no TLSN-safe source found`,
      reasonCode: "TLSN_REQUIRED_NO_TLSN_SOURCE",
    };
  }

  return {
    pass: false,
    reason: `No matching ${plan.required}${plan.fallback ? `/${plan.fallback}` : ""} source for topic "${topic}"`,
    reasonCode: "NO_MATCHING_SOURCE",
  };
}
```

### 2. Wire preflight into `tools/session-runner.ts` — `runPublishAutonomous()`

In the `runPublishAutonomous()` function (around line 1381), add a preflight check BEFORE the LLM `generatePost()` call. Find the `for (const gp of gatePosts)` loop and add this at the top of the try block, BEFORE the "Step 1: Generate post text via LLM" comment:

```typescript
// Step 0: Preflight — check source availability before spending LLM time
const preflightResult = preflight(gp.topic, sources, agentConfig);
if (!preflightResult.pass) {
  // Try dynamic discovery before giving up
  const plan = resolveAttestationPlan(gp.topic, agentConfig);
  const discovered = await discoverSourceForTopic(gp.topic, plan.required);
  const discoveredFallback = !discovered && plan.fallback
    ? await discoverSourceForTopic(gp.topic, plan.fallback)
    : null;

  if (discovered) {
    persistSourceToRegistry(agentConfig.paths.sourcesRegistry, discovered.source);
    sources.push(discovered.source);
    info(`Preflight: discovered source "${discovered.source.name}" for "${gp.topic}"`);
  } else if (discoveredFallback) {
    persistSourceToRegistry(agentConfig.paths.sourcesRegistry, discoveredFallback.source);
    sources.push(discoveredFallback.source);
    info(`Preflight: discovered fallback source "${discoveredFallback.source.name}" for "${gp.topic}"`);
  } else {
    info(`Preflight SKIP: ${gp.topic} — ${preflightResult.reason} (${preflightResult.reasonCode})`);
    continue; // Skip to next topic without LLM call
  }
}
```

Also add the import at the top of session-runner.ts — update the existing import from attestation-policy.ts to include `preflight`:

```typescript
import { loadSourceRegistry, resolveAttestationPlan, selectSourceForTopic, preflight, type AttestationType } from "./lib/attestation-policy.js";
```

### 3. Wire preflight into `runGateAutonomous()` — BEFORE gate.ts subprocess

In `runGateAutonomous()` (around line 1213), the existing source-availability pre-check already does what preflight should do. Replace the inline check with a call to `preflight()`:

Find the block that starts with:
```
const plan = resolveAttestationPlan(suggestion.topic, agentConfig);
const hasRequired = selectSourceForTopic(suggestion.topic, sources, plan.required) !== null;
```

Replace that entire block (lines ~1216-1237) with:
```typescript
const preflightResult = preflight(suggestion.topic, sources, agentConfig);
if (!preflightResult.pass) {
  // Try dynamic discovery before rejecting
  const plan = resolveAttestationPlan(suggestion.topic, agentConfig);
  const discovered = await discoverSourceForTopic(suggestion.topic, plan.required);
  const discoveredFallback = !discovered && plan.fallback
    ? await discoverSourceForTopic(suggestion.topic, plan.fallback)
    : null;
  if (discovered) {
    persistSourceToRegistry(agentConfig.paths.sourcesRegistry, discovered.source);
    sources.push(discovered.source);
    info(`Gate preflight: discovered source "${discovered.source.name}" for "${suggestion.topic}" (relevance ${discovered.relevanceScore})`);
  } else if (discoveredFallback) {
    persistSourceToRegistry(agentConfig.paths.sourcesRegistry, discoveredFallback.source);
    sources.push(discoveredFallback.source);
    info(`Gate preflight: discovered fallback source "${discoveredFallback.source.name}" for "${suggestion.topic}" (relevance ${discoveredFallback.relevanceScore})`);
  } else {
    info(`Gate SKIP: ${suggestion.topic} — ${preflightResult.reason} (${preflightResult.reasonCode})`);
    continue;
  }
}
```

## Validation

After making changes, run:
```bash
npx tsx tools/session-runner.ts --help
```
This must succeed (exit 0) — confirms no import/syntax errors.

Also verify the preflight function is exported:
```bash
npx tsx -e "import { preflight } from './tools/lib/attestation-policy.js'; console.log(typeof preflight)"
```
Should print: `function`

## Important Constraints

- Do NOT modify state.ts or the PHASE_ORDER
- Do NOT change strategy.yaml format
- Do NOT add new dependencies
- Do NOT refactor existing code — only add the preflight function and wire it in
- Keep the existing dynamic discovery logic but consolidate it through preflight
