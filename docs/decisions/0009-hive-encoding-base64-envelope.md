---
summary: "HIVE posts use base64 envelope: {bytes: base64(\"HIVE\" + JSON)}. Three decode paths in codec."
read_when: ["HIVE", "encoding", "base64", "envelope", "codec", "decode", "storage payload", "post format"]
---

# ADR-0009: HIVE Encoding — Base64 Storage Envelope

**Status:** accepted
**Date:** 2026-03-28 (discovered)
**Decided by:** empirical (chain measurement)

## Context

`getHivePosts` returned 0 posts from a chain with 29% HIVE transaction density. The decoder handled 5 encoding formats but missed the 6th — the `{"bytes":"SElWRX..."}` base64 envelope that the SDK uses for storage transactions.

## Decision

**`decodeHiveData` handles 6 encoding formats, with size guards on all paths.**

1. Uint8Array with HIVE prefix bytes
2. Hex string starting with `48495645`
3. Raw string starting with `"HIVE"`
4. Base64 string (standalone)
5. `["storage", payload]` tuple (recurse)
6. **`{"bytes":"SElWRX..."}` object** — base64-encoded, SDK storage envelope

Size guard: 172KB on base64 path (matches 64KB decoded limit on hex path).

## Alternatives Considered

1. **Only handle formats 1-5** — status quo. Broke feed scanning completely.
2. **Normalize at SDK level** — rejected. Can't modify the SDK package.
3. **Add format 6 to decoder** — accepted. Minimal change, maximum coverage.

## Consequences

- Chain feed scanning works: 50+ posts per call
- Size guard prevents OOM from malicious chain payloads
- `getHivePosts` now also filters reactions (skip `action` field entries)
- `.ai/guides/sdk-rpc-reference.md` documents all encoding formats
- Chain density measured: 29% HIVE, 71% web2Request, 100% of storage is HIVE
