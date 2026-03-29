# ADR-0011: SDK Bridge Decomposition

**Status:** Accepted
**Date:** 2026-03-29
**Context:** sdk-bridge.ts grew to 917 LOC combining type definitions, HIVE encoding/decoding, chain transaction scanning, and a 15-method bridge factory. Desloppify flagged it as the largest active file with mixed responsibilities (design_coherence drag).

**Decision:** Extract two reusable primitives into dedicated modules:

- `src/toolkit/hive-codec.ts` — HIVE prefix handling, `encodeHivePayload()`, `decodeHiveData()`, `hasHivePrefix()`. These are pure data transforms with no bridge context dependency.
- `src/toolkit/chain-scanner.ts` — `scanAddressStorage()` pagination helper. This is a reusable chain query primitive used by multiple bridge methods.

sdk-bridge.ts imports from both new modules. The SdkBridge interface and createSdkBridge factory signature are unchanged.

**Alternatives Considered:**
- Keep everything in sdk-bridge.ts — rejected because 917 LOC with 5+ responsibilities violates single-responsibility and makes review harder.
- Extract all bridge methods into individual files — rejected as over-decomposition; the bridge factory is cohesive.
- Move to a subdirectory (sdk-bridge/) — rejected; 3 files don't warrant a directory.

**Consequences:**
- sdk-bridge.ts reduced to ~724 LOC (focused on bridge factory + API)
- hive-codec.ts and chain-scanner.ts are independently testable
- No breaking changes to public API
- Future chain query methods can reuse scanAddressStorage without importing the full bridge
