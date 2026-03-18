/**
 * Shared keyword-based evaluator factory.
 *
 * Extracts the common algorithm used by domain-specific plugins
 * (DeFi, Infra, etc.) to score content relevance by keyword matching.
 * Each plugin provides its keyword list and domain label.
 */

import type { Evaluator } from "../types.js";

export interface KeywordEvaluatorConfig {
  /** Evaluator name (e.g., "market-relevance") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Keywords to match (lowercase) */
  keywords: readonly string[];
  /** Domain label for reason strings (e.g., "DeFi", "infra") */
  domain: string;
  /** Score per keyword match (default: 15) */
  scorePerMatch?: number;
  /** Minimum score to pass (default: 30) */
  threshold?: number;
}

/**
 * Create a keyword-matching evaluator.
 *
 * Scores text by counting keyword hits: score = min(100, matches * scorePerMatch).
 * Passes if score >= threshold.
 */
export function createKeywordEvaluator(config: KeywordEvaluatorConfig): Evaluator {
  const {
    name,
    description,
    keywords,
    domain,
    scorePerMatch = 15,
    threshold = 30,
  } = config;

  return {
    name,
    description,
    async evaluate(input) {
      const text = input.text.toLowerCase();
      const matches = keywords.filter(k => text.includes(k));
      const score = Math.min(100, matches.length * scorePerMatch);
      return {
        pass: score >= threshold,
        score,
        reason: matches.length > 0
          ? `Contains ${matches.length} ${domain} signals: ${matches.slice(0, 5).join(", ")}`
          : `No ${domain} signals detected`,
      };
    },
  };
}
