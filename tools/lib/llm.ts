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
import { info } from "./sdk.js";
import type { LLMProvider } from "./llm-provider.js";

// ── Constants ──────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const DEFAULT_PERSONA_PATH = resolve(REPO_ROOT, "agents/sentinel/persona.md");
const DEFAULT_STRATEGY_PATH = resolve(REPO_ROOT, "agents/sentinel/strategy.yaml");

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

function loadPersona(personaPath: string = DEFAULT_PERSONA_PATH, agentName: string = "sentinel"): string {
  // Try new location first, fall back to old personas/ subdirectory
  if (existsSync(personaPath)) {
    return readFileSync(personaPath, "utf-8");
  }
  const legacyPath = resolve(REPO_ROOT, `agents/${agentName}/personas/${agentName}.md`);
  if (existsSync(legacyPath)) {
    return readFileSync(legacyPath, "utf-8");
  }
  return `You are ${agentName}, an agent on SuperColony. Be precise, data-driven, and measured.`;
}

function loadStrategyContext(strategyPath: string = DEFAULT_STRATEGY_PATH): string {
  if (!existsSync(strategyPath)) return "";
  const raw = readFileSync(strategyPath, "utf-8");
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
  const persona = loadPersona(config?.personaMdPath, config?.agentName);
  const strategyContext = loadStrategyContext(config?.strategyYamlPath);

  const systemPrompt = `${persona}

## Strategy Context
${strategyContext}

## Task
Generate a SuperColony post. You must output ONLY valid JSON matching this schema:
{
  "text": "post text (300-600 chars, dense with data, no filler)",
  "category": "ANALYSIS or PREDICTION",
  "tags": ["2-4 lowercase kebab-case tags"],
  "confidence": 60-95,
  "hypothesis": "what you predict will happen with this post",
  "predicted_reactions": <number>
}

Rules:
- Text MUST exceed 200 characters (scoring bonus)
- Include specific numbers, percentages, agent names, or data points
- Never be generic — every sentence must carry information
- If attested data is provided, reference it directly
- If replying to a post, reference the parent's content
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
    userPrompt += `\n\nColony briefing (latest 12h summary):\n${input.briefingContext.slice(0, 500)}`;
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

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = responseText.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let draft: PostDraft;
  try {
    draft = JSON.parse(jsonStr);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${jsonStr.slice(0, 200)}`);
  }

  // Validate required fields
  if (!draft.text || draft.text.length < 200) {
    throw new Error(`Generated text too short (${draft.text?.length || 0} chars, need ≥200)`);
  }
  const VALID_CATEGORIES = ["ANALYSIS", "PREDICTION"];
  if (!draft.category || !VALID_CATEGORIES.includes(draft.category)) {
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
