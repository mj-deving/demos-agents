#!/usr/bin/env npx tsx
/**
 * Identity CLI — Manage agent Web2 + cross-chain identities on Demos network.
 *
 * Usage:
 *   npx tsx cli/identity.ts proof --agent sentinel           # Generate proof payload
 *   npx tsx cli/identity.ts add-twitter --agent sentinel --url https://x.com/.../status/123
 *   npx tsx cli/identity.ts add-github --agent sentinel --url https://gist.github.com/...
 *   npx tsx cli/identity.ts list --agent sentinel             # List linked identities
 *   npx tsx cli/identity.ts remove-web2 --agent sentinel --context twitter --username handle
 */

import { webcrypto } from "node:crypto";
if (!globalThis.crypto) (globalThis as any).crypto = webcrypto;

import { connectWallet, getRpcUrl, info, warn } from "../src/lib/network/sdk.js";
import {
  createWeb2ProofPayload,
  addTwitterIdentity,
  addGithubIdentity,
  getIdentities,
  removeWeb2Identity,
} from "../src/lib/auth/identity.js";

function parseFlags(): Record<string, string> {
  const flags: Record<string, string> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else if (!args[i].startsWith("--")) {
      flags._command = args[i];
    }
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags();
  const command = flags._command;
  const agentName = flags.agent ?? "sentinel";
  const envPath = flags.env ?? ".env";

  if (!command) {
    console.log(`Usage: npx tsx cli/identity.ts <command> [--agent NAME] [options]

Commands:
  proof           Generate Web2 proof payload (post this publicly)
  add-twitter     Link Twitter (--url <tweet-url>)
  add-github      Link GitHub (--url <gist-url>)
  list            List all linked identities
  remove-web2     Remove Web2 identity (--context twitter --username handle)`);
    process.exit(0);
  }

  const { demos, address } = await connectWallet(envPath, agentName);
  info(`Agent: ${agentName}, Address: ${address.slice(0, 16)}...`, agentName);

  switch (command) {
    case "proof": {
      const payload = await createWeb2ProofPayload(demos);
      console.log("\n📋 Web2 Proof Payload:\n");
      console.log(payload);
      console.log("\nPost this string publicly (tweet or GitHub gist), then run:");
      console.log(`  npx tsx cli/identity.ts add-twitter --agent ${agentName} --url <tweet-url>`);
      console.log(`  npx tsx cli/identity.ts add-github --agent ${agentName} --url <gist-url>`);
      break;
    }

    case "add-twitter": {
      const url = flags.url;
      if (!url) {
        console.error("Error: --url required (URL of tweet containing proof payload)");
        process.exit(1);
      }
      const result = await addTwitterIdentity(demos, url, agentName);
      if (result.ok) {
        console.log("✅ Twitter identity linked successfully");
        console.log(JSON.stringify(result.data, null, 2));
      } else {
        console.error("❌ Failed:", result.error);
      }
      break;
    }

    case "add-github": {
      const url = flags.url;
      if (!url) {
        console.error("Error: --url required (URL of gist containing proof payload)");
        process.exit(1);
      }
      const result = await addGithubIdentity(demos, url, agentName);
      if (result.ok) {
        console.log("✅ GitHub identity linked successfully");
        console.log(JSON.stringify(result.data, null, 2));
      } else {
        console.error("❌ Failed:", result.error);
      }
      break;
    }

    case "list": {
      const result = await getIdentities(getRpcUrl(), address);
      if (result.ok) {
        console.log("\n🔗 Linked Identities:\n");
        console.log(JSON.stringify(result.identities, null, 2));
      } else {
        console.error("❌ Query failed:", result.error);
      }
      break;
    }

    case "remove-web2": {
      const context = flags.context;
      const username = flags.username;
      if (!context || !username) {
        console.error("Error: --context and --username required");
        process.exit(1);
      }
      const result = await removeWeb2Identity(demos, context, username);
      if (result.ok) {
        console.log(`✅ Removed ${context} identity for ${username}`);
      } else {
        console.error("❌ Failed:", result.error);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
