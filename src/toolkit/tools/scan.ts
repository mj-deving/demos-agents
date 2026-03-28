/**
 * scan() — fetch and analyze posts from the Demos chain.
 *
 * Chain-first: uses bridge.getHivePosts (paginated getTransactions + HIVE decode).
 * Optional API enrichment: if authenticated, merge reaction counts from feed API.
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
 * Scan the feed for posts and opportunities.
 *
 * Primary: chain scan via bridge.getHivePosts (paginated getTransactions + HIVE decode).
 * Enrichment: if apiAccess === "authenticated", merge reaction counts from feed API.
 */
export async function scan(
  session: DemosSession,
  opts?: ScanOptions,
): Promise<ToolResult<ScanResult>> {
  return withToolWrapper(session, "scan", "NETWORK_ERROR", async (start) => {
    const inputError = validateInput(ScanOptionsSchema, opts);
    if (inputError) return err(inputError, localProvenance(start));

    const limit = opts?.limit ?? 50;
    const bridge = session.getBridge();

    try {
      // Chain-first: get posts from on-chain transactions
      let posts = await bridge.getHivePosts(limit);

      // Domain filtering
      if (opts?.domain) {
        posts = posts.filter(p => p.tags?.includes(opts.domain!));
      }

      // Optional API enrichment: merge reaction counts when authenticated
      if (bridge.apiAccess === "authenticated") {
        try {
          const feedResult = await bridge.apiCall(`/api/feed?limit=${limit}`);
          if (feedResult.ok) {
            const feedPosts = parseFeedPosts(feedResult.data);
            const feedMap = new Map(feedPosts.map(p => [p.txHash, p]));
            posts = posts.map(p => {
              const feedPost = feedMap.get(p.txHash);
              if (feedPost) {
                return {
                  ...p,
                  reactions: feedPost.reactions,
                  reactionsKnown: true,
                };
              }
              return p;
            });
          }
        } catch {
          // API enrichment is optional — chain data is primary
          console.warn("scan: API enrichment failed, using chain-only data");
        }
      }

      const opportunities = identifyOpportunities(posts);
      return ok<ScanResult>({ posts, opportunities }, localProvenance(start));
    } catch (scanErr) {
      console.warn("scan: chain scan failed", { error: (scanErr as Error).message });
      return err(
        demosError("NETWORK_ERROR", `Scan failed: ${(scanErr as Error).message}`, true),
        localProvenance(start),
      );
    }
  });
}

/**
 * Identify engagement opportunities from posts.
 * Skips reaction-dependent heuristics when reactionsKnown is false.
 */
function identifyOpportunities(posts: ScanPost[]): ScanOpportunity[] {
  const opportunities: ScanOpportunity[] = [];
  for (const post of posts) {
    // Reaction-dependent heuristics only when reactions are trusted
    if (post.reactionsKnown) {
      if (post.reactions.agree + post.reactions.disagree < MIN_REACTIONS_FOR_ENGAGEMENT && post.text.length > MIN_TEXT_LENGTH_FOR_SUBSTANCE) {
        opportunities.push({
          type: "reply",
          post,
          reason: "Low engagement post with substantive content",
          score: DEFAULT_OPPORTUNITY_SCORE,
        });
      }

      if (post.reactions.agree + post.reactions.disagree >= MIN_REACTIONS_FOR_ENGAGEMENT * TRENDING_MULTIPLIER && post.text.length > MIN_TEXT_LENGTH_FOR_SUBSTANCE) {
        opportunities.push({
          type: "trending",
          post,
          reason: "High engagement post worth monitoring",
          score: TRENDING_OPPORTUNITY_SCORE,
        });
      }
    } else {
      // Chain-only mode: opportunities based on content only (no reaction data)
      if (post.text.length > MIN_TEXT_LENGTH_FOR_SUBSTANCE) {
        opportunities.push({
          type: "reply",
          post,
          reason: "Substantive content (reaction data unavailable)",
          score: DEFAULT_OPPORTUNITY_SCORE,
        });
      }
    }
  }
  return opportunities;
}
