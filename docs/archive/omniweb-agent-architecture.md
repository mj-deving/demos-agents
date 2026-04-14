# Omniweb Agent Architecture

> Design document for Demos omniweb agents — autonomous agents operating across the entire Demos ecosystem, not just SuperColony.

**Status:** Design (pre-implementation)
**Date:** 2026-03-18
**Author:** Marius + PAI

---

## 1. Motivation

Current omniweb-agents operate at ~15% of the Demos SDK surface area. Agents publish to SuperColony, react, reply, tip, and attest data via DAHR. The remaining 85% of SDK capabilities — cross-chain operations (XM SDK), workflow orchestration (DemosWork), on-chain storage (Storage Programs), privacy subnets (L2PS), cross-context identity (CCI), and MCP node queries — are unused.

The goal is to design **super-capable agents** that can autonomously perform **any operation** in the Demos ecosystem, while maintaining SuperColony-focused agents as a valid narrower tier.

## 2. Two-Tier Agent Model

| Tier | Scope | Action Types | Runner | Example |
|------|-------|-------------|--------|---------|
| **SC** | SuperColony feed only | publish, reply, react, tip, log_only | session-runner / event-runner | sentinel |
| **Omniweb** | Full Demos ecosystem | SC types + transfer, bridge, store, attest, workflow, assign_task, private_transfer, zk_prove | omniweb-runner (new) | nexus, weaver, shade |

Both tiers share:
- Base loop: **observe → act → verify → learn**
- Plugin system: FrameworkPlugin + EventPlugin interfaces
- Agent config: AGENT.yaml, persona.yaml, persona.md, strategy.yaml
- Credential management: `~/.config/demos/credentials-{agent}`

The tiers diverge in:
- Available action types (5 vs 13)
- Event sources (feed-only vs chain+storage+workflow)
- Loop extensions (SC-specific vs omniweb-specific)
- Runner process (existing runners vs new omniweb-runner)

## 3. SDK Capability Map

### 3.1 Currently Used

| SDK Module | Used By | How |
|------------|---------|-----|
| WebSDK (Demos class) | All agents | Wallet connect, transfer, startProxy (DAHR) |
| SuperColony API | Sentinel | REST endpoints: /api/feed, /api/tip, /api/auth |
| DAHR Attestation | Sentinel | Proxy fetch → responseHash + txHash |

### 3.2 Available but Unused

| SDK Module | Import Path | Capabilities | Agent Tier |
|------------|-------------|-------------|------------|
| **StorageProgram** | `@kynesyslabs/demosdk` | On-chain KV store (JSON/binary), ACL, granular field ops, search, 1MB limit, 1 DEM/10KB | Omniweb |
| **DemosWork** | `@kynesyslabs/demosdk` | Workflow orchestration: XM (cross-chain), Web2 (HTTP), Native ops. Conditional branching (if/else). Script validation + execution | Omniweb |
| **L2PS** | `@kynesyslabs/demosdk` | AES-GCM encrypted transactions, privacy subnets, multi-singleton pattern | Omniweb (SHADE) |
| **XM SDK** | `@kynesyslabs/demosdk` | Cross-chain operations across 13 chains (EVM, Solana, Bitcoin, TON, NEAR, Cosmos, MultiversX, XRP, Aptos) | Omniweb (NEXUS) |
| **MCP Server** | Node RPC | Model Context Protocol on every Demos node — chain state queries, peer info, network status | Omniweb |
| **CCI** | TBD | Cross-Context Identity — unified identity linking wallets + Web2 across chains | Future |

### 3.3 StorageProgram API (Key for Inter-Agent Coordination)

```
StorageProgram.createStorageProgram(deployer, name, data, encoding, acl, {nonce})
StorageProgram.writeStorage(address, data, encoding)
StorageProgram.readStorage(address)
StorageProgram.setField(address, field, value)
StorageProgram.appendItem(address, field, value)
StorageProgram.deleteField(address, field)
StorageProgram.getByAddress(rpcUrl, address)
StorageProgram.getByOwner(rpcUrl, owner)
StorageProgram.searchByName(rpcUrl, query, {exactMatch, limit})
StorageProgram.getValue(rpcUrl, address, field)
StorageProgram.getFields(rpcUrl, address)
StorageProgram.hasField(rpcUrl, address, field)
StorageProgram.checkPermission(acl, owner, requester, permission)

ACL modes: owner | restricted | public
ACL features: allowed list, blacklist, groups with per-group permissions
Pricing: 1 DEM per 10KB (minimum 1 DEM)
Size limit: 1MB per program
Encoding: JSON (key-value, field ops) or binary (raw base64)
```

### 3.4 DemosWork API

```
DemosWork.push(operation)       // Add operation to workflow script
DemosWork.validate(script)      // Validate workflow before execution
DemosWork.fromJSON(script)      // Load from serialized script
DemosWork.toJSON()              // Serialize for storage/transmission
prepareDemosWorkPayload(work, demos)  // Create executable transaction

Step types:
- XMScript — cross-chain operations (any of 13 chains)
- IWeb2Request — HTTP requests to external APIs
- INativePayload — native Demos transactions

Conditionals:
- Operators: eq, neq, gt, lt, gte, lte, not, and, or
- Operands: static values or references to previous step outputs
- Branching: if condition → execute step/operation
```

### 3.5 L2PS API

```
L2PS.create(privateKey?, iv?)    // Create privacy subnet
L2PS.getInstance(id)             // Get existing subnet
l2ps.encryptTx(tx, sender?)     // Encrypt transaction with AES-GCM
l2ps.decryptTx(encryptedTx)     // Decrypt back to original
l2ps.getId()                     // Subnet identifier
l2ps.getKeyFingerprint()         // Short key fingerprint

Encryption: AES-256-GCM (authenticated encryption)
Transaction wrapping: Encrypted tx is a valid Transaction (type: "l2psEncryptedTx")
Multi-singleton: Multiple L2PS instances can coexist
```

## 4. Extended Action Type System

### 4.1 Current (SC Tier)

```typescript
// core/types.ts — existing
type SCActionType = "publish" | "reply" | "react" | "tip" | "log_only";
```

### 4.2 Proposed (Omniweb Tier)

```typescript
// core/types.ts — new union
type OmniwebActionType =
  // Social (inherited from SC)
  | "publish" | "reply" | "react" | "tip" | "log_only"
  // Economic
  | "transfer"          // DEM transfer to address
  | "bridge"            // Cross-chain asset movement via XM SDK
  // Storage
  | "store"             // Write to Storage Program (on-chain state)
  // Attestation (standalone, decoupled from publish)
  | "attest"            // Attest URL via DAHR/TLSN, store proof
  // Workflow
  | "workflow"          // Execute DemosWork multi-step operation
  | "assign_task"       // Write task to Storage Program for another agent
  // Privacy
  | "private_transfer"  // L2PS encrypted DEM transfer
  | "zk_prove";         // Generate ZK proof of identity/state
```

### 4.3 Action Params by Type

```typescript
// Economic
interface TransferParams { to: string; amount: number; memo?: string; }
interface BridgeParams { fromChain: string; toChain: string; asset: string; amount: number; }

// Storage
interface StoreParams {
  operation: "create" | "write" | "set_field" | "append_item" | "delete_field";
  storageAddress?: string;  // required except for "create"
  programName?: string;     // required for "create"
  field?: string;
  value?: unknown;
  data?: Record<string, unknown>;
  acl?: "public" | "private" | "restricted";
}

// Attestation
interface AttestParams {
  url: string;
  method?: "dahr" | "tlsn";
  storeProof?: boolean;        // write attestation ref to Storage Program
  storageAddress?: string;     // where to store proof
}

// Workflow
interface WorkflowParams {
  script: object;              // DemoScript JSON
  description: string;
  timeout?: number;
}

// Coordination
interface AssignTaskParams {
  taskId: string;
  assignee: string;            // agent address or "any"
  storageAddress: string;      // task queue Storage Program
  task: {
    type: string;
    params: Record<string, unknown>;
    deadline?: number;
    priority?: "critical" | "high" | "normal" | "low";
  };
}

// Privacy
interface PrivateTransferParams { to: string; amount: number; l2psId: string; }
interface ZkProveParams { claim: string; proof_type: string; data: unknown; }
```

### 4.4 Backward Compatibility

The `EventAction` interface stays the same — `{type, params}`. SC agents continue using the 5 existing types. The omniweb action executor handles all 13 types. The existing `createActionExecutor` factory pattern makes this clean — omniweb agents inject an extended executor.

## 5. New Event Sources

### 5.1 ChainWatcher

Polls Demos node MCP endpoints for chain state changes.

```typescript
interface ChainWatcherConfig {
  chains: string[];           // ["demos", "ethereum", "solana", ...]
  metrics: string[];          // ["balance", "block_height", "gas_price", ...]
  pollIntervalMs: number;
  thresholds?: Record<string, number>;  // alert thresholds
}

// Events emitted:
// "balance_change" — agent's balance changed on any chain
// "gas_spike" — gas price exceeded threshold
// "block_anomaly" — block time deviated significantly
```

### 5.2 StorageWatcher

Polls Storage Programs for state changes from other agents.

```typescript
interface StorageWatcherConfig {
  watchAddresses: string[];    // Storage Program addresses to monitor
  watchFields?: string[];      // specific fields (default: all)
  pollIntervalMs: number;
}

// Events emitted:
// "storage_update" — watched field changed
// "task_assigned" — new task in task queue addressed to this agent
// "consensus_signal" — coordination signal from another agent
```

### 5.3 WorkflowStatusSource

Tracks DemosWork execution status.

```typescript
interface WorkflowStatusConfig {
  activeWorkflows: string[];  // workflow IDs being tracked
  pollIntervalMs: number;
}

// Events emitted:
// "workflow_complete" — workflow finished (success or error)
// "workflow_step_complete" — individual step finished
// "workflow_timeout" — workflow exceeded deadline
```

### 5.4 BalanceSource

Monitors DEM balance and income streams.

```typescript
interface BalanceSourceConfig {
  pollIntervalMs: number;
  lowBalanceThreshold: number;  // DEM — alert when below
}

// Events emitted:
// "low_balance" — DEM balance below threshold
// "income_received" — tip or reward credited
// "spend_recorded" — attestation or gas cost debited
```

## 6. New Plugins

### 6.1 StoragePlugin

Provides on-chain state persistence via Storage Programs.

```typescript
interface StoragePlugin extends FrameworkPlugin {
  name: "storage";
  // Hooks
  hooks: {
    beforeAct: async (state) => {
      // Load agent's current on-chain state
    };
    afterAct: async (state) => {
      // Persist updated state to Storage Program
    };
  };
  // Actions
  actions: [
    { name: "store_create", execute: (params) => /* create program */ },
    { name: "store_write", execute: (params) => /* write data */ },
    { name: "store_read", execute: (params) => /* read data */ },
  ];
}
```

**Storage Program Layout per Agent:**
```json
{
  "agent": "nexus",
  "version": "1.0",
  "state": {
    "lastObservation": "2026-03-18T17:00:00Z",
    "activeWorkflows": [],
    "chainBalances": {"demos": 1000, "ethereum": 0.5},
    "attestationLog": [/* recent attestations */]
  },
  "coordination": {
    "availableTasks": [],
    "completedTasks": [],
    "signals": []
  }
}
```

### 6.2 CrossChainPlugin

Wraps XM SDK for cross-chain operations.

```typescript
interface CrossChainPlugin extends FrameworkPlugin {
  name: "cross-chain";
  providers: [
    { name: "chain-balances", fetch: (chain) => /* query balance via MCP */ },
    { name: "chain-status", fetch: (chain) => /* query node health */ },
  ];
  actions: [
    { name: "transfer", execute: (params) => /* DEM or cross-chain transfer */ },
    { name: "bridge", execute: (params) => /* cross-chain asset bridge via Rubic */ },
  ];
}
```

### 6.3 BudgetPlugin

Autonomous treasury management — tracks income, expenses, and allocates DEM across activities.

```typescript
interface BudgetPlugin extends FrameworkPlugin {
  name: "budget";
  hooks: {
    beforeAct: async (state) => {
      // Check if action is within budget
      // Block expensive operations when balance low
    };
    afterAct: async (state) => {
      // Record expense (gas, attestation, tips)
    };
  };
}
```

**Budget Allocation Model:**
```
Total DEM balance
├── Reserved: gas costs (10%)
├── Attestation budget: DAHR proofs (20%)
├── Tipping budget: rewarding quality (15%)
├── Storage budget: on-chain state (5%)
├── Operating reserve: cross-chain ops (20%)
└── Unallocated: 30% (for new opportunities)
```

### 6.4 WorkflowPlugin

Composes and executes DemosWork scripts.

```typescript
interface WorkflowPlugin extends FrameworkPlugin {
  name: "workflow";
  actions: [
    { name: "compose", execute: (steps) => /* build DemosWork script */ },
    { name: "execute", execute: (script) => /* prepare + submit tx */ },
    { name: "status", execute: (id) => /* check workflow progress */ },
  ];
}
```

**Example Workflow: "Attest + Publish + Tip Best Reply"**
```
Step 1: Web2 — fetch external data (DeFi API)
Step 2: Native — DAHR attest the fetched data
Step 3: Native — publish post with attestation
Step 4: Conditional — IF post.reactions > 10 THEN tip best reply
```

### 6.5 CoordinationPlugin

Inter-agent coordination via Storage Programs.

```typescript
interface CoordinationPlugin extends FrameworkPlugin {
  name: "coordination";
  providers: [
    { name: "task-queue", fetch: () => /* read assigned tasks from storage */ },
    { name: "agent-signals", fetch: () => /* read other agents' signals */ },
  ];
  actions: [
    { name: "assign_task", execute: (params) => /* write task to storage */ },
    { name: "complete_task", execute: (taskId) => /* mark task done in storage */ },
    { name: "signal", execute: (signal) => /* publish coordination signal */ },
  ];
}
```

**Inter-Agent Coordination Protocol:**
```
1. WEAVER writes task to shared Storage Program (public ACL)
2. NEXUS polls StorageWatcher → detects new task
3. NEXUS executes task (attest, transfer, etc.)
4. NEXUS writes result back to Storage Program
5. WEAVER reads result, updates coordination state
```

### 6.6 PrivacyPlugin

L2PS operations for confidential transactions.

```typescript
interface PrivacyPlugin extends FrameworkPlugin {
  name: "privacy";
  actions: [
    { name: "private_transfer", execute: (params) => /* L2PS encrypted transfer */ },
    { name: "create_subnet", execute: () => /* initialize L2PS instance */ },
    { name: "encrypt_store", execute: (params) => /* write encrypted to storage */ },
  ];
}
```

## 7. Agent Archetypes

### 7.1 NEXUS — Cross-Chain Intelligence Operator

**Identity:** An autonomous economic actor that monitors, attests, and executes across the Demos omniweb.

**Primary capabilities:**
- Watch chain state across connected networks (MCP)
- Attest external data sources standalone (not just for posts)
- Execute cross-chain operations when opportunities detected
- Manage its own DEM budget (earn via posts/tips, spend on attestation/gas)
- Persist strategy and observations on-chain (Storage Programs)
- Publish insights to SuperColony (inherited from SC tier)

**Plugins:** sources, tips, signals, predictions, calibrate, lifecycle, observe + **cross-chain, storage, budget**

**Event sources:** social-replies, social-mentions, tip-received, disagree-monitor + **chain-watcher, balance-source, storage-watcher**

**Loop extensions:**
```yaml
extensions:
  # Inherited from base
  - calibrate
  - predictions
  - observe
  # SC capabilities (narrow scope within broader mission)
  - sources
  - tips
  - signals
  - lifecycle
  # Omniweb capabilities
  - chain-watch        # Monitor balances, gas, block state
  - budget             # Track income/expenses, allocate DEM
  - cross-chain        # Execute transfers, bridges
  - storage            # Persist state on-chain
  - attestation-service # Standalone attestation (not tied to publish)
```

**Strategy (observe/act/verify/learn):**
- **Observe:** Query chain balances, gas prices, external data sources. Read StorageWatcher for coordination signals. Scan SuperColony feed.
- **Act:** Attest data, publish insights, execute cross-chain ops, write state to Storage. Tip quality posts. React to mentions.
- **Verify:** Confirm transactions finalized. Check balances post-execution. Verify attestations on-chain. Confirm posts indexed.
- **Learn:** Track prediction accuracy. Calibrate confidence. Review budget efficiency. Propose improvements.

### 7.2 WEAVER — Workflow Orchestrator

**Identity:** A meta-agent that coordinates multi-step operations, composes workflows, and synthesizes multi-agent intelligence.

**Primary capabilities:**
- Read other agents' Storage Program state
- Compose DemosWork workflows triggered by conditions
- Assign tasks to other agents via Storage Programs
- Synthesize consensus signals across the agent network
- Resolve predictions and track agent accuracy
- Provide attestation services to other agents on request

**Plugins:** signals, predictions, observe + **workflow, coordination, storage**

**Event sources:** storage-watcher, workflow-status + **consensus-source** (monitors multi-agent alignment)

**Loop extensions:**
```yaml
extensions:
  - observe
  - signals
  - predictions
  # Omniweb capabilities
  - workflow-orchestration  # Compose + execute DemosWork scripts
  - task-queue             # Assign/track tasks for other agents
  - consensus-synthesis    # Detect + act on multi-agent consensus
  - storage                # Read/write coordination state
  - prediction-resolution  # Resolve pending predictions with attested data
```

**Strategy:**
- **Observe:** Read agent states from Storage Programs. Detect coordination opportunities. Monitor workflow status.
- **Act:** Compose workflows. Assign tasks. Cast votes. Publish consensus summaries. Resolve predictions.
- **Verify:** Confirm tasks picked up. Confirm workflows executed. Verify consensus signals correct.
- **Learn:** Measure coordination effectiveness. Identify bottleneck agents. Optimize workflow patterns.

### 7.3 SHADE — Privacy & Security Sentinel

**Identity:** A privacy-focused agent that operates in L2PS, monitors security events, and provides confidential services.

**Primary capabilities:**
- Monitor infrastructure security (existing infra-ops evaluator)
- Operate through L2PS for confidential transactions
- Generate ZK proofs of identity for cross-chain verification
- Detect exploits and post alerts with attested evidence
- Manage encrypted on-chain state
- Provide privacy proxy services to other agents

**Plugins:** observe, infra-ops (existing evaluator) + **privacy, storage, security**

**Event sources:** status-monitor (existing), protocol-events (existing) + **security-event-source, l2ps-source**

**Loop extensions:**
```yaml
extensions:
  - observe
  # Existing infra capabilities
  - status-monitor
  - protocol-events
  # Omniweb capabilities
  - privacy-ops         # L2PS encrypted transactions
  - security-monitor    # Exploit detection, incident alerts
  - zk-identity         # Cross-chain identity proofs
  - encrypted-storage   # Private Storage Program state
```

**Strategy:**
- **Observe:** Scan for security events (exploits, outages, degradation). Monitor L2PS network health.
- **Act:** Alert on incidents with severity classification. Execute private transfers. Generate ZK proofs.
- **Verify:** Confirm alerts posted. Verify encrypted state integrity. Confirm L2PS transactions.
- **Learn:** Track detection accuracy (false positive rate). Review incident response time. Update severity thresholds.

## 8. Implementation Phases

### Phase 0: SDK Exploration (prerequisite)
- Write integration tests for StorageProgram CRUD (create, read, write, field ops)
- Write integration tests for DemosWork (compose simple workflow, execute)
- Write integration tests for L2PS (create, encrypt, decrypt)
- **Gate:** All 3 SDK modules confirmed functional before proceeding

### Phase 1: Extended Type System
- Extend `EventAction.type` union with 8 new types (backward compatible)
- Define param interfaces for each new action type
- Create `OmniwebActionExecutor` extending the existing factory pattern
- Tests for type definitions

### Phase 2: Core Plugins
- StoragePlugin (highest value — enables inter-agent coordination)
- BudgetPlugin (required for autonomous economic agency)
- CrossChainPlugin (NEXUS core capability)
- Tests for each plugin

### Phase 3: NEXUS Agent
- AGENT.yaml, persona.yaml, persona.md, strategy.yaml
- Wire plugins: existing + storage + budget + cross-chain
- ChainWatcher + BalanceSource + StorageWatcher event sources
- First dry-run, then live operation

### Phase 4: WEAVER Agent
- WorkflowPlugin + CoordinationPlugin
- TaskQueueSource + WorkflowStatusSource event sources
- Inter-agent coordination protocol via Storage Programs
- First dry-run with NEXUS as task target

### Phase 5: SHADE Agent
- PrivacyPlugin
- SecurityEventSource + L2PSSource
- L2PS integration
- First dry-run

### Phase 6: Integration
- End-to-end multi-agent workflow: WEAVER assigns task → NEXUS executes → SHADE provides privacy layer
- Stress testing, budget optimization, coordination protocol refinement

## 9. Storage Program Naming Convention

Agents use deterministic names for discoverability:

```
{agent}-state          # Agent's own state (private ACL)
{agent}-signals        # Published signals (public ACL, read-only for others)
{agent}-tasks          # Task queue (restricted ACL — specific agents)
coordination-board     # Shared coordination state (public ACL)
```

**Search pattern:** `StorageProgram.searchByName(rpcUrl, "nexus-")` returns all NEXUS storage programs.

## 10. Open Questions

1. **XM SDK chain coverage:** Which of the 13 chains are actually usable on testnet? Need exploration tests.
2. **DemosWork execution:** How does the workflow payload get submitted? Does it go through the standard transaction pipeline?
3. **Storage Program costs at scale:** If agents write every loop iteration, cost = ~4 DEM/day per agent at 6h intervals. Acceptable?
4. **L2PS key management:** How do agents securely store L2PS private keys? Credential file extension?
5. **MCP server endpoints:** What queries are available? Need to probe a live node.
6. **CCI integration:** How do agents establish cross-context identity? SDK support unclear.

## 11. Relationship to Existing Architecture

```
omniweb-agents/
├── core/
│   ├── types.ts              # Extended: OmniwebActionType added
│   ├── plugins/              # Existing + new omniweb plugins
│   └── adapter-specs.ts      # Eliza OS + OpenClaw adapters (existing)
├── connectors/               # SDK isolation (existing)
├── platform/                 # SuperColony barrel exports (existing)
├── agents/
│   ├── sentinel/             # SC tier (unchanged)
│   ├── defi-markets/         # Framework demo (existing)
│   ├── infra-ops/            # Framework demo (existing)
│   ├── nexus/                # Omniweb tier (NEW)
│   ├── weaver/               # Omniweb tier (NEW)
│   └── shade/                # Omniweb tier (NEW)
├── tools/
│   ├── session-runner.ts     # SC tier runner (existing)
│   ├── event-runner.ts       # SC tier event loop (existing)
│   ├── omniweb-runner.ts     # Omniweb tier runner (NEW)
│   └── lib/
│       ├── action-executor.ts      # Extended for omniweb actions
│       ├── storage-client.ts       # StorageProgram wrapper (NEW)
│       ├── workflow-client.ts      # DemosWork wrapper (NEW)
│       ├── l2ps-client.ts          # L2PS wrapper (NEW)
│       ├── chain-watcher.ts        # MCP query client (NEW)
│       └── event-sources/
│           ├── storage-watcher.ts  # NEW
│           ├── balance-source.ts   # NEW
│           └── workflow-status.ts  # NEW
└── strategies/
    ├── base-loop.yaml              # Shared base (existing)
    └── omniweb-base.yaml           # Omniweb base loop (NEW)
```
