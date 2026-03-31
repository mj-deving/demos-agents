export interface ContractEntry {
  address: string;
  abi: unknown[];
  isProxy: boolean;
}

export interface MetricDerivation {
  rawUnit: string;
  decimals: number;
  outputUnit: string;
}

export interface MetricDefinition {
  contract: string;
  function: string;
  params?: string[];
  derivation?: MetricDerivation;
  enumMap?: Record<number, string>;
  positiveStates?: string[];
  negativeStates?: string[];
}

export interface ProtocolEntry {
  chain: string;
  contracts: Record<string, ContractEntry>;
  metrics: Record<string, MetricDefinition>;
}

const TOTAL_SUPPLY_ABI = [{
  type: "function",
  name: "totalSupply",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint256" }],
}] satisfies unknown[];

const GET_PROPOSAL_STATE_ABI = [{
  type: "function",
  name: "getProposalState",
  stateMutability: "view",
  inputs: [{ name: "proposalId", type: "uint256" }],
  outputs: [{ type: "uint8" }],
}] satisfies unknown[];

const PROPOSAL_STATE_ENUM = {
  0: "pending",
  1: "active",
  2: "canceled",
  3: "defeated",
  4: "succeeded",
  5: "queued",
  6: "expired",
  7: "executed",
} satisfies Record<number, string>;

export const CONTRACT_REGISTRY: Record<string, ProtocolEntry> = {
  compound: {
    chain: "eth:1",
    contracts: {
      tvlToken: {
        address: "0x39AA39c021dfbaE8faC545936693aC917d5E7563",
        abi: TOTAL_SUPPLY_ABI,
        isProxy: false,
      },
      governance: {
        address: "0xc0Da02939E1441F497fd74F78cE7Decb17B66529",
        abi: GET_PROPOSAL_STATE_ABI,
        isProxy: false,
      },
    },
    metrics: {
      tvl: {
        contract: "tvlToken",
        function: "totalSupply",
        derivation: {
          rawUnit: "base_units",
          decimals: 6,
          outputUnit: "USD",
        },
      },
      governance: {
        contract: "governance",
        function: "getProposalState",
        params: ["entityId"],
        enumMap: PROPOSAL_STATE_ENUM,
        positiveStates: ["succeeded", "queued", "executed"],
        negativeStates: ["canceled", "defeated", "expired"],
      },
    },
  },
  aave: {
    chain: "eth:1",
    contracts: {
      governance: {
        address: "0xEC568fffba86c094cf06b22134B23074DFE2252c",
        abi: GET_PROPOSAL_STATE_ABI,
        isProxy: false,
      },
    },
    metrics: {
      governance: {
        contract: "governance",
        function: "getProposalState",
        params: ["entityId"],
        enumMap: PROPOSAL_STATE_ENUM,
        positiveStates: ["succeeded", "queued", "executed"],
        negativeStates: ["canceled", "defeated", "expired"],
      },
    },
  },
  uniswap: {
    chain: "eth:1",
    contracts: {
      governor: {
        address: "0x408ED6354d4973f66138C91495F2f2bE7D0D3344",
        abi: GET_PROPOSAL_STATE_ABI,
        isProxy: false,
      },
    },
    metrics: {},
  },
  marinade: {
    chain: "sol:mainnet",
    contracts: {
      state: {
        address: "8szGkuLqMZscyH2rvZqQhq8LJLtX6JzZsE8hVvUPTqCq",
        abi: [],
        isProxy: false,
      },
    },
    metrics: {
      tvl: {
        contract: "state",
        function: "fetchAccount",
        derivation: {
          rawUnit: "lamports",
          decimals: 9,
          outputUnit: "SOL",
        },
      },
    },
  },
};

const SUBJECT_ALIASES: Record<string, string[]> = {
  compound: ["compound", "compound finance"],
  aave: ["aave"],
  uniswap: ["uniswap"],
  marinade: ["marinade", "marinade finance"],
};

const METRIC_ALIASES: Record<string, string[]> = {
  tvl: ["tvl", "total value locked"],
  governance: ["governance", "proposal state", "proposal_state", "proposalstate", "governance state"],
};

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function canonicalMetric(metric: string): string {
  const normalized = normalizeToken(metric);
  for (const [key, aliases] of Object.entries(METRIC_ALIASES)) {
    if (aliases.some((alias) => normalizeToken(alias) === normalized)) {
      return key;
    }
  }
  return normalized.replace(/\s+/g, "_");
}

function resolveProtocolKey(
  subject: string,
  registry: Record<string, ProtocolEntry>,
): string | null {
  const normalized = normalizeToken(subject);

  for (const [protocolKey, aliases] of Object.entries(SUBJECT_ALIASES)) {
    if (!(protocolKey in registry)) continue;
    if (aliases.some((alias) => normalized.includes(normalizeToken(alias)))) {
      return protocolKey;
    }
  }

  for (const protocolKey of Object.keys(registry)) {
    if (normalized.includes(normalizeToken(protocolKey))) {
      return protocolKey;
    }
  }

  return null;
}

function toNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function resolveChainSource(
  subject: string,
  metric: string,
  registry: Record<string, ProtocolEntry> = CONTRACT_REGISTRY,
): { protocol: ProtocolEntry; metricDef: MetricDefinition } | null {
  const protocolKey = resolveProtocolKey(subject, registry);
  if (!protocolKey) return null;

  const protocol = registry[protocolKey];
  const metricDef = protocol.metrics[canonicalMetric(metric)];

  if (!metricDef) return null;

  return { protocol, metricDef };
}

export function deriveValue(
  rawValue: unknown,
  derivation: MetricDerivation,
): number | null {
  const numericValue = toNumeric(rawValue);
  if (numericValue === null) return null;

  return numericValue / (10 ** derivation.decimals);
}
