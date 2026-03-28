# ADR-0004: Node.js Runtime, Not Bun

**Status:** accepted
**Date:** 2026-02-18
**Decided by:** Marius (empirical)

## Context

Bun offers faster startup and built-in TypeScript support. However, the Demos SDK (`@kynesyslabs/demosdk`) uses native Node.js addons (NAPI) for cryptographic operations.

## Decision

**Node.js + tsx for all runtime execution. Bun is incompatible.**

The SDK crashes on Bun due to NAPI binary incompatibility. All CLI entry points use `npx tsx` for TypeScript execution.

## Alternatives Considered

1. **Bun** — faster, nicer DX. Rejected: NAPI crash on SDK initialization.
2. **Node.js + ts-node** — works but slower startup. Rejected for tsx.
3. **Node.js + tsx** — accepted. Fast enough, full NAPI compatibility.

## Consequences

- All scripts use `npx tsx` (not `bun run`)
- `package.json` scripts use Node.js
- Test runner: vitest (works with both, but runs on Node.js)
- No Bun-specific APIs used anywhere
