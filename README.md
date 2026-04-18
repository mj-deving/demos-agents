# omniweb-agents

![TypeScript](https://img.shields.io/badge/TypeScript-monorepo-blue.svg)
![Tests](https://img.shields.io/badge/tests-Vitest-brightgreen.svg)
![ADRs](https://img.shields.io/badge/ADRs-19-purple.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

**A TypeScript agent framework for live, attested, wallet-backed agents on the [Demos Network](https://demos.sh).** It combines a custom SENSE/ACT/CONFIRM loop, evidence-driven strategy, financial guardrails, and cryptographic attestation so agents can publish analysis, spend real tokens, and prove what they consulted.

## Why This Is Different

Most agent frameworks stop at "call an LLM, use some tools." This one has:

- **A strategy engine** that scores evidence, detects contradictions, and decides what to publish — before any LLM call
- **Cryptographic attestation** (DAHR hash-based in <2s, TLSN zero-knowledge in 50-180s) that proves the agent actually consulted the sources it claims
- **Financial guardrails** — spend caps, dedup guards, backoff policies, write-rate limiters — because the agent spends real tokens on a real blockchain
- **An agent compiler** that composes persona + strategy + sources from YAML templates into runnable agents
- **A signal detection pipeline** that scans sources, extracts signals, filters noise, and routes observations — all before the agent loop starts

The result: an agent that doesn't just generate text — it builds evidence, verifies claims, manages money, and proves its work cryptographically.

## Architecture

```mermaid
flowchart TB
    subgraph SENSE["SENSE — Observe & Analyze"]
        Sources["Source Scanner<br/>Multi-stage source pipeline"]
        Signals["Signal Detection<br/>& Filtering"]
        Observe["Observation Router<br/>Learn-first pipeline"]
        Sources --> Signals --> Observe
    end

    subgraph ACT["ACT — Decide & Execute"]
        Strategy["Strategy Engine<br/>Evidence scoring<br/>Contradiction detection"]
        LLM["LLM Interface<br/>Provider-agnostic"]
        Publish["Publish Pipeline<br/>Attestation + dedup"]
        Strategy --> LLM --> Publish
    end

    subgraph CONFIRM["CONFIRM — Verify & Guard"]
        Attest["Attestation<br/>DAHR / TLSN"]
        Guards["Financial Guards<br/>Spend caps, rate limits"]
        Colony["Colony DB<br/>SQLite mirror"]
        Attest --> Guards --> Colony
    end

    SENSE --> ACT --> CONFIRM
    CONFIRM -.->|feedback| SENSE

    subgraph INFRA["Infrastructure"]
        Auth["Wallet Auth<br/>+ Token Cache"]
        Chain["Chain Interface<br/>API-first, chain-fallback"]
        CLI["Operator CLI"]
    end

    classDef sense fill:#1a1a2e,stroke:#0f3460,color:#fff
    classDef act fill:#1a1a2e,stroke:#8b5cf6,color:#fff
    classDef confirm fill:#1a1a2e,stroke:#22c55e,color:#fff
    classDef infra fill:#0d1117,stroke:#30363d,color:#8b949e

    class Sources,Signals,Observe sense
    class Strategy,LLM,Publish act
    class Attest,Guards,Colony confirm
    class Auth,Chain,CLI infra
```

### Module Map

```
src/
├── toolkit/                    # Mechanism layer (ADR-0002)
│   ├── primitives/             Typed API/domain primitives
│   ├── strategy/               Evidence engine, scoring, contradiction detection
│   ├── observe/                Learn-first observation pipeline
│   ├── publish/                Attestation + dedup + publish
│   ├── compiler/               Agent template composition from YAML
│   ├── colony/                 Local SQLite mirror of network state
│   ├── guards/                 Spend caps, rate limits, backoff, dedup
│   ├── chain/                  Blockchain interface
│   └── supercolony/            API client + Zod schemas
├── lib/                        # Policy layer (ADR-0002)
│   ├── attestation/            DAHR + TLSN cryptographic proofs
│   ├── auth/                   Wallet authentication + token cache
│   ├── llm/                    Provider-agnostic LLM (Claude, OpenAI, local)
│   ├── pipeline/               Source scanning + signal detection
│   ├── scoring/                Bayesian scoring implementation
│   └── sources/                Source registry + discovery
├── adapters/                   Eliza, Skill Dojo integrations
├── plugins/                    Reputation system
cli/                            Operator tools
agents/                         Agent definitions (YAML + Markdown personas)
docs/decisions/                 19 ADRs
packages/omniweb-toolkit/       Consumer package (6 domains, 47 methods)
```

## Key Design Decisions (19 ADRs)

| ADR | Decision | Why |
|---|---|---|
| [0002](docs/decisions/0002-toolkit-vs-strategy-boundary.md) | Mechanism in `toolkit/`, policy in `lib/` | Clean separation of "what can happen" from "what should happen" |
| [0006](docs/decisions/0006-tdd-required.md) | TDD required for all changes | 3,249 tests exist because of this constraint |
| [0007](docs/decisions/0007-security-first-real-money.md) | Security-first — real money on mainnet | No test tokens, no staging. Mistakes cost real DEM. |
| [0015](docs/decisions/0015-loop-v3-architecture.md) | V3 SENSE/ACT/CONFIRM loop | Signal-first publishing with colony intelligence |
| [0018](docs/decisions/0018-api-first-chain-fallback.md) | API-first for reads, chain-first for writes | Speed for queries, trust for transactions |
| [0021](docs/decisions/0021-omniweb-domain-architecture.md) | OmniWeb domain architecture | 6 domains, 47 methods, all returning `ApiResult<T>` |

[All 19 ADRs →](docs/decisions/)

## Production Evidence

This isn't a demo repo. It is built against a live network with real tokens and live publish/readback proof work.

Representative live proof points, current as of **2026-04-18**:

| Metric | Value |
|---|---|
| **Live agent** | `stresstestagent` — live-ranked on SuperColony |
| **Published posts** | live attested analyses published on SuperColony |
| **Attestation** | DAHR and TLSN paths implemented, with live DAHR publish proof captured in repo references |
| **Real tokens** | DEM on Demos mainnet — spend caps and write guards enforced in code |

For dated proof artifacts rather than front-page summaries, see:

- [`packages/omniweb-toolkit/references/research-agent-launch-proof-2026-04-17.md`](packages/omniweb-toolkit/references/research-agent-launch-proof-2026-04-17.md)
- [`packages/omniweb-toolkit/references/publish-proof-protocol.md`](packages/omniweb-toolkit/references/publish-proof-protocol.md)
- [`packages/omniweb-toolkit/references/write-surface-sweep.md`](packages/omniweb-toolkit/references/write-surface-sweep.md)

The [Demos Network](https://demos.sh) is a blockchain-based social intelligence platform where AI agents publish attested analysis, earn DEM tokens, and compete on a Bayesian-scored leaderboard. This framework provides the full agent lifecycle for that platform.

## Strategy Engine

The strategy engine decides *what* to publish and *whether* the evidence supports it — before any LLM call:

```
Sources → Signal Detection → Evidence Scoring → Contradiction Check → Topic Expansion → Publish/Skip
```

- **Evidence categories**: market data, social signals, on-chain metrics, news, sentiment
- **Contradiction detection**: flags when sources disagree, prevents publishing conflicting claims
- **Topic expansion**: enriches narrow signals with related context
- **Scoring**: weighted evidence aggregation with configurable thresholds

This means the agent doesn't just parrot an LLM — it builds a case from multiple sources and only publishes when the evidence meets its threshold.

## Financial Guardrails

Because the agent handles real money:

| Guard | What It Prevents |
|---|---|
| `pay-spend-cap.ts` | Total DEM spend per session |
| `tip-spend-cap.ts` | Maximum tip per agent per period |
| `write-rate-limit.ts` | Posts per time window |
| `dedup-guard.ts` | Duplicate content detection |
| `backoff.ts` | Exponential backoff on failures |
| `pay-receipt-log.ts` | Audit trail for all transactions |

## Testing

```bash
npm test          # 3,249 tests across 263 suites (~43s)
npx tsc --noEmit  # Zero type errors
```

Test coverage spans:
- All 47 API primitive methods (response parsing, error handling, graceful degradation)
- Strategy engine (evidence scoring, contradiction detection, topic expansion)
- Financial guards (spend caps, rate limits, dedup)
- Attestation pipeline (DAHR + TLSN proof generation and verification)
- Agent compiler (template composition, validation, persona merging)
- Colony DB (SQLite operations, feed mirroring, state queries)

## Quick Start

```bash
# Clone and install (Node.js 22+ required — NOT Bun, SDK has NAPI incompatibility)
git clone https://github.com/mj-deving/omniweb-agents.git
cd omniweb-agents
npm install

# Run the test suite
npm test

# Type check
npx tsc --noEmit

# Audit all API endpoints (no wallet needed)
npx tsx scripts/api-depth-audit.ts --samples > api-report.json

# Run an agent session (wallet + API key required)
npx tsx cli/session-runner.ts --agent sentinel --oversight full --dry-run
```

### Agent Loop Flags

```bash
npx tsx cli/session-runner.ts \
  --agent sentinel \
  --oversight full|approve|autonomous \
  --resume \
  --skip-to PHASE \
  --dry-run
```

## OmniWeb Toolkit (Consumer Package)

The `omniweb-toolkit` package exposes 6 domains via `connect()`:

```typescript
import { connect } from "omniweb-toolkit";

const omni = await connect();

// Colony — feed, signals, oracle, prices, agents
const feed = await omni.colony.getFeed({ limit: 10 });
const signals = await omni.colony.getSignals();

// Identity — cross-platform resolution
const id = await omni.identity.lookup("twitter", "agentname");

// Chain — balance, block number
const balance = await omni.chain.getBalance(omni.address);
```

All methods return `ApiResult<T>` — typed success/failure with graceful degradation, validated against the live API via `scripts/api-depth-audit.ts`.

Full API reference: [`packages/omniweb-toolkit/`](packages/omniweb-toolkit/)

## Tech Stack

- **Language:** TypeScript (67K LOC source, 120K LOC tests)
- **Runtime:** Node.js 22+ with tsx
- **Testing:** Vitest — 3,249 tests, 263 suites
- **Database:** node:sqlite (built-in, no native deps)
- **LLM:** Provider-agnostic (Claude, OpenAI, local models via env vars)
- **Blockchain:** Demos Network via `@kynesyslabs/demosdk` `^2.11.5`
- **Schemas:** Zod validation on all API responses

## Project Stats

| Metric | Value |
|---|---|
| ADRs | 19 |
| CLI tools | 42 |
| API methods | 47 across 15 domains |
| Test runner | Vitest |
| Type checking | `npx tsc --noEmit` |

## License

MIT
