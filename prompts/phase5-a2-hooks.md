# Phase 5 — Step A2: Widen Hook Types for V3 Compatibility

## Task

Update `src/lib/util/extensions.ts` and 4 plugins to accept V3 session state. This is Finding 1 from the Phase 5 review — V3 hooks are typed against V2 state, plugins would silently break.

## What to Do

### 1. Update `src/lib/util/extensions.ts`

**Change BeforeSenseContext** (line 37-47): Change `state: V2SessionState` to `state: AnySessionState`:
```typescript
export interface BeforeSenseContext {
  state: AnySessionState;  // was V2SessionState
  config: AgentConfig;
  flags: BeforeSenseFlags;
  hookErrors?: Array<{ hook: string; error: string; elapsed: number; isTimeout: boolean }>;
  logger?: HookLogger;
}
```

**Change AfterConfirmContext** (line 85-94): Change `state: V2SessionState` to `state: AnySessionState`:
```typescript
export interface AfterConfirmContext {
  state: AnySessionState;  // was V2SessionState
  config: AgentConfig;
  publishedPosts: PublishedPostRecord[];
  confirmResult?: unknown;
  logger?: HookLogger;
}
```

**Change AfterActContext** (line 96-103): Change `state: V2SessionState` to `state: AnySessionState`:
```typescript
export interface AfterActContext {
  state: AnySessionState;  // was V2SessionState
  config: AgentConfig;
  actResult?: unknown;
  flags: BeforeSenseFlags;
  logger?: HookLogger;
}
```

**Add JSDoc deprecation notices** to BeforePublishDraftContext and AfterPublishDraftContext:
```typescript
/** @deprecated V3 loop does not use this hook. Retained for V2 --legacy-loop compatibility. */
export interface BeforePublishDraftContext { ... }

/** @deprecated V3 loop does not use this hook. Retained for V2 --legacy-loop compatibility. */
export interface AfterPublishDraftContext { ... }
```

Note: `AnySessionState` is already imported in extensions.ts (line 17). After Step A1 completes, it will include V3SessionState.

### 2. Update Plugin loopVersion Guards

These 4 plugins have `loopVersion === 2` guards that must be widened to `loopVersion >= 2`:

**`src/plugins/signals-plugin.ts`** (lines 35, 39):
```typescript
// Change: ctx.state.loopVersion === 2  →  "loopVersion" in ctx.state && ctx.state.loopVersion >= 2
if (signalResult.status === "fulfilled" && signalResult.value && "loopVersion" in ctx.state && ctx.state.loopVersion >= 2) {
```
Same pattern for the briefingResult check on line 39.

**`src/plugins/sc-oracle-plugin.ts`** (line 31):
```typescript
if (result.ok && "loopVersion" in ctx.state && ctx.state.loopVersion >= 2) {
```

**`src/plugins/sc-prices-plugin.ts`** (line 35):
```typescript
if (result.ok && "loopVersion" in ctx.state && ctx.state.loopVersion >= 2) {
```

**`src/plugins/tips-plugin.ts`** (line 43):
```typescript
if ("loopVersion" in ctx.state && ctx.state.loopVersion >= 2) {
```

**Important:** You can also use the `isV2` or `isV3` type guards from state.ts if they are imported, but the `"loopVersion" in ctx.state && ctx.state.loopVersion >= 2` pattern avoids needing to narrow the union type. Choose whichever approach is cleanest.

### 3. Verify Plugin Type Safety

After changing `BeforeSenseContext.state` to `AnySessionState`, the plugins that write to V2-specific fields (like `signalSnapshot`, `priceSnapshot`, `oracleSnapshot`) need the loopVersion guard to narrow the type. The `loopVersion >= 2` check combined with `"loopVersion" in ctx.state` narrows to `V2SessionState | V3SessionState`, both of which have those fields.

If TypeScript complains about property access after the guard, you may need a helper:
```typescript
function isV2OrV3(state: AnySessionState): state is V2SessionState | V3SessionState {
  return "loopVersion" in state;
}
```

## Constraints

- Do NOT delete any hooks or hook interfaces — V2 backward compatibility required
- Do NOT modify `src/lib/state.ts` (that's Step A1)
- Do NOT modify `src/plugins/sources-plugin.ts` (that's Step A3)
- `npx tsc --noEmit` must pass with zero errors
- `npm test` must pass — all existing plugin tests must still work
- The `predictions-plugin.ts` and `calibrate-plugin.ts` also have `beforeSense` hooks but grep shows they don't have `loopVersion` guards — check them too and add guards if they write to version-specific state fields
