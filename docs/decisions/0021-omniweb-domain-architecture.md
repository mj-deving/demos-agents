---
status: accepted
date: 2026-04-10
summary: "OmniWeb toolkit exposes 6 Demos domains (colony, identity, escrow, storage, ipfs, chain), not just SuperColony."
read_when: ["architecture", "domain", "omniweb", "colony vs omniweb", "toolkit structure"]
---

# ADR-0021: OmniWeb Domain Architecture

## Context

The package is called `omniweb-toolkit` but only exposed SuperColony (`colony.hive.*`). The Demos SDK has 8+ modules spanning the full "OmniWeb" infrastructure. Features like StorageProgram and tip-by-handle were incorrectly placed in `HiveAPI` (the SuperColony social layer) when they're Demos chain primitives.

## Decision

Restructure `omniweb-toolkit` to expose 6 domains matching the Demos OmniWeb stack:

| Domain | SDK Source | What It Does |
|--------|-----------|-------------|
| `omni.colony` | SuperColony API | Social intelligence (posts, signals, predictions) |
| `omni.identity` | `Identities` + chain RPC | Identity linking + lookup |
| `omni.escrow` | `EscrowTransaction` | Trustless tipping to social identities |
| `omni.storage` | `StorageProgram` | On-chain programmable databases |
| `omni.ipfs` | `IPFSOperations` | Decentralized file storage |
| `omni.chain` | `Demos` class + `SdkBridge` | Core chain operations |

Top-level type renamed from `Colony` to `OmniWeb`. `Colony` kept as alias.

## Alternatives Considered

1. **Keep colony-only** — rejected because the package name is `omniweb-toolkit` and features kept being misplaced in HiveAPI
2. **Flat namespace** (`omni.publish()`, `omni.transfer()`) — rejected because domain boundaries prevent misplacement
3. **Separate packages** (`@omniweb/colony`, `@omniweb/escrow`) — premature, adds dependency management overhead

## Consequences

- Consumers access the full Demos stack through one `connect()` call
- Domain boundaries are clear — social features in `colony`, chain features in `chain`, etc.
- New SDK modules (XMCore, Messaging) have a clear place to land when ready
- Existing `colony.hive.*` code works unchanged (alias)
