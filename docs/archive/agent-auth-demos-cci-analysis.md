# Agent Auth Protocol + Demos CCI: Strategic Analysis

> **Date:** 2026-03-20
> **Purpose:** Evaluate whether Agent Auth Protocol benefits omniweb-agents, especially via Demos CCI
> **Verdict:** YES — complementary layers, not competing. High strategic value.

---

## Executive Summary

Agent Auth Protocol and Demos CCI solve **different problems at different layers**. Agent Auth is a **session credential** system (how agents prove authorization per-request to web services). Demos CCI is a **persistent identity** system (who agents are across all chains, contexts, and time). Together they enable agents that are both securely credentialed AND carry portable, reputation-backed identity.

**The compounding insight:** Demos CCI can be the ROOT IDENTITY from which Agent Auth session credentials are derived. Reputation accumulated on-chain informs what capabilities services grant. High-reputation agents get broader permissions. This is the "passport + boarding pass" model.

---

## What Each System Is

### Agent Auth Protocol (Better Auth Inc.)

| Aspect | Detail |
|--------|--------|
| **Core function** | Per-agent Ed25519 cryptographic identity for API authentication |
| **Problem solved** | Agents accessing web services can't be individually identified, scoped, or revoked |
| **Key innovation** | Agents as first-class auth principals (not piggybacking on user/app credentials) |
| **Mechanism** | Ed25519 keypair → short-lived JWT → scoped capability execution |
| **Discovery** | `/.well-known/agent-configuration` endpoint + directory at agent-auth.directory |
| **Approval** | OAuth Device Flow or CIBA (user approves agent capabilities) |
| **Clients** | TypeScript SDK (`@auth/agent`), MCP Server, CLI |
| **Status** | v1.0-draft, 2 services in directory (Gmail, Agent Deploy) |
| **What it lacks** | No persistence, no reputation, no cross-chain, no on-chain component |

### Demos CCI (Cross-Context Identity)

| Aspect | Detail |
|--------|--------|
| **Core function** | Unified identity across 12+ blockchains + Web2 services, with reputation |
| **Problem solved** | Agents/users exist on many chains — no way to link them or carry reputation |
| **Key innovation** | Single Demos address as identity root, cross-chain linking via crypto signatures |
| **Cross-chain** | EVM, Solana, BTC, Aptos, IBC, NEAR, MultiversX, TON, XRP, Unstoppable Domains, TEN |
| **Web2 linking** | Twitter, GitHub, Discord, Telegram |
| **Privacy** | ZK Identity (Groth16 ZK-SNARKs) — prove identity without revealing it |
| **Attestation** | DAHR (fast HTTP relay) + TLSN (cryptographic MPC-TLS proof) |
| **Reputation** | Aggregated across all linked identities — activity, attestations, scoring |
| **Storage** | On-chain via GCR (Global Change Registry) + Storage Programs |
| **SDK** | `@kynesyslabs/demosdk` — identities.inferXmIdentity(), getIdentities(), removeXmIdentity() |
| **Status** | Architecture defined, SDK available. CCI plugin in omniweb-agents is SCAFFOLD (Node.js not validated) |
| **What it lacks** | No web service auth protocol, no capability scoping, no per-request JWT model |

### Demos Full Identity Stack (Beyond CCI)

Demos has a remarkably deep identity infrastructure that most competitors don't match:

- **ZK Identity:** Privacy-preserving attestation via Groth16 ZK-SNARKs + Poseidon commitments + nullifiers. Prove you have a verified identity without revealing which one.
- **DAHR:** Data Agnostic HTTPS Relay — proxied HTTP requests with attestation on-chain.
- **TLSN:** TLSNotary MPC-TLS — cryptographic proof of web data authenticity.
- **L2PS:** Layer 2 Privacy Subnets — encrypted private transactions on public L1.
- **Post-Quantum Crypto:** Quantum-safe signing algorithms available in SDK.
- **Instant Messaging:** End-to-end encrypted (ml-kem-aes) messaging between identities.

---

## The Layer Model

```
┌──────────────────────────────────────────────────────────────┐
│  LAYER 3: APPLICATION BEHAVIOR                                │
│  What the agent DOES — publish, attest, tip, react, trade     │
│  → omniweb-agents session loop (8 phases, 20 plugins)           │
│  → SuperColony feed operations                                │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────┴─────────────────────────────────┐
│  LAYER 2: SESSION AUTHENTICATION                              │
│  How the agent PROVES ITSELF per-request to external services │
│  → Agent Auth Protocol (Ed25519 JWT, scoped capabilities)     │
│  → TODAY: raw auth tokens, ad hoc OAuth, manual API keys      │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────┴─────────────────────────────────┐
│  LAYER 1: PERSISTENT IDENTITY + REPUTATION                    │
│  WHO the agent IS across all contexts and over time           │
│  → Demos CCI (wallet root, 12+ chain links, ZK, reputation)  │
│  → TODAY: scaffold/blocker in cci-identity-plugin.ts          │
└──────────────────────────────────────────────────────────────┘
```

**Key insight:** We currently have Layer 3 (rich application behavior) but Layers 1 and 2 are ad hoc. Agent Auth standardizes Layer 2. Demos CCI standardizes Layer 1. Both are needed.

---

## Gap Analysis

### What Agent Auth has that Demos lacks

| Capability | Why it matters for omniweb-agents |
|------------|-------------------------------|
| **Per-agent Ed25519 identity for web API auth** | Our agents currently use shared auth tokens. Agent Auth gives each agent its own crypto identity for API calls. |
| **Scoped capabilities with field-level constraints** | We can't currently restrict what an agent can do at the API level (e.g., "publish but not tip" or "max 3 posts/day enforced by service"). |
| **Discovery protocol** (/.well-known/agent-configuration) | Agents could auto-discover compatible services instead of hardcoded endpoints. |
| **MCP Server client** | Our agents could use Agent Auth via MCP to access any registered service — Gmail, deploy, future services. |
| **Standardized agent lifecycle** (active/suspended/expired/revoked) | We have no formal agent lifecycle management beyond cron/systemd start/stop. |

### What Demos has that Agent Auth lacks

| Capability | Why this is strategically powerful |
|------------|----------------------------------|
| **Cross-chain identity linking** (12+ chains) | Agent Auth agents exist in a vacuum. Demos agents carry identity across chains. |
| **Reputation scoring** | Agent Auth has no way to evaluate agent trustworthiness. Demos aggregates reputation across all contexts. |
| **ZK Identity** | Agent Auth has no privacy-preserving identity proofs. Demos can prove identity without revealing it. |
| **On-chain attestation** (DAHR + TLSN) | Agent Auth has no data attestation. Demos proves web data is authentic. |
| **Persistent on-chain storage** (GCR + Storage Programs) | Agent Auth is stateless. Demos stores identity state permanently. |
| **Web2 identity linking** (Twitter, GitHub, Discord, Telegram) | Agent Auth doesn't link social identities. Demos unifies them. |
| **Post-quantum cryptography** | Agent Auth uses Ed25519 (vulnerable to quantum). Demos has quantum-safe options. |
| **Encrypted messaging** | Agent Auth has no agent-to-agent communication. Demos has e2e encrypted IM. |

---

## The Compounding Strategy: CCI as Root → Agent Auth as Session Layer

The most powerful play is NOT choosing one over the other. It's using **Demos CCI as the root identity** from which **Agent Auth session credentials are derived**.

### How it works

```
1. Agent has Demos address (CCI root identity)
   ├── Linked: Solana wallet (cross-chain)
   ├── Linked: Twitter @sentinel_agent (Web2)
   ├── Linked: GitHub demos-sentinel (Web2)
   ├── Attestations: 47 DAHR + 12 TLSN (data provenance)
   └── Reputation score: 847 (aggregated across all)

2. Agent wants to access a new service (e.g., data API)
   ├── Agent Auth: discover service → register → request capabilities
   ├── Service checks Demos CCI reputation: 847 → grants FULL access
   │   (low-rep agent would get RESTRICTED access)
   └── Agent Auth JWT now carries Demos identity claim

3. Every action builds more reputation
   ├── Attested data → SuperColony post → reactions → reputation↑
   ├── Cross-chain transactions → identity links → reputation↑
   └── Service usage history → attestable → reputation↑
```

### The flywheel

```
More contexts linked (CCI) → Higher reputation → More capabilities granted (Agent Auth)
→ More useful actions → More attestations → Higher reputation → ...
```

**This is the moat.** Agent Auth alone gives you session auth but no history. Demos CCI alone gives you identity but no standardized service access. Together: agents that carry provable reputation into every new service interaction, and every interaction builds more reputation.

---

## Current State in omniweb-agents

| Component | Status | Gap |
|-----------|--------|-----|
| CCI Identity Plugin | **SCAFFOLD** — returns "SDK blocker: CCI SDK module not yet validated for Node.js" | Needs SDK validation + actual implementation |
| Cross-chain identity SDK | **Available** — `identities.inferXmIdentity()` in demosdk | Not wired into agent loop |
| Web2 identity linking | **Available** — SDK methods for Twitter/GitHub/Discord/Telegram | Not wired |
| ZK Identity | **Available** — Groth16 backend, API reference exists | Not explored for agents |
| Agent Auth integration | **None** — no references in codebase | New integration opportunity |
| Demos MCP Server | **Available** — network status, blockchain queries | Limited tools (no identity/attestation tools yet) |

---

## Demos Documentation Index (for regular reference)

The full Demos docs are at `https://docs.kynesys.xyz/llms.txt` — a machine-readable index. Key sections for our work:

| Area | URL | Relevance |
|------|-----|-----------|
| **CCI** | docs.kynesys.xyz/backend/internal-mechanisms/cross-context-identities | Core identity architecture |
| **ZK Identity** | docs.kynesys.xyz/backend/zk-identity/overview | Privacy-preserving attestation |
| **Cross-chain Identities** | docs.kynesys.xyz/sdk/cross-chain/identities | SDK for linking identities |
| **Web2 Identities** | docs.kynesys.xyz/sdk/web2/identities/ | Twitter/GitHub/Discord/Telegram linking |
| **DAHR API** | docs.kynesys.xyz/sdk/web2/dahr-api-reference/overview | Attestation relay |
| **TLSN** | docs.kynesys.xyz/sdk/web2/tlsnotary/overview | Cryptographic attestation |
| **Storage Programs** | docs.kynesys.xyz/sdk/storage-programs/overview | On-chain key-value storage |
| **DemosWork** | docs.kynesys.xyz/sdk/cookbook/demoswork/overview | Work step framework |
| **MCP Server** | docs.kynesys.xyz/backend/mcp-server/available-tools | AI agent doc access |
| **WebSDK** | docs.kynesys.xyz/sdk/websdk/overview | Core SDK capabilities |
| **SDK API Reference** | kynesyslabs.github.io/demosdk-api-ref/index.html | Full API docs |

---

## Actionable Next Steps for omniweb-agents

### Immediate (next 1-2 sessions)

1. **Save Demos doc index as reference memory** — establish regular lookup habit
2. **Validate CCI SDK for Node.js** — the scaffold blocker says "not yet validated." Test `identities.inferXmIdentity()` in our Node.js + tsx runtime. If it works, the blocker is stale.
3. **Wire Web2 identity linking** for sentinel agent — link Twitter/GitHub to Demos address. This is low-hanging fruit that immediately enriches agent identity.

### Medium-term (Phase 5 timeline)

4. **Evaluate Agent Auth SDK** (`@auth/agent`) — install, test discovery + registration flow against Gmail endpoint. Understand the developer experience.
5. **Design CCI → Agent Auth bridge** — Demos address as root identity, Agent Auth Ed25519 key derived or linked. Reputation informs capability grants.
6. **Implement cci-identity-plugin for real** — replace scaffold with actual cross-chain identity resolution using SDK.

### Strategic (roadmap item)

7. **Register omniweb-agents in Agent Auth directory** — make our agents discoverable as Agent Auth-capable services (other agents can interact with ours via the protocol).
8. **Propose to KyneSys: Agent Auth integration** — Demos network could become an Agent Auth provider, where Demos reputation score is exposed as an attestation that services can check before granting capabilities.
9. **Propose to Better Auth: Demos as reputation layer** — Agent Auth currently has no reputation model. Demos CCI fills that gap. Strategic partnership opportunity.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Agent Auth is v1.0-draft, only 2 services | Medium | Low integration cost. Even if ecosystem is small now, the protocol design is sound and backed by Better Auth (established auth library). |
| CCI SDK not validated for Node.js | Medium | Test it. If broken, file issue with KyneSys. If it works, remove scaffold blocker. |
| Agent Auth could change spec before v1.0 | Low | TypeScript SDK abstracts protocol details. Spec changes = SDK update, not rewrite. |
| Demos ecosystem is still testnet | Context | We're already building on testnet. CCI integration is testnet-safe. |
| Over-engineering identity before product-market fit | Medium | Start with Web2 linking (simple, immediate value) before full CCI + Agent Auth bridge. |
