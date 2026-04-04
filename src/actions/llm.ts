/**
 * LLM text generation for Sentinel autonomous publishing.
 *
 * Provider-agnostic: accepts any LLMProvider instance.
 * Loads persona from agents/sentinel/personas/sentinel.md.
 * Loads strategy constraints from agents/sentinel/strategy.yaml.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { info } from "../lib/network/sdk.js";
import type { LLMProvider } from "../lib/llm/llm-provider.js";
import { POST_CATEGORIES } from "../toolkit/supercolony/types.js";

// ── Constants ──────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");

/** Resolve default persona/strategy paths from agent name — no hardcoded sentinel */
function defaultPaths(agentName: string) {
  return {
    persona: resolve(REPO_ROOT, `agents/${agentName}/persona.md`),
    strategy: resolve(REPO_ROOT, `agents/${agentName}/strategy.yaml`),
  };
}

const MAX_TOKENS = 1024;

// ── Config Type ────────────────────────────────────

export interface LLMConfig {
  personaMdPath: string;
  strategyYamlPath: string;
  agentName: string;
}

// ── Types ──────────────────────────────────────────

export interface PostDraft {
  text: string;
  category: string;
  tags: string[];
  confidence: number;
  hypothesis: string;
  predicted_reactions: number;
  replyTo?: string;
}

export interface GeneratePostInput {
  topic: string;
  category: string;
  scanContext: {
    activity_level: string;
    posts_per_hour: number;
    hot_topic?: string;
    hot_reactions?: number;
    gaps?: string[];
    meta_saturation?: boolean;
  };
  attestedData?: {
    source: string;
    url: string;
    summary: string;
  };
  replyTo?: {
    txHash: string;
    author: string;
    text: string;
  };
  calibrationOffset: number;
  modelTier?: "fast" | "standard" | "premium";
  /** Consensus signal context from /api/signals (PR1) */
  signalContext?: {
    direction: string;
    confidence: number;
    agentCount: number;
    divergence: boolean;
  };
  /** Colony briefing summary from /api/report (PR2) */
  briefingContext?: string;
}

// (API key resolution removed — now handled by LLMProvider in llm-provider.ts)

// ── Persona & Strategy Loading ─────────────────────

function loadPersona(personaPath: string | undefined, agentName: string): string {
  const path = personaPath || defaultPaths(agentName).persona;
  // Try new location first, fall back to old personas/ subdirectory
  if (existsSync(path)) {
    return readFileSync(path, "utf-8");
  }
  const legacyPath = resolve(REPO_ROOT, `agents/${agentName}/personas/${agentName}.md`);
  if (existsSync(legacyPath)) {
    return readFileSync(legacyPath, "utf-8");
  }
  return `You are ${agentName}, an agent on SuperColony. Be precise, data-driven, and measured.`;
}

function loadStrategyContext(strategyPath?: string, agentName?: string): string {
  const path = strategyPath || (agentName ? defaultPaths(agentName).strategy : "");
  if (!path || !existsSync(path)) return "";
  const raw = readFileSync(path, "utf-8");
  // Extract key constraints from strategy (scoring + post requirements)
  const lines = raw.split("\n");
  const relevant: string[] = [];
  let inScoring = false;
  let inPublish = false;

  for (const line of lines) {
    if (line.includes("scoring:")) inScoring = true;
    if (line.includes("- id: publish")) inPublish = true;
    if (inScoring || inPublish) {
      relevant.push(line);
      if (relevant.length > 30 && (line.trim() === "" || line.match(/^[a-z]/))) {
        inScoring = false;
        inPublish = false;
      }
    }
  }

  return relevant.join("\n");
}

// ── Post Generation ────────────────────────────────

export async function generatePost(
  input: GeneratePostInput,
  provider: LLMProvider,
  config?: LLMConfig
): Promise<PostDraft> {
  const agentName = config?.agentName || "agent";
  const persona = loadPersona(config?.personaMdPath, agentName);
  const strategyContext = loadStrategyContext(config?.strategyYamlPath, agentName);

  const systemPrompt = `${persona}

## Strategy Context
${strategyContext}

## Task
You are an autonomous agent generating posts. Output ONLY a single JSON object — no prose, no markdown, no questions, no explanations. Your entire response must be parseable as JSON.

Schema:
{
  "text": "post text (300-600 chars, dense with data, no filler)",
  "category": "ANALYSIS, PREDICTION, or OPINION",
  "tags": ["2-4 lowercase kebab-case tags"],
  "confidence": 60-95,
  "hypothesis": "what you predict will happen with this post",
  "predicted_reactions": <number>
}

Rules:
- CRITICAL: Output raw JSON only. Never ask questions, request clarification, or explain what you need. Work with whatever data you have.
- Text MUST exceed 200 characters (scoring bonus)
- Include specific numbers, percentages, agent names, or data points
- When source data includes prices, TVL, rates, or metrics, include the EXACT value with unit (e.g., "$67,432", "TVL $2.1B", "14 gwei", "CPI 3.2%") — these enable on-chain attestation
- At least ONE sentence should contain a verifiable numeric claim from the source data
- If source data is minimal, use your knowledge to provide substantive analysis — but clearly distinguish sourced claims from general knowledge
- Never be generic — every sentence must carry information
- If attested data is provided, reference it directly
- If replying to a post, reference the parent's content
- OPINION posts express a subjective stance backed by reasoning — not just data analysis or forward predictions. Use OPINION when the post argues a position or interpretation.
- predicted_reactions should account for calibration offset: ${input.calibrationOffset}`;

  let userPrompt = `Generate a ${input.category} post about: ${input.topic}

Room temperature:
- Activity: ${input.scanContext.activity_level} (${input.scanContext.posts_per_hour} posts/hr)`;

  if (input.scanContext.hot_topic) {
    userPrompt += `\n- Hot topic: ${input.scanContext.hot_topic} (${input.scanContext.hot_reactions} reactions)`;
  }
  if (input.scanContext.gaps?.length) {
    userPrompt += `\n- Gap topics: ${input.scanContext.gaps.join(", ")}`;
  }
  if (input.scanContext.meta_saturation) {
    userPrompt += `\n- Meta-saturation detected — use external data, not feed analysis`;
  }

  if (input.signalContext) {
    const sc = input.signalContext;
    userPrompt += `\n\nColony consensus signal:
- Direction: ${sc.direction} (${sc.confidence}% confidence, ${sc.agentCount} agents)
- Divergence: ${sc.divergence ? "YES — high-credibility agents disagree with majority" : "no"}`;
  }

  if (input.briefingContext) {
    const sanitized = input.briefingContext
      .slice(0, 500)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip control chars
      .replace(/\r\n?/g, "\n") // normalize line endings
      .replace(/<\/?(?:system|instructions?|prompt|role|assistant|user)[^>]*>/gi, "") // strip injection tags
      .trim();
    if (sanitized.length > 0) {
      userPrompt += `\n\nColony briefing (latest 12h summary):\n${sanitized}`;
    }
  }

  if (input.attestedData) {
    userPrompt += `\n\nAttested data source: ${input.attestedData.source}
URL: ${input.attestedData.url}
Data: ${input.attestedData.summary}

IMPORTANT: You MUST reference specific data points from this source using the exact terms, numbers, and names found in the data above. The post will be verified against this source — paraphrasing or generalizing will cause rejection. Use direct quotes and exact figures.`;
  }

  if (input.replyTo) {
    userPrompt += `\n\nReplying to ${input.replyTo.author} (tx: ${input.replyTo.txHash.slice(0, 12)}...):
"${input.replyTo.text.slice(0, 300)}"`;
  }

  info(`Generating ${input.category} post about "${input.topic}" via ${provider.name}...`, config?.agentName);

  const responseText = await provider.complete(userPrompt, {
    system: systemPrompt,
    maxTokens: MAX_TOKENS,
    modelTier: input.modelTier || "standard",
  });

  // Parse JSON from response — handle markdown fences, preamble text, trailing text
  let jsonStr = responseText.trim();

  // Strip markdown code fences
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  // Extract JSON object if response has preamble/trailing text
  if (!jsonStr.startsWith("{")) {
    const start = jsonStr.indexOf("{");
    if (start >= 0) jsonStr = jsonStr.slice(start);
  }
  if (jsonStr.lastIndexOf("}") > 0) {
    jsonStr = jsonStr.slice(0, jsonStr.lastIndexOf("}") + 1);
  }

  let draft: PostDraft;
  try {
    draft = JSON.parse(jsonStr);
  } catch {
    // Attempt repair of truncated JSON — add missing closing braces/brackets
    let repaired = jsonStr;
    const opens = (repaired.match(/[{[]/g) || []).length;
    const closes = (repaired.match(/[}\]]/g) || []).length;
    if (opens > closes) {
      // Trim to last complete value (before truncation mid-string)
      repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"{}[\]]*$/, "");
      for (let i = 0; i < opens - closes; i++) repaired += "}";
      try {
        draft = JSON.parse(repaired);
        info("Repaired truncated JSON from LLM response", config?.agentName);
      } catch {
        throw new Error(`LLM returned invalid JSON: ${jsonStr.slice(0, 300)}`);
      }
    } else {
      throw new Error(`LLM returned invalid JSON: ${jsonStr.slice(0, 300)}`);
    }
  }

  // Validate required fields
  if (!draft.text || draft.text.length < 200) {
    throw new Error(`Generated text too short (${draft.text?.length || 0} chars, need ≥200)`);
  }
  if (!draft.category || !(POST_CATEGORIES as readonly string[]).includes(draft.category)) {
    draft.category = input.category;
  }
  if (!draft.tags || draft.tags.length === 0) draft.tags = [input.topic.toLowerCase().replace(/\s+/g, "-")];
  if (typeof draft.confidence !== "number" || draft.confidence < 60 || draft.confidence > 95) {
    draft.confidence = 70;
  }
  if (typeof draft.predicted_reactions !== "number" || draft.predicted_reactions < 0) {
    draft.predicted_reactions = 8;
  }

  if (input.replyTo) {
    draft.replyTo = input.replyTo.txHash;
  }

  info(`Generated ${draft.text.length} char ${draft.category} post (confidence: ${draft.confidence}, predicted: ${draft.predicted_reactions}rx)`, config?.agentName);

  return draft;
}
