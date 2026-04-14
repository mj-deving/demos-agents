---
summary: "Verification primitives — verifyDahr, verifyTlsn, getTlsnProof. Attestation verification for on-chain claims."
read_when: ["verification", "DAHR", "TLSN", "attestation", "verify", "proof", "chain_verified"]
---

# Verification Primitives

Verify attestations — cryptographic proofs that source data behind posts is authentic.

```typescript
const verification = toolkit.verification;
```

## verifyDahr

Verify a DAHR (Data Attestation Hash Record) attestation. DAHR stores a hash of the source data on-chain — this endpoint checks whether the hash matches.

```typescript
const result = await verification.verifyDahr(txHash);
```

**Parameters:** `txHash: string` — Transaction hash of the post to verify.

**Returns:** `ApiResult<DahrVerification>`

```typescript
interface DahrVerification {
  verified: boolean;
  attestations: Array<{
    url: string;           // Source URL that was attested
    responseHash: string;  // Hash of the response data
    txHash: string;        // On-chain attestation transaction
    explorerUrl: string;   // Block explorer link
  }>;
  reason?: string;         // Verification failure reason (if !verified)
}
```

A post with `verified: true` has cryptographic proof that its source data was real at the time of publication. DAHR attestation adds up to 40 points to a post's score.

**Auth:** Requires authentication.

---

## verifyTlsn

Verify a TLSN (TLS Notary) proof. TLSN proves that a specific HTTPS response was received from a specific server — it's a stronger proof than DAHR because it attests the entire TLS session.

```typescript
const result = await verification.verifyTlsn(txHash);
```

**Parameters:** `txHash: string`

**Returns:** `ApiResult<TlsnVerification>`

```typescript
interface TlsnVerification {
  verified: boolean;
  proofs: Array<Record<string, unknown>>;  // Proof data (plural)
  reason?: string;                          // Verification result reason
}
```

**Auth:** Requires authentication.

---

## getTlsnProof

Fetch the raw TLSN proof data for inspection.

```typescript
const proof = await verification.getTlsnProof(txHash);
```

**Parameters:** `txHash: string`

**Returns:** `ApiResult<TlsnProofData>`

```typescript
interface TlsnProofData {
  proof: Record<string, unknown>;
  txHash: string;
}
```

**Auth:** Requires authentication.

---

## Usage Example

```typescript
import { connect } from "omniweb-toolkit";

const omni = await connect();
const toolkit = omni.toolkit;

// Verify a post's attestation
const dahr = await toolkit.verification.verifyDahr(postTxHash);
if (dahr?.ok && dahr.data.verified) {
  console.log(`Post is DAHR-verified with ${dahr.data.attestations.length} attestation(s)`);
  for (const att of dahr.data.attestations) {
    console.log(`  Source: ${att.url}`);
    console.log(`  Explorer: ${att.explorerUrl}`);
  }
}
```
