#!/usr/bin/env npx tsx

import { fetchText, getNumberArg, getStringArg, hasFlag } from "./_shared.ts";

interface FeedHit {
  scope: "generic" | "author";
  limit: number;
  category: string | null;
  index: number;
  score: number | null;
  blockNumber: number | null;
}

interface PostReadbackRecord {
  tx: string;
  post: {
    status: number;
    ok: boolean;
    error?: string | null;
    author?: string | null;
    category?: string | null;
    score?: number | null;
    blockNumber?: number | null;
    textSnippet?: string;
  };
  feedHits: FeedHit[];
}

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/check-post-readback.ts --tx <hash> [--tx <hash> ...]

Options:
  --tx <hash>        Post tx hash to inspect. Repeat for multiple posts.
  --limit <n>        Feed page size to probe. Repeatable. Default: 100,250,500
  --author <addr>    Override author for author-scoped feed probes.
  --help, -h         Show help

The script uses the cached auth token from ~/.supercolony-auth.json when available.`);
  process.exit(0);
}

const txs = collectRepeatableArg(args, "--tx");
if (txs.length === 0) {
  console.error("Error: at least one --tx <hash> is required");
  process.exit(2);
}

const limits = collectRepeatableNumberArg(args, "--limit");
const feedLimits = limits.length > 0 ? limits : [100, 250, 500];
const overrideAuthor = getStringArg(args, "--author");
const categories: Array<string | null> = [null, "ANALYSIS"];

const results: PostReadbackRecord[] = [];
for (const tx of txs) {
  results.push(await inspectTx(tx, overrideAuthor, feedLimits, categories));
}

console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));

async function inspectTx(
  tx: string,
  overrideAuthor: string | undefined,
  limits: number[],
  categories: Array<string | null>,
): Promise<PostReadbackRecord> {
  const postRes = await fetchText(`/api/post/${encodeURIComponent(tx)}`, {
    accept: "application/json",
  });
  const parsed = safeJson(postRes.body);
  const post = parsed?.post ?? null;
  const author = overrideAuthor ?? post?.author ?? null;

  const record: PostReadbackRecord = {
    tx,
    post: {
      status: postRes.status,
      ok: postRes.ok,
      error: !postRes.ok ? parsed?.error ?? truncate(postRes.body) : null,
      author,
      category: post?.payload?.cat ?? post?.category ?? null,
      score: post?.score ?? null,
      blockNumber: post?.blockNumber ?? null,
      textSnippet: truncate(post?.payload?.text ?? post?.text ?? ""),
    },
    feedHits: [],
  };

  for (const limit of limits) {
    for (const category of categories) {
      const generic = await fetchFeed(limit, category);
      pushHit(record.feedHits, tx, generic.posts, {
        scope: "generic",
        limit,
        category,
      });

      if (author) {
        const authorScoped = await fetchFeed(limit, category, author);
        pushHit(record.feedHits, tx, authorScoped.posts, {
          scope: "author",
          limit,
          category,
        });
      }
    }
  }

  return record;
}

async function fetchFeed(limit: number, category: string | null, author?: string): Promise<{ posts: any[] }> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (category) qs.set("category", category);
  if (author) qs.set("author", author);
  const res = await fetchText(`/api/feed?${qs.toString()}`, { accept: "application/json" });
  const body = safeJson(res.body);
  return { posts: Array.isArray(body?.posts) ? body.posts : [] };
}

function pushHit(
  hits: FeedHit[],
  tx: string,
  posts: any[],
  base: Pick<FeedHit, "scope" | "limit" | "category">,
): void {
  const index = posts.findIndex((post) => (post?.txHash ?? post?.tx_hash) === tx);
  if (index < 0) return;
  const post = posts[index];
  hits.push({
    ...base,
    index,
    score: post?.score ?? null,
    blockNumber: post?.blockNumber ?? null,
  });
}

function collectRepeatableArg(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag) {
      const value = args[i + 1];
      if (value) values.push(value);
    }
  }
  return values;
}

function collectRepeatableNumberArg(args: string[], flag: string): number[] {
  const values: number[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag) {
      const raw = args[i + 1];
      const parsed = raw ? Number(raw) : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        values.push(parsed);
      }
    }
  }
  return values;
}

function safeJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function truncate(value: string, max = 160): string {
  if (typeof value !== "string") return "";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
