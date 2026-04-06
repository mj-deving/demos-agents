---
type: plan
status: active
created: 2026-04-06
summary: "Staged production validation: preflight -> dry-run -> shadow -> single live -> endurance. Full outcome tracking."
read_when: ["live test", "production test", "live session", "production plan", "go live", "test plan"]
---

# Live Production Test Plan

> Systematic validation of the V3 loop after the tech debt sweep (12 items resolved, schema v8).
> Goal: establish confidence in each subsystem before sustained autonomous operation.

## Methodology

**Staged blast radius expansion:**

```
Phase 0: PREFLIGHT          Phase 1: DRY-RUN          Phase 2: SHADOW          Phase 3: LIVE          Phase 4: ENDURANCE
Check environment    ->    Run loop, no chain TX  -> Run loop, no publish -> 1 live session    -> 3+ consecutive
Schema, wallet, API        Validates SENSE path      Validates strategy       Validates full        Validates stability
                           Validates DB ingestion    Validates scoring        Validates publish     Validates pruning
                                                                              Validates confirm     Validates spending
```

**Tracking principle:** Every step produces a structured record: `{ phase, step, expected, actual, verdict: PASS|FAIL|WARN, notes }`.

---

## Phase 0: Preflight Checks

Run before any session. These are environment invariants.

```bash
# All commands from project root: /home/mj/projects/demos-agents
```

### 0.1 Schema Version
```bash
npx tsx -e "
import { initColonyCache } from './src/toolkit/colony/schema.js';
const db = initColonyCache(process.env.HOME + '/.sentinel/colony/cache.db');
const v = db.prepare(\"SELECT value FROM _meta WHERE key = 'schema_version'\").pluck().get();
console.log('Schema version:', v);
console.log(v === '8' ? 'PASS' : 'FAIL — expected v8');
db.close();
"
```
**Expected:** Schema version: 8
**If FAIL:** Migration should auto-run on next `initColonyCache` call. Verify no corruption.

### 0.2 DAHR Backward Compatibility
```bash
npx tsx -e "
import { initColonyCache } from './src/toolkit/colony/schema.js';
const db = initColonyCache(process.env.HOME + '/.sentinel/colony/cache.db');
const rows = db.prepare(\"SELECT id, chain_data FROM attestations WHERE chain_method = 'DAHR' AND chain_verified = 1 LIMIT 10\").all();
let good = 0, bad = 0;
for (const r of rows) {
  try {
    const d = JSON.parse(r.chain_data);
    const proof = d.proof || d;
    if (proof.url && (proof.responseHash || proof.hash)) good++; else bad++;
  } catch { bad++; }
}
console.log('DAHR attestations checked:', rows.length, '| good:', good, '| missing fields:', bad);
console.log(bad === 0 ? 'PASS' : 'WARN — some DAHR proofs lack url+hash, may be rejected by new validation');
db.close();
"
```
**Expected:** All existing DAHR attestations have url+hash fields.

### 0.3 Wallet Balance
```bash
npx tsx -e "
import { connectWallet } from './src/lib/network/sdk.js';
const { demos, address } = await connectWallet();
console.log('Wallet:', address);
const balance = await demos.getBalance?.(address) ?? 'unknown';
console.log('Balance:', balance, 'DEM');
console.log(typeof balance === 'number' && balance > 1 ? 'PASS' : 'WARN — check balance manually');
"
```
**Expected:** Wallet connected, balance > 1 DEM.

### 0.4 LLM Provider
```bash
npx tsx -e "
import { resolveLlmProvider } from './src/lib/llm/llm-provider.js';
const provider = resolveLlmProvider();
if (!provider) { console.log('FAIL — no LLM provider configured'); process.exit(1); }
console.log('Provider:', provider.name ?? 'configured');
try {
  const test = await provider.complete([{ role: 'user', content: 'Reply with OK' }]);
  console.log('Response:', test.slice(0, 20));
  console.log('PASS');
} catch (e) { console.log('FAIL —', e.message); }
"
```
**Expected:** LLM responds.

### 0.5 SuperColony API
```bash
npx tsx -e "
const r = await fetch('https://supercolony.ai/api/feed?limit=1');
console.log('Status:', r.status);
console.log(r.ok ? 'PASS' : 'FAIL — API returned ' + r.status);
"
```
**Expected:** 200 OK.

---

## Phase 1: Dry-Run Validation

Run the full V3 loop with `--dry-run` flag. No on-chain transactions.

### 1.1 Command
```bash
npx tsx cli/session-runner.ts --agent sentinel --oversight autonomous --dry-run --pretty --loop-version 3 2>&1 | tee /tmp/sentinel-dryrun-$(date +%Y%m%d-%H%M%S).log
```

### 1.2 Success Criteria

| Step | What to check | Expected | How to verify |
|------|--------------|----------|---------------|
| SENSE: chain fetch | Posts fetched count | > 0 | Log: "Colony DB: ingested N new posts" |
| SENSE: proof ingestion | Proof resolution | resolved >= 0, no crashes | Log: "Proof ingestion:" or "Proof ingestion failed (non-fatal)" |
| SENSE: profile refresh | Profiles updated | >= 0 | Log: "Agent profiles refreshed" |
| SENSE: source fetch | Sources cached | > 0 | Log: "Source fetch: N/M cached" |
| SENSE: SSE feed | Posts ingested | >= 0 (may be 0 if API down) | Log: "SSE sense:" or "SSE sense failed (non-fatal)" |
| ACT: strategy | Actions planned | >= 0 | Log: "Planned actions:" |
| ACT: execution | No chain TX | 0 transactions | No "txHash" in log |
| Duration | Total time | < 5 minutes | Timing in session report |

### 1.3 Post-Run Checks
```bash
# Check colony DB grew
npx tsx -e "
import { initColonyCache } from './src/toolkit/colony/schema.js';
const db = initColonyCache(process.env.HOME + '/.sentinel/colony/cache.db');
const count = db.prepare('SELECT COUNT(*) FROM posts').pluck().get();
const embeds = db.prepare('SELECT COUNT(*) FROM post_embeddings').pluck().get();
console.log('Posts:', count, '| Embeddings:', embeds);
db.close();
"

# Check no spending occurred
cat ~/.sentinel/spending-ledger.json
```

---

## Phase 2: Shadow Run

Run with `--shadow` flag. SENSE + strategy scoring run fully, but no publish/execute.

### 2.1 Command
```bash
npx tsx cli/session-runner.ts --agent sentinel --oversight autonomous --shadow --pretty --loop-version 3 2>&1 | tee /tmp/sentinel-shadow-$(date +%Y%m%d-%H%M%S).log
```

### 2.2 Success Criteria

| Step | What to check | Expected | How to verify |
|------|--------------|----------|---------------|
| Strategy decisions | Actions planned with scores | At least 1 candidate scored | Log: strategy output |
| Quality scoring | Quality data logged | At least 1 quality entry | Log: quality score |
| Dedup | Dedup check ran | No "already published similar" or correctly detected | Log |
| Contradiction scan | Ran without error | Results or empty array | Log |
| API enrichment | Enrichment attempted | At least partial (API may 502) | Log: "API enrichment:" |
| No chain TX | Zero on-chain actions | No txHash | Spending ledger unchanged |

### 2.3 Decision Quality Assessment
After shadow run, manually review:
1. Were the planned actions reasonable given the SENSE data?
2. Would the selected posts have been high-quality?
3. Were any obvious opportunities missed?
4. Were any bad actions correctly filtered by strategy rules?

---

## Phase 3: Single Live Session

First real on-chain session post-sweep. Monitor closely.

### 3.1 Pre-Session Checklist
- [ ] Phase 0 preflight all PASS
- [ ] Phase 1 dry-run all PASS
- [ ] Phase 2 shadow decisions reviewed and reasonable
- [ ] SuperColony API currently responsive (check /api/feed)
- [ ] DEM balance sufficient

### 3.2 Command
```bash
npx tsx cli/session-runner.ts --agent sentinel --oversight autonomous --pretty --loop-version 3 2>&1 | tee /tmp/sentinel-live-$(date +%Y%m%d-%H%M%S).log
```

### 3.3 Outcome Tracking Matrix

| Metric | Value | Notes |
|--------|-------|-------|
| **Session #** | (auto-assigned) | |
| **Duration** | ___s | |
| **SENSE: posts fetched** | ___ | |
| **SENSE: proofs resolved** | ___/___/___  (verified/failed/skipped) | |
| **SENSE: sources cached** | ___/___ | |
| **ACT: actions planned** | ___ | PUBLISH: __, ENGAGE: __, REPLY: __ |
| **ACT: actions executed** | ___ | |
| **PUBLISH: posts created** | ___ | |
| **PUBLISH: attestation type** | DAHR / TLSN / none | |
| **PUBLISH: tx hashes** | ___ | |
| **CONFIRM: posts in feed** | ___/___ | Ratio of confirmed/published |
| **CONFIRM: post scores** | ___ | From SuperColony scoring |
| **SPENDING: DEM spent** | ___ | Tips + gas |
| **ERRORS: count** | ___ | |
| **WARNINGS: count** | ___ | |

### 3.4 Post-Session Verification
```bash
# Check post appeared in feed
npx tsx -e "
import { connectWallet } from './src/lib/network/sdk.js';
import { createSdkBridge } from './src/toolkit/sdk-bridge.js';
const { demos, address } = await connectWallet();
const bridge = createSdkBridge(demos);
const posts = await bridge.getHivePosts(5);
const mine = posts.filter(p => p.author.toLowerCase() === address.toLowerCase());
console.log('My recent posts:', mine.length);
for (const p of mine) {
  console.log(' -', p.txHash.slice(0, 16), '|', p.text?.slice(0, 60));
}
"

# Check SuperColony score (if API available)
# GET /api/scores/agents?limit=5 — look for our address

# Verify spending ledger updated
cat ~/.sentinel/spending-ledger.json
```

---

## Phase 4: Multi-Session Endurance

Run 3 consecutive sessions with full tracking.

### 4.1 Execution
Run 3 sessions with at least 30-minute gaps (to allow feed indexing):

```bash
for i in 1 2 3; do
  echo "=== Session $i of 3 ==="
  npx tsx cli/session-runner.ts --agent sentinel --oversight autonomous --pretty --loop-version 3 2>&1 | tee /tmp/sentinel-endurance-$i-$(date +%Y%m%d-%H%M%S).log
  echo "Waiting 30 minutes before next session..."
  sleep 1800
done
```

### 4.2 Cumulative Tracking

| Session | Posts | Confirms | Avg Score | Errors | DEM Spent | Duration |
|---------|-------|----------|-----------|--------|-----------|----------|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| **Total** | | | | | | |

### 4.3 Colony DB Pruning Test
After endurance sessions, test pruning:
```bash
# Dry-run pruning first
npx tsx -e "
import { initColonyCache } from './src/toolkit/colony/schema.js';
import { prunePosts } from './src/toolkit/colony/posts.js';
const db = initColonyCache(process.env.HOME + '/.sentinel/colony/cache.db');
const result = prunePosts(db, { retentionDays: 30, dryRun: true });
console.log('Would prune:', result.pruned, '| Would preserve:', result.preserved);
db.close();
"
```

### 4.4 Findings Document
After all sessions, produce a findings document:
1. **What worked:** subsystems that performed as expected
2. **What degraded:** subsystems that worked but had issues
3. **What failed:** subsystems that need fixes
4. **Performance data:** timing for each SENSE sub-operation
5. **Strategy quality:** were decisions good? False positives/negatives?
6. **Next hardening targets:** prioritized list for next round

---

## Outcome Tracking Template

For each session, fill in this JSONL entry and append to `~/.sentinel/sessions/test-outcomes.jsonl`:

```json
{
  "session": 60,
  "phase": "live",
  "timestamp": "2026-04-06T...",
  "sense": { "postsFetched": 0, "proofsResolved": 0, "proofsFailed": 0, "proofsSkipped": 0, "sourcesCached": 0, "sourcesFetched": 0 },
  "act": { "planned": 0, "executed": 0, "publishCount": 0, "engageCount": 0, "replyCount": 0 },
  "confirm": { "postsConfirmed": 0, "postsPublished": 0, "avgScore": 0 },
  "spending": { "demSpent": 0 },
  "errors": 0,
  "warnings": 0,
  "duration_s": 0,
  "verdict": "PASS|FAIL|WARN",
  "notes": ""
}
```

---

## Success Criteria Summary

| Phase | Gate | Requirement |
|-------|------|-------------|
| 0 | Preflight | All 5 checks PASS |
| 1 | Dry-run | SENSE completes, 0 chain TX, no crashes |
| 2 | Shadow | Strategy produces reasonable decisions |
| 3 | Live | 1+ post published, confirmed in feed, score >= 40 |
| 4 | Endurance | 3 sessions, no manual intervention, all posts confirmed |

**After Phase 4 completes successfully:** the system is validated for sustained autonomous operation. Findings document becomes the input for the next hardening round.
