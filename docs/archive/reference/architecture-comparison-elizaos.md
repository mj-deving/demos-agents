# Agent Architecture Comparison — ElizaOS, omniweb-agents, OpenClaw, Claude Code

> Deep architectural analysis for future refactor. Created 2026-03-18.
> Visual companion: `~/.agent/diagrams/agent-architecture-comparison.html`

---

## 1. ElizaOS — Complete Architecture

### 1.1 Plugin Interface

```typescript
interface Plugin {
  name: string
  description: string
  init?: (runtime: IAgentRuntime) => Promise<void>
  config?: Record<string, unknown>
  actions?: Action[]
  providers?: Provider[]
  evaluators?: Evaluator[]
  services?: typeof Service[]
  adapter?: IDatabaseAdapter
  models?: Record<string, ModelHandler>
  events?: Record<string, EventHandler[]>
  routes?: Route[]
  tests?: TestSuite[]
  componentTypes?: Record<string, ComponentType>
  dependencies?: string[]
  testDependencies?: string[]
  priority?: number
  schema?: DatabaseSchema
}
```

**Initialization sequence:** DB adapter → Actions → Evaluators → Providers → Model handlers → HTTP routes → Event handlers → Services.

### 1.2 Core Abstractions

**Action:**
```typescript
interface Action {
  name: string
  similes: string[]                    // Alternative names/aliases
  description: string
  examples: Example[]
  validate: (runtime: IAgentRuntime, message: Memory, state?: State) => Promise<boolean>
  handler: (runtime: IAgentRuntime, message: Memory, state?: State, options?: Record<string, unknown>, callback?: Callback, responses?: string[]) => Promise<ActionResult>
}

interface ActionResult {
  success: boolean
  text?: string
  values?: Record<string, unknown>
  data?: unknown
}
```

**Provider:**
```typescript
interface Provider {
  get: (runtime: IAgentRuntime, message: Memory, state?: State) => Promise<string>
}
```
Returns a string injected into LLM context. Built-in: Time, Facts, Boredom.

**Evaluator:**
```typescript
interface Evaluator {
  name: string
  description: string
  similes: string[]
  examples: EvaluationExample[]
  alwaysRun: boolean
  validate: (runtime: IAgentRuntime, message: Memory, state?: State) => Promise<boolean>
  handler: (runtime: IAgentRuntime, message: Memory, state?: State) => Promise<void>
}
```
Runs post-action. Extracts insights that providers inject into future context.

**Service:**
```typescript
abstract class Service {
  protected runtime: IAgentRuntime
  static readonly serviceType: string
  abstract readonly capabilityDescription: string
  abstract stop(): Promise<void>
}
```

### 1.3 Character (Agent Definition)

```typescript
interface Character {
  name: string
  bio: string | string[]
  id?: UUID
  username?: string
  system?: string                      // System prompt override
  adjectives?: string[]
  topics?: string[]
  templates?: Record<string, string>
  messageExamples?: Array<Array<Message>>
  postExamples?: string[]
  knowledge?: KnowledgeItem[]
  style?: {
    chat?: string[]
    post?: string[]
    [key: string]: string[]
  }
  plugins?: string[]
  settings?: {
    modelProvider?: string
    model?: string
    temperature?: number
    maxTokens?: number
    knowledge?: { enabled: boolean; documentIds?: string[]; queryLimit?: number; minScore?: number }
    mcp?: MCPServerConfig[]
    [key: string]: unknown
  }
  secrets?: Record<string, string>
}
```

### 1.4 Memory System

```typescript
interface Memory {
  id: UUID
  entityId: UUID          // Who created it
  roomId: UUID            // Conversation context
  worldId?: UUID          // Broader context (server)
  content: Content
  embedding?: number[]    // Vector for semantic search
  createdAt: number
  metadata?: MemoryMetadata
}
```

**Three-tier hierarchy:** World (server) → Room (channel) → Entity (user/agent).

**Storage:** PostgreSQL + pgvector, SQLite, MongoDB, Qdrant. Retrieval via recency, semantic similarity, keyword search, relationship filtering.

### 1.5 Event System

20+ event types organized by domain:

| Domain | Events |
|--------|--------|
| World/Entity | WORLD_JOINED, WORLD_CONNECTED, WORLD_LEFT, ENTITY_JOINED, ENTITY_LEFT, ENTITY_UPDATED |
| Message | MESSAGE_RECEIVED, MESSAGE_SENT, MESSAGE_DELETED, MESSAGE_UPDATED |
| Voice | VOICE_MESSAGE_RECEIVED, VOICE_MESSAGE_SENT, VOICE_STARTED, VOICE_ENDED |
| Execution | RUN_STARTED, RUN_COMPLETED, RUN_FAILED, RUN_TIMEOUT |
| Action/Eval | ACTION_STARTED, ACTION_COMPLETED, ACTION_FAILED, EVALUATOR_STARTED, EVALUATOR_COMPLETED |
| Model/Service | MODEL_USED, MODEL_FAILED, SERVICE_STARTED, SERVICE_STOPPED, SERVICE_ERROR |

### 1.6 Message Flow

```
Client → Message → AgentRuntime.processMessage()
  → composeState() [recent 32 messages + facts + providers + vector search]
  → LLM selects Action(s) via HandlerMessageTemplate
  → Action.validate() → Action.handler()
  → Evaluator.handler() (post-action reflection)
  → Memory.create() (store result)
  → Response sent to client
```

### 1.7 Connectors

Client plugins: Discord, Twitter/X, Telegram, Farcaster, Slack, WhatsApp. 45+ blockchain connectors (Solana, EVM chains, Coinbase, Abstract, Hedera). Cross-chain via Chainlink CCIP.

### 1.8 Package Structure (Monorepo)

```
packages/
├── core/           — AgentRuntime, bootstrap, message processing
├── server/         — Express.js backend + Socket.IO
├── client/         — React web dashboard
├── cli/            — Scaffolding (agent create, plugin create, start/build)
├── app/            — Tauri desktop app
└── plugin-sql/     — Database plugin
```

90+ official plugins. Plugin dev structure:
```
plugin-name/
├── src/
│   ├── index.ts       — Plugin export
│   ├── actions/       — Action implementations
│   ├── providers/     — Context providers
│   ├── evaluators/    — Response evaluators
│   ├── services/      — Background services
│   └── types.ts
├── tests/
└── package.json
```

### 1.9 Runtime

- Node.js v23+ (optimal 23.3.0), optional Bun
- 2-4GB RAM minimum, 8GB for multiple agents
- State composition: `composeState()` builds context from recent messages (default 32), facts, provider contributions, vector similarity search, character bio/knowledge

---

## 2. omniweb-agents — Complete Architecture

### 2.1 Plugin Interfaces

```typescript
// Primary extension mechanism (src/types.ts:133-168)
interface FrameworkPlugin {
  name: string
  version: string
  description?: string
  hooks?: Record<string, HookFn>
  providers?: DataProvider[]
  evaluators?: Evaluator[]
  actions?: Action[]
  init?(config: AgentConfig, llm?: LLMProvider): Promise<void>
  destroy?(): Promise<void>
}

// Reactive extension (src/types.ts)
interface EventPlugin {
  name: string
  version: string
  description?: string
  eventHooks?: {
    onEvent?(event: AgentEvent): Promise<void>
    beforeAction?(event: AgentEvent, action: EventAction): Promise<boolean>
    afterAction?(event: AgentEvent, action: EventAction, result: unknown): Promise<void>
    onError?(event: AgentEvent, error: Error): Promise<void>
  }
  sources?: EventSource<any>[]
  handlers?: EventHandler[]
  init?(config: AgentConfig): Promise<void>
  destroy?(): Promise<void>
}
```

### 2.2 Core Abstractions

```typescript
// Data Provider (src/types.ts:27-42)
interface DataProvider {
  name: string
  description: string
  fetch(topic: string, options?: Record<string, unknown>): Promise<ProviderResult>
}
interface ProviderResult {
  ok: boolean
  data?: unknown
  error?: string
  source?: string
  metadata?: Record<string, unknown>
}

// Evaluator (src/types.ts:48-77)
interface Evaluator {
  name: string
  description: string
  evaluate(input: EvaluatorInput): Promise<EvaluatorResult>
}
interface EvaluatorInput {
  text: string
  context: Record<string, unknown>
  metadata?: Record<string, unknown>
}
interface EvaluatorResult {
  pass: boolean
  score?: number
  reason: string
  details?: Record<string, unknown>
}

// Action (src/types.ts:89-123)
interface Action {
  name: string
  description: string
  aliases?: string[]
  validate(input: ActionInput): Promise<boolean>
  execute(input: ActionInput): Promise<ActionResult>
}
interface ActionResult {
  success: boolean
  data?: unknown
  text?: string
  error?: string
}

// Event Source (src/types.ts:261-286)
interface EventSource<T = unknown> {
  id: string
  description: string
  eventTypes: string[]
  poll(): Promise<T>
  diff(prev: T | null, curr: T): AgentEvent[]
  extractWatermark(snapshot: T): unknown
}

// Event Handler
interface EventHandler {
  name: string
  eventTypes: string[]
  handle(event: AgentEvent): Promise<EventAction | null>
}

// Agent Event
interface AgentEvent<T = unknown> {
  id: string            // source:type:timestamp:hash
  sourceId: string
  type: string
  detectedAt: number
  payload: T
  watermark: unknown
}
```

### 2.3 Action Types (Two-Tier)

```typescript
// SuperColony tier (5 actions)
type SCActionType = "publish" | "reply" | "react" | "tip" | "log_only"

// Omniweb tier (13 actions, backward compatible)
type OmniwebActionType =
  | SCActionType
  | "transfer"          // DEM transfer
  | "bridge"            // Cross-chain via XM SDK
  | "store"             // Storage Program write
  | "attest"            // Standalone attestation
  | "workflow"          // DemosWork multi-step
  | "assign_task"       // Task to Storage Program
  | "private_transfer"  // L2PS encrypted transfer
  | "zk_prove"          // ZK proof generation

interface EventAction {
  type: OmniwebActionType
  params: Record<string, unknown>
}
```

### 2.4 Agent Definition (YAML Stack)

**AGENT.yaml** — Identity, capabilities, constraints:
```yaml
apiVersion: omniweb-agents/v1
kind: AgentDefinition
metadata:
  name: sentinel
  displayName: "Demos SuperColony Sentinel Agent"
  version: "1.0.0"
identity:
  role: "Verification node in SuperColony"
  mission: "Detect gaps in collective intelligence"
  tone: "Precise, curious, measured"
capabilities:
  skills: [supercolony]
constraints:
  hardRules:
    - "Never publish without attestation"
    - "Never exceed 3 posts per session"
```

**persona.yaml** — Runtime config:
```yaml
apiVersion: omniweb-agents/v1
kind: PersonaConfig
name: sentinel
topics:
  primary: [crypto, defi, ai, macro]
  secondary: [protocol-analysis, agent-behavior]
scan:
  modes: [lightweight, since-last]
  qualityFloor: 70
attestation:
  defaultMode: dahr_only
  highSensitivityRequireTlsn: true
engagement:
  minDisagreePerSession: 1
  maxReactionsPerSession: 5
gate:
  predictedReactionsThreshold: 10
  allow5Of6: true
```

**strategy.yaml** — Loop configuration (extends base-loop.yaml)

**persona.md** — Voice, tone, post guidelines (natural language)

### 2.5 Module Boundaries

```
core/                    → Zero SDK imports (portable)
  ↓
platform/               → SuperColony-specific (imports SDK via connectors/)
  ↓
connectors/             → SDK isolation layer (@kynesyslabs/demosdk bridge)
  ↓
@kynesyslabs/demosdk    → Actual SDK
```

Barrel exports: `src/index.ts` (95 lines), `platform/index.ts` (44 lines), `connectors/index.ts` (15 lines).

### 2.6 Two Loop Modes

**Session Runner (Cron, 8-phase):**
AUDIT → SCAN → ENGAGE → GATE → PUBLISH → VERIFY → REVIEW → HARDEN

Three oversight modes: full (interactive), approve (semi-auto), autonomous (auto).

**Event Runner (Long-lived, Reactive):**
Poll → Diff → AgentEvent[] → EventHandler → EventAction → ActionExecutor → Watermark save

4 built-in sources: social:replies, social:mentions, tip:received, disagree:monitor.

### 2.7 Action Executor (Factory + DI)

```typescript
interface ActionExecutorContext {
  agentName: string
  address: string
  dryRun: boolean
  getToken: () => Promise<string>
  dailyReactive: number
  hourlyReactive: number
  calibrationOffset: number
  llm: any | null
  ownTxHashes: Set<string>
  apiCall: ApiCallFn
  generatePost: GeneratePostFn
  attestAndPublish: AttestAndPublishFn
  transfer: TransferFn
  loadWriteRateLedger: (address: string) => WriteRateLedger
  canPublish: (ledger, limits) => WriteRateCheck
  recordPublish: (ledger, agent, txHash?) => WriteRateLedger
  saveWriteRateLedger: (ledger) => void
  observe: ObserveFn
  info: (msg: string) => void
  warn: (msg: string) => void
}
```

All dependencies injected — no SDK imports, no file I/O within executor.

### 2.8 LLM Provider

```typescript
interface LLMProvider {
  complete(prompt: string, options?: {
    system?: string
    maxTokens?: number
    model?: string
    modelTier?: "fast" | "standard" | "premium"
  }): Promise<string>
  readonly name: string
}
```

Resolution: `LLM_PROVIDER` env → `LLM_CLI_COMMAND` → API key autodetect → CLI autodetect → null (graceful degradation).

### 2.9 Publish Pipeline

```
Stage 1: Attestation (optional) — attestDahr(url) or attestTlsn(url)
Stage 2: HIVE encoding — HIVE prefix + JSON payload → Uint8Array
Stage 3: Chain publishing — DemosTransactions → txHash (from CONFIRM response)
Stage 4: Indexer confirmation — poll feed at [5s, 10s, 15s] delays
```

### 2.10 Unique Features (No Equivalent in ElizaOS)

| Feature | Description |
|---------|-------------|
| **DAHR/TLSN Attestation** | On-chain proof of data retrieval |
| **BudgetPlugin** | Per-category spend tracking: gas, attestation, tipping, storage, ops |
| **Scoring** | `calculateExpectedScore()` with calibration offset, reply vs top-level weighting |
| **Rate Limiting** | `WriteRateLedger` — address-scoped, persistent, separate cron/reactive budgets |
| **Watermark Dedup** | Persistent state markers per event source, warm-up on restart |
| **Two-Tier Actions** | SC (5) ⊂ Omniweb (13) — backward compatible union |
| **8-Phase Loop** | AUDIT→SCAN→ENGAGE→GATE→PUBLISH→VERIFY→REVIEW→HARDEN with oversight |
| **Source Lifecycle** | quarantine → active (3 passes) → degraded (3 fails or rating<40) |

### 2.11 Plugin Implementations (9)

1. `storage-plugin.ts` — On-chain state (Storage Programs)
2. `budget-plugin.ts` — Treasury management
3. `cross-chain-plugin.ts` — Chain balance queries
4. `sources-plugin.ts` — Declarative data provider engine
5. `signals-plugin.ts` — Consensus tracking
6. `predictions-plugin.ts` — Calibration + prediction registration
7. `lifecycle-plugin.ts` — Source health transitions
8. `tips-plugin.ts` — Autonomous tipping
9. `observe-plugin.ts` — Telemetry logging

---

## 3. OpenClaw — Architecture

### 3.1 Configuration Model

**Primary:** `openclaw.json` — single source of truth, hot-reloads without restart.

```
agents.defaults (base config)
  ↓
agents.list[].id (per-agent override)
  ↓
tools.profile + allow/deny (permission cascade)
```

### 3.2 Skill System (Three-Tier)

1. Workspace skills (`<workspace>/skills/`) — highest priority
2. Managed skills (`~/.openclaw/skills/`) — shared
3. Bundled skills (npm package) — lowest priority

**Format:** SKILL.md + YAML frontmatter. ~24 tokens per skill in every message.

### 3.3 Identity Model

Workspace .md files form agent identity (~35K tokens):
```
├── AGENTS.md      — Operating instructions, hard constraints
├── SOUL.md        — Persona, tone, boundaries
├── IDENTITY.md    — Name, role definition
├── USER.md        — Owner profile
├── TOOLS.md       — Tool routing guidance
├── MEMORY.md      — Curated long-term memory
└── HEARTBEAT.md   — Cron checklist
```

### 3.4 Permission Pipeline

4 restrictive layers: profile → provider → global → per-agent.

```typescript
interface ToolPolicy {
  profile: "full" | "coding" | "messaging" | "minimal"
  alsoAllow?: string[]
  deny?: string[]
  byProvider?: Record<string, ToolPolicy>
}
```

### 3.5 Memory

SQLite + vector hybrid search. 6 results max, minScore 0.35. Vector + FTS + temporal decay + MMR.

### 3.6 Runtime

- Node.js 22.x, Bun for tooling
- VPS with systemd + process hardening
- Dual-agent: Gregor (fast, Telegram-always-on) + Isidore Cloud (heavy compute, on-demand)
- Communication: shared filesystem pipeline (`/var/lib/pai-pipeline/`)

---

## 4. Claude Code (PAI) — Architecture

### 4.1 Three Agent Systems

**System 1: Task Tool Subagents** — Pre-built types: Architect, Designer, Engineer, Explore, Plan, QATester, Pentester, various Researchers. Invoked via `Task({ subagent_type, prompt })`.

**System 2: Named Agents** — Persistent identities in `~/.claude/skills/Agents/`. Unique ElevenLabs voices, persistent memory, backstory.

**System 3: Custom Agents** — Dynamic composition via `ComposeAgent.ts`:
```typescript
interface ComposedAgent {
  name: string
  traits: string[]
  expertise: TraitDefinition[]    // security, legal, finance, technical, etc.
  personality: TraitDefinition[]  // skeptical, analytical, bold, etc.
  approach: TraitDefinition[]     // thorough, rapid, systematic, etc.
  voice: string
  voiceId: string
  voiceSettings: ProsodySettings
  color: string
  prompt: string                  // Generated system prompt
}
```

### 4.2 Hook System (20 hooks)

**Lifecycle events:** SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, Stop.

**Hook I/O contract:**
```typescript
// Input: stdin JSON
{ tool_name: string; tool_input: Record<string, unknown>; session_id?: string }

// Output: stdout JSON
{ "continue": true }                     // Allow
{ "decision": "ask", "message": "..." }  // Prompt user
{ "decision": "block", "reason": "..." } // Block
```

### 4.3 Skill System

```
SkillName/
├── SKILL.md           — Manifest (YAML frontmatter + workflows)
├── Workflows/         — Individual workflow .md files
├── Tools/             — CLI tools (TypeScript)
├── Templates/         — Handlebars templates
└── Data/              — Config/reference YAML
```

Naming: System skills = TitleCase, Personal skills = `_ALLCAPS`.

### 4.4 MCP Servers

External tool providers, auto-discovered via `enableAllProjectMcpServers: true` in settings.json. Appear as callable tools — no agent code needed.

### 4.5 State Management

File-based: MEMORY.md (persistent across sessions), settings.json (config), work.json (PRD tracking from Algorithm). No database.

---

## 5. Type Mapping — ElizaOS ↔ omniweb-agents

| ElizaOS Type | Signature | omniweb-agents Equivalent | Bridge Complexity |
|---|---|---|---|
| `Plugin` | `{ name, init, actions, providers, evaluators, services, events, routes, adapter, models }` | `FrameworkPlugin` + `EventPlugin` | Medium — merge two interfaces |
| `Action.validate` | `(runtime, message, state) → boolean` | `Action.validate(input) → boolean` | **Low** — wrap input |
| `Action.handler` | `(runtime, message, state, opts, cb) → ActionResult` | `Action.execute(input) → ActionResult` | **Low** — same result shape |
| `Provider.get` | `(runtime, message, state) → string` | `DataProvider.fetch(topic, opts) → ProviderResult` | **Medium** — serialize result |
| `Evaluator.handler` | `(runtime, message, state) → void` | `Evaluator.evaluate(input) → EvaluatorResult` | **Medium** — map result type |
| `Service` | `class { serviceType, stop() }` | `EventSource { poll(), diff(), extractWatermark() }` | **Higher** — loop wrapper |
| `Character` | `JSON { name, bio, style, plugins, settings }` | `YAML { AGENT.yaml, persona.yaml, strategy.yaml }` | **Low** — format transform |
| `IDatabaseAdapter` | `{ createMemory, getMemories, searchMemories, ... }` | `WatermarkStore { load, save, loadAll }` | **Higher** — scope differs |
| `Memory` | `{ id, entityId, roomId, embedding, content }` | Session log JSONL + file-based watermarks | **Higher** — different model |
| `events{}` | `Record<string, EventHandler[]>` | `EventPlugin.eventHooks` + `EventSource` | **Medium** — pattern differs |

---

## 6. Event Mapping — ElizaOS ↔ omniweb-agents

| ElizaOS Event | omniweb-agents Equivalent | Notes |
|---|---|---|
| `MESSAGE_RECEIVED` | `social:replies` EventSource + `social:mentions` | demos polls for messages, ElizaOS pushes |
| `MESSAGE_SENT` | `observe("insight", ...)` | Telemetry after publish |
| `ACTION_STARTED` | `EventPlugin.eventHooks.beforeAction()` | Pre-action hook |
| `ACTION_COMPLETED` | `EventPlugin.eventHooks.afterAction()` | Post-action hook |
| `ACTION_FAILED` | `EventPlugin.eventHooks.onError()` | Error hook |
| `RUN_STARTED` | Session Runner phase start | Per-phase, not per-run |
| `RUN_COMPLETED` | HARDEN phase completion | End of 8-phase loop |
| `SERVICE_STARTED` | Event Runner startup | Long-lived process |
| `WORLD_JOINED` | `connectWallet()` | Chain connection |
| N/A | `tip:received` EventSource | No ElizaOS equivalent |
| N/A | `disagree:monitor` EventSource | No ElizaOS equivalent |

---

## 7. Character ↔ Persona Mapping

| ElizaOS Character Field | omniweb-agents Equivalent | Source File |
|---|---|---|
| `name` | `metadata.name` | AGENT.yaml |
| `bio` | `identity.role` + `identity.mission` | AGENT.yaml |
| `adjectives` | `identity.tone` (split) | AGENT.yaml |
| `topics` | `topics.primary` + `topics.secondary` | persona.yaml |
| `style.post` | Post guidelines | persona.md |
| `plugins` | `capabilities.skills` | AGENT.yaml |
| `settings.modelProvider` | `LLM_PROVIDER` env | credentials file |
| `secrets` | Per-agent credentials | `~/.config/demos/credentials-{agent}` |
| `system` | Combined persona.md content | persona.md |
| `messageExamples` | N/A — not used | — |
| `postExamples` | N/A — not used | — |
| `knowledge` | N/A — uses DataProviders | — |
| `settings.knowledge` | `scan` config | persona.yaml |

---

## 8. Adapter Strategy — First Principles Analysis

### 8.1 The Question

What is the minimal adapter surface to bridge omniweb-agents into ElizaOS while preserving unique features?

### 8.2 Constraint Classification

| Constraint | Type | Rationale |
|---|---|---|
| ElizaOS Plugin interface is fixed | **Hard** | Published npm package, community depends on it |
| omniweb-agents core/ must stay SDK-free | **Hard** | Architectural invariant for testing + portability |
| Provider returns string vs ProviderResult | **Soft** | Wrap with JSON.stringify |
| Event model differs (events{} vs sources[]) | **Soft** | Wrap EventSource as Service that emits events |
| Watermarks need persistent state | **Hard** | Dedup requires persistence regardless of host |
| Attestation has no ElizaOS equivalent | **Assumption** | Can expose as ElizaOS Action |
| Budget must be in omniweb-agents | **Soft** | Can live as ElizaOS evaluator |

### 8.3 The 6 Bridges

**Bridge 1 — ActionBridge (Low effort):**
```
demos Action.validate(input) → ElizaOS Action.validate(runtime, msg, state)
demos Action.execute(input)  → ElizaOS Action.handler(runtime, msg, state)
```
Extract ActionInput from ElizaOS state, call demos Action, return result. ~50 lines.

**Bridge 2 — ProviderBridge (Low effort):**
```
demos DataProvider.fetch(topic) → JSON.stringify(result) → ElizaOS Provider.get()
```
ElizaOS providers return strings for context injection. Serialize ProviderResult.

**Bridge 3 — EvaluatorBridge (Medium effort):**
```
demos Evaluator.evaluate(input) → ElizaOS Evaluator.handler(runtime, msg, state)
```
Map EvaluatorResult (pass/score/reason) to ElizaOS evaluator pattern.

**Bridge 4 — EventSourceService (Higher effort):**
```
demos EventSource.poll() + diff() → ElizaOS Service (background loop)
New events → runtime.emit(eventType, payload)
```
Most complex bridge. Needs watermark persistence via ElizaOS DB adapter.

**Bridge 5 — ConfigBridge (Low effort):**
```
YAML persona.yaml + AGENT.yaml → ElizaOS Character JSON
persona.md voice/tone → Character.style
```
One-time transform at init.

**Bridge 6 — WatermarkAdapter (Higher effort):**
```
demos WatermarkStore.save(sourceId, wm) → ElizaOS adapter.createMemory()
demos WatermarkStore.load(sourceId) → ElizaOS adapter.getMemories()
```
Persist watermarks using ElizaOS database instead of file-based JSON.

### 8.4 Unique Features as ElizaOS Primitives

| omniweb-agents Feature | ElizaOS Primitive | Rationale |
|---|---|---|
| Attestation (DAHR/TLSN) | **Action** | Exposed as "attest-dahr", "attest-tlsn" actions |
| BudgetPlugin | **Evaluator** | Gates publish actions based on budget |
| Scoring/Reputation | **Provider** | Injects score context into LLM decisions |
| Rate Limiting | **Evaluator** | Pre-action validation before publish |
| Session Loop (8-phase) | **Service** | Background service running the loop |
| Source Lifecycle | **Service + Events** | Health monitoring emitting events |

### 8.5 Key Insight

The assumption limiting us was that omniweb-agents needs its own runtime. In reality, `core/` is already framework-agnostic — it just needs 6 thin bridges to map its interfaces onto ElizaOS's Plugin contract. The two systems share the same conceptual model (Action/Provider/Evaluator) with different signatures.

### 8.6 Dual-Mode Architecture

```
adapters/
├── eliza/
│   ├── plugin.ts          — ElizaOS Plugin export (wires all bridges)
│   ├── action-bridge.ts   — demos Action → ElizaOS Action
│   ├── provider-bridge.ts — demos DataProvider → ElizaOS Provider
│   ├── evaluator-bridge.ts
│   ├── event-service.ts   — demos EventSource → ElizaOS Service
│   ├── config-bridge.ts   — YAML → Character JSON
│   └── watermark-adapter.ts
└── standalone/            — Current mode (session-runner + event-runner)
```

Both modes share `core/` business logic. The adapter directory imports from `core/` only.

---

## 9. Prioritized Roadmap

### Priority 1 — High Impact, Low Effort

1. **ConfigBridge** — YAML → Character JSON transformer
2. **ActionBridge** — thin wrapper (~50 lines, signatures nearly identical)
3. **ProviderBridge** — wrap fetch() → get() with JSON.stringify

### Priority 2 — High Impact, Medium Effort

4. **EventSourceService** — wrap poll/diff as ElizaOS Service
5. **EvaluatorBridge** — wrap evaluate() → handler()
6. **Expose Attestation as ElizaOS Actions** — unique value proposition

### Priority 3 — Medium Impact, High Effort

7. **Migrate session log to ElizaOS DB adapter** — enables vector search
8. **Add vector memory** — semantic search over observations
9. **Multi-platform connectors** — gain Discord/Twitter/Telegram via ElizaOS plugins

---

## 10. Cross-System Comparison Summary

| Dimension | ElizaOS | omniweb-agents | OpenClaw | Claude Code |
|---|---|---|---|---|
| **Core Model** | Action/Provider/Evaluator/Service | Action/DataProvider/Evaluator/EventSource | Skills + native tools | Skills + Hooks + MCP |
| **Config Format** | JSON (Character) | YAML (4-file stack) | JSON + Markdown workspace | Markdown + YAML + JSON |
| **Memory** | Vector DB + rooms | File-based (JSONL, watermarks) | SQLite + vector hybrid | File-based (MEMORY.md) |
| **Event Model** | 20+ typed events, push | 4 sources, poll/diff/watermark | N/A (polling) | 6 hook lifecycle events |
| **Connectors** | 50+ (social + blockchain) | 1 (SuperColony SDK) | 1 (Telegram) | MCP servers + built-in |
| **Multi-Agent** | Worlds/Rooms | Two-tier (SC/Omniweb) | Dual-agent (fast/heavy) | Subagent types + compose |
| **Unique Strength** | Ecosystem breadth | On-chain verification depth | Context prefix caching | Dynamic trait composition |
| **Runtime** | Node.js 23+, monorepo | Node.js + tsx, single repo | Node.js 22, VPS/systemd | Claude CLI, cloud |
| **Plugin Count** | 90+ official | 9 internal | ~24 skills | 30+ skills |
| **Database** | Postgres/SQLite/Mongo/Qdrant | File-based | SQLite | File-based |
