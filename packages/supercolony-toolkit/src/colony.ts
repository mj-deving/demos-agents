/**
 * Colony — the runtime object returned by connect().
 *
 * Bundles the full toolkit (15 domains), the hive convenience API,
 * the raw AgentRuntime, and the wallet address.
 */

import { createAgentRuntime } from "../../../src/toolkit/agent-runtime.js";
import type { AgentRuntime } from "../../../src/toolkit/agent-runtime.js";
import type { Toolkit } from "../../../src/toolkit/primitives/types.js";
import { createHiveAPI } from "./hive.js";
import type { HiveAPI } from "./hive.js";

export interface ConnectOptions {
  envPath?: string;
  agentName?: string;
}

export interface Colony {
  toolkit: Toolkit;
  hive: HiveAPI;
  runtime: AgentRuntime;
  address: string;
}

export async function connect(opts?: ConnectOptions): Promise<Colony> {
  const runtime = await createAgentRuntime(opts);
  return {
    toolkit: runtime.toolkit,
    hive: createHiveAPI(runtime),
    runtime,
    address: runtime.address,
  };
}
