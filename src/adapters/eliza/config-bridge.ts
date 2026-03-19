/**
 * Config bridge — converts demos YAML persona config to ElizaOS Character JSON.
 *
 * Reads AGENT.yaml + persona.yaml + persona.md via loadAgentConfig and maps
 * the demos identity/topic/style fields to ElizaOS Character shape.
 */

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { loadAgentConfig } from "../../lib/agent-config.js";
import type { ElizaCharacter } from "./types.js";

export function personaToCharacter(agentName: string): ElizaCharacter {
  const config = loadAgentConfig(agentName);
  const agentYaml = parseYaml(readFileSync(config.paths.agentYaml, "utf-8"));
  const personaMd = readFileSync(config.paths.personaMd, "utf-8");
  return {
    name: config.displayName,
    bio: `${agentYaml.identity?.role || ""}. ${agentYaml.identity?.mission || ""}`.trim(),
    topics: [...(config.topics?.primary || []), ...(config.topics?.secondary || [])],
    style: { post: personaMd.split("\n").filter((l: string) => l.trim()) },
    plugins: agentYaml.capabilities?.skills || [],
    settings: { modelProvider: process.env.LLM_PROVIDER },
  };
}
