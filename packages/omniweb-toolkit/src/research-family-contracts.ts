import type { ResearchTopicFamily } from "./research-source-profile.js";
import type { TopicFamilyContract } from "./topic-family-contract.js";
import { defineTopicFamilyContract } from "./topic-family-contract.js";

export type SupportedResearchTopicFamily = Exclude<ResearchTopicFamily, "unsupported">;

export type ResearchTopicFamilyContract = TopicFamilyContract<SupportedResearchTopicFamily>;

export function defineResearchTopicFamilyContract<TFamily extends SupportedResearchTopicFamily>(
  contract: TopicFamilyContract<TFamily>,
): TopicFamilyContract<TFamily> {
  return defineTopicFamilyContract(contract);
}
