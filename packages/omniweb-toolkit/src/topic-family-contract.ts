export interface TopicMetricSemantic {
  means: string;
  doesNotMean: string;
  comment?: string;
}

export interface TopicClaimRequirement {
  claim: string;
  requiredMetrics: string[];
  reason: string;
}

export interface TopicClaimBounds {
  defensible: string[];
  blocked: string[];
  requiresExtra: TopicClaimRequirement[];
}

export interface TopicQualitySlipPattern {
  pattern: RegExp;
  detail: string;
}

export interface TopicFamilySourcePlan {
  primarySourceIds: string[];
  supportingSourceIds: string[];
  expectedMetrics: string[];
}

export interface TopicFamilyPromptDoctrine {
  baseline: string[];
  focus: string[];
}

export interface TopicFamilyQualityContract {
  slipPatterns: TopicQualitySlipPattern[];
}

export interface TopicFamilyContract<TFamily extends string = string> {
  family: TFamily;
  displayName: string;
  sourcePlan: TopicFamilySourcePlan;
  promptDoctrine: TopicFamilyPromptDoctrine;
  claimBounds: TopicClaimBounds;
  metricSemantics: Record<string, TopicMetricSemantic>;
  quality: TopicFamilyQualityContract;
}

export type TopicFamilyRegistry<TFamily extends string = string> = Record<TFamily, TopicFamilyContract<TFamily>>;

export function defineTopicFamilyContract<TFamily extends string>(
  contract: TopicFamilyContract<TFamily>,
): TopicFamilyContract<TFamily> {
  return contract;
}

export function createTopicFamilyRegistry<TFamily extends string>(
  contracts: TopicFamilyContract<TFamily>[],
): TopicFamilyRegistry<TFamily> {
  const registry = {} as TopicFamilyRegistry<TFamily>;

  for (const contract of contracts) {
    if (contract.family in registry) {
      throw new Error(`duplicate_topic_family_contract:${contract.family}`);
    }
    registry[contract.family] = contract;
  }

  return registry;
}

export function getTopicFamilyContract<TFamily extends string>(
  registry: TopicFamilyRegistry<TFamily>,
  family: TFamily,
): TopicFamilyContract<TFamily> {
  const contract = registry[family];
  if (!contract) {
    throw new Error(`unknown_topic_family_contract:${family}`);
  }
  return contract;
}
