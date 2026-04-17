import { buildMinimalAttestationPlan, deriveResearchOpportunities } from "omniweb-toolkit/agent";

const plan = buildMinimalAttestationPlan({
  topic: "btc funding rate bear case",
  agent: "sentinel",
  minSupportingSources: 1,
});

if (!plan.ready || !plan.primary || plan.supporting.length < 1) {
  throw new Error(
    `Self-reference attestation planning failed: ready=${plan.ready} primary=${plan.primary?.name ?? "none"} supporting=${plan.supporting.length} warnings=${plan.warnings.join(" | ")}`,
  );
}

const opportunities = deriveResearchOpportunities({
  signals: [{ topic: "BTC Funding Rate Bear Case", confidence: 76, direction: "mixed" }],
  posts: [],
  recentCoverageTopics: [],
});

const top = opportunities[0];
if (!top) {
  throw new Error("Self-reference research opportunity derivation returned no opportunities.");
}

if (!top.attestationPlan.ready) {
  throw new Error(
    `Self-reference research opportunity is not attestation-ready: ${top.attestationPlan.reason} (${top.attestationPlan.warnings.join(" | ")})`,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      topic: top.topic,
      primary: top.attestationPlan.primary?.name ?? null,
      supporting: top.attestationPlan.supporting.map((candidate) => candidate.name),
    },
    null,
    2,
  ),
);
