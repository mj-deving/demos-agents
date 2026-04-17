#!/usr/bin/env npx tsx
/**
 * probe-identity-surfaces.ts — maintained live proof for production register()
 * and the official human-link challenge/claim/approve flow.
 *
 * Default behavior is dry-run only. Pass --execute to mutate the current wallet's
 * public profile and run a full link + cleanup round trip against supercolony.ai.
 */

import { getStringArg, hasFlag, loadConnect } from "./_shared.js";

const DEFAULT_REGISTER_NAME = "mj-codex-proof-agent";
const DEFAULT_REGISTER_DESCRIPTION = "Production-host proof agent for omniweb-toolkit identity verification.";
const DEFAULT_REGISTER_SPECIALTIES = ["testing", "proof"];

const args = process.argv.slice(2);

if (hasFlag(args, "--help", "-h")) {
  console.log(`Usage: npx tsx packages/omniweb-toolkit/scripts/probe-identity-surfaces.ts [options]

Options:
  --register-name NAME       Agent name for the live register() proof
  --register-description TXT Agent description for the live register() proof
  --register-specialties CSV Agent specialties for the live register() proof
  --state-dir PATH           Override state directory for runtime guards
  --execute                  Perform the live register + link + unlink proof
  --help, -h                 Show this help

Output: JSON identity proof report
Exit codes: 0 = register and official human-link path are green, 1 = degraded, 2 = invalid args`);
  process.exit(0);
}

for (const flag of [
  "--register-name",
  "--register-description",
  "--register-specialties",
  "--state-dir",
]) {
  const index = args.indexOf(flag);
  if (index >= 0 && !args[index + 1]) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(2);
  }
}

const registerName = getStringArg(args, "--register-name") ?? DEFAULT_REGISTER_NAME;
const registerDescription = getStringArg(args, "--register-description") ?? DEFAULT_REGISTER_DESCRIPTION;
const registerSpecialties = ((getStringArg(args, "--register-specialties") ?? DEFAULT_REGISTER_SPECIALTIES.join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const stateDir = getStringArg(args, "--state-dir") || undefined;
const execute = hasFlag(args, "--execute");

if (registerSpecialties.length === 0) {
  console.error("Error: --register-specialties must contain at least one specialty");
  process.exit(2);
}

const connect = await loadConnect();
const omni = await connect({ stateDir });

if (!execute) {
  console.log(JSON.stringify({
    attempted: false,
    ok: false,
    address: omni.address,
    message: "Dry run only. Re-run with --execute to perform the live register + link + unlink proof.",
  }, null, 2));
  process.exit(0);
}

const agentAddress = omni.address;
const register = await omni.colony.register({
  name: registerName,
  description: registerDescription,
  specialties: registerSpecialties,
});
const challenge = await omni.colony.createAgentLinkChallenge(agentAddress);
const challengeValue = challenge?.ok
  ? challenge.data.challenge ?? challenge.data.nonce ?? challenge.data.challengeId
  : undefined;
const sign = challenge?.ok
  ? await omni.chain.signMessage(challenge.data.message)
  : { ok: false, error: "challenge failed" };
const signature = sign.ok && sign.signature && typeof sign.signature === "object"
  ? ((sign.signature as Record<string, unknown>).data ?? sign.signature)
  : undefined;

const claim = challenge?.ok && typeof challengeValue === "string" && typeof signature === "string"
  ? await omni.colony.claimAgentLink({
      challenge: challengeValue,
      agentAddress,
      signature,
    })
  : null;
const approve = claim?.ok && typeof challengeValue === "string"
  ? await omni.colony.approveAgentLink({
      challenge: challengeValue,
      agentAddress,
      action: "approve",
    })
  : null;
const linked = await omni.colony.getLinkedAgents();
const unlink = approve?.ok
  ? await omni.colony.unlinkAgent(agentAddress)
  : null;
const linkedAfter = await omni.colony.getLinkedAgents();

const ok = !!register?.ok && !!challenge?.ok && !!sign.ok && !!claim?.ok && !!approve?.ok && !!linked?.ok && !!unlink?.ok && !!linkedAfter?.ok;

console.log(JSON.stringify({
  attempted: true,
  ok,
  address: omni.address,
  register: summarizeApiResult(register, "register() succeeded"),
  challenge: challenge?.ok
    ? {
        ok: true,
        challenge: challengeValue ?? null,
        challengeId: challenge.data.challengeId ?? null,
        nonce: challenge.data.nonce ?? null,
        humanAddress: challenge.data.humanAddress ?? null,
        expiresAt: challenge.data.expiresAt ?? null,
      }
    : summarizeApiResult(challenge, "challenge created"),
  sign: sign.ok
    ? { ok: true, hasSignature: typeof signature === "string" && signature.length > 0 }
    : { ok: false, error: sign.error ?? "sign failed" },
  claim: summarizeApiResult(claim, "claimAgentLink() accepted live challenge handle"),
  approve: summarizeApiResult(approve, "approveAgentLink() accepted live challenge handle plus agentAddress"),
  linked: summarizeApiResult(linked, "getLinkedAgents() returned current linked agents"),
  unlink: summarizeApiResult(unlink, "unlinkAgent() cleaned up the live link"),
  linkedAfter: summarizeApiResult(linkedAfter, "getLinkedAgents() returned after cleanup"),
}, null, 2));

process.exit(ok ? 0 : 1);

function summarizeApiResult(result: null | undefined | { ok?: boolean; status?: number; error?: unknown; data?: unknown }, success: string): Record<string, unknown> {
  if (result?.ok) {
    return {
      ok: true,
      status: typeof result.status === "number" ? result.status : null,
      detail: success,
      data: result.data ?? null,
    };
  }

  return {
    ok: false,
    status: typeof result?.status === "number" ? result.status : null,
    detail: typeof result?.error === "string" ? result.error.slice(0, 200) : "unknown error",
  };
}
