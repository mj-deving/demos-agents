# Plan: ElizaOS Adapters + src/lib Reorganization + Housekeeping

## Context

After the repo restructure (`src/`, `cli/`, `config/`), four items remain. Codex review applied — key changes: subsystem-based moves instead of role-based, corrected adapter bridge sketches, decoupled Item 5 from Item 6, expanded migration checklist.

---

## Item 7: Update MEMORY.md (5 min, zero risk)

Replace stale paths in `~/.claude/projects/-home-mj-projects-omniweb-agents/memory/MEMORY.md`:

- `tools/lib/` → `src/lib/`, `tools/session-runner.ts` → `cli/session-runner.ts`
- `tools/event-runner.ts` → `cli/event-runner.ts`, `core/types.ts` → `src/types.ts`
- `sources/catalog.json` → `config/sources/catalog.json`
- Update test count: 855 → 866, 50 → 51 suites
- Update "Next Steps" — remove ownTxHashes (done), add ElizaOS adapter + reorg work

---

## Item 8: Update Visual HTML (5 min, zero risk)

Fix stale paths in `~/.agent/diagrams/agent-architecture-comparison.html`:
- `core/` → `src/`, `tools/lib/` → `src/lib/`, `tools/*.ts` → `cli/*.ts` in text content

---

## Item 5: ElizaOS Adapter Bridges (DECOUPLED from Item 6)

Per Codex: P1 bridges can be developed against current stable types without waiting for Item 6.

### Structure
```
src/adapters/
└── eliza/
    ├── index.ts              — Plugin export
    ├── plugin.ts             — Wires all bridges into ElizaOS Plugin interface
    ├── config-bridge.ts      — YAML persona → ElizaOS Character JSON
    ├── action-bridge.ts      — demos Action → ElizaOS Action
    ├── provider-bridge.ts    — demos DataProvider → ElizaOS Provider
    ├── evaluator-bridge.ts   — demos Evaluator → ElizaOS Evaluator
    ├── event-service.ts      — demos EventSource → ElizaOS Service subclass
    └── watermark-adapter.ts  — ElizaOS DB adapter → demos WatermarkStore
```

### P1 Bridges (corrected per Codex review):

**config-bridge.ts** — Must read AGENT.yaml + persona.yaml + persona.md (not just loadAgentConfig):
```typescript
export function personaToCharacter(agentName: string): Character {
  const config = loadAgentConfig(agentName);       // persona.yaml → AgentConfig
  const agentYaml = parseYaml(readFileSync(config.paths.agentYaml, 'utf-8'));
  const personaMd = readFileSync(config.paths.personaMd, 'utf-8');
  return {
    name: config.displayName,
    bio: `${agentYaml.identity.role}. ${agentYaml.identity.mission}`,
    topics: [...config.topics.primary, ...config.topics.secondary],
    style: { post: personaMd.split('\n').filter(l => l.trim()) },
    plugins: agentYaml.capabilities?.skills || [],   // from AGENT.yaml, NOT loopExtensions
    settings: { modelProvider: process.env.LLM_PROVIDER },
  };
}
```

**action-bridge.ts** — Build ActionInput from runtime+message+state, normalize result:
```typescript
export function bridgeAction(demosAction: DemosAction): ElizaAction {
  return {
    name: demosAction.name,
    similes: demosAction.aliases || [],
    description: demosAction.description,
    examples: [],
    validate: async (runtime, message, state) => {
      return demosAction.validate({
        context: { runtime, message, ...state },
        metadata: {},
      });
    },
    handler: async (runtime, message, state) => {
      const result = await demosAction.execute({
        context: { runtime, message, ...state },
        metadata: {},
      });
      return {
        success: result.success,
        text: result.text,
        values: result.data ? { data: result.data } : undefined,
        data: result.data,
      };
    },
  };
}
```

**provider-bridge.ts** — Stringify full ProviderResult (not just .data):
```typescript
export function bridgeProvider(demosProvider: DataProvider): ElizaProvider {
  return {
    get: async (runtime, message, state) => {
      const result = await demosProvider.fetch(state?.topic || '', {});
      return JSON.stringify(result);  // full ProviderResult: ok, data, error, source, metadata
    },
  };
}
```

### P2 Bridges (corrected):

**evaluator-bridge.ts** — Must implement validate, handler, alwaysRun, similes, examples:
```typescript
export function bridgeEvaluator(demosEval: DemosEvaluator): ElizaEvaluator {
  return {
    name: demosEval.name,
    description: demosEval.description,
    similes: [],
    examples: [],
    alwaysRun: false,
    validate: async (runtime, message, state) => true,
    handler: async (runtime, message, state) => {
      const result = await demosEval.evaluate({
        text: message.content?.text || '',
        context: { runtime, message, ...state },
      });
      // Store evaluation result in memory for future provider access
      if (!result.pass) {
        runtime.log?.(`Evaluator ${demosEval.name} failed: ${result.reason}`);
      }
    },
  };
}
```

**event-service.ts** — Real Service subclass (not just wrapper):
```typescript
export class EventSourceService extends Service {
  static readonly serviceType = 'demos-event-source';
  readonly capabilityDescription = 'Demos event source polling';
  private running = false;

  async start(sources: EventSource[], handlers: EventHandler[]): Promise<void> {
    this.running = true;
    // poll/diff loop, emit via runtime.emit()
  }

  async stop(): Promise<void> {
    this.running = false;
  }
}
```

**watermark-adapter.ts** — Direction: ElizaOS DB → demos WatermarkStore (not reverse):
```typescript
export function createElizaWatermarkStore(adapter: IDatabaseAdapter): WatermarkStore {
  return {
    async load(sourceId) { /* query adapter for watermark memory by sourceId */ },
    async save(sourceId, watermark) { /* upsert memory via adapter */ },
    async loadAll() { /* query all watermark memories */ },
  };
}
```

### Tests
```
tests/adapters/
├── config-bridge.test.ts     — YAML → Character round-trip
├── action-bridge.test.ts     — validate + execute delegation + result normalization
├── provider-bridge.test.ts   — fetch → full stringify → get
└── plugin.test.ts            — Plugin interface compliance
```

### Dependencies
- `@elizaos/core` added to devDependencies (types only)
- Imports from `src/types.ts`, `src/lib/agent-config.ts`

---

## Item 6: Reorganize src/lib/ by Subsystem (NOT by role)

Per Codex review: role-based categorization misaligns with actual code boundaries. Move by dependency cluster instead.

### Subsystem Clusters

**Cluster 1: sources/** (already a subtree — keep together, don't split across evaluators/providers)
```
src/lib/sources/        — stays as-is (catalog, fetch, health, lifecycle, matcher, policy, rate-limit, providers/)
```
No move needed. Already self-contained. This was the biggest miscategorization in the original plan.

**Cluster 2: reactive/** (event system — tightly coupled)
```
src/lib/event-sources/  → src/reactive/event-sources/
src/lib/event-handlers/ → src/reactive/event-handlers/
src/lib/event-loop.ts   → src/reactive/event-loop.ts
src/lib/watermark-store.ts → src/reactive/watermark-store.ts
src/lib/own-tx-hashes.ts → src/reactive/own-tx-hashes.ts
```

**Cluster 3: actions/** (execution layer)
```
src/lib/action-executor.ts         → src/actions/action-executor.ts
src/lib/omniweb-action-executor.ts → src/actions/omniweb-action-executor.ts
src/lib/publish-pipeline.ts        → src/actions/publish-pipeline.ts
src/lib/llm.ts                     → src/actions/llm.ts
```

**Cluster 4: stays in src/lib/** (shared internals — no move)
```
auth.ts, sdk.ts, errors.ts, log.ts, observe.ts, llm-provider.ts,
agent-config.ts, attestation-policy.ts, subprocess.ts, state.ts,
extensions.ts, improvement-utils.ts, review-findings.ts,
tlsn-playwright-bridge.ts, predictions.ts, mentions.ts, tips.ts,
scoring.ts, budget-tracker.ts, storage-client.ts, feed-filter.ts,
source-discovery.ts, signals.ts, spending-policy.ts,
write-rate-limit.ts, response-validator.ts, tx-queue.ts
```

Per Codex: scoring, budget-tracker, storage-client, source-discovery, feed-filter are NOT providers — they're shared utilities. Keeping them in lib/ is correct.

### Migration Order (by cluster, each independently committable):

**Step 1:** Move reactive cluster (5 files + 2 subdirs)
- Create `src/reactive/`
- `git mv` event-sources, event-handlers, event-loop, watermark-store, own-tx-hashes
- Rewrite imports in: cli/event-runner.ts, tests/event-*.ts, tests/own-tx-hashes.test.ts, tests/watermark-store.test.ts, src/index.ts
- **Verify:** `npx vitest run`

**Step 2:** Move actions cluster (4 files)
- Create `src/actions/`
- `git mv` action-executor, omniweb-action-executor, publish-pipeline, llm
- Rewrite imports in: cli/event-runner.ts, cli/session-runner.ts, cli/publish.ts, tests/action-executor.test.ts, tests/omniweb-action-executor.test.ts, tests/thread-reply.test.ts, tests/llm.test.ts, src/index.ts, platform/index.ts
- **Verify:** `npx vitest run`

**Step 3:** Update barrel exports
- `src/index.ts` — update re-export paths
- `platform/index.ts` — update re-export paths (publish-pipeline, llm)
- **Verify:** `npx vitest run`

### Files NOT moved (staying in src/lib/)
- `sources/` subtree — already well-organized, don't fragment it
- All shared utilities — per Codex, these don't fit role categories
- `event-handlers/` and `event-sources/` — move with reactive cluster

### Update sites for each cluster:

**Reactive cluster consumers:**
- `cli/event-runner.ts` — imports event-loop, event-sources/*, event-handlers/*, watermark-store, own-tx-hashes
- `tests/event-loop.test.ts`, `tests/event-sources-handlers.test.ts`, `tests/own-tx-hashes.test.ts`, `tests/watermark-store.test.ts`
- `src/index.ts` — re-exports event-loop types
- `src/plugins/lifecycle-plugin.ts` — if it imports event types
- Dynamic imports in `cli/event-runner.ts`

**Actions cluster consumers:**
- `cli/event-runner.ts`, `cli/session-runner.ts`, `cli/publish.ts`, `cli/engage.ts`
- `tests/action-executor.test.ts`, `tests/omniweb-action-executor.test.ts`, `tests/thread-reply.test.ts`, `tests/llm.test.ts`, `tests/gate-opinion.test.ts`
- `src/index.ts`, `platform/index.ts`
- `src/plugins/budget-plugin.ts` — dynamic import of budget-tracker (stays in lib, but check)
- `cli/session-runner.ts` dynamic imports
- `tests/gate-opinion.test.ts` — reads `src/lib/llm.ts` as literal path string

---

## Execution Order

1. **Item 7** — MEMORY.md paths (5 min)
2. **Item 8** — Visual HTML paths (5 min)
3. **Item 5** — ElizaOS P1 bridges (decoupled, can start immediately)
4. **Item 6 Step 1** — Move reactive cluster
5. **Item 6 Step 2** — Move actions cluster
6. **Item 6 Step 3** — Update barrel exports

Items 3 and 4-6 are independent and could run in parallel (Item 5 on a separate branch).

---

## Verification

```bash
# After each step
npx vitest run

# After Item 6 complete — no stale imports
grep -rn 'src/lib/action-executor\|src/lib/event-loop\|src/lib/event-sources\|src/lib/event-handlers\|src/lib/publish-pipeline\|src/lib/watermark-store\|src/lib/own-tx-hashes\|src/lib/llm\.ts' src/ cli/ tests/ platform/ connectors/ --include='*.ts' | grep -v node_modules | grep -v '// '

# After Item 5 — adapter tests
npx vitest run tests/adapters/

# CLI works
npx tsx cli/session-runner.ts --help
npx tsx cli/event-runner.ts --help
```

## Critical Files

- `src/index.ts` — barrel re-exports change for moved files
- `platform/index.ts` — re-exports publish-pipeline, llm
- `cli/event-runner.ts` — heaviest consumer of reactive + actions clusters
- `cli/session-runner.ts` — dynamic imports of sources, actions
- `tests/import-boundaries.test.ts` — hardcoded paths
- `tests/gate-opinion.test.ts` — literal path string `src/lib/llm.ts`
- `tests/declarative-engine.test.ts` — literal path `src/lib/sources/providers/specs`
- `tests/golden-adapters.test.ts` — literal path `src/lib/sources/providers/specs`
- `src/plugins/budget-plugin.ts` — dynamic import of budget-tracker
- `src/plugins/sources-plugin.ts` — imports policy, matcher
