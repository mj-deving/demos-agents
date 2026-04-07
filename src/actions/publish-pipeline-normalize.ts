import type { AttestResult, PublishInput, PublishOptions } from "./publish-pipeline.js";

const HIVE_PREFIX = new Uint8Array([0x48, 0x49, 0x56, 0x45]); // "HIVE"

type SourceAttestation = NonNullable<PublishInput["sourceAttestations"]>[number];
type TlsnAttestation = NonNullable<PublishInput["tlsnAttestations"]>[number];

export function encodeHivePost(post: object): Uint8Array {
  const json = JSON.stringify(post);
  const jsonBytes = new TextEncoder().encode(json);
  const combined = new Uint8Array(HIVE_PREFIX.length + jsonBytes.length);
  combined.set(HIVE_PREFIX, 0);
  combined.set(jsonBytes, HIVE_PREFIX.length);
  return combined;
}

export function buildNormalizedHivePost(
  input: PublishInput,
  options: Pick<PublishOptions, "allowUnattested"> = {}
): Record<string, unknown> {
  const hasDahr = Array.isArray(input.sourceAttestations) && input.sourceAttestations.length > 0;
  const hasTlsn = Array.isArray(input.tlsnAttestations) && input.tlsnAttestations.length > 0;
  if (!hasDahr && !hasTlsn && !options.allowUnattested) {
    throw new Error("Refusing unattested publish: sourceAttestations or tlsnAttestations is required");
  }

  for (const att of input.sourceAttestations || []) {
    if (!att?.url || !att?.responseHash || !att?.txHash) {
      throw new Error("Refusing publish: invalid sourceAttestations entry (url/responseHash/txHash required)");
    }
  }

  for (const att of input.tlsnAttestations || []) {
    if (!att?.url || !att?.txHash) {
      throw new Error("Refusing publish: invalid tlsnAttestations entry (url/txHash required)");
    }
  }

  const post: Record<string, unknown> = {
    v: 1,
    cat: input.category,
    text: input.text,
  };
  if (input.tags.length > 0) post.tags = input.tags;
  if (input.confidence !== undefined) post.confidence = input.confidence;
  if (input.replyTo) post.replyTo = input.replyTo;
  if (input.assets && input.assets.length > 0) post.assets = input.assets;
  if (input.sourceAttestations && input.sourceAttestations.length > 0) {
    post.sourceAttestations = input.sourceAttestations.map((attestation) =>
      normalizeSourceAttestation(attestation),
    );
  }
  if (input.tlsnAttestations && input.tlsnAttestations.length > 0) {
    post.tlsnAttestations = input.tlsnAttestations.map((attestation) =>
      normalizeTlsnAttestation(attestation),
    );
  }

  return post;
}

export function applyPreAttestedInput(
  input: PublishInput,
  preAttested: AttestResult[]
): { input: PublishInput; attestation: AttestResult } {
  const attestation = preAttested[0];
  return {
    attestation,
    input: {
      ...input,
      sourceAttestations: resolvePreAttestedSourceAttestations(input, preAttested),
      tlsnAttestations: resolvePreAttestedTlsnAttestations(input, preAttested),
    },
  };
}

export function resolveAttestedPublishInput(
  input: PublishInput,
  attestation?: AttestResult
): PublishInput {
  return {
    ...input,
    sourceAttestations:
      attestation?.type === "dahr"
        ? [normalizeSourceAttestation({
            url: attestation.url,
            responseHash: String(attestation.responseHash || ""),
            txHash: attestation.txHash,
          })]
        : input.sourceAttestations,
    tlsnAttestations:
      attestation?.type === "tlsn"
        ? [normalizeTlsnAttestation({
            url: attestation.url,
            txHash: attestation.txHash,
          })]
        : input.tlsnAttestations,
  };
}

function resolvePreAttestedSourceAttestations(
  input: PublishInput,
  preAttested: AttestResult[]
): PublishInput["sourceAttestations"] {
  const sourceAttestations = preAttested
    .filter((attestation) => attestation.type === "dahr")
    .map((attestation) =>
      normalizeSourceAttestation({
        url: attestation.url,
        responseHash: String(attestation.responseHash || ""),
        txHash: attestation.txHash,
      }),
    );

  return sourceAttestations.length > 0 ? sourceAttestations : input.sourceAttestations;
}

function resolvePreAttestedTlsnAttestations(
  input: PublishInput,
  preAttested: AttestResult[]
): PublishInput["tlsnAttestations"] {
  const tlsnAttestations = preAttested
    .filter((attestation) => attestation.type === "tlsn")
    .map((attestation) =>
      normalizeTlsnAttestation({
        url: attestation.url,
        txHash: attestation.txHash,
      }),
    );

  return tlsnAttestations.length > 0 ? tlsnAttestations : input.tlsnAttestations;
}

function normalizeSourceAttestation(attestation: SourceAttestation): SourceAttestation {
  return {
    url: attestation.url,
    responseHash: attestation.responseHash,
    txHash: attestation.txHash,
    timestamp: typeof attestation.timestamp === "number" ? attestation.timestamp : Date.now(),
  };
}

function normalizeTlsnAttestation(attestation: TlsnAttestation): TlsnAttestation {
  return {
    url: attestation.url,
    txHash: attestation.txHash,
    timestamp: typeof attestation.timestamp === "number" ? attestation.timestamp : Date.now(),
  };
}
