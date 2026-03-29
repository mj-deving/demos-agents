import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { observe } from "./pipeline/observe.js";
import { apiCall } from "./network/sdk.js";
import type { PendingMentionRecord } from "./state.js";

export interface MentionCursor {
  txHash: string;
  timestamp: number;
}

export interface MentionState {
  lastProcessedMention: MentionCursor | null;
}

export interface FetchMentionsOptions {
  limit?: number;
  cursor?: MentionCursor | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeMentions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

function normalizePosts(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  const nestedData = asRecord(root?.data);
  const posts =
    root?.posts ??
    root?.results ??
    root?.items ??
    nestedData?.posts ??
    root?.data ??
    payload ??
    [];
  if (!Array.isArray(posts)) return [];
  return posts.filter((post): post is Record<string, unknown> => typeof post === "object" && post !== null);
}

function normalizeTimestamp(raw: unknown): number {
  const parsed = Number(raw ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function statePath(agent: string): string {
  return resolve(homedir(), `.${agent}`, "mentions-state.json");
}

function freshState(): MentionState {
  return { lastProcessedMention: null };
}

export function loadMentionState(agent: string): MentionState {
  const path = statePath(agent);
  try {
    if (!existsSync(path)) return freshState();
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const cursor = raw?.lastProcessedMention;
    if (
      cursor &&
      typeof cursor.txHash === "string" &&
      Number.isFinite(Number(cursor.timestamp))
    ) {
      return {
        lastProcessedMention: {
          txHash: cursor.txHash,
          timestamp: Math.floor(Number(cursor.timestamp)),
        },
      };
    }
    return freshState();
  } catch {
    return freshState();
  }
}

export function saveMentionState(state: MentionState, agent: string): void {
  const dir = resolve(homedir(), `.${agent}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const path = statePath(agent);
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, path);
}

export async function fetchMentions(
  agentAddress: string,
  token: string,
  options: FetchMentionsOptions = {}
): Promise<PendingMentionRecord[]> {
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : 100;
  const normalizedAddress = agentAddress.toLowerCase();
  const res = await apiCall(`/api/feed?limit=${limit}`, token);
  if (!res.ok) {
    throw new Error(`Feed fetch failed (${res.status}): ${JSON.stringify(res.data)}`);
  }

  const cursor = options.cursor || null;
  const mentions = normalizePosts(res.data)
    .map((post): PendingMentionRecord | null => {
      const payload = asRecord(post.payload);
      const txHash = String(post.txHash || "").trim();
      const author = String(post.author || post.address || "").trim().toLowerCase();
      const timestamp = normalizeTimestamp(post.timestamp);
      const mentionList = normalizeMentions(payload?.mentions);
      if (!txHash || !author || mentionList.length === 0) return null;
      if (!mentionList.includes(normalizedAddress)) return null;

      return {
        txHash,
        author,
        timestamp,
        textPreview: String(payload?.text || post.text || "").slice(0, 200),
        mentions: mentionList,
      };
    })
    .filter((post): post is PendingMentionRecord => Boolean(post))
    .filter((post) => {
      if (!cursor) return true;
      if (post.timestamp > cursor.timestamp) return true;
      return post.timestamp === cursor.timestamp && post.txHash !== cursor.txHash;
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  observe("insight", `Mention poll found ${mentions.length} mention(s) for ${agentAddress.slice(0, 10)}...`, {
    phase: "sense",
    source: "mentions.ts:fetchMentions",
    data: {
      agentAddress,
      limit,
      cursor,
      mentions: mentions.map((mention) => ({
        txHash: mention.txHash,
        author: mention.author,
        timestamp: mention.timestamp,
      })),
    },
  });

  return mentions;
}
