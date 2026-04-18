---
summary: "Venue routing analysis for the systemic indexing-gap escalation — where to send it, fallback options, and whether the bundle is ready."
read_when: ["indexer escalation routing", "upstream venue", "where to file indexing bug", "SuperColony contact"]
---

# Indexer Escalation Routing — April 18, 2026

## Findings

### No public repo exists for the SuperColony indexer

There is no `TheSuperColony/SuperColony` repo. The explore agent incorrectly claimed one existed — verified with `gh repo view`: "Could not resolve to a Repository with the name 'TheSuperColony/SuperColony'."

The **TheSuperColony** GitHub org has exactly 4 public repos, all consumer integration packages:

| Repo | Purpose | Issues |
|---|---|---|
| `supercolony-agent-starter` | Agent template | 0 issues (unused tracker) |
| `supercolony-mcp` | MCP integration | — |
| `langchain-supercolony` | LangChain plugin | — |
| `eliza-plugin-supercolony` | Eliza plugin | — |

None of these is the platform, the API surface, or the indexer.

The **kynesyslabs** GitHub org has 20 public repos. Relevant ones:

| Repo | Purpose | Issues |
|---|---|---|
| `node` | **Demos chain node** | 773+ issues (actively maintained) |
| `sdks` | SDK source code | issues enabled |
| `demostoolkit` | Unknown (empty description) | issues enabled |
| `documentation-mintlify` | Docs site | — |
| `demosdk-api-ref` | API reference | — |

### The bug spans two layers

1. **Chain/node layer**: `getTxByHash()` via `@kynesyslabs/demosdk` (which calls `demosnode.discus.sh` RPC) returns **empty envelopes** for the missing txs. If the chain node can't return the tx data, no downstream indexer can process it.

2. **SuperColony API layer**: The indexed read surface (`supercolony.ai/api/post/:txHash`, feed endpoints) returns 404. This could be a consequence of (1) or an independent indexer gap.

This dual-layer involvement means no single public repo cleanly owns the problem.

### Contact channels found

- **`agents@supercolony.ai`** — from both `/.well-known/agent.json` and `/.well-known/agents.json` A2A manifests (line 15 and line 6 respectively in `docs/research/supercolony-discovery/`)
- **No Discord, Telegram, or community forum** found anywhere in the codebase (grep for `discord.gg`, `discord.com`, `t.me/`, `telegram.me` returned zero matches across the entire repo)

## Venue Ranking

| Rank | Venue | Confidence | Rationale |
|---|---|---|---|
| **1** | **Email: `agents@supercolony.ai`** | **75%** | Official platform contact from A2A manifests. Bypasses the "which repo?" problem. The SuperColony team can internally route to the right component (node, indexer, or API). Best for initial engagement when no public platform repo exists. |
| **2** | **GitHub: `kynesyslabs/node` issues** | **60%** | The raw SDK returning empty envelopes via the Demos RPC suggests the data loss is at the chain/node level. Active tracker (773+ issues). But the SuperColony indexer may run separately from the chain node, so this could miss the right team. |
| **3** | **GitHub: `TheSuperColony/supercolony-agent-starter` issues** | **15%** | Most visible consumer-facing repo in the TheSuperColony org. But completely wrong scope (agent template, not platform infrastructure). Only as a last resort if both above are unresponsive. |

## Recommended Approach

### Step 1: Email `agents@supercolony.ai` (primary)

Send the ready-to-paste issue body from `packages/omniweb-toolkit/references/indexer-escalation-bundle-2026-04-18.md` (lines 90-182). Add a brief cover note:

```
Subject: Systemic indexing gap in blocks 2109138-2109139 — ~94% of hive posts missing

Hi,

We are building an autonomous research agent on SuperColony and have identified
what appears to be a systemic indexing gap affecting blocks 2109138-2109139.

~94% of hive posts in that block window (63 of 67 scanned, spanning 13 authors)
are missing from the indexed read surface. This is not isolated to our publish
path — other authors are also affected.

Full evidence below. Happy to provide the raw JSON probe artifact if useful.

[paste escalation body here]

Thanks,
[name]
```

### Step 2: File on `kynesyslabs/node` (secondary, chain-layer framing)

If the email yields no response within 48-72 hours, file a GitHub issue on `kynesyslabs/node` with a **chain-focused framing** — emphasize the `getTxByHash()` empty-envelope divergence rather than the indexed read surface:

```
Title: getTxByHash returns empty envelope for confirmed hive posts in blocks 2109138-2109139

Body: [reframe the escalation body to focus on:
  - raw SDK getTxByHash returns storage-array for tx 44f24253 (block 2108918)
  - raw SDK getTxByHash returns empty for txs in blocks 2109138-2109139
  - 67 hive posts in that block window, majority unresolvable
  - question: is this a known storage/retrieval inconsistency for that block range?]
```

### Step 3: Monitor and escalate (fallback)

If neither venue responds within a week:
- File on `TheSuperColony/supercolony-agent-starter` as a platform-wide concern (last resort)
- Check if any of the Demos documentation sites have a forum or feedback mechanism

## Is the Escalation Body Ready?

**Yes.** The body in `indexer-escalation-bundle-2026-04-18.md` (lines 90-182) is strong and well-structured:

- Leads with systemic scope (67 posts, 94% missing, 13 authors) — not just "our 3 posts"
- Provides comparison tx that works normally
- Shows three diagnostic layers (raw SDK, post_detail, feed)
- Includes other-author misses to falsify narrow hypothesis
- Uses measured language ("we are not claiming to know the root cause")
- Offers to provide raw JSON artifact

**No additional evidence gathering needed.** The only missing piece was venue routing, which this memo resolves.

## One Enhancement for the Email

The current escalation body doesn't include the `lastIndexedBlock` discrepancy from the earlier verification runs. Consider adding one sentence to section 3:

> During our initial verification polls, the API reported `lastIndexedBlock: 2109138-2109139`, meaning it claimed to have processed those blocks. Despite this, posts IN those blocks still returned `404` on authenticated `post_detail`.

This strengthens the case that the indexer advanced its counter past the blocks without actually processing the hive posts within them.

## Conclusion

**Ready to route now.** The escalation body is complete. The venue is `agents@supercolony.ai` with `kynesyslabs/node` issues as the secondary option. No additional artifact is needed before sending.
