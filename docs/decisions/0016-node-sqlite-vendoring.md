---
summary: "Use node:sqlite (built-in) not better-sqlite3 — zero native deps, FTS5/triggers supported, vendored with Node 22+"
read_when: ["sqlite", "database", "node:sqlite", "better-sqlite3", "vendoring", "native dependency"]
---

# ADR-0016: node:sqlite Vendoring via better-sqlite3 API Shim

**Status:** accepted
**Date:** 2026-03-31
**Context:** V3 Phase 2b colony cache needed SQLite

## Decision

Use Node.js built-in `node:sqlite` (`DatabaseSync`) via a `better-sqlite3` API-compatible shim in `vendor/better-sqlite3/`. The shim implements `Database`, `Statement` (with `run`, `get`, `all`, `pluck`), `pragma()`, `exec()`, `prepare()`, `transaction()`, and `close()`.

## Why Not `better-sqlite3` Directly?

- `better-sqlite3` requires native C++ compilation via `node-gyp`
- Codex sandbox (and some CI environments) lack build tools
- The colony cache uses a small subset of the `better-sqlite3` API (no custom functions, aggregates, or backup)

## Why `node:sqlite`?

- Ships with Node.js 22+ — zero external dependencies
- `DatabaseSync` is synchronous, matching `better-sqlite3` semantics
- Sufficient for our use case: parameterized queries, transactions, WAL mode, PRAGMA

## Risks

- `node:sqlite` is **experimental** (Node.js 22-23). API may change.
- Feature parity with `better-sqlite3` is incomplete (no `backup()`, `loadExtension()`, custom aggregates)
- Performance characteristics may differ from `better-sqlite3`'s optimized native bindings

## Mitigation

- The shim is ~87 lines — easy to audit and update if `node:sqlite` API changes
- All colony code imports `better-sqlite3` (not `node:sqlite` directly) — swapping the real package requires only `npm install better-sqlite3` and deleting the vendor shim
- If `node:sqlite` is removed or broken in a future Node version, swap to real `better-sqlite3` in one `package.json` change

## Consequences

- `ExperimentalWarning` printed on first SQLite use — cosmetic only
- Colony tests run without native compilation — faster CI, works in sandboxes
- When/if we need `better-sqlite3` features beyond the shim, install the real package
