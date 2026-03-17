# Agent Framework Modularization Research

> Research deliverable for demos-agents refactor planning.
> Date: 2026-03-17 | Author: Nova (intern agent)

---

## 1. OpenClaw Format

### What Is OpenClaw?

OpenClaw is an open-source (MIT), local-first AI agent framework written in TypeScript. Originally published as "Clawdbot" in November 2025, it gained rapid adoption in January 2026. It runs as a single Node.js process (Gateway) that manages messaging platform connections (WhatsApp, Telegram, Discord, Slack, Signal), session state, model calls, tool execution, and memory persistence.

Key architectural innovations:
- **Lane Queue** -- serial execution by default to prevent race conditions
- **Semantic Snapshots** -- accessibility-tree parsing for browser automation (cheaper than screenshots)
- **Markdown Memory** -- all state stored as human-readable markdown files
- **JSONL tool logging** -- replayable event format for tool calls

### Agent Workspace Format

An OpenClaw agent workspace is a directory containing these user-editable markdown files, injected into agent context at session start:

| File | Purpose | Required |
|------|---------|----------|
| `AGENTS.md` | Operating instructions + persistent memory | Yes |
| `SOUL.md` | Persona, boundaries, tone | No |
| `TOOLS.md` | User-maintained tool notes/conventions | No |
| `BOOTSTRAP.md` | One-time first-run ritual (auto-deleted) | No |
| `IDENTITY.md` | Agent name, vibe, emoji | No |
| `USER.md` | User profile, preferred address | No |
| `MEMORY.md` | Distilled knowledge repository | No |
| `skills/` | Workspace-local skill directories | No |

Blank files are skipped. Oversized files are trimmed with truncation markers. Sessions are stored as JSONL at `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`.

### SKILL.md Format

Each skill is a directory containing a `SKILL.md` with YAML frontmatter and markdown instructions. The format follows the **AgentSkills spec** (compatible with Claude Code and Cursor).

**Required frontmatter:**
```yaml
---
name: skill-name
description: What the skill does
---
```

**Optional frontmatter fields:**
- `homepage` -- URL for skill website
- `version` -- semver
- `user-invocable` -- expose as slash command (default: true)
- `disable-model-invocation` -- exclude from model prompt
- `command-dispatch: tool` -- bypass model for direct tool dispatch
- `command-tool` -- tool name to invoke
- `command-arg-mode: raw` -- forward raw arguments string

**Dependency declaration** (via `metadata.openclaw` as single-line JSON):
```yaml
metadata.openclaw: {"requires":{"bins":["ffmpeg"],"env":["OPENAI_API_KEY"],"config":["openclaw.json-path"]},"os":["darwin","linux"],"primaryEnv":"OPENAI_API_KEY","install":{"brew":"ffmpeg","node":"@scope/pkg"}}
```

**Skill loading precedence (highest to lowest):**
1. `<workspace>/skills/` -- per-agent, workspace-local
2. `~/.openclaw/skills/` -- managed/local, shared across agents
3. Bundled skills -- shipped with npm package
4. Additional dirs via `skills.load.extraDirs` config

**Registry:** ClawHub (`clawhub.com`) is the public skill registry. Install with `clawhub install <skill-slug>`.

### What "Bring Workflows to OpenClaw Format" Means Concretely

For demos-agents, this would mean:

1. **Agent definitions** -- Convert each agent's YAML config (AGENT.yaml, persona.yaml, strategy.yaml) into an OpenClaw workspace directory with:
   - `AGENTS.md` containing operating instructions (merge of persona.md + strategy rules + hard constraints)
   - `SOUL.md` for voice/tone (from persona.md)
   - `IDENTITY.md` for agent name/display metadata
   - Optionally `BOOTSTRAP.md` for first-run initialization (credential check, dependency verification)

2. **Skills** -- The existing `skills/supercolony/SKILL.md` already follows the AgentSkills spec format. To be fully OpenClaw-compatible:
   - Ensure frontmatter uses only single-line keys (parser limitation)
   - Add `metadata.openclaw` for runtime requirements (bins, env vars)
   - Move workspace-specific skills into `<agent-workspace>/skills/`

3. **Tools as skills** -- Convert CLI tools (audit.ts, room-temp.ts, engage.ts, etc.) into individual skill directories with SKILL.md files describing their purpose and invocation

4. **Session state** -- Adopt JSONL session logging format (partially done already with observation JSONL files)

5. **Memory** -- Map existing state files (~/.sentinel/predictions.json, tips-state.json) into a `MEMORY.md` or structured memory directory

---

## 2. Framework Comparison

### 2.1 CrewAI

**Language:** Python | **Stars:** 44.6k+ | **License:** MIT

**Core/Agent Separation:**
- Core is the `crewai` pip package (orchestration engine, memory systems, message bus)
- User agents defined declaratively in `config/agents.yaml` and `config/tasks.yaml`
- Python glue in `crew.py` using `@CrewBase`, `@agent`, `@task`, `@crew` decorators
- YAML names must match Python method names for auto-linking

**Agent Definition Format:**
```yaml
# config/agents.yaml
researcher:
  role: "{topic} Senior Data Researcher"
  goal: "Uncover cutting-edge developments in {topic}"
  backstory: "You're a seasoned researcher..."
  llm: openai/gpt-4o  # optional
```

**Tool Registration:**
- Tools registered inside `@agent` methods: `Agent(tools=[SerperDevTool()])`
- 100+ built-in tools, plus custom tool classes extending `BaseTool`
- Global message bus + entity store + agent registry for dynamic registration

**Plugin/Extension Pattern:**
- Dual workflow model: **Crews** (autonomous collaboration) + **Flows** (deterministic event-driven)
- MCP and A2A protocol support (v1.10.1+)
- Hierarchical delegation: manager agent decomposes, workers execute and report JSON

**Key Insight:** YAML-first configuration with Python decorators for wiring. Non-technical users can edit YAML without touching code.

### 2.2 AutoGen (Microsoft Agent Framework)

**Language:** Python/.NET | **Stars:** 40k+ | **License:** MIT

**Core/Agent Separation -- Three Explicit Layers:**
1. **Core** -- Event-driven messaging foundation using actor model pattern. Async message passing between agents via `RoutedAgent` with Python decorators for type-safe message routing.
2. **AgentChat** -- Opinionated high-level API for rapid prototyping (two-agent chat, group chats). Built on Core.
3. **Extensions** -- First- and third-party extensions expanding capabilities.

**Tool Registration:**
- Tools are functions decorated or registered with agents
- Extensions provide tool bundles (McpWorkbench, DockerCommandLineCodeExecutor, etc.)
- Runtime discovers handlers automatically via decorators

**Plugin/Extension Pattern:**
- Extensions implement Core/AgentChat interfaces
- Installable via `pip install autogen-ext-*` sub-packages
- Examples: MCP server integration, OpenAI Assistant API wrapper, gRPC distributed runtime
- v0.4+ architecture is fully async, event-driven

**Key Insight:** The explicit three-layer stack (Core / AgentChat / Extensions) is the cleanest separation model. Core never depends on extensions. Extensions never depend on AgentChat.

### 2.3 LangGraph

**Language:** Python/JS | **Stars:** 15k+ | **License:** MIT

**Core/Agent Separation:**
- Core is `StateGraph` -- a graph runtime that manages shared state across nodes
- Agents are nodes in the graph (LLM calls, tool calls, or arbitrary functions)
- State flows through edges with conditional routing

**Tool Registration:**
- `ToolNode` -- dedicated node type wrapping tool execution
- Tools registered via `tools_by_name` registry mapping names to callables
- `Universal Tool Node` pattern: registers tools, extracts schemas, validates inputs, handles errors in one class
- LangChain tool interface: any tool implementing the interface auto-registers

**Plugin/Extension Pattern:**
- Graph composition: sub-graphs as reusable modules
- Tools-first pattern: tool schemas are the architectural foundation
- `messages-key` convention standardizes state shape

**Key Insight:** Graph-as-architecture. The graph IS the extension point. New capabilities = new nodes. Composition = sub-graphs. No plugin registry needed.

### 2.4 Eliza (elizaOS / ai16z)

**Language:** TypeScript | **Stars:** 20k+ | **License:** MIT

**Core/Agent Separation:**
- Three-layer architecture: Interface Layer (platform adapters), Core Layer (memory + behavior + config), Model Layer (LLM providers)
- V2 architecture: unified message bus, registry-and-override model

**Agent Definition:**
- Character files (JSON/TS) define personality, plugins, settings
- Character includes: name, bio, lore, knowledge, style, plugins array

**Plugin Interface:**
```typescript
interface Plugin {
  name: string;
  description: string;
  actions: Action[];      // What agents CAN DO (validate + handler + examples)
  providers: Provider[];  // What agents CAN SEE (context injection)
  evaluators: Evaluator[]; // What agents ASSESS (post-action analysis)
  services: Service[];    // What agents MANAGE (state, connections)
}
```

**Tool Registration:**
- Everything is a plugin (unified architecture)
- Plugins registered via character file: `plugins: ['./plugin-fal-ai']`
- Plugin registry at `elizaos-plugins/registry` (JSON registry on GitHub)
- Each plugin is a separate npm package with `dist/` build output

**Key Insight:** The Action/Provider/Evaluator/Service taxonomy is the most granular plugin decomposition. It separates "what can be done" from "what can be seen" from "what can be judged."

### 2.5 Agency Swarm

**Language:** Python | **Stars:** 5k+ | **License:** MIT

**Core/Agent Separation:**
- Built on OpenAI Agents SDK
- Four components defined in order: Tools, Completions, Agents, Swarms
- Agents are specialized for specific roles within an Agency

**Tool Registration:**
- Two approaches: `@function_tool` decorator (modern) or `BaseTool` class extension
- Tools defined with schema including validation, execution logic, and function descriptions
- `addTool` function with explicit schema

**Communication Pattern:**
- Agents communicate via `send_message` tool
- Directional `communication_flows` defined on the Agency (not free-form)
- Swarms define navigation patterns between agents via `addSwarm`
- Triage pattern: initial agent evaluates and routes to specialists

**Key Insight:** Explicit, directional communication flows. Agents do not communicate freely -- the topology is declared upfront.

---

## 3. Side-by-Side Comparison

| Dimension | CrewAI | AutoGen | LangGraph | Eliza | Agency Swarm |
|-----------|--------|---------|-----------|-------|-------------|
| **Config format** | YAML + Python decorators | Python code + decorators | Python/JS graph code | JSON/TS character files | Python code + decorators |
| **Agent definition** | Declarative YAML (role/goal/backstory) | Code-first with typed messages | Graph nodes | Character files + plugins | Code-first with role classes |
| **Core boundary** | `crewai` package | 3 layers: Core/AgentChat/Extensions | `StateGraph` runtime | Core layer (memory+behavior) | OpenAI SDK wrapper |
| **Tool registration** | Agent constructor + built-in registry | Decorator-based + extensions | ToolNode + name registry | Plugin actions array | @function_tool + BaseTool |
| **Extension pattern** | Crews + Flows composition | Extension sub-packages (pip) | Graph composition (sub-graphs) | Plugin packages (npm) | Agency communication flows |
| **State management** | Shared memory systems | Actor model message passing | StateGraph shared state | Memory system + providers | Per-agent with send_message |
| **Multi-agent** | Hierarchical delegation | Async group chat patterns | Graph routing | Plugin-provided | Directional communication flows |
| **Config vs code** | 70% YAML / 30% code | 10% config / 90% code | 5% config / 95% code | 50% JSON / 50% code | 20% config / 80% code |
| **Publishability** | pip package + YAML | pip sub-packages per layer | pip package | npm packages per plugin | pip package |

---

## 4. Cross-Cutting Patterns

### 4.1 Core vs Extension Boundary

**Converging pattern across all frameworks:**

The **harness pattern** (articulated explicitly by DeerFlow/ByteDance and Microsoft Agent Framework) is the dominant model:

```
HARNESS (publishable core)          APP (user-specific)
--------------------------------    --------------------------------
- Agent runtime/loop                - Agent definitions (YAML/JSON)
- Tool execution engine             - Custom tools/skills
- Message passing/routing           - Business logic
- Memory management                 - Platform integrations
- State persistence                 - Deployment config
- LLM provider abstraction          - Credentials
```

**Critical rule:** Harness never imports from App. Enforced by tests. This allows the harness to be published as an independent package while the app layer remains user-specific.

### 4.2 Tool/Skill Registration Patterns

Three distinct approaches across frameworks:

1. **Declarative registry** (CrewAI, OpenClaw) -- YAML/markdown files declare tools with schemas, loaded at startup
2. **Code decorator** (AutoGen, Agency Swarm) -- Python decorators register functions as tools at import time
3. **Graph composition** (LangGraph) -- Tools are graph nodes, registered when the graph is constructed

**Best practice synthesis:** Declarative registration (YAML/markdown) is best for publishable frameworks because non-technical users can add tools without writing code. Code decorators are best for developer-centric frameworks. The ideal is **both** -- declarative for configuration, code for implementation.

### 4.3 Agent Definition Patterns

Two camps:

1. **Structured config** (CrewAI YAML, Eliza JSON, OpenClaw markdown) -- Agent personality and behavior in config files, wired to code at runtime
2. **Code-first** (AutoGen, LangGraph, Agency Swarm) -- Agent behavior defined in code, config is minimal

**For publishable repos:** Structured config wins. It enables users to create new agents without understanding the framework internals.

---

## 5. Best Practices for Publishable Agent Repos

Synthesized from all frameworks and the harness pattern research:

### 5.1 Minimal Core (The Harness)

The publishable core should contain exactly:

1. **Agent loop/runtime** -- The sense-think-act cycle engine
2. **Tool execution engine** -- Schema validation, sandboxing, error handling
3. **LLM provider abstraction** -- Provider-agnostic completion interface
4. **Memory/state management** -- Persistence layer for agent state
5. **Extension dispatcher** -- Hook system for lifecycle events
6. **Message routing** -- Inter-agent communication primitives

Everything else belongs in the extension/app layer.

### 5.2 Extension Boundary Principles

1. **Dependency inversion** -- Core defines interfaces, extensions implement them
2. **No core-to-extension imports** -- Enforced by CI tests (DeerFlow model)
3. **Progressive loading** -- Skills/tools loaded when needed, not all at startup
4. **Layered APIs** -- Low-level core for power users, high-level convenience for rapid prototyping (AutoGen model)
5. **Declarative agent definitions** -- YAML/JSON/markdown for agent config, code for tool implementation only

### 5.3 What Makes a Framework Easy to Extend

- **Clear plugin interface** -- Eliza's Action/Provider/Evaluator/Service taxonomy is the gold standard
- **Skill format standard** -- OpenClaw's SKILL.md with YAML frontmatter (also used by Claude Code, Cursor)
- **Registry/discovery** -- ClawHub (OpenClaw), plugin-registry (Eliza), PyPI sub-packages (AutoGen)
- **Workspace isolation** -- Per-agent workspace directories with local overrides
- **Composition over inheritance** -- Graph composition (LangGraph) or crew composition (CrewAI)

---

## 6. Mapping to demos-agents Current Structure

### What demos-agents already has that aligns:

| Current | Closest Framework Pattern | Notes |
|---------|--------------------------|-------|
| `AGENT.yaml` (apiVersion, kind, metadata, identity, capabilities) | CrewAI agents.yaml / OpenClaw AGENTS.md | Already declarative, well-structured |
| `persona.yaml` + `persona.md` | OpenClaw SOUL.md + Eliza character files | Split config from voice/tone |
| `strategy.yaml` | No direct equivalent | Unique self-improving loop config |
| `SKILL.md` (supercolony) | OpenClaw SKILL.md | Already AgentSkills-compatible |
| `tools/lib/extensions.ts` | AutoGen Extensions / Eliza Plugin interface | Typed hook system |
| `tools/lib/llm-provider.ts` | All frameworks have this | Provider-agnostic already |
| `tools/lib/sdk.ts` | Platform-specific -- no direct equivalent | Demos chain integration |
| `sources/catalog.json` | No direct equivalent | Unique source lifecycle system |
| `tools/session-runner.ts` | CrewAI Crews / Agent loop runtime | The "harness" |

### What demos-agents is missing:

1. **Clear harness/app boundary** -- tools/lib/ mixes core plumbing (llm-provider, extensions) with app logic (sdk, publish-pipeline, sources/)
2. **Package boundary** -- No npm package.json exports, no publishable core
3. **Tool-as-skill packaging** -- Individual tools (audit, gate, verify) are scripts, not skill directories
4. **Plugin interface type** -- No formal Plugin/Extension type definition (extensions.ts has hooks but no standard interface)
5. **Agent workspace isolation** -- Agent dirs have config but share all tools globally

---

## 7. Actionable Refactoring Recommendations

### R1: Establish the Harness/App Boundary

**Create `packages/core/` as the publishable harness:**

```
packages/
  core/                          # npm-publishable
    src/
      runtime/
        session-runner.ts        # Agent loop engine (from tools/)
        phase-executor.ts        # Phase management
      tools/
        tool-registry.ts         # Declarative tool loading
        tool-executor.ts         # Schema validation + execution
      llm/
        llm-provider.ts          # From tools/lib/
        adapters/                # Claude, OpenAI, CLI
      memory/
        state.ts                 # Agent state management
        observations.ts          # JSONL observation logging
      extensions/
        extensions.ts            # Hook dispatcher (from tools/lib/)
        types.ts                 # Plugin/Extension interface definition
      messaging/
        types.ts                 # Inter-agent message types
    package.json                 # Publishable as @demos/agent-core
```

**Keep in app layer (root):**
```
agents/                          # Agent workspace directories (unchanged)
tools/                           # App-specific tools importing from @demos/agent-core
  lib/
    sdk.ts                       # Demos chain SDK (app-specific)
    publish-pipeline.ts          # Publishing logic (app-specific)
    sources/                     # Source system (app-specific)
skills/                          # Skills (unchanged, already AgentSkills-compatible)
sources/                         # Catalog data (app-specific)
```

### R2: Define a Formal Plugin Interface

Inspired by Eliza's taxonomy, adapted for demos-agents:

```typescript
interface DemosPlugin {
  name: string;
  description: string;
  version: string;

  // What agents CAN DO (tools/actions)
  tools?: ToolDefinition[];

  // What agents CAN SEE (context providers -- source adapters, feed readers)
  providers?: ProviderDefinition[];

  // What agents ASSESS (gate checks, verification, calibration)
  evaluators?: EvaluatorDefinition[];

  // Lifecycle hooks (pre-publish, post-session, etc.)
  hooks?: HookDefinition[];
}
```

This formalizes the implicit separation that already exists:
- `tools/audit.ts`, `tools/gate.ts` = evaluators
- `tools/engage.ts`, `tools/verify.ts` = tools/actions
- `sources/providers/` = providers
- `tools/lib/extensions.ts` hooks = hooks

### R3: Convert Tools to Skills

Each major tool becomes a skill directory with SKILL.md:

```
skills/
  audit/
    SKILL.md                     # AgentSkills + OpenClaw compatible
    scripts/audit.ts
  engage/
    SKILL.md
    scripts/engage.ts
  gate/
    SKILL.md
    scripts/gate.ts
  verify/
    SKILL.md
    scripts/verify.ts
  source-lifecycle/
    SKILL.md
    scripts/source-lifecycle.ts
  supercolony/                   # Already exists
    SKILL.md
    scripts/...
```

### R4: Make Agent Workspaces Self-Contained

Each agent directory becomes a complete workspace (OpenClaw-compatible):

```
agents/sentinel/
  AGENTS.md                      # Merged from AGENT.yaml + strategy rules (OpenClaw format)
  SOUL.md                        # From persona.md (voice/tone)
  AGENT.yaml                     # Keep for structured config (CrewAI pattern)
  persona.yaml                   # Keep for scan modes, thresholds
  strategy.yaml                  # Keep for loop config
  skills/                        # Agent-specific skill overrides (if any)
  memory/                        # Agent-specific state (predictions, tips, etc.)
```

### R5: Enforce the Boundary with Tests

Following the DeerFlow model:

```typescript
// tests/harness-boundary.test.ts
test('core never imports from app layer', () => {
  const coreFiles = glob('packages/core/src/**/*.ts');
  for (const file of coreFiles) {
    const content = readFileSync(file, 'utf-8');
    expect(content).not.toMatch(/from ['"]\.\.\/\.\.\/tools/);
    expect(content).not.toMatch(/from ['"]\.\.\/\.\.\/agents/);
    expect(content).not.toMatch(/from ['"]\.\.\/\.\.\/sources/);
  }
});
```

### R6: Incremental Migration Path

1. **Phase 1** -- Extract `packages/core/` with llm-provider, extensions, and session-runner. Keep old paths as re-exports.
2. **Phase 2** -- Define Plugin interface. Refactor extensions.ts hooks to use it.
3. **Phase 3** -- Convert tools to skills directories with SKILL.md files.
4. **Phase 4** -- Make agent workspaces self-contained (move state files).
5. **Phase 5** -- Publish `@demos/agent-core` to npm. Remove re-exports.

Each phase is independently shippable and testable.

---

## Sources

- [OpenClaw Agent Runtime Docs](https://docs.openclaw.ai/concepts/agent)
- [OpenClaw Skills Docs](https://docs.openclaw.ai/tools/skills)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [OpenClaw Skill Format Spec](https://github.com/openclaw/clawhub/blob/main/docs/skill-format.md)
- [CrewAI Documentation](https://docs.crewai.com/)
- [CrewAI YAML Configuration DeepWiki](https://deepwiki.com/crewAIInc/crewAI/8.2-yaml-configuration)
- [AutoGen GitHub](https://github.com/microsoft/autogen)
- [Microsoft Agent Framework Overview](https://learn.microsoft.com/en-us/agent-framework/overview/)
- [AutoGen to Microsoft Agent Framework Migration](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/)
- [LangGraph GitHub](https://github.com/langchain-ai/langgraph)
- [LangGraph Tools-First Pattern](https://www.sitepoint.com/implementing-the-tools-first-pattern-in-lang-graph/)
- [ElizaOS Documentation](https://docs.elizaos.ai)
- [ElizaOS Plugin Creation Guide](https://docs.elizaos.ai/guides/create-a-plugin)
- [ElizaOS Plugin Registry](https://github.com/elizaos-plugins/registry)
- [Agency Swarm Overview](https://agency-swarm.ai/core-framework/agents/overview)
- [Agency Swarm GitHub](https://github.com/VRSEN/agency-swarm)
- [DeerFlow Harness/App Boundary](https://github.com/bytedance/deer-flow/issues/1130)
- [Microsoft Agent Harness Blog](https://devblogs.microsoft.com/agent-framework/agent-harness-in-agent-framework/)
- [Inngest: Your Agent Needs a Harness](https://www.inngest.com/blog/your-agent-needs-a-harness-not-a-framework)
- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Milvus: OpenClaw Complete Guide](https://milvus.io/blog/openclaw-formerly-clawdbot-moltbot-explained-a-complete-guide-to-the-autonomous-ai-agent.md)
