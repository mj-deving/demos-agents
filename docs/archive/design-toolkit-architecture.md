# Design: Framework-Agnostic Demos Toolkit

> **Status:** Superseded by `design-loop-v3.md` §9 (Code Placement) for toolkit/strategy boundary. Packaging deferred to V3 Phase 4.
> Living design document. Iterated session by session until vision is nailed down.

**Status:** APPROVED
**Started:** 2026-03-25
**Last updated:** 2026-03-27
**Decision log:** Append-only at bottom. Never delete decisions, only supersede.

---

## 1. Problem Statement

omniweb-agents contains high-value domain logic for operating within the Demos Network ecosystem — attestation pipelines, source catalogs, claim extraction, quality gates, entity resolution, colony intelligence, self-improvement machinery. This logic is currently locked inside a monolithic session harness that only works as a standalone system.

External agent frameworks (ElizaOS, OpenClaw, Hermes, custom) cannot consume this value without adopting the entire harness. The goal is to extract the toolkit so any agent — regardless of framework — can operate within the Demos ecosystem with minimal friction.

**The "wow" test:** Someone installs the toolkit, configures their Demos wallet credentials, and within minutes has an agent that can publish attested posts, engage with colony agents, and track performance. The toolkit did the heavy lifting. (Wallet provisioning is a prerequisite — see Q3.)

---

## 2. Taxonomy

Established 2026-03-25. These definitions scope ALL subsequent design decisions.

| Category | Definition | Examples | omniweb-agents Target |
|----------|-----------|----------|-------------------|
| **Framework** | Builds agent logic — provides Actions, Memory, Evaluators as building blocks | ElizaOS, LangChain, CrewAI, AutoGen | NO — we don't define how agents think |
| **Harness** | Manages agent execution — lifecycle, state, safety, channels, I/O | OpenClaw, Claude Agent SDK, DeepAgents | NO (currently yes, evolving away) |
| **Toolkit** | Domain-specific capabilities agents USE — tools, guardrails, data, strategies | Stripe Agent Toolkit, browser-use | **YES — this is our target** |

**Key insight:** No canonical cross-framework skill format exists. ElizaOS uses TypeScript plugins (Action/Provider/Evaluator), OpenClaw uses SKILL.md (AgentSkills spec), Hermes uses Markdown skills. We build a core with thin adapter layers per framework.

---

## 3. Scope: What Demos Offers (Beyond SuperColony)

SuperColony is the first vertical. The Demos SDK (`@kynesyslabs/demosdk` v2.11.5, NOT our work) offers 10+ verticals:

| Vertical | SDK Module | Toolkit Impl Status | Toolkit Priority |
|----------|-----------|------------|-----------------|
| **SuperColony** | websdk + fetch | ✅ Active (3 agents publishing) | **MVP — first vertical** |
| **Attestation** | websdk (proxy) | ✅ Active (DAHR pipeline) | **MVP — core capability** |
| **D402 Payments** | d402/client, d402/server | 🔲 Code-reviewed, not integrated | **P1 — agent monetization** |
| **Identity (CCI)** | abstraction | ⚠️ RPC-direct (NAPI crash) | P2 — agent identity |
| **ERC-8004 Agent ID** | (SDK issue #70) | 🔲 Not yet in SDK | P1 — when it ships |
| **Cross-Chain Ops** | xmcore, bridge | 🔲 Not started | P3 — future vertical |
| **Storage Programs** | storage | ❌ Blocked (RPC "Unknown message") | P3 — SDK ready, node not |
| **DemosWork** | demoswork | ❌ Blocked (ESM bug) | P3 — when SDK unblocks |
| **L2PS Privacy** | l2ps | ❌ Blocked (Buffer bug) | P3 — when SDK unblocks |
| **Encrypted Messaging** | websdk/im | 🔲 Not started | P3 — future vertical |
| **ZK Identity** | encryption/zK | 🔲 Not started | P3 — future vertical |
| **Post-Quantum Crypto** | websdk | ✅ Active (Falcon) | Bundled — transparent |
| **Node MCP** | node built-in | 🔲 Available, not consumed | P2 — real-time chain state |

**Design constraint:** The toolkit API should NOT be `supercolony.publish()` but `demos.tools.publish()` — SuperColony is one target, not the only one.

---

## 4. Architecture: Three Layers

```
ADAPTER LAYER (thin, per-framework)
├── OpenClaw: SKILL.md + handlers
├── ElizaOS: Action[] + Provider[] + Evaluator[] plugin
└── AgentSkills: skill.md for Hermes/generic

CORE TOOLKIT (framework-agnostic, multi-vertical)
@omniweb-agents/core
├── base/           Universal abstractions (already in src/types.ts — 600 lines)
├── sources/        Source catalog (229), lifecycle, matcher, declarative engine
├── pipeline/       Claim extraction, attestation planner, quality gate, scoring
├── guardrails/     Rate limits, dedup, spending policy, budget enforcement
├── identity/       CCI integration, agent auth, wallet management
│   └── erc8004.ts  Placeholder interface for ERC-8004 Agent Identity (SDK issue #70, not yet shipped). Empty impl now; fulfilled when SDK ships. Seam prevents multi-file touch on integration day.
├── verticals/
│   └── supercolony/   Feed ops: publish, reply, react, tip, scan, colony intel
├── connectors/     SDK isolation — core never imports @kynesyslabs/demosdk directly
└── errors/         Typed error unions, partial-success results, retry metadata

docs/playbooks/                    (NOT in core — reference strategies)
├── session-loop.md   8-phase loop recipe (our production strategy)
├── reactive-loop.md  Event-driven recipe
└── reply-only.md     Reply-focused recipe

examples/                          (NOT in core — reference/inspiration only)
├── personas/       sentinel, crawler, pioneer — reference implementations
├── strategies/     Example playbook configurations
└── integrations/   Sample OpenClaw/ElizaOS/CLI setups

DEMOS SDK (not ours — Demos team)
@kynesyslabs/demosdk — wallet, signing, RPC, transactions
```

**Design principles:**
1. **Atomic tools** — Each tool is a standalone function. No dispatch harness, no plugin hooks. Consumer calls tools directly.
2. **Stateless by default** — Tools accept a session handle and return a typed result. No ambient state.
3. **Mandatory guardrails** — Rate limits and spending caps are non-optional. Consumer cannot bypass them.
4. **Typed contracts** — Every tool has a typed request, typed response, and typed error union. No `any`.

> Note: The 25 existing plugins (`src/plugins/`) are harness-specific. They remain in the codebase for our production agents but are NOT part of the toolkit's public API. Consumers who want plugin-style composition build it on top of atomic tools.

---

## 5. Open Design Questions

### Q1: Naming & Identity ✅
- [x] "omniweb-agents" is misleading — implies a framework/harness
- [x] Name should signal "plug this into YOUR agent" — a skill/toolkit/plugin
- [x] Candidates: `demos-toolkit`, `demos-skills`, `@demos/toolkit`
- **Decision:** Name should reflect toolkit/skill/plugin identity. Not "agents." Exact name TBD but direction is clear — it's a bolt-on, plug-and-play toolkit. Any agent comes along and plugs in.

### Q2: Boundary — What Do WE Own vs Demos Team? ✅
- [x] Wrapper should NOT be thick or obscure the SDK
- [x] Abstract: difficulty, learning curve, errors, gotchas, repetitive config — the non-trivial stuff every agent would otherwise figure out from scratch
- [x] Don't abstract: the SDK itself. Agents should interact with Demos natively through our tools
- [x] Document over implement: when implementation value is unclear, document. Good docs let smart agents self-serve
- [x] Don't be personal: design for any flavor, not our specific style
- [x] Scaffold future verticals, don't implement: structure + docs until value is proven
- **Decision:** Thin wrapper. Abstract non-trivial complexity (attestation pipeline, claim extraction, quality heuristics). Don't obscure the SDK. Prefer documentation over implementation when value is unclear. Scaffold verticals, implement only when proven. Design generically, not for personal style.

### Q3: MVP Scope — What's the "wow" moment? ✅
- [x] Layered "wow": instant (3 commands) → discovery (see what's possible) → adoption (compose your own)
- [x] `openclaw skills install demos` → 3 commands → publish attested post. Yes.
- [x] ElizaOS autonomous character? Yes — same core, different adapter.
- [x] Standalone CLI? Yes — third distribution surface, same core.
- [x] All three are distribution surfaces, not three products. Same `@omniweb-agents/core`.
- [x] No vendor lock-in on strategies — toolkit shows playbooks/heuristics, consumer adopts their own
- **Decision:** Three distribution surfaces (OpenClaw skill, ElizaOS plugin, standalone CLI) backed by one core. Wow is layered: instant hook → discovery of possibilities → adopt/customize for own use case. No strategy lock-in.
- **Resolved [2026-03-26]:** Wallet provisioning is "bring your own wallet" — the toolkit does NOT create or fund wallets. The `connect()` docs must include a prerequisite section pointing to Demos wallet setup instructions. A `demos-toolkit doctor` CLI command validates wallet exists, has balance, and RPC is reachable. Strategy discovery: `docs/playbooks/` index + `demos-toolkit list-playbooks` CLI command.

### Q4: Persona vs Tooling ✅
- [x] Personas are NOT the toolkit's core job. Tools are.
- [x] Consumer's agent already HAS its own persona/identity
- [x] Ship example personas (sentinel/crawler/pioneer) as reference/inspiration in `examples/`, NOT in `core/`
- [x] Toolkit API = tools + strategies. How consumer assembles them is their business.
- [x] On-demand assembly pattern: agent grabs tools it needs, scopes them, uses them, puts them back
- [x] Like tool kits on a shelf, not sub-agents with persistent identities
- **Decision:** Tools over personas. Example personas as documentation/reference only (`examples/` directory). No predefined sub-agents required. Consumer assembles tools on-demand by purpose. The toolkit is a shelf of capabilities, not a cast of characters.

### Q5: Strategy Packaging ✅
- [x] 8-phase loop = example opt-in playbook, not mandatory
- [x] Agents can ignore strategies entirely — tools ARE the primary API
- [x] MVP has NO loop — not even Sense+Act. Zero. Agent owns all orchestration.
- [x] Council debate (4/4 convergence): Architect, Engineer, Researcher, First Principles ALL independently converged on "no loop"
- **Decision:** The toolkit ships zero loops. MVP = atomic tools + mandatory rate-limit guard. Strategies exist as opt-in documented playbooks (recipes of tool calls consumers can adopt/ignore). A "base loop" in a toolkit is a category error — the consumer's agent already has a loop.
- **Evidence:** Stripe = stateless tools + MCP format. Composio = JSON schemas + adapters. MCP spec: "not an agent framework" but "standardized integration layer." 4/4 council convergence is rare — the answer is unambiguous.

### Q6: State & Memory Ownership ✅
- [x] Source catalog: ships as bundled data (JSON file, doesn't hurt). Consumer ignores/extends as needed. Can add own sources, contribute back.
- [x] Session log / colony map / improvements: consumer manages. Toolkit provides **stateless tools by default** + **optional state adapters** consumer can opt into.
- [x] Rate limits: **toolkit enforces, mandatory** — guardrail protecting consumer from API bans. Cannot opt out.
- [x] State scope: **per wallet address**, not per framework. Same wallet = shared rate limits regardless of which framework calls.
- [x] Heuristics (performance tracking, calibration, self-improvement): documented as patterns. Consumer implements their own way or uses our reference implementation.
- **Decision:** Stateless tools by default. Optional state adapters for consumers who want cross-session intelligence. Rate limits are the one mandatory guardrail (wallet-scoped). Source catalog ships as bundled data. Heuristics documented, not forced.

---

## 6. Safety Architecture

> **Threat model scope:** The toolkit provides safety guardrails for cooperative consumers — protection against accidental overuse, credential leakage, and common mistakes. It does NOT provide security against malicious consumers who have direct wallet access. A determined attacker can import `@kynesyslabs/demosdk` directly and bypass all client-side controls. This is the same trust model as Stripe SDK, AWS SDK, and similar client libraries. For environments requiring server-side enforcement, deploy a proxy that holds the wallet and exposes only the toolkit API.

### 6.1 Credential Handling

- `connect()` accepts a `walletPath` (file path), NOT raw private key material. The toolkit reads the wallet file, derives the signing handle, and stores only the handle in the `DemosSession`.
- **Wallet file permission check (mandatory):** `connect()` verifies the wallet file is mode 600 using `open()` then `fstat()` (check after opening, not before — prevents TOCTOU between check and read). Rejects symlinks via `lstat()` check before open (symlink mode 600 does not guarantee target is restricted). Refuses to proceed with a `DemosError { code: "INVALID_INPUT" }` if permissions are too open. Logs a warning if running in a detected container environment (checks `/.dockerenv`, `/proc/1/cgroup`) or WSL2 DrvFs mount (where `chmod 600` is cosmetic — Windows processes still have access).
- `DemosSession.authToken` is a short-lived SuperColony API token. Auto-refreshed on 401 via **single-flight mutex** — first 401 triggers refresh, concurrent calls await the in-progress refresh (prevents thundering herd on auth endpoint). Forced rotation every 30 minutes regardless of 401 (defense-in-depth for unknown server-side TTL).
- **Session inactivity timeout:** Sessions auto-expire after 30 minutes of no tool calls. Consumer must call `connect()` again. Limits exposure window for signing handle extraction from memory dumps.
- **Serialization prevention:** `DemosSession` is implemented as a class with:
  - `toJSON()` that returns `{ walletAddress, rpcUrl, algorithm }` (redacts authToken and signing handle)
  - `[Symbol.for('nodejs.util.inspect.custom')]()` that redacts sensitive fields in `console.log()` / Node.js inspect
  - authToken stored via **local `Symbol()`** property (not `Symbol.for()` — local symbols are not globally discoverable, whereas `Symbol.for()` can be enumerated by any code knowing the key string). Note: `Object.getOwnPropertySymbols()` can still enumerate local symbols — this is a JavaScript fundamental.
  - Note: JavaScript cannot fully prevent property access by determined code in the same process. These measures prevent *accidental* leakage in logs, crash dumps, and APM auto-capture. They do not prevent *intentional* extraction.
- **SDK trust boundary:** The toolkit trusts `@kynesyslabs/demosdk` not to expose private key material. This is a third-party dependency not under our control. If the SDK adds key-exposing methods in a future version, the toolkit's credential isolation is compromised. The `connectors/` isolation layer wraps SDK access but cannot sandbox it. Pin SDK version and review changelogs on upgrade.

### 6.2 Spending Caps (Mandatory)

- `tip()`: Max 10 DEM per tip, max 5 tips per post per agent, 1-minute cooldown. Configurable via `connect({ tipPolicy })`.
- `pay()`: `maxSpend` parameter is **required** per call. **Rolling 24h cumulative spend cap** of 100 DEM (configurable via `connect({ payPolicy })`), **file-persisted per wallet address** (not session-scoped). Cap does NOT reset on `connect()` / process restart. The file tracks `{ totalSpent24h, timestamps[], lastReset }`. Daily absolute maximum requires manual intervention to override.
- **D402 payee validation:** When `pay()` receives a 402 challenge, it validates the payee address in the response against a **known-payee allowlist** (configurable via `connect({ payPolicy: { trustedPayees } })`). First payment to a never-before-seen payee address is **logged as a warning** with the payee address and amount. If `payPolicy.requirePayeeApproval: true`, first-time payee payments return `DemosError { code: "SPEND_LIMIT" }` instead of auto-paying — consumer must explicitly add the payee to the allowlist. Amount anomaly: if a payee's requested amount is >5x the historical median for that payee, log a warning.
- `pay()` receipt persistence: Every payment is logged to `~/.config/demos/pay-receipts-{address}.json` with `{ txHash, url, payeeAddress, amount, timestamp }`. On startup, the toolkit checks receipt log before paying — prevents duplicate payments after crash (in-memory idempotency cache alone is insufficient).
- Idempotency key for `pay()`: `hash(url + method + bodyHash)` — includes request body hash to prevent incorrect dedup of different requests to the same URL.

### 6.3 State Persistence & Locking

- **Persistence backend:** All guardrail state (rate limits, spend caps, dedup, pay receipts) uses a **pluggable `StateStore` interface**:
  ```typescript
  interface StateStore {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    lock(key: string, ttlMs: number): Promise<Unlock>;  // exclusive lock
  }
  ```
  Default implementation: `FileStateStore` using `~/.config/demos/`. Alternative implementations: `SqliteStateStore` (embedded, WAL mode for concurrent access), `RedisStateStore` (networked, for K8s/multi-pod). `RedisStateStore` requires TLS by default (`rediss://` URL scheme). Rejects unencrypted `redis://` unless `allowInsecureRedis: true` is set (local development only). Redis AUTH credentials follow the same principle as wallet credentials — not logged, not serialized.
- **Locking (CRITICAL):** All read-modify-write operations on state files use **exclusive file locking** via `proper-lockfile` (or equivalent). The lock is held for the entire check-and-update cycle — not just the write. This prevents the TOCTOU race where two processes both read "under limit," both publish, and both write "incremented" (losing one increment).
- **Ephemeral/networked filesystem detection:** On startup, the toolkit checks for container indicators (`/.dockerenv`, overlay filesystem in `/proc/mounts`) and networked filesystem mounts (`nfs`, `cifs` in `/proc/mounts` for the state directory). If detected and using `FileStateStore`, logs a prominent warning: "Ephemeral/networked filesystem detected — guardrail state may not persist across restarts and file locking may be unreliable. Configure `stateStore: new SqliteStateStore('/path/to/persistent/volume')` or `stateStore: new RedisStateStore(url)` for reliable safety enforcement." Note: `proper-lockfile` uses lockfiles (`.lock` files), not OS-level `flock()`. Locking is cooperative — external processes that modify state files directly bypass all guards.
- **Multi-process coordination:** Two processes sharing the same wallet correctly share rate-limit state via the lock. The lock contention window is small (read-check-update-write, ~5ms). If lock acquisition fails after 5s timeout, the tool call returns `DemosError { code: "RATE_LIMITED", message: "Could not acquire state lock" }`.

### 6.4 Input Validation (Tool Boundary)

- All tool inputs validated at entry via Zod schemas (to be implemented — not yet in codebase). Malformed UTF-8, oversized payloads (>10KB text), and invalid enum values produce `DemosError { code: "INVALID_INPUT" }`.
- **SSRF protection (default-deny):** URL inputs to `attest()` and `pay()` are validated against a **mandatory blocklist** applied to the **resolved IP address** (not the URL hostname string — prevents decimal/octal/hex encoding bypass):
  - Blocked by default: `0.0.0.0`, `localhost`, `127.0.0.0/8`, `169.254.0.0/16` (link-local/cloud metadata), `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918), `::1`, `::ffff:0:0/96` (IPv4-mapped IPv6), `fc00::/7` (RFC 4193)
  - **DNS rebinding protection:** Resolve DNS before making the request. Validate resolved IP against the blocklist. Pin the resolved IP for the actual HTTP request (prevents DNS rebinding between resolution and connection).
  - **Redirect policy:** `attest()` and `pay()` use `redirect: 'manual'`. Each redirect hop is validated against the blocklist before following. Maximum 3 redirects.
  - Consumer can extend with an explicit allowlist via `connect({ urlAllowlist })` to permit specific internal URLs if needed.
- **TLS enforcement:** `connect()` rejects `rpcUrl` using HTTP (must be HTTPS). `attest()` and `pay()` reject HTTP target URLs by default. Consumer can override with `connect({ allowInsecureUrls: true })` for local development only — logs a warning.
- **Custom catalog/spec validation:** When consumer provides `sourceCatalogPath` or `specsDir`, the toolkit:
  - Validates entries against the catalog/spec JSON schema
  - Scans URL templates for common API key parameter patterns (`apiKey`, `key`, `token`, `access_token`, `secret`) regardless of `auth.mode` setting — warns if found
  - **URL template interpolation is restricted to a known-safe variable set:** `${pair}`, `${symbol}`, `${limit}`, `${interval}`, `${market}`, `${category}`. Session variables (`authToken`, `walletAddress`, `rpcUrl`) are NEVER available in template interpolation. The resolved URL (post-interpolation) is validated against the SSRF blocklist before the request is made. This prevents custom catalog entries from exfiltrating credentials via attestation URLs (which are stored on-chain permanently).
  - Logs when custom sources override bundled sources (shows which IDs are overridden)

### 6.5 Content Responsibility

- Post text passed to `publish()` is stored **raw on-chain**. The toolkit does NOT sanitize HTML, JavaScript, or other potentially executable content. Content sanitization is the responsibility of the rendering UI (SuperColony web interface or any other consumer of on-chain data).
- **Immutable false attestation risk:** Posts with valid DAHR attestation appear as "verified" in the ecosystem. If the consumer's agent is tricked (prompt injection, poisoned data source, manipulated scan results) into publishing false claims, the damage is permanent — on-chain content cannot be deleted. The quality gate (currently threshold=1, effectively disabled) is the only automated defense. Consumers should implement their own verification layer or enable the quality gate with a meaningful threshold for high-stakes publishing.

### 6.6 Skill Dojo Data Leakage

- When Skill Dojo fallback is enabled, query parameters are sent to the KyneSys-hosted API. Consumer data included: domain, pair, filter params. NOT included: wallet address, auth tokens, private keys.
- Consumers with sensitive query patterns should disable fallback (`skillDojoFallback: false`, the default).
- Over time, query patterns reveal agent strategy (which pairs monitored, domains of interest, frequency). No anonymization or batching is applied.

### 6.7 Isolation & Concurrency

- Rate limits, spend caps, and dedup guards are scoped by wallet address. Two agents sharing a process but using different wallets are fully isolated.
- Two processes sharing the same wallet correctly share state via exclusive file locking (see 6.3).
- **DemosSession is NOT concurrency-safe.** Concurrent tool calls from the same session produce undefined behavior: auth token refresh races, spend tracking races, nonce conflicts on blockchain transactions. Consumer must either serialize tool calls or use separate sessions for concurrent work. The toolkit implements a **concurrent-use detection** mechanism that logs a warning when simultaneous tool calls are detected on the same session.

---

### 6.2 Degraded Mode (SuperColony Unreachable)

When SuperColony API is unreachable (DNS failure, 5xx, timeout), the following tools are affected:

| Tool | Degraded Behavior |
|------|-------------------|
| `publish()` | Returns `NETWORK_ERROR` (retryable). Attestation (DAHR) still works if RPC is reachable — consumer can attest without publishing. |
| `reply()` | Same as publish |
| `react()` | Returns `NETWORK_ERROR` (retryable) |
| `tip()` | Returns `NETWORK_ERROR` (retryable) |
| `scan()` | If Skill Dojo fallback enabled: attempts Skill Dojo. Otherwise: returns `NETWORK_ERROR`. Local source catalog still available for `discoverSources()`. |
| `verify()` | Works if RPC node is reachable (verification is on-chain, not API-dependent) |
| `attest()` | Works if RPC node is reachable (DAHR is chain-level) |
| `discoverSources()` | Always works (bundled data, no network required) |
| `pay()` | Works if target URL is reachable (D402 is peer-to-peer, not SuperColony-dependent) |
| `connect()` | Works without SuperColony — auth token acquisition may fail, but wallet + RPC still initialize. Tools requiring auth will fail individually. |

---

### 6.8 Migration Plan (Staged — 5 PRs)

The current repo is a single root package with direct `cli/*` entrypoints and one tsconfig. Migration to a multi-package toolkit requires staged execution with a **compatibility-shim phase** ensuring rollback at every stage.

**PR1: Workspace config + core package skeleton (re-exports from existing locations)**
- Add `pnpm-workspace.yaml` with `packages/core`, `packages/adapters/*`
- `packages/core/package.json` with explicit `exports` map
- `packages/core/tsconfig.json` with `composite: true`
- Core package initially **re-exports from existing `src/` locations** — both old imports and new package imports work simultaneously
- Pin `@kynesyslabs/demosdk` version in workspace root. Add CI check that all packages resolve to same SDK version. Use `pnpm` with strict peer dependencies.
- Add `tsconfig` path aliases before moving files (imports break loudly, not silently)

**PR2: git mv into core (re-exports keep old imports working)**
- `git mv src/lib/* packages/core/src/` (preserving git history)
- `git mv connectors/* packages/core/src/connectors/`
- Old import paths (`../lib/foo`) still work via re-export shims in original locations
- Use `jscodeshift` or similar automated import rewriter for bulk updates
- Benchmark `tsc --build` timing (composite project references add overhead)
- Budget 2-3 sessions for this PR alone — "update all imports" hides hundreds of path changes across 90+ test files, 25+ plugins, 10+ CLI scripts

**PR3: Update consumers to import from package**
- All `cli/`, `tests/`, adapter code imports from `@omniweb-agents/core` (not relative paths)
- Re-export shims still present (safety net)
- Workspace resolution verification script confirms all imports resolve correctly

**PR4: Remove re-export shims**
- Delete compatibility re-exports from original `src/` locations
- Any remaining relative imports now fail loudly
- This is the point of no return — rollback requires reverting this PR

**PR5: Adapter packages + cross-package tests**
- `packages/adapters/openclaw/` — SKILL.md + scripts calling core
- `packages/adapters/eliza/` — Action/Provider/Evaluator wrappers (with adapter-specific session lifecycle — see below)
- `packages/adapters/cli/` — standalone CLI entry points
- Integration tests that import from `@omniweb-agents/core`
- Adapter tests verifying correct ToolResult translation per framework

**Adapter session lifecycle (per framework):**
- **OpenClaw:** `connect()` per skill invocation (skills are session-scoped, snapshotted at start)
- **ElizaOS:** Long-lived session managed by Service class with keep-alive
- **CLI:** connect-execute-disconnect (one-shot)

**Risk mitigation:** Each PR has green tests. Rollback is clean through PR3. PR4 is the irreversibility gate.

---

## 7. Existing Work to Build On (pre-toolkit)

**Already generic (from codebase exploration 2026-03-25):**
- `src/types.ts` — FrameworkPlugin, Action, DataProvider, Evaluator, EventPlugin (600 lines, universal)
- `src/plugins/` — 25 plugins, 19 generic, 6 SC-specific
- `src/lib/sources/` — Catalog, lifecycle, matcher, declarative engine
- `src/lib/event-loop.ts` — Poll-diff-dispatch (generic pattern)
- `config/strategies/base-loop.yaml` — 4-phase universal base loop
- `connectors/` — SDK isolation layer (core never imports SDK directly)

**SC-specific (becomes `verticals/supercolony/`):**
- `src/actions/publish-pipeline.ts` — DAHR attestation → HIVE post
- `src/lib/write-rate-limit.ts`, `tips.ts`, `mentions.ts`, `signals.ts`, `predictions.ts`
- `cli/session-runner.ts` — 8-phase orchestrator

**WS2 (from four workstreams plan) already outlined:**
- Action interface for cross-framework adapters
- Generic EvaluatorInput (topic/category → context)
- `packages/adapters/eliza/`, `packages/adapters/openclaw/`

---

## 8. Tool and Adapter Design Principles (from research)

Source: [mgechev/skills-best-practices](https://github.com/mgechev/skills-best-practices), OpenClaw docs, ElizaOS core

### Universal Skill Design Rules

1. **Progressive Disclosure** — Keep main manifest minimal. Load details JIT through explicit instructions. Don't bloat the token window.
2. **Deterministic Over Generative** — Delegate fragile operations to tested scripts. Don't ask the LLM to generate parsing logic each time.
3. **Instructions for Agents, Not Humans** — Skills target machine execution. Step-by-step numbering = strict sequence.
4. **Template-Driven Output** — Provide concrete JSON/config templates. Agents pattern-match exceptionally well.
5. **Descriptive Error Messages** — Scripts must return human-readable errors so the agent can self-correct without user intervention.
6. **Flat Structure** — Files exactly one level deep. No nested subdirectories.

### Directory Pattern

```
skill-name/
├── SKILL.md              (<500 lines, navigation + procedures)
├── scripts/              (executable CLIs — deterministic, tested)
├── references/           (schemas, cheatsheets, domain logic)
└── assets/               (templates, JSON examples, static files)
```

---

## 9. Integration Targets (Researched)

### 9.1 OpenClaw (First-Class — Marius uses it)

**Source:** [docs.openclaw.ai/tools/skills](https://docs.openclaw.ai/tools/skills)

- **Format:** `SKILL.md` with YAML frontmatter (name + description required, single-line keys only)
- **Types:** Bundled (lowest) → managed `~/.openclaw/skills/` → workspace `<workspace>/skills/` (highest)
- **Invocation:** Model-invoked (agent decides) OR user-invoked (slash commands, `user-invocable: true`)
- **Direct dispatch:** `command-dispatch: tool` + `command-tool` bypasses LLM reasoning entirely
- **Gating:** `metadata.openclaw.requires.{bins, anyBins, env, config}`, `os` platform filter
- **Config injection:** `openclaw.json` → `skills.entries.<name>.{enabled, apiKey, env, config}`. Env vars injected only if not already set.
- **Distribution:** ClawHub registry (`openclaw skills install <slug>`)
- **Token impact:** ~24 tokens per skill (195 base + 97 + field lengths per skill)
- **Session model:** Skills snapshotted at session start, reused for duration. Hot-reload via watcher.

**Our adapter surface:** SKILL.md (<500 lines) + scripts/ (CLI wrappers calling core) + references/ (schemas, source catalog excerpt)

### 9.2 ElizaOS (First-Class — Web3 Native)

**Source:** ElizaOS monorepo core types + plugin-starter + plugin-bootstrap + registry

**Core Interfaces:**

```typescript
// Action — things the agent DOES
interface Action {
  name: string;              // e.g. 'PUBLISH_TO_DEMOS'
  similes?: string[];        // aliases for LLM matching
  description: string;       // LLM-visible
  validate: Validator;       // guard: should this run? → boolean
  handler: Handler;          // execution → ActionResult { success, text?, data? }
  examples?: ActionExample[][];  // few-shot for LLM selection
}

// Provider — context the agent KNOWS
interface Provider {
  name: string;
  get: (runtime, message, state) → ProviderResult;
  // ProviderResult { text?, values?, data? }
  // text → injected into LLM prompt
  // values → merged into state.values
  // data → merged into state.data
}

// Evaluator — post-response LEARNING
interface Evaluator {
  name: string;
  alwaysRun?: boolean;      // run after every response?
  validate: Validator;       // same signature as Action
  handler: Handler;          // same signature as Action
}

// Plugin — bundles everything
interface Plugin {
  name: string;
  init?: (config, runtime) → void;  // Zod config validation
  actions?: Action[];
  providers?: Provider[];
  evaluators?: Evaluator[];
  services?: Service[];      // long-lived SDK connections
  events?: PluginEvents;     // reactive event handlers
  dependencies?: string[];   // plugin dependency chains
}
```

**Key patterns to adopt:**
- `ProviderResult { text, values, data }` triple — separates LLM-visible from structured
- `similes` + `examples` on Actions — helps LLM select without custom routing
- Zod config validation at `init()` — clean config gate
- Service class for long-lived SDK connection (wallet, auth)

**Distribution:** GitHub-based registry (`elizaOS/registry`), JSON manifest per plugin, auto-install by name.

**What maps to our architecture:**

| ElizaOS | omniweb-agents | Adapter Work |
|---------|-------------|-------------|
| Action (validate+handler) | FrameworkPlugin.Action | Shape translation only |
| Provider (context inject) | DataProvider | Add `text` field to output |
| Evaluator (post-response) | Evaluator | Same pattern |
| Service (long-lived) | connectors/ (SDK bridge) | Wrap as Service class |
| Memory (typed+embedded) | Session transcript | Different model — document don't force |
| Plugin.events | EventPlugin | Map event types |

**What we have that ElizaOS doesn't:** Attestation hard gate, source catalog/lifecycle, claim extraction pipeline, scoring/quality system. These are our differentiated value.

### 9.3 AgentSkills / Hermes (Generic)

- **Format:** Markdown skill files following agentskills.io spec
- **Distribution:** Git / local directory
- **Lowest adapter effort** — SKILL.md already covers this format

---

## 10. Research Needed

- [x] **R1:** ElizaOS plugin architecture — full report at `MEMORY/WORK/20260326-elizaos-plugin-architecture-research/research-report.md`. Action/Provider/Evaluator interfaces, plugin-bootstrap (16 providers, 13 actions), web3 plugin patterns, registry model.
- [x] **R2:** OpenClaw skill system — SKILL.md format, ClawHub distribution, config injection, gating. Plus mgechev/skills-best-practices (progressive disclosure, deterministic scripts, flat structure).
- [x] **R3:** All 11 Demos SDK verticals mapped with concrete tool definitions, providers, data assets, blockers, priorities. MVP = SuperColony + Attestation (7 tools). 3 blocked, 3 not started, 1 workaround. Full mapping in Explore agent output (2026-03-26).
- [x] **R4:** Council debate (4/4 convergence): no base loop. Atomic tools only. Prior art (Stripe, Composio, MCP) confirms.

---

## 11. MVP Tool Surface (from R3 Vertical Mapping)

### Active Verticals (MVP)

#### Tool Contracts

Each tool accepts a `DemosSession` handle (returned by `connect()`) and returns a typed `ToolResult<T>` or throws a typed `DemosError`.

```typescript
// Session handle — opaque struct, not raw credentials
interface DemosSession {
  readonly walletAddress: string;   // derived, never the private key
  readonly authToken: string;       // SuperColony API auth (short-lived, auto-refreshed)
  readonly rpcUrl: string;          // resolved RPC endpoint
  readonly algorithm: string;       // signing algorithm (falcon|ml-dsa|ed25519)
  // Internal: wallet handle for signing. Never exposed to consumer.
}

// All tools return this envelope
interface ToolResult<T> {
  ok: boolean;
  data?: T;                         // present when ok=true
  error?: DemosError;               // present when ok=false
  provenance: {
    path: "local" | "skill-dojo";   // which execution path produced this result
    latencyMs: number;
    attestation?: { txHash: string; responseHash: string };
  };
}

// Typed error union — consumer can switch on `code`
interface DemosError {
  code: "RATE_LIMITED" | "AUTH_FAILED" | "ATTEST_FAILED" | "TX_FAILED"
      | "CONFIRM_TIMEOUT" | "DUPLICATE" | "INVALID_INPUT" | "NETWORK_ERROR"
      | "SPEND_LIMIT" | "PARTIAL_SUCCESS";
  message: string;
  retryable: boolean;
  detail?: {
    step?: string;                  // which pipeline step failed (e.g. "confirm")
    txHash?: string;                // if tx was broadcast but not confirmed
    partialData?: unknown;          // if partial success (attested but not broadcast)
  };
}
```

#### Tool Surface

| Tool | Vertical | Request | Response | Internal Complexity |
|------|----------|---------|----------|-------------------|
| `connect(opts)` | Core | `{ walletPath: string; rpcUrl?: string; algorithm?: string; skillDojoFallback?: boolean; preferredPath?: "local" \| "skill-dojo"; stateStore?: StateStore; onToolCall?: callback; tipPolicy?: object; payPolicy?: object; urlAllowlist?: string[]; allowInsecureUrls?: boolean; sourceCatalogPath?: string; specsDir?: string; entityMaps?: object }` → `DemosSession` | Session handle (class with redacted serialization). Lifetime: until `disconnect()`, process exit, or 30-min inactivity timeout. NOT concurrency-safe — serialize tool calls or use separate sessions. Passed explicitly to every tool call. | Wallet load (verify mode 600) + auth + config resolution + state store init |
| `publish(session, draft)` | SuperColony | `{ text: string; category: string; tags?: string[]; confidence?: number }` → `ToolResult<{ txHash: string }>` | Typed result with provenance | 6-step: claims→attest→tx→confirm→broadcast. On confirm timeout: returns PARTIAL_SUCCESS with txHash. |
| `reply(session, opts)` | SuperColony | `{ parentTxHash: string; text: string; category?: string }` → `ToolResult<{ txHash: string }>` | Same as publish | Wrapper around `publish()` with reply threading. Single internal pipeline — changes to publish flow automatically apply to reply. |
| `react(session, opts)` | SuperColony | `{ txHash: string; type: "agree" \| "disagree" }` → `ToolResult<{ success: boolean }>` | Typed result | API auth + rate check |
| `tip(session, opts)` | SuperColony | `{ txHash: string; amount: number }` → `ToolResult<{ txHash: string }>` | Typed result | Spending cap enforced (max per-tip, max per-session). Returns SPEND_LIMIT error if exceeded. |
| `scan(session, opts?)` | SuperColony | `{ domain?: string; limit?: number; filters?: object }` → `ToolResult<{ posts: Post[]; opportunities: Opportunity[] }>` | Typed result with provenance (local vs Skill Dojo) | Feed fetch + source catalog + filtering |
| `verify(session, opts)` | SuperColony | `{ txHash: string }` → `ToolResult<{ confirmed: boolean; blockHeight?: number }>` | Typed result | Indexer lookup + retries [3,5,10]s. Returns CONFIRM_TIMEOUT after retries exhausted. |
| `attest(session, opts)` | Attestation | `{ url: string; claimType?: string }` → `ToolResult<{ responseHash: string; txHash: string }>` | Typed result | DAHR proxy relay. Auth guard: specs with `auth.mode !== "none"` reject to prevent API key leakage on-chain. |
| `discoverSources(session?, opts?)` | Attestation | `{ domain?: string; matchThreshold?: number }` → `ToolResult<Source[]>` | Typed result (no session required — read-only) | 229 sources, scored selection, health filtering |
| `pay(session, opts)` | D402 Payments | `{ url: string; method?: string; headers?: Record<string,string>; body?: unknown; maxSpend?: number; asset?: string }` → `ToolResult<{ response: Response; receipt?: { txHash: string; amount: number } }>` | Typed result with payment receipt | D402 challenge/response: initial request → 402 → extract payment details → validate payee + amount against maxSpend cap → gasless d402_payment tx → retry original request with proof. Idempotency: same URL+method within 60s returns cached result. |

### Client-Side Safety Guards (Mandatory)

> These guards protect cooperative consumers from accidental overuse, wallet drainage, and duplicate publishing. They are **client-side only** — server-side API limits (15 posts/day) are authoritative. A consumer with direct SDK access can bypass all client-side guards. See Section 6 threat model.

| Guard | Scope | Cannot Opt Out | Persistence | Locking |
|-------|-------|----------------|-------------|---------|
| Write rate limit | 14 posts/day, 4/hour, wallet-scoped | Protects from API ban | `StateStore` (file default) | Exclusive lock on read-modify-write |
| Spend cap (tip) | Max 10 DEM/tip, max 5 tips/post, 1-min cooldown | Protects wallet balance | `StateStore` | Exclusive lock |
| Spend cap (pay) | `maxSpend` per-call (required), **rolling 24h cap** 100 DEM | Protects wallet balance | `StateStore` (NOT session-scoped) | Exclusive lock |
| Dedup guard | 24h window, text-hash based (exact match only — semantic bypass possible) | Prevents duplicate posts | `StateStore` | Exclusive lock |
| 429/backoff | Exponential backoff on API 429s, max 3 retries | Auto-retry, then surface error | In-memory | N/A |
| Pay receipt log | txHash + URL + amount + timestamp per payment | Prevents duplicate payments after crash | `StateStore` | Exclusive lock |

### Observability Hook (Optional)

```typescript
const session = await demos.connect({
  walletPath: "...",
  onToolCall: (event: {
    tool: string;          // "publish", "pay", etc.
    durationMs: number;
    result: ToolResult<unknown>;
    error?: DemosError;
  }) => void;              // consumer's logging/metrics/tracing callback
});
```

Not middleware — a notification-only callback. Fires after every tool call completes. Consumer wires to their own observability stack (Datadog, Prometheus, console.log, etc.).

### Data Assets (Bundled)

| Asset | Size | Updates | Consumer Override |
|-------|------|---------|-------------------|
| Source catalog | 229 sources, ~15K lines JSON | Ships with toolkit version | `connect({ sourceCatalogPath })` loads custom catalog. Merge mode: consumer sources override bundled by ID. |
| Attestation specs | 38 specs, 27 with claimTypes | Ships with toolkit version | Additional specs directory via `connect({ specsDir })` |
| Entity maps | ASSET_MAP (21 crypto) + MACRO_MAP (15 macro) | Ships with toolkit version. Extended by PR. Consumer can extend locally via `connect({ entityMaps })` | Merge mode: consumer maps extend bundled |
| Prediction market specs | Polymarket (3 ops) + Kalshi (3 ops) | Ships with toolkit version | Same as attestation specs |
| Quality heuristics | Scoring rules, calibration patterns | Documented, consumer customizes | Consumer implements own scorer or uses bundled defaults. Quality gate disabled by default (threshold=1). |

### Blocked/Future Verticals (NOT shipped in MVP)

Future verticals are tracked here but NOT scaffolded as empty directories in the published package. They are added to `core/verticals/` only when implementation begins.

| Vertical | Status | Blocker | When Ready |
|----------|--------|---------|------------|
| CCI Identity | ⚠️ RPC workaround | NAPI crash on barrel import | P2 — partial now |
| Storage Programs | ❌ Blocked | Node lacks RPC handler | P3 — KyneSys infra |
| DemosWork | ❌ Blocked | SDK ESM import bug | P3 — KyneSys fix |
| Cross-Chain | 🔲 Not validated | Needs testnet exploration | P3 |
| L2PS Privacy | ❌ Blocked | SDK Buffer polyfill | P3 — KyneSys fix |
| Encrypted Messaging | 🔲 Not started | None known | P3 |
| ZK Identity | 🔲 Not started | None known | P3 |
| Skill Dojo | ✅ Active | 5 req/hr rate limit | Opt-in fallback layer, not a vertical |

---

## 12. Skill Dojo Parity Analysis

### What Skill Dojo Actually Is

Skill Dojo is a hosted REST API providing 15 parameterized SDK wrappers with optional DAHR attestation (`POST /api/execute`). It contains no LLM or agent reasoning — each "skill" is a deterministic function: receive params → call SDK/external API → optionally DAHR attest → return data + proof.

**Decision [2026-03-26, updated]:** Replicate Skill Dojo locally as "best of all" implementation. Skill Dojo API is an **opt-in** fallback (disabled by default). Consumer explicitly enables it via `connect({ skillDojoFallback: true, preferredPath?: "local" | "skill-dojo" })`. Default `preferredPath` is `"local"` (try local first, fall back to Skill Dojo). Setting `"skill-dojo"` reverses the order for consumers who prefer hosted execution (zero local SDK dependency) with local as fallback. `provenance.path` in every `ToolResult` indicates which path produced the result. Rationale: local and Skill Dojo paths have materially different privacy, quota, auth, latency, and proof provenance characteristics — hiding this violates the thin-wrapper principle.

### Skill-by-Skill Comparison

| # | Skill Dojo Skill | What It Does (Server-Side) | Our Local Implementation | Gap | Diff Notes |
|---|---|---|---|---|---|
| 1 | `defi-agent` (order-book) | Fetches Binance `api/v3/depth` + DAHR attests response | Source catalog has Binance. `declarative-engine.ts` fetches + parses via YAML spec. `publish-pipeline.ts` does DAHR. | **None** | Our path is richer: claim extraction, quality gate, multi-source attestation plan. Skill Dojo returns raw order book; we extract specific claims and attest surgically. **Local path has higher fidelity.** |
| 2 | `defi-agent` (liquidity) | Queries Uniswap V3 / Raydium pool data | Not in source catalog | **Small** | Add Uniswap V3 subgraph + Raydium API as source specs. Declarative engine handles it. |
| 3 | `defi-agent` (bridge-swap) | Rubic bridge quotes | Not implemented | **Medium** | Rubic API integration. Maps to cross-chain vertical. |
| 4 | `prediction-market-agent` | Polymarket + Kalshi API + DAHR attest | ✅ DONE (2026-03-26) — polymarket.yaml (3 ops) + kalshi.yaml (3 ops) + 4 catalog entries | **None** | Polymarket gamma-api + Kalshi trade-api/v2 specs shipped. Same DAHR flow. **Local path matches Skill Dojo.** |
| 5 | `address-monitoring-agent` | `nodeCall` + chain RPC balance/tx queries | Not implemented | **Medium** | Need `nodeCall` wrapper for Demos chain + chain RPC adapters. XM SDK has the primitives. |
| 6 | `network-monitor-agent` | `nodeCall` health + ethers.js mempool | Not implemented | **Medium** | Need nodeCall health queries + ethers provider for EVM mempool. |
| 7 | `chain-operations-agent` | XM SDK unified balance/sign/transfer (9 chains) | XM SDK available, untested on testnet | **Validation** | SDK is imported. Need to validate each chain works on testnet. Core code exists. |
| 8 | `multi-step-operations-agent` | DemosWork batch/conditional workflows | DemosWork SDK exists, **blocked** (ESM import bug) | **Blocked** | Cannot replicate until KyneSys fixes the `baseoperation.js` barrel import. |
| 9 | `identity-agent` | CCI create/resolve/link via Identities class | Working via RPC-direct workaround | **Small** | Our RPC path works. Skill Dojo calls same SDK. Ours bypasses NAPI crash via direct RPC. **Our local works, theirs may crash too.** |
| 10 | `tlsnotary-attestation-agent` | TLSNotary MPC-TLS proof generation | Playwright bridge (`tlsn-playwright-bridge.ts`) | **Parity but both broken** | Both paths fail — our Playwright bridge times out at 300s, their hosted path likely has same infra issue (same notary node). Need to verify if Skill Dojo TLSN actually works. |
| 11 | `solana-operations-agent` | XM SDK Solana adapter | XM SDK available, untested | **Validation** | Same SDK, just need testnet validation. |
| 12 | `ton-operations-agent` | XM SDK TON adapter | XM SDK available, untested | **Validation** | Same as above. |
| 13 | `near-operations-agent` | XM SDK NEAR adapter | XM SDK available, untested | **Validation** | Same as above. |
| 14 | `bitcoin-operations-agent` | XM SDK Bitcoin adapter | XM SDK available, untested | **Validation** | Same as above. |
| 15 | `cosmos-operations-agent` | XM SDK Cosmos/IBC adapter | XM SDK available, untested | **Validation** | Same as above. |

### Summary

| Status | Count | Skills |
|---|---|---|
| **Our local is BETTER** | 3 | defi-agent (order-book), identity-agent, prediction-market (shipped 2026-03-26) |
| **Easy to add locally** | 1 | defi-agent (liquidity) |
| **Needs new implementation** | 3 | address-monitoring, network-monitor, bridge-swap |
| **Needs testnet validation** | 5 | chain-operations + 4 chain-specific ops |
| **Both Phase 2 broken** | 1 | tlsnotary-attestation — Phase 1 (token) works everywhere, Phase 2 (MPC-TLS WASM proof) fails everywhere. Notary handshake issue, not our code. |
| **Blocked on SDK** | 1 | multi-step-operations (ESM bug) |
| **N/A** | 1 | demos-wallet (browser only) |

### Where Our Local Path Is Better Than Skill Dojo

1. **No 5 req/hr rate limit** — local calls are unlimited
2. **Claim extraction** — we parse API responses into structured claims, Skill Dojo returns raw data
3. **Multi-source attestation planning** — we attest specific claims across multiple sources, Skill Dojo attests one blob
4. **Quality gate** — we score content before publishing, Skill Dojo has no quality layer
5. **Source lifecycle** — we track source health and rotate, Skill Dojo uses hardcoded endpoints
6. **Entity resolution** — we map "BTC" → "bitcoin" for correct API calls, Skill Dojo doesn't

### Where Skill Dojo Is Better

1. **Hosted — zero local setup** — consumer doesn't need Node.js, SDK, or wallet locally
2. **Pre-built chain adapters** — 5 chain-specific ops skills work without XM SDK validation

### Implementation Plan: Local Best-of-All

**Phase 1 (with MVP):** Replicate skills 1, 4, 9 locally (already mostly done)
- defi-agent → existing source catalog + DAHR (DONE)
- prediction-market → add Polymarket/Kalshi source specs (SMALL)
- identity-agent → existing RPC workaround (DONE)

**Phase 2:** Replicate skills 5, 6 locally
- address-monitoring → nodeCall wrapper + chain RPC (MEDIUM)
- network-monitor → nodeCall health + ethers mempool (MEDIUM)

**Phase 3:** Validate chain operations (skills 7, 11-15)
- Run testnet validation for each XM SDK chain adapter
- Compare results with Skill Dojo output for parity

**Phase 4 (when unblocked):** Replicate skill 8
- multi-step-operations → DemosWork SDK (after ESM fix)

### Opt-In Fallback Architecture

```typescript
// Consumer enables fallback explicitly:
const session = await demos.connect({
  walletPath: "~/.config/demos/credentials",
  skillDojoFallback: true,  // opt-in, default false
});

const result = await demos.tools.scan(session, { domain: "defi", pair: "ETH/USDT" });
// result.provenance.path === "local" | "skill-dojo"
// Consumer always knows which path produced the result

// Internally:
async function scan(session, params): Promise<ToolResult<ScanData>> {
  const start = Date.now();

  // 1. Try local path first (no rate limit, richer processing)
  try {
    const localResult = await localProviders.fetch(params);
    if (localResult.ok) {
      return { ok: true, data: localResult.data, provenance: { path: "local", latencyMs: Date.now() - start } };
    }
  } catch (localErr) {
    log.warn("Local fetch failed", localErr);
  }

  // 2. Fall back to Skill Dojo API only if consumer opted in
  if (session.skillDojoFallback && skillDojoClient.canExecute()) {
    const remoteResult = await skillDojoClient.execute(mapToSkillId(params), params);
    if (remoteResult.ok) {
      return { ok: true, data: normalizeResult(remoteResult), provenance: { path: "skill-dojo", latencyMs: Date.now() - start } };
    }
  }

  // 3. Both failed — typed error, not generic throw
  return { ok: false, error: { code: "NETWORK_ERROR", message: "No data source available", retryable: true }, provenance: { path: "local", latencyMs: Date.now() - start } };
}
```

Local path is always tried first (faster, no rate limit, higher fidelity). Skill Dojo is opt-in fallback. `provenance.path` makes the execution path visible to the consumer. Note: Skill Dojo sends query parameters to a third-party API — consumers with sensitive data (wallet addresses, private transactions) should leave fallback disabled.

---

## 13. Iteration Log

> Note: The iteration log is narrative (what happened per session). The decision log (section 14) is authoritative (what was decided). When they overlap, the decision log is canonical.

### 2026-03-25 — Session 1: Vision Established
- Taxonomy defined (framework vs harness vs toolkit)
- Three-layer architecture proposed (adapter → core → SDK)
- 6 open design questions identified
- Deep codebase exploration: 85% of generic work already exists
- SuperColony confirmed as first vertical, not only vertical
- Key clarification: demos-sdk is Demos team's work, not ours
- OpenClaw + ElizaOS confirmed as dual first-class adapter targets
- ElizaOS web3 alignment noted (dominant crypto framework, $25M+ AUM)
- Existing docs: architecture-comparison-elizaos.md, research-agent-frameworks-modularization.md already exist as prior research
- TLSN ecosystem scan: 0/145 posts have TLSN attestations, disabled indefinitely

**Participants:** Marius + Claude (Intern agent for framework research, Explore agent for codebase deep-dive)

### 2026-03-25 — Session 2: Q1-Q6 Answered
- **Q1 (Naming):** Resolved — name must signal toolkit/skill/plugin, not "agents." Exact name TBD.
- **Q2 (Boundary):** Resolved — thin wrapper. Abstract non-trivial complexity, don't obscure SDK. Document over implement when value unclear. Scaffold verticals, don't implement.
- **Q3 (MVP):** Resolved — three distribution surfaces (OpenClaw, ElizaOS, CLI), one core. Layered wow: instant hook → discovery → adopt/customize. No strategy lock-in.
- **Q4 (Personas):** Resolved — tools over personas. Examples in `examples/` for reference. On-demand assembly by purpose, not predefined sub-agents.
- **Q5 (Strategies):** Partially resolved — strategies are opt-in playbooks. PARKED: what is the minimum viable strategy? Needs creative/analytical deep dive.
- **Q6 (State):** Resolved — stateless tools by default, optional state adapters. Rate limits mandatory (wallet-scoped). Source catalog ships as bundled data. Heuristics documented as patterns.

**Status: 5 of 6 questions answered. Q5 parked for deep thinking session.**
**Next:** R1-R4 research, then MVP spec with ISC criteria.

**Participants:** Marius + Claude

### 2026-03-25 — Session 3: Q5 Council Debate + Skill Design Research
- **Q5 resolved via Council debate (4/4 convergence):** Zero loops. MVP = atomic tools + rate-limit guard. "A base loop in a toolkit is a category error."
- Council members: Architect (Serena), Engineer (Marcus), Researcher (Ava), First Principles
- All independently converged on same answer from different angles:
  - Architect: impedance mismatch with consumer's existing loop
  - Engineer: "four functions and a constraint" ships fastest
  - Researcher: Stripe, Composio, MCP all confirm tools-not-loops pattern
  - First Principles: three irreducible primitives (identity, attest, transact)
- **Skill design research completed:**
  - AgentSkills best practices (mgechev): progressive disclosure, deterministic scripts, lean SKILL.md, JIT loading
  - OpenClaw skill system: SKILL.md format, ClawHub distribution, config injection, requires gating
  - ElizaOS plugin system: Action/Provider/Evaluator pattern, npm distribution (research agent)
- **MVP tool surface defined:** connect, publish, scan, verify, react, tip, discoverSources + rate-limit middleware
- **All 6 design questions now answered.** Ready for MVP spec.

**Status: ALL questions answered. Ready for MVP spec with ISC criteria.**
**Next:** Write the MVP spec. The Algorithm can derive ISC from it.

**Participants:** Marius + Claude + Council (4 agents) + ElizaOS researcher

### 2026-03-26 — Session 4: Skill Dojo Deconstruction + Parity Analysis
- **Key discovery:** Skill Dojo is NOT an AI system — it's 15 parameterized SDK wrappers behind a REST API. Zero LLM, zero reasoning, zero memory. Each "skill" = receive params → SDK/API call → optional DAHR attest → return data.
- **Decision: Replicate locally (option B+C).** Local "best of all" implementation + Skill Dojo API as seamless fallback. Consumer never sees routing.
- **Parity analysis complete:** 15 skills mapped. 2 where our local is already better (DeFi order-book, identity). 2 easy to add (prediction markets, liquidity). 3 need new implementation (address monitoring, network monitor, bridge). 5 need testnet validation (chain ops). 1 both broken (TLSN). 1 blocked (DemosWork).
- **Our local advantages over Skill Dojo:** No rate limit, claim extraction, multi-source attestation planning, quality gate, source lifecycle, entity resolution.
- **Skill Dojo advantages:** Zero local setup, pre-built chain adapters, prediction market data ready.
- **Seamless fallback architecture defined:** local-first → Skill Dojo fallback → normalized result shape.
- **4-phase local replication plan:** Phase 1 (MVP, mostly done), Phase 2 (monitoring, medium), Phase 3 (chain validation), Phase 4 (when SDK unblocks).

**Participants:** Marius + Claude

### 2026-03-26 — Session 5: SDK Deep-Dive + D402 + Prediction Markets + MCP
- **SDK upgraded 2.11.4 → 2.11.5** (released same day). L2PS messaging types.
- **D402 Payment Protocol deep-dive:** Complete HTTP 402 micropayment system in SDK. Client auto-pays on 402, server Express middleware gates endpoints. Gasless d402_payment tx type. No docs exist — we're reading source code. Added `pay()` to MVP tool surface.
- **Storage Programs confirmed still blocked:** "Unknown message" on both RPC nodes. SDK is mature (granular JSON ops, binary mode, group ACL, 1MB limit). Our wrappers (`storage-client.ts`, `storage-plugin.ts`) ready. Blocker is KyneSys infrastructure.
- **TLSN diagnosis conclusive:** `tlsn-component` repo is same engine in iframe. All three paths (our Playwright bridge, tlsn-component, SDK TLSNotary) use identical `tlsn-js` WASM. Hang is KyneSys notary server, not our code. Our bridge is correct.
- **Prediction markets shipped:** Polymarket (3 ops) + Kalshi (3 ops) YAML specs + 4 catalog entries. Parity with Skill Dojo achieved.
- **2 MCP servers wired:** `demosdk_references` (get.demos.sh) + `demosdk_docs` (GitBook). Available for SDK doc lookup.
- **KyneSys org fully mapped:** 23 repos, 6 NPM packages, 3 MCP servers. Key strategic items: ERC-8004 agent identity (issue #70), D402, Storage Programs.
- **ERC-8004 Agent Identity identified as most strategic upcoming feature** — on-chain agent identity registry via ERC-721. Open SDK issue, not yet implemented.

**Participants:** Marius + Claude + 3 parallel research agents

### 2026-03-26 — Session 6: Dual Design Review + All Findings Fixed
- **Codex design review (GPT-5.4):** 3 HIGH, 5 MEDIUM, 1 LOW findings
- **Fabric `review_design` (Sonnet):** 8 sections, critical findings across security, architecture, document readability
- **Zero overlap validates dual-review approach:** Codex caught architectural boundary violations + interface gaps (codebase-grounded). Fabric caught security absence, data management, document structure (structured lens).
- **All 23 findings addressed in design doc:**
  - C1: Removed loop/strategies/plugins from core diagram. Plugins noted as harness-only, not toolkit API.
  - C2: Full typed contracts — DemosSession, ToolResult<T>, DemosError with typed error codes.
  - C3: pay() enriched with challenge/response, maxSpend, idempotency, receipts.
  - C4: New Security Architecture section (credentials, spending caps, input validation, data leakage, isolation).
  - C5: Skill Dojo fallback changed from seamless/invisible to opt-in with provenance visibility.
  - C6: All 10 tool signatures now have typed request/response/error.
  - I1-I9: Rate-limit expansion, migration plan, error semantics, wallet provisioning, no empty scaffolds, degraded mode, data overrides, ERC-8004 placeholder, reply as publish wrapper.
  - L1-L8: Section numbering fixed, wow test scoped, column headers, informal register, decision log drift.
- **2 decisions superseded:** "Personas in-scope" and "Consumer never sees which path runs."
- **Design doc status remains ITERATING** — ready for implementation after this commit.

**Participants:** Marius + Claude + Codex (GPT-5.4) + Fabric review_design (Sonnet)

### 2026-03-27 — Session 7: Triple Adversarial Review + All Findings Applied
- **Red team (32-agent decomposition):** 4 CRITICAL, 5 HIGH, 6 MEDIUM, 5 LOW. Key criticals: TOCTOU race on rate-limit files, session spend cap resets on connect(), SSRF default-open, design claims exceed TypeScript capabilities.
- **Council debate (4 members, 3 rounds):** 4/4 convergence on typed contracts right-sized, no-loops correct, opt-in Skill Dojo correct, 5 guardrails right number. 8 additions recommended: concurrency contract, session redaction, migration restructure, preferredPath, threat model statement, guardrail reframing, testnet quickstart, content responsibility.
- **STRIDE threat model (18 threats):** 7 unique findings not caught by red team or council — immutable false attestation risk, malicious custom catalog, wallet file permissions, auth.mode bypass, TLS enforcement, semantic dedup bypass, provenance forgery (already mitigated).
- **Cross-validation:** Red team + Council + STRIDE = 25 deduplicated findings. Zero architectural rework needed — all fixes are specification refinements and honest reframing.
- **Major changes:** Security → Safety Architecture with explicit threat model. Exclusive file locking via proper-lockfile. Pluggable StateStore (file/SQLite/Redis). Rolling 24h spend cap. SSRF default-deny. DemosSession class with redaction. Concurrency contract. Migration restructured to 5 PRs. preferredPath. Observability hook. Custom catalog validation.
- **2 framings superseded:** "Security Architecture" → "Safety Architecture", 4-PR migration → 5-PR migration.

**Participants:** Marius + Claude + Red Team (32 agents) + Council (4 members) + STRIDE

---

## 14. Glossary

| Term | Meaning |
|------|---------|
| **Vertical** | A Demos SDK capability domain (SuperColony, Attestation, D402, Cross-Chain, etc.) |
| **Distribution surface** | A consumer framework target (OpenClaw, ElizaOS, CLI) |
| **Tool** | An atomic function in the toolkit API (e.g. `publish()`, `attest()`) |
| **Adapter** | A thin translation layer mapping toolkit tools to a specific framework's interface |
| **Playbook** | A documented recipe of tool calls (e.g. "8-phase session loop") — opt-in, not enforced |
| **Session handle** | An opaque `DemosSession` struct returned by `connect()`, passed to all tool calls |
| **Provenance** | Metadata on a `ToolResult` indicating which execution path and attestation produced the result |

---

## 15. Decision Log

> Append-only. Format: `[DATE] DECISION: statement. REASON: why. SUPERSEDES: what (if any).`

[2026-03-25] DECISION: omniweb-agents is a TOOLKIT, not a framework or harness. REASON: We provide domain capabilities, not agent reasoning or execution management.

[2026-03-25] DECISION: SuperColony is the first vertical, not the only vertical. REASON: Demos SDK offers 7+ verticals. Toolkit API should be `demos.tools.publish()` not `supercolony.publish()`.

[2026-03-25] DECISION: OpenClaw and ElizaOS are dual first-class adapter targets. REASON: OpenClaw = Marius uses it + largest adoption. ElizaOS = dominant web3 framework + thematic alignment with Demos blockchain.

[2026-03-25] DECISION: demos-sdk (@kynesyslabs/demosdk) is NOT our work. We build the high-value layer on top. REASON: Avoid scope confusion. We're an adoption wrapper, not an SDK competitor.

[2026-03-25] ~~DECISION: Personas are in-scope for the toolkit. REASON: They define scoped strategies + tool selection.~~ SUPERSEDED by Q4 resolution below — personas are example/reference only, not part of core toolkit API.

[2026-03-25] DECISION: Do not implement until design questions Q1-Q6 are answered. REASON: Premature implementation creates architectural debt.

[2026-03-25] DECISION: Toolkit wrapper is thin — abstract non-trivial complexity, don't obscure SDK. REASON: Agents are smart. Abstract difficulty/gotchas/config, but let them interact with Demos natively. Prefer documentation over implementation when value is unclear.

[2026-03-25] DECISION: Tools over personas. Example personas in examples/ only. REASON: Consumer's agent already has its own identity. Toolkit is a shelf of capabilities, not a cast of characters. On-demand assembly by purpose.

[2026-03-25] DECISION: Strategies are opt-in playbooks, never mandatory. REASON: No vendor lock-in. 8-phase loop is one example. Agents can use individual tools without any strategy.

[2026-03-25] DECISION: Stateless tools by default, optional state adapters. REASON: Consumer manages their own state. Rate limits are the one mandatory guardrail (wallet-scoped, protects from API bans).

[2026-03-25] DECISION: Three distribution surfaces, one core. REASON: OpenClaw skill, ElizaOS plugin, standalone CLI all call the same @omniweb-agents/core. Not three products.

[2026-03-25] ~~DECISION: Scaffold future verticals, don't implement.~~ SUPERSEDED by 2026-03-26 decision: future verticals NOT scaffolded as empty directories in published package. Added only when implementation begins.

[2026-03-25] DECISION: Zero loops in the toolkit. MVP = atomic tools + rate-limit guard. REASON: Council debate (4/4 convergence). Prior art (Stripe, Composio, MCP) confirms toolkits ship tools not loops. Consumer's agent already has a loop — imposing another creates impedance mismatch.

[2026-03-25] DECISION: MVP tool surface: connect(), publish(), scan(), verify(), react(), tip(), discoverSources() + mandatory rate-limit middleware. REASON: Engineer's "four functions and a constraint" principle. publish() hides 6-step chain internally. Complexity is internal, API is clean. SUPERSEDED by 2026-03-26 additions below (reply, attest, pay added).

[2026-03-26] DECISION: Replicate Skill Dojo locally as "best of all" version. Skill Dojo API as seamless fallback. REASON: Skill Dojo is 15 parameterized SDK wrappers, not AI. Our local path is already better for 2/15 skills (no rate limit, claim extraction, quality gate). Local-first eliminates 5 req/hr shared constraint. SUPERSEDES: earlier framing of Skill Dojo as "data provider layer" — it's actually an alternative execution path for the same operations we do locally.

[2026-03-26] ~~DECISION: Seamless routing: local-first → Skill Dojo fallback → normalized result. Consumer never sees which path runs.~~ SUPERSEDED by design review finding below — hiding execution path violates thin-wrapper principle.

[2026-03-26] DECISION: Skill Dojo fallback is opt-in (disabled by default). Consumer enables via `connect({ skillDojoFallback: true })`. When enabled, `provenance.path` in every `ToolResult` shows "local" or "skill-dojo". REASON: Local and Skill Dojo paths have materially different privacy, quota, auth, latency, and proof provenance characteristics. Hiding this contradicts the thin-wrapper goal. Consumers with sensitive data should not unknowingly route through a third-party API. SUPERSEDES: seamless routing decision above.

[2026-03-26] DECISION: Add pay() to MVP tool surface — D402 client auto-pay on HTTP 402. REASON: D402 Payment Protocol is complete in SDK v2.11.5 (gasless d402_payment tx, Express middleware, auto-retry). Enables agents to access paid data sources and monetize services. ~20 lines client integration. SUPERSEDES: D402 was not considered in prior MVP scope (undocumented module, discovered via source code reading).

[2026-03-26] DECISION: Prediction market sources (Polymarket + Kalshi) ship as bundled data assets. REASON: Polymarket gamma-api (3 ops) and Kalshi trade-api/v2 (3 ops) specs complete. No auth required. New claim types: probability, prediction. Enables attested market-consensus predictions — qualitatively different from price feeds.

[2026-03-26] DECISION: Monitor ERC-8004 Agent Identity (SDK issue #70) as highest-priority strategic feature. REASON: On-chain agent identity registry using ERC-721. Agent cards with name, capabilities, endpoints, payment address. When it ships in SDK, integrate immediately — game changer for our CCI architecture.

[2026-03-26] DECISION: Storage Programs deferred from MVP, keep wrappers ready. REASON: SDK is mature (granular JSON ops, binary, group ACL, 1MB limit). Our storage-client.ts and storage-plugin.ts wrap it. But RPC nodes return "Unknown message" — KyneSys hasn't deployed server-side handlers. Confirmed still broken in v2.11.5.

[2026-03-26] DECISION: TLSN remains disabled. tlsn-component offers no alternative path. REASON: All three approaches (our Playwright bridge, tlsn-component iframe, SDK TLSNotary) share identical tlsn-js WASM engine. The hang is in the KyneSys notary server, not our code. Fix requires KyneSys infrastructure work or testing against a reference notary.

[2026-03-26] DECISION: Typed tool contracts — every tool returns `ToolResult<T>` with provenance metadata, throws `DemosError` with typed error codes. REASON: Codex + Fabric design review (9 findings). Placeholder signatures are not implementable contracts. Typed envelopes enable adapter translation and consumer error handling. SUPERSEDES: prior MVP tool table with string-level "Params → Return" descriptions.

[2026-03-26] ~~DECISION: Security architecture added.~~ SUPERSEDED by 2026-03-27 reframing below (Safety Architecture).

[2026-03-26] DECISION: Remove `loop/`, `strategies/`, `plugins/` from core package. Loops → `docs/playbooks/`. Plugins remain in codebase for production agents but NOT in toolkit public API. REASON: Codex + Fabric both flagged contradiction with Q5 zero-loops decision. Plugins require a dispatch harness; atomic toolkit has no harness. SUPERSEDES: architecture diagram showing loop/strategies/plugins in @omniweb-agents/core.

[2026-03-26] DECISION: Wallet provisioning is "bring your own wallet" — toolkit does NOT create or fund wallets. `demos-toolkit doctor` CLI validates prerequisites. REASON: Fabric flagged unresolved wallet provisioning blocking wow test. Simplest resolution: document prerequisite, provide diagnostic tool.

[2026-03-26] ~~DECISION: Staged migration plan (4 PRs).~~ SUPERSEDED by 2026-03-27 5-PR plan with re-export compatibility shim.

[2026-03-26] DECISION: Future verticals (cross-chain, storage, workflows, privacy) are NOT scaffolded as empty directories. Added to `core/verticals/` only when implementation begins. REASON: Fabric flagged empty scaffold dirs confuse consumers of published package.

[2026-03-26] DECISION: MVP tool surface finalized at 10 tools: connect, publish, reply, react, tip, scan, verify, attest, discoverSources, pay. Plus 5 mandatory guardrails: write rate limit, spend cap (tip), spend cap (pay), dedup guard, 429/backoff. SUPERSEDES: all prior partial MVP tool lists.

[2026-03-27] DECISION: Reframe "Security Architecture" as "Safety Architecture." REASON: Red team (32-agent, 4 CRITICAL) + Council (4/4 convergence) + STRIDE (18 threats) all identified that all enforcement is client-side. Malicious consumers bypass via SDK. Honest framing: "safety for cooperative consumers, not security against adversaries." Same trust model as Stripe/AWS SDKs. SUPERSEDES: "Security Architecture" framing from 2026-03-26.

[2026-03-27] DECISION: Exclusive file locking via `proper-lockfile` for all state read-modify-write. Pluggable `StateStore` interface with file (default), SQLite WAL, Redis backends. REASON: Red team F1 (TOCTOU race, 6-agent convergence). STRIDE T-0003/T-0004 (CRITICAL). Advisory locking is cooperative only. Exclusive locking prevents multi-process rate limit bypass. Pluggable backend prevents ephemeral filesystem (container) from silently disabling all guardrails. SUPERSEDES: "advisory file locking prevents corruption" claim.

[2026-03-27] DECISION: Rolling 24h cumulative spend cap for pay(), file-persisted per wallet, NOT session-scoped. REASON: Red team F2 (CRITICAL). Session caps reset on connect() — unlimited session creation = unlimited spending. File-persisted rolling cap with timestamps cannot be reset without manual intervention.

[2026-03-27] DECISION: SSRF default-deny blocklist for attest()/pay(). Block RFC 6890 private ranges + DNS rebinding protection. REASON: Red team F3 (CRITICAL). STRIDE T-0005 (CRITICAL). "Validated where configured" = not configured = open SSRF. Default-deny is the only safe posture.

[2026-03-27] DECISION: DemosSession implemented as class with toJSON()/inspect() redaction, Symbol-keyed authToken, 30-min inactivity timeout, NOT concurrency-safe (documented). REASON: Red team F5 (HIGH), Council (4/4), STRIDE T-0001/T-0007/T-0015. Plain object with `readonly authToken: string` leaks to logs, APMs, crash dumps. Concurrent tool calls race on auth refresh and nonce.

[2026-03-27] DECISION: Migration plan restructured to 5 PRs with re-export compatibility shim. REASON: Council (Ava) + Red team F10. Stage 2 (git mv) hides hundreds of import changes. Compatibility shim gives rollback path through PR3. Use jscodeshift for automated import rewriting. SUPERSEDES: 4-PR plan.

[2026-03-27] DECISION: Skill Dojo `preferredPath` option added to connect(). REASON: Council (Ava). Some consumers prefer hosted execution (zero local SDK dependency). Small addition, big flexibility gain.

[2026-03-27] DECISION: Observability hook `onToolCall()` callback in connect() options. REASON: Red team F13 (MEDIUM). Production consumers need logging/metrics/tracing. Every Stripe/Composio-style toolkit gets this request. Notification-only callback, not middleware.

[2026-03-27] DECISION: Custom catalog/spec validation: schema check + API key pattern scan in URL templates + override logging. REASON: STRIDE T-0012 (HIGH). Malicious custom catalogs can redirect attestations to attacker URLs. T-0017: custom spec with auth.mode "none" can leak API keys on-chain.

[2026-03-30] DECISION: Clarify "zero loops" scope. The Q5 decision ("toolkit ships zero loops") prohibits **agent orchestration loops** (8-phase session loops, sense-act-learn cycles, strategy loops). It does NOT prohibit **reactive infrastructure primitives** — generic poll-diff-dispatch mechanisms that are analogous to Node's EventEmitter or a message queue consumer. An `EventLoop<TAction>` primitive with generic action types is an infrastructure building block, not an opinionated agent loop. However, it MUST: (a) be generic over its action type (no `OmniwebActionType` dependency), (b) live in a sub-path export (`@omniweb-agents/core/reactive`), not the main barrel, (c) impose zero orchestration opinions (no phases, no strategy, no mandatory hooks). REASON: Codex review of architecture migration plan flagged contradiction between EventLoop extraction and Q5 decision. FirstPrinciples analysis (2026-03-29) identified EventLoop as an atomic operation #9 (OBSERVE) / #10 (SCHEDULE) primitive, not a strategy loop. CLARIFIES (not supersedes): Q5 "zero loops" decision from 2026-03-26.
