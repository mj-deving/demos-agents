---
type: reference
status: current
scraped: 2026-04-02
source: Demos SDK MCP (demosdk_references)
coverage: All SDK modules
---

# Demos SDK Capabilities Reference

> Comprehensive reference from SDK MCP queries on 2026-04-02.
> For strategy-relevant capabilities only. Full SDK docs at MCP.

## Core Modules

1. **websdk.Demos** — Main SDK class (connect, wallet, transfer, transactions)
2. **Identity/Abstraction** — Web2/Web3/ZK/PQC identity management
3. **Storage Programs** — On-chain structured storage (CREATE, WRITE, READ, ACL)
4. **IPFS** — Content pinning/unpinning with quotes
5. **Web2Proxy** — DAHR HTTP proxy (startProxy is complete operation)
6. **TLSNotary** — MPC-TLS HTTPS attestations
7. **Bridge** — Cross-chain via Rubic (9 chains, 3 tokens)
8. **XMCore** — Multi-chain reads (EVM, Solana, BTC, TON, NEAR, IBC, TRON, MultiversX, XRPL)
9. **Encryption** — FHE, PQC, ZK proofs, HKDF key derivation
10. **Instant Messaging** — P2P WebSocket communication
11. **Escrow** — Send DEM to social identity with expiry
12. **DemosWork** — Workflow execution engine

## Strategy-Relevant Capabilities

| Capability | SDK Method | Strategy Use |
|------------|-----------|--------------|
| Balance check | `getBalance()` | Economic decision gating |
| Transfer DEM | `transfer(to, amount)` | Tipping |
| DAHR attestation | `web2.createDahr().startProxy()` | +40 scoring points |
| Identity lookup | `getIdentities(address)` | Agent profile enrichment |
| Reputation points | `getUserPoints(address)` | Trust scoring |
| Cross-chain reads | `xmcore.*.readFromContract()` | On-chain data verification |
| Storage programs | `storageProgram.create/write/read` | Persistent on-chain data |
| ZK proofs | `encryption.zK.identity.*` | Privacy-preserving attestation |
| Nomis scores | `getNomisScore(wallet, chain)` | Wallet reputation |

## Cross-Chain Read Capabilities (via XMCore)

| Chain | Methods | Verify |
|-------|---------|--------|
| EVM (Eth, Polygon, etc.) | `readFromContract()`, `getBalance()` | Smart contract state, TVL |
| Solana | `fetchAccount()`, `runAnchorProgram()` | Program accounts, staking |
| Bitcoin | `getBalance()`, `fetchUTXOs()` | Balances, UTXO sets |
| TON, NEAR, IBC | Chain-specific | Various state data |

## Key Constants

- Storage: 1 DEM per 10KB, max 1MB per program
- IPFS: max 2GB per content
- TLSNotary: 1 DEM base + 1 DEM/KB
- Transfer: no memo param (attribution via API validation)
