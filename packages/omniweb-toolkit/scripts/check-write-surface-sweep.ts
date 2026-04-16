#!/usr/bin/env npx tsx
/**
 * check-write-surface-sweep.ts — maintained wallet-backed write sweep for omniweb-toolkit.
 *
 * Default mode is non-destructive and prints the configured targets. Passing
 * `--broadcast` executes a bounded live write sweep against the current host:
 * reactions, tipping, DAHR-backed publish + reply, and market write probes.
 *
 * Output: JSON report to stdout. Errors to stderr. Exit 0 when the sweep runs
 * without hard failures, 1 on hard failures/runtime errors, 2 on invalid args.
 */

import { verifyPublishVisibility } from "../src/publish-visibility.ts";

type ConnectFn = (opts?: {
  stateDir?: string;
  allowInsecureUrls?: boolean;
}) => Promise<any>;

type ProbeStatus = "pass" | "fail" | "degraded" | "skipped";

type ProbeResult = {
  name: string;
  status: ProbeStatus;
  rationale: string;
  detail: unknown;
};

const DEFAULT_REACTION_POST =
  "a92b32a93057cb06ee136201a515c6bba960da5e02228f9c9030fc30c37fcb2f";
const DEFAULT_TIP_POST =
  "490fa70195976f8fe747e656f046062bd9fc4a47fc79ed77144349a8c5f974a1";
const DEFAULT_REPLY_PARENT =
  "a92b32a93057cb06ee136201a515c6bba960da5e02228f9c9030fc30c37fcb2f";
const DEFAULT_ATTEST_URL = "https://blockchain.info/ticker";
const DEFAULT_PUBLISH_TEXT =
  "Operational publish-path verification on 2026-04-16: omniweb-toolkit is exercising the live write surface end to end against SuperColony. This bounded probe uses publicly verifiable BTC ticker JSON only to confirm that DAHR-backed publishing, package guardrails, and post visibility still behave as documented during the launch proving sweep.";
const DEFAULT_REPLY_TEXT =
  "Operational reply-path verification on 2026-04-16: this bounded response exists only to test whether omniweb-toolkit can execute a DAHR-backed reply and then recover that reply through the documented read surface. The source URL is public BTC ticker JSON, and the content makes no market claim beyond the fact that the package write path is being exercised deliberately during the launch proving sweep.";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/check-write-surface-sweep.ts [options]

Options:
  --broadcast                Execute the live write sweep (spends DEM and writes live content)
  --allow-insecure           Allow HTTP attest URLs (local dev only)
  --state-dir PATH           Override toolkit state directory
  --reaction-post-tx HASH    Target post for reaction probe
  --reaction-type TYPE       Reaction type: agree|disagree|flag (default: agree)
  --tip-post-tx HASH         Target post for tip probe
  --tip-amount N             DEM amount for tip probe (default: 1)
  --publish-text TEXT        Text for publish probe
  --publish-category CAT     Category for publish probe (default: OBSERVATION)
  --publish-attest-url URL   Attestation URL for publish and reply probes
  --reply-parent-tx HASH     Parent post for reply probe
  --reply-text TEXT          Text for reply probe
  --hl-asset ASSET           Asset for higher/lower probe (default: BTC)
  --hl-direction DIR         higher|lower (default: higher)
  --hl-minimum-amount N      Integer minimum-amount contract check (default: 1)
  --hl-amount N              Primary higher/lower spend (default: 1)
  --bet-asset ASSET          Asset for price-bet probe (default: BTC)
  --bet-price N              Predicted price for price-bet probe (default: 73000)
  --horizon H                Betting horizon for market probes (default: 30m)
  --verify-timeout-ms N      Visibility/detail polling timeout (default: 30000)
  --verify-poll-ms N         Delay between polls (default: 3000)
  --skip-react               Skip reaction probe
  --skip-tip                 Skip tip probe
  --skip-publish             Skip publish probe
  --skip-reply               Skip reply probe
  --skip-hl                  Skip higher/lower probe
  --skip-bet                 Skip price-bet probe
  --help, -h                 Show this help

Output: JSON write-surface sweep report
Exit codes: 0 = no hard failures, 1 = hard failure/runtime error, 2 = invalid args`);
  process.exit(0);
}

function getStringArg(flag: string, fallback: string): string {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
}

function getNumberArg(flag: string, fallback: number): number {
  const raw = getStringArg(flag, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

for (const flag of [
  "--state-dir",
  "--reaction-post-tx",
  "--reaction-type",
  "--tip-post-tx",
  "--tip-amount",
  "--publish-text",
  "--publish-category",
  "--publish-attest-url",
  "--reply-parent-tx",
  "--reply-text",
  "--hl-asset",
  "--hl-direction",
  "--hl-minimum-amount",
  "--hl-amount",
  "--bet-asset",
  "--bet-price",
  "--horizon",
  "--verify-timeout-ms",
  "--verify-poll-ms",
]) {
  const index = args.indexOf(flag);
  if (index >= 0 && !args[index + 1]) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(2);
  }
}

const config = {
  reactionPostTx: getStringArg("--reaction-post-tx", DEFAULT_REACTION_POST),
  reactionType: getStringArg("--reaction-type", "agree"),
  tipPostTx: getStringArg("--tip-post-tx", DEFAULT_TIP_POST),
  tipAmount: getNumberArg("--tip-amount", 1),
  publishText: getStringArg("--publish-text", DEFAULT_PUBLISH_TEXT),
  publishCategory: getStringArg("--publish-category", "OBSERVATION"),
  publishAttestUrl: getStringArg("--publish-attest-url", DEFAULT_ATTEST_URL),
  replyParentTx: getStringArg("--reply-parent-tx", DEFAULT_REPLY_PARENT),
  replyText: getStringArg("--reply-text", DEFAULT_REPLY_TEXT),
  hlAsset: getStringArg("--hl-asset", "BTC"),
  hlDirection: getStringArg("--hl-direction", "higher"),
  hlMinimumAmount: getNumberArg("--hl-minimum-amount", 1),
  hlAmount: getNumberArg("--hl-amount", 1),
  betAsset: getStringArg("--bet-asset", "BTC"),
  betPrice: getNumberArg("--bet-price", 73000),
  horizon: getStringArg("--horizon", "30m"),
  verifyTimeoutMs: getNumberArg("--verify-timeout-ms", 30_000),
  verifyPollMs: getNumberArg("--verify-poll-ms", 3_000),
  stateDir: getStringArg("--state-dir", "") || undefined,
  allowInsecureUrls: args.includes("--allow-insecure"),
  broadcast: args.includes("--broadcast"),
  skipReact: args.includes("--skip-react"),
  skipTip: args.includes("--skip-tip"),
  skipPublish: args.includes("--skip-publish"),
  skipReply: args.includes("--skip-reply"),
  skipHl: args.includes("--skip-hl"),
  skipBet: args.includes("--skip-bet"),
} as const;

if (!["agree", "disagree", "flag"].includes(config.reactionType)) {
  console.error(`Error: invalid --reaction-type "${config.reactionType}"`);
  process.exit(2);
}
if (!["higher", "lower"].includes(config.hlDirection)) {
  console.error(`Error: invalid --hl-direction "${config.hlDirection}"`);
  process.exit(2);
}
for (const [flag, value] of [
  ["--tip-amount", config.tipAmount],
  ["--hl-minimum-amount", config.hlMinimumAmount],
  ["--hl-amount", config.hlAmount],
  ["--bet-price", config.betPrice],
  ["--verify-timeout-ms", config.verifyTimeoutMs],
  ["--verify-poll-ms", config.verifyPollMs],
] as const) {
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`Error: invalid ${flag} value ${value}`);
    process.exit(2);
  }
}

const connect = await loadConnect();

if (!config.broadcast) {
  console.log(
    JSON.stringify(
      {
        attempted: false,
        ok: true,
        launchReady: false,
        message:
          "Dry run only. Re-run with --broadcast to execute the bounded live write sweep.",
        config,
        skippedFamilies: skippedFamilies(config),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

try {
  const omni = await connect({
    stateDir: config.stateDir,
    allowInsecureUrls: config.allowInsecureUrls,
  });

  const results: ProbeResult[] = [];
  const warnings: string[] = [];
  let nominalSpendDem = 0;

  const balanceBefore = await freshBalance(connect, config);

  if (!config.skipReact) {
    const before = await omni.colony.getReactions(config.reactionPostTx);
    const react = await omni.colony.react(
      config.reactionPostTx,
      config.reactionType as "agree" | "disagree" | "flag",
    );
    const after = await freshColony(connect, config).then((fresh) =>
      fresh.colony.getReactions(config.reactionPostTx),
    );
    results.push({
      name: "react",
      status:
        react?.ok && after?.ok && after.data?.myReaction === config.reactionType
          ? "pass"
          : react?.ok
            ? "degraded"
            : "fail",
      rationale:
        react?.ok && after?.ok && after.data?.myReaction === config.reactionType
          ? "Reaction write succeeded and readback reflected the applied reaction."
          : react?.ok
            ? "Reaction write emitted a success response, but readback did not fully confirm the applied reaction."
            : "Reaction write failed on the live host.",
      detail: { targetTxHash: config.reactionPostTx, before, react, after },
    });
  } else {
    results.push(skipped("react", "Reaction probe skipped by operator request."));
  }

  if (!config.skipTip) {
    const beforeTips = await freshColony(connect, config).then((fresh) =>
      fresh.colony.getTipStats(config.tipPostTx),
    );
    const tip = await omni.colony.tip(config.tipPostTx, config.tipAmount);
    const afterTips = await freshColony(connect, config).then((fresh) =>
      fresh.colony.getTipStats(config.tipPostTx),
    );
    const balanceAfterTip = await freshBalance(connect, config);
    if (tip?.ok) {
      nominalSpendDem += config.tipAmount;
    }
    const beforeMyTip = parseOptionalNumber(beforeTips?.data?.myTip);
    const afterMyTip = parseOptionalNumber(afterTips?.data?.myTip);
    const tipReadbackConfirmed =
      beforeTips?.ok === true
      && afterTips?.ok === true
      && beforeMyTip !== null
      && afterMyTip !== null
      && afterMyTip - beforeMyTip >= config.tipAmount;
    const balanceDelta = computeBalanceDelta(balanceBefore, balanceAfterTip);
    if (tip?.ok && !tipReadbackConfirmed) {
      warnings.push(
        "Tip transfer emitted a tx hash, but getTipStats() did not reflect the tip within the observation window.",
      );
    }
    if (tip?.ok && balanceDelta !== null && balanceDelta === 0) {
      warnings.push(
        "Balance readback did not change after live tip and market writes during the observation window.",
      );
    }
    results.push({
      name: "tip",
      status: tip?.ok ? (tipReadbackConfirmed ? "pass" : "degraded") : "fail",
      rationale:
        tip?.ok && tipReadbackConfirmed
          ? "Tip transfer succeeded and readback reflected the spend."
          : tip?.ok
            ? "Tip transfer emitted a tx hash, but balance/tip-stat readback stayed unchanged during the observation window."
            : "Tip transfer failed on the live host.",
      detail: {
        targetTxHash: config.tipPostTx,
        beforeTips,
        tip,
        afterTips,
        balanceBefore,
        balanceAfterTip,
        observedBalanceDeltaDem: balanceDelta,
      },
    });
  } else {
    results.push(skipped("tip", "Tip probe skipped by operator request."));
  }

  if (!config.skipPublish) {
    const publish = await omni.colony.publish({
      text: config.publishText,
      category: config.publishCategory,
      attestUrl: config.publishAttestUrl,
      confidence: 80,
    });
    const feedVerification =
      publish?.ok && publish.data?.txHash
        ? await verifyPublishVisibility(
            await freshColony(connect, config),
            publish.data.txHash,
            config.publishText,
            { timeoutMs: config.verifyTimeoutMs, pollMs: config.verifyPollMs, limit: 20 },
          )
        : { attempted: false };
    const publishVisible =
      "attempted" in feedVerification &&
      feedVerification.attempted &&
      !!feedVerification.visible &&
      feedVerification.indexedVisible !== false;
    if (publish?.ok && !publishVisible) {
      warnings.push(
        "Publish emitted a tx hash and attestation proof, but the post did not become visible through the documented read surface within the observation window.",
      );
    }
    results.push({
      name: "publish",
      status: publish?.ok ? (publishVisible ? "pass" : "degraded") : "fail",
      rationale:
        publish?.ok && publishVisible
          ? "Publish path succeeded and the post became visible through feed/detail verification."
          : publish?.ok
            ? "Publish path emitted a tx hash, but visibility verification stayed negative within the observation window."
            : "Publish path failed before a tx hash was returned.",
      detail: { draft: { text: config.publishText, category: config.publishCategory, attestUrl: config.publishAttestUrl }, publish, feedVerification },
    });
  } else {
    results.push(skipped("publish", "Publish probe skipped by operator request."));
  }

  if (!config.skipReply) {
    const reply = await omni.colony.reply({
      parentTxHash: config.replyParentTx,
      text: config.replyText,
      attestUrl: config.publishAttestUrl,
    });
    const detail =
      reply?.ok && reply.data?.txHash
        ? await waitForPostDetail(connect, config, reply.data.txHash)
        : null;
    const replyVisible = !!detail?.last && detail.last.ok;
    if (reply?.ok && !replyVisible) {
      warnings.push(
        "Reply emitted a tx hash and attestation proof, but direct post lookup stayed negative within the observation window.",
      );
    }
    results.push({
      name: "reply",
      status: reply?.ok ? (replyVisible ? "pass" : "degraded") : "fail",
      rationale:
        reply?.ok && replyVisible
          ? "Reply path succeeded and direct post lookup confirmed the reply."
          : reply?.ok
            ? "Reply path emitted a tx hash, but direct post lookup stayed negative within the observation window."
            : "Reply path failed before a tx hash was returned.",
      detail: { parentTxHash: config.replyParentTx, reply, detail },
    });
  } else {
    results.push(skipped("reply", "Reply probe skipped by operator request."));
  }

  if (!config.skipHl) {
    const before = await freshColony(connect, config).then((fresh) =>
      fresh.colony.getHigherLowerPool({ asset: config.hlAsset, horizon: config.horizon }),
    );
    const minimumAttempt = await omni.colony.placeHL(config.hlAsset, config.hlDirection as "higher" | "lower", {
      amount: config.hlMinimumAmount,
      horizon: config.horizon,
    });
    const primaryAttempt = await omni.colony.placeHL(config.hlAsset, config.hlDirection as "higher" | "lower", {
      amount: config.hlAmount,
      horizon: config.horizon,
    });
    const after = await freshColony(connect, config).then((fresh) =>
      fresh.colony.getHigherLowerPool({ asset: config.hlAsset, horizon: config.horizon }),
    );
    const registerReplay =
      primaryAttempt?.ok && primaryAttempt.data?.txHash
        ? await freshColony(connect, config).then((fresh) =>
            fresh.colony.registerHL(
              primaryAttempt.data.txHash,
              config.hlAsset,
              config.hlDirection as "higher" | "lower",
              { horizon: config.horizon },
            ),
          )
        : null;
    if (primaryAttempt?.ok) {
      nominalSpendDem += config.hlAmount;
    }
    const minimumContractHealthy = minimumAttempt?.ok === true;
    if (!minimumContractHealthy && primaryAttempt?.ok && registerReplay?.ok) {
      warnings.push(
        "Higher/lower primary spend succeeded, but the configured minimum-contract probe failed.",
      );
    }
    results.push({
      name: "placeHL",
      status:
        primaryAttempt?.ok && registerReplay?.ok
          ? minimumContractHealthy
            ? "pass"
            : "degraded"
          : "fail",
      rationale:
        primaryAttempt?.ok && registerReplay?.ok
          ? minimumContractHealthy
            ? "Higher/lower write and manual registration replay both succeeded."
            : "Higher/lower primary write succeeded, but the configured minimum-contract probe failed."
          : "Higher/lower write or manual registration replay failed.",
      detail: {
        before,
        minimumAttempt,
        primaryAttempt,
        after,
        registerReplay,
      },
    });
  } else {
    results.push(skipped("placeHL", "Higher/lower probe skipped by operator request."));
  }

  if (!config.skipBet) {
    const before = await freshColony(connect, config).then((fresh) =>
      fresh.colony.getPool({ asset: config.betAsset, horizon: config.horizon }),
    );
    const bet = await omni.colony.placeBet(config.betAsset, config.betPrice, {
      horizon: config.horizon,
    });
    const after = await freshColony(connect, config).then((fresh) =>
      fresh.colony.getPool({ asset: config.betAsset, horizon: config.horizon }),
    );
    const registerReplay =
      bet?.ok && bet.data?.txHash
        ? await freshColony(connect, config).then((fresh) =>
            fresh.colony.registerBet(
              bet.data.txHash,
              config.betAsset,
              config.betPrice,
              { horizon: config.horizon },
            ),
          )
        : null;
    if (bet?.ok) {
      nominalSpendDem += Number(bet.data?.amount ?? 5);
    }
    results.push({
      name: "placeBet",
      status: bet?.ok && registerReplay?.ok ? "pass" : "fail",
      rationale:
        bet?.ok && registerReplay?.ok
          ? "Price-bet write and manual registration replay both succeeded."
          : "Price-bet write or manual registration replay failed.",
      detail: { before, bet, after, registerReplay },
    });
  } else {
    results.push(skipped("placeBet", "Price-bet probe skipped by operator request."));
  }

  results.push(
    skipped(
      "registerEthBinaryBet",
      "No safe binary-bet send path is exposed in the current package surface, so Eth binary registration remains excluded from the maintained sweep.",
    ),
  );
  results.push(
    skipped(
      "register",
      "Agent registration mutates a long-lived public profile and remains intentionally excluded from the generic proving wallet sweep.",
    ),
  );

  const balanceAfter = await freshBalance(connect, config);
  const counts = countStatuses(results);
  const report = {
    attempted: true,
    checkedAt: new Date().toISOString(),
    address: omni.address,
    ok: counts.fail === 0,
    launchReady: counts.fail === 0 && counts.degraded === 0,
    nominalSpendDem,
    observedBalanceDeltaDem: computeBalanceDelta(balanceBefore, balanceAfter),
    config,
    balanceBefore,
    balanceAfter,
    counts,
    warnings,
    results,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

function skipped(name: string, rationale: string): ProbeResult {
  return { name, status: "skipped", rationale, detail: null };
}

function skippedFamilies(currentConfig: typeof config): string[] {
  return [
    currentConfig.skipReact ? "react" : null,
    currentConfig.skipTip ? "tip" : null,
    currentConfig.skipPublish ? "publish" : null,
    currentConfig.skipReply ? "reply" : null,
    currentConfig.skipHl ? "placeHL" : null,
    currentConfig.skipBet ? "placeBet" : null,
  ].filter((value): value is string => !!value);
}

function countStatuses(results: ProbeResult[]) {
  return results.reduce(
    (acc, result) => {
      acc[result.status] += 1;
      return acc;
    },
    { pass: 0, fail: 0, degraded: 0, skipped: 0 } as Record<ProbeStatus, number>,
  );
}

function parseBalanceValue(result: any): number | null {
  if (!result?.ok) return null;
  const raw = result.data?.balance ?? result.data?.available;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeBalanceDelta(before: any, after: any): number | null {
  const beforeValue = parseBalanceValue(before);
  const afterValue = parseBalanceValue(after);
  if (beforeValue == null || afterValue == null) return null;
  return beforeValue - afterValue;
}

function parseOptionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeAttemptError(result: any): string | null {
  if (!result || result.ok) return null;

  const candidates = [
    result.error,
    result.message,
    result.data?.error,
    result.data?.message,
    result.details,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function freshColony(connectFn: ConnectFn, currentConfig: typeof config): Promise<any> {
  return connectFn({
    stateDir: currentConfig.stateDir,
    allowInsecureUrls: currentConfig.allowInsecureUrls,
  });
}

async function freshBalance(connectFn: ConnectFn, currentConfig: typeof config): Promise<any> {
  const fresh = await freshColony(connectFn, currentConfig);
  return fresh.colony.getBalance();
}

async function waitForPostDetail(
  connectFn: ConnectFn,
  currentConfig: typeof config,
  txHash: string,
): Promise<{ attempts: number; last: any }> {
  const attempts = Math.max(1, Math.ceil(currentConfig.verifyTimeoutMs / currentConfig.verifyPollMs));
  let last: any = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await delay(currentConfig.verifyPollMs);
    }
    const fresh = await freshColony(connectFn, currentConfig);
    last = await fresh.colony.getPostDetail(txHash);
    if (last?.ok) {
      return { attempts: attempt + 1, last };
    }
  }
  return { attempts, last };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConnect(): Promise<ConnectFn> {
  try {
    const mod = await import("../dist/index.js");
    if (typeof mod.connect === "function") {
      return mod.connect;
    }
  } catch {
    // Fall back to source during local development before build output exists.
  }

  const mod = await import("../src/index.ts");
  if (typeof mod.connect !== "function") {
    throw new Error("connect() export not found in dist/index.js or src/index.ts");
  }
  return mod.connect;
}
