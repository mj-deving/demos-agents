/**
 * LLM text generation for Sentinel autonomous publishing.
 *
 * Uses Anthropic Claude Sonnet for post text generation.
 * Loads persona from agents/sentinel/personas/sentinel.md.
 * Loads strategy constraints from agents/sentinel/strategy.yaml.
 *
 * API key resolution: ANTHROPIC_API_KEY from .env file or process.env.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { info } from "./sdk.js";

// ── Constants ──────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const PERSONA_PATH = resolve(REPO_ROOT, "agents/sentinel/personas/sentinel.md");
const STRATEGY_PATH = resolve(REPO_ROOT, "agents/sentinel/strategy.yaml");

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;

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
}

// ── API Key Resolution ─────────────────────────────

function loadApiKey(envPath?: string): string {
  // Check process.env first
  if (process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }

  // Try loading from .env file
  if (envPath) {
    const resolved = resolve(envPath.replace(/^~/, homedir()));
    if (existsSync(resolved)) {
      const content = readFileSync(resolved, "utf-8");
      const match = content.match(/ANTHROPIC_API_KEY="?([^"\n]+)"?/);
      if (match) return match[1];
    }
  }

  throw new Error(
    "ANTHROPIC_API_KEY not found. Set it in your environment or add to .env file."
  );
}

// ── Persona & Strategy Loading ─────────────────────

function loadPersona(): string {
  if (!existsSync(PERSONA_PATH)) {
    return "You are Sentinel, a verification agent on SuperColony. Be precise, data-driven, and measured.";
  }
  return readFileSync(PERSONA_PATH, "utf-8");
}

function loadStrategyContext(): string {
  if (!existsSync(STRATEGY_PATH)) return "";
  const raw = readFileSync(STRATEGY_PATH, "utf-8");
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
  envPath?: string
): Promise<PostDraft> {
  const apiKey = loadApiKey(envPath);
  const client = new Anthropic({ apiKey });
  const persona = loadPersona();
  const strategyContext = loadStrategyContext();

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

  if (input.attestedData) {
    userPrompt += `\n\nAttested data source: ${input.attestedData.source}
URL: ${input.attestedData.url}
Data: ${input.attestedData.summary}`;
  }

  if (input.replyTo) {
    userPrompt += `\n\nReplying to ${input.replyTo.author} (tx: ${input.replyTo.txHash.slice(0, 12)}...):
"${input.replyTo.text.slice(0, 300)}"`;
  }

  info(`Generating ${input.category} post about "${input.topic}" via ${MODEL}...`);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  // Extract text content
  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("LLM returned non-text response");
  }

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = content.text.trim();
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

  info(`Generated ${draft.text.length} char ${draft.category} post (confidence: ${draft.confidence}, predicted: ${draft.predicted_reactions}rx)`);

  return draft;
}
