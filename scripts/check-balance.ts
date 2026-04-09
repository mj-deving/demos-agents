#!/usr/bin/env npx tsx
import { createAgentRuntime } from "../src/toolkit/agent-runtime.js";

const runtime = await createAgentRuntime({ enableColonyDb: false });
const balance = await runtime.toolkit.balance.get({ address: runtime.address });
console.log("Address:", runtime.address);
if (balance?.ok) {
  console.log("Balance:", JSON.stringify(balance.data, null, 2));
} else {
  console.log("Balance lookup failed:", balance);
}
process.exit(0);
