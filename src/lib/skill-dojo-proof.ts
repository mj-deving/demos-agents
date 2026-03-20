/**
 * Proof normalization — extracts attestation proofs from different
 * Skill Dojo response shapes into a common format.
 *
 * Never throws. Missing proofs are normal for non-attested skills.
 */

export interface NormalizedProof {
  attested: boolean;
  source: string;
  responseHash?: string;
  txHash?: string;
  explorerUrl?: string;
}

/**
 * Extract proof(s) from any skill response data.
 *
 * Supports:
 * - `data.dahrAttestation` (defi-agent shape) → single proof
 * - `data.demosAttestation.proofs` (prediction-market shape) → multiple proofs
 * - `data.attestation` or `data.proof` (generic) → best-effort single proof
 *
 * Returns empty array if no proof fields found.
 */
export function extractProofs(data: unknown): NormalizedProof[] {
  if (!data || typeof data !== "object") return [];

  const d = data as Record<string, unknown>;

  // defi-agent: data.dahrAttestation
  if (d.dahrAttestation && typeof d.dahrAttestation === "object") {
    const att = d.dahrAttestation as Record<string, unknown>;
    return [
      {
        attested: att.attested === true,
        source: (att.api as string) ?? "dahr",
        responseHash: att.responseHash as string | undefined,
        txHash: att.txHash as string | undefined,
        explorerUrl: att.explorerUrl as string | undefined,
      },
    ];
  }

  // prediction-market: data.demosAttestation.proofs
  if (d.demosAttestation && typeof d.demosAttestation === "object") {
    const dem = d.demosAttestation as Record<string, unknown>;
    if (dem.proofs && typeof dem.proofs === "object") {
      const proofs = dem.proofs as Record<string, unknown>;
      return Object.entries(proofs)
        .filter(([, v]) => v != null && typeof v === "object")
        .map(([key, v]) => {
          const p = v as Record<string, unknown>;
          return {
            attested: true,
            source: (p.source as string) ?? key,
            responseHash: p.responseHash as string | undefined,
            txHash: p.txHash as string | undefined,
            explorerUrl: p.explorerUrl as string | undefined,
          };
        });
    }
  }

  // Generic: data.attestation or data.proof
  const generic = (d.attestation ?? d.proof) as
    | Record<string, unknown>
    | undefined;
  if (generic && typeof generic === "object") {
    return [
      {
        attested: generic.attested === true,
        source: (generic.source as string) ?? "unknown",
        responseHash: generic.responseHash as string | undefined,
        txHash: generic.txHash as string | undefined,
        explorerUrl: generic.explorerUrl as string | undefined,
      },
    ];
  }

  return [];
}
