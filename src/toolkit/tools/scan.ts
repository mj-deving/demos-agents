/**
 * scan() — fetch and analyze SuperColony feed posts.
 *
 * Uses SDK bridge for local feed fetch. Optional Skill Dojo fallback.
 */

import type { ScanOptions, ScanResult, ScanPost, ScanOpportunity, ToolResult } from "../types.js";
import { ok, err, demosError } from "../types.js";
import { DemosSession } from "../session.js";
import { withToolWrapper, localProvenance } from "./tool-wrapper.js";

/**
 * Scan the SuperColony feed for posts and opportunities.
 */
export async function scan(
  session: DemosSession,
  opts?: ScanOptions,
): Promise<ToolResult<ScanResult>> {
  return withToolWrapper(session, "scan", "NETWORK_ERROR", async (start) => {
    const limit = opts?.limit ?? 50;

    try {
      const posts = await fetchFeed(session, limit, opts?.domain);
      const opportunities = identifyOpportunities(posts);
      return ok<ScanResult>({ posts, opportunities }, localProvenance(start));
    } catch (localErr) {
      if (session.skillDojoFallback) {
        try {
          const posts = await fetchFromSkillDojo(session, limit, opts?.domain);
          return ok<ScanResult>(
            { posts, opportunities: identifyOpportunities(posts) },
            { path: "skill-dojo", latencyMs: Date.now() - start },
          );
        } catch { /* both failed */ }
      }

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
    if (post.reactions.agree + post.reactions.disagree < 5 && post.text.length > 100) {
      opportunities.push({
        type: "reply",
        post,
        reason: "Low engagement post with substantive content",
        score: 0.7,
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

  // Normalize response — feed API returns various shapes
  const data = result.data as Record<string, unknown>;
  const rawPosts = (data?.posts ?? data?.results ?? data?.items ?? data?.data ?? data) as unknown[];
  if (!Array.isArray(rawPosts)) return [];

  return rawPosts.map((p: unknown) => {
    const post = p as Record<string, unknown>;
    const payload = (post.payload ?? post) as Record<string, unknown>;
    return {
      txHash: String(post.txHash ?? ""),
      text: String(payload.text ?? ""),
      category: String(payload.cat ?? payload.category ?? ""),
      author: String(post.sender ?? post.author ?? ""),
      timestamp: Number(post.timestamp ?? 0),
      reactions: {
        agree: Number((post.reactions as Record<string, unknown>)?.agree ?? 0),
        disagree: Number((post.reactions as Record<string, unknown>)?.disagree ?? 0),
      },
      tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    };
  });
}

async function fetchFromSkillDojo(_session: DemosSession, _limit: number, _domain?: string): Promise<ScanPost[]> {
  // TODO(skill-dojo): wire to Skill Dojo API fallback
  throw new Error("Skill Dojo integration pending");
}
