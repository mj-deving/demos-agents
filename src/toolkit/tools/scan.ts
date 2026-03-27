/**
 * scan() — fetch and analyze SuperColony feed posts.
 *
 * Uses SDK bridge for local feed fetch. Optional Skill Dojo fallback.
 */

import type { ScanOptions, ScanResult, ScanPost, ScanOpportunity, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";
import { validateInput, ScanOptionsSchema } from "../schemas.js";
import { parseFeedPosts } from "./feed-parser.js";

const MIN_REACTIONS_FOR_ENGAGEMENT = 5;
const MIN_TEXT_LENGTH_FOR_SUBSTANCE = 100;
const DEFAULT_OPPORTUNITY_SCORE = 0.7;
const TRENDING_OPPORTUNITY_SCORE = 0.5;
const TRENDING_MULTIPLIER = 4;

/**
 * Scan the SuperColony feed for posts and opportunities.
 */
export async function scan(
  session: DemosSession,
  opts?: ScanOptions,
): Promise<ToolResult<ScanResult>> {
  return withToolWrapper(session, "scan", "NETWORK_ERROR", async (start) => {
    const inputError = validateInput(ScanOptionsSchema, opts);
    if (inputError) return err(inputError, localProvenance(start));

    const limit = opts?.limit ?? 50;

    // fetchFeed throws on API failure — scan catches to attempt Skill Dojo fallback.
    // This is intentional error propagation, not throw-then-catch anti-pattern.
    try {
      const posts = await fetchFeed(session, limit, opts?.domain);
      const opportunities = identifyOpportunities(posts);
      return ok<ScanResult>({ posts, opportunities }, localProvenance(start));
    } catch (localErr) {
      session.logger?.warn?.("scan: feed fetch failed, no fallback", { error: (localErr as Error).message });
      return err(
        demosError("NETWORK_ERROR", `Scan failed: ${(localErr as Error).message}`, true),
        localProvenance(start),
      );
    }
  });
}

function identifyOpportunities(posts: ScanPost[]): ScanOpportunity[] {
  const opportunities: ScanOpportunity[] = [];
  for (const post of posts) {
    if (post.reactions.agree + post.reactions.disagree < MIN_REACTIONS_FOR_ENGAGEMENT && post.text.length > MIN_TEXT_LENGTH_FOR_SUBSTANCE) {
      opportunities.push({
        type: "reply",
        post,
        reason: "Low engagement post with substantive content",
        score: DEFAULT_OPPORTUNITY_SCORE,
      });
    }

    // High-engagement trending posts worth monitoring
    if (post.reactions.agree + post.reactions.disagree >= MIN_REACTIONS_FOR_ENGAGEMENT * TRENDING_MULTIPLIER && post.text.length > MIN_TEXT_LENGTH_FOR_SUBSTANCE) {
      opportunities.push({
        type: "trending",
        post,
        reason: "High engagement post worth monitoring",
        score: TRENDING_OPPORTUNITY_SCORE,
      });
    }
  }
  return opportunities;
}

async function fetchFeed(session: DemosSession, limit: number, domain?: string): Promise<ScanPost[]> {
  const bridge = session.getBridge();
  const path = `/api/feed?limit=${limit}`;
  const result = await bridge.apiCall(path);

  if (!result.ok) {
    throw new Error(`Feed API returned ${result.status}`);
  }

  const posts = parseFeedPosts(result.data);
  return domain ? posts.filter(p => p.tags.includes(domain)) : posts;
}

