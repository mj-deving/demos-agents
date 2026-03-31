import type { StructuredClaim } from "../publish/types.js";
import {
  CONTRACT_REGISTRY,
  deriveValue,
  resolveChainSource,
  type MetricDefinition,
  type ProtocolEntry,
} from "./contract-registry.js";
import type {
  ChainAdapter,
  ChainFamily,
  ChainProvenance,
} from "./xm-types.js";

export interface ChainVerificationResult {
  verified: boolean;
  source: "chain-native";
  data: unknown;
  derivedValue: number | null;
  provenance: ChainProvenance | null;
  trustTier: "authoritative" | "discovered" | "failed";
  error?: string;
}

export interface ChainVerifierOptions {
  adapters?: Map<ChainFamily, ChainAdapter>;
  registry?: Record<string, ProtocolEntry>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getChainFamily(chainId: string): ChainFamily | null {
  const prefix = chainId.split(":")[0]?.toLowerCase();
  switch (prefix) {
    case "eth":
    case "arb":
    case "op":
    case "polygon":
    case "avax":
    case "bsc":
      return "evm";
    case "sol":
      return "solana";
    case "btc":
      return "btc";
    case "ton":
      return "ton";
    case "near":
      return "near";
    case "ibc":
      return "ibc";
    default:
      return null;
  }
}

function buildArgs(metricDef: MetricDefinition, claim: StructuredClaim): unknown[] {
  const claimFields: Record<string, unknown> = {
    chain: claim.identity.chain,
    address: claim.identity.address,
    market: claim.identity.market,
    entityId: claim.identity.entityId,
    metric: claim.identity.metric,
    subject: claim.subject,
    value: claim.value,
    unit: claim.unit,
    direction: claim.direction,
    dataTimestamp: claim.dataTimestamp,
    sourceField: claim.sourceField,
    type: claim.type,
  };

  return (metricDef.params ?? []).map((key) => claimFields[key] ?? null);
}

function extractMetricValue(rawData: unknown, metricDef: MetricDefinition): unknown {
  if (
    metricDef.function === "fetchAccount" &&
    rawData &&
    typeof rawData === "object" &&
    "totalStakedSol" in rawData
  ) {
    return (rawData as Record<string, unknown>).totalStakedSol;
  }

  return rawData;
}

function mapEnumValue(rawValue: unknown, metricDef: MetricDefinition): unknown {
  if (!metricDef.enumMap) return rawValue;

  const enumKey = typeof rawValue === "number"
    ? rawValue
    : typeof rawValue === "string" && rawValue.trim().length > 0
      ? Number(rawValue)
      : null;

  if (enumKey === null || !Number.isInteger(enumKey)) return rawValue;

  return metricDef.enumMap[enumKey] ?? rawValue;
}

function endpointHint(chainId: string, claim: StructuredClaim): string {
  const hint = claim.identity.chain.trim();
  if (/^[a-z]+:\/\//i.test(hint)) {
    return hint;
  }

  return `chain://${chainId}`;
}

function failedResult(error: string): ChainVerificationResult {
  return {
    verified: false,
    source: "chain-native",
    data: null,
    derivedValue: null,
    provenance: null,
    trustTier: "failed",
    error,
  };
}

export async function verifyClaimOnChain(
  claim: StructuredClaim,
  options: ChainVerifierOptions = {},
): Promise<ChainVerificationResult> {
  const registry = options.registry ?? CONTRACT_REGISTRY;
  const resolved = resolveChainSource(claim.subject, claim.identity.metric, registry);
  if (!resolved) {
    return failedResult(`no chain source registered for ${claim.subject}:${claim.identity.metric}`);
  }

  const family = getChainFamily(resolved.protocol.chain);
  if (!family) {
    return failedResult(`unsupported chain family for ${resolved.protocol.chain}`);
  }

  const adapter = options.adapters?.get(family);
  if (!adapter) {
    return failedResult(`no adapter available for ${family}`);
  }

  const contract = resolved.protocol.contracts[resolved.metricDef.contract];
  if (!contract) {
    return failedResult(`missing contract entry ${resolved.metricDef.contract}`);
  }

  const args = buildArgs(resolved.metricDef, claim);
  const timestamp = new Date().toISOString();
  let connected = false;

  try {
    await adapter.connect(endpointHint(resolved.protocol.chain, claim));
    connected = true;

    const rawRead = resolved.metricDef.function === "getBalance"
      ? await adapter.getBalance(contract.address)
      : await adapter.readContract(
        contract.address,
        contract.abi,
        resolved.metricDef.function,
        args,
      );

    const extractedValue = extractMetricValue(rawRead, resolved.metricDef);
    const data = mapEnumValue(extractedValue, resolved.metricDef);

    let blockNumber: number | null = null;
    try {
      blockNumber = await adapter.getBlockNumber();
    } catch {
      blockNumber = null;
    }

    const provenance: ChainProvenance = {
      chainId: resolved.protocol.chain,
      blockNumber,
      contractAddress: contract.address,
      method: resolved.metricDef.function,
      args,
      timestamp,
    };

    return {
      verified: true,
      source: "chain-native",
      data,
      derivedValue: resolved.metricDef.derivation
        ? deriveValue(extractedValue, resolved.metricDef.derivation)
        : null,
      provenance,
      trustTier: provenance ? "authoritative" : "discovered",
    };
  } catch (error) {
    return failedResult(toErrorMessage(error));
  } finally {
    if (connected) {
      adapter.disconnect();
    }
  }
}
