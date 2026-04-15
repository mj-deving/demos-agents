/**
 * Storage API — on-chain programmable databases via Demos StorageProgram.
 *
 * Wraps the existing storage-client.ts which uses @kynesyslabs/demosdk/storage.
 * StorageProgram is a Demos chain primitive (NOT SuperColony/HIVE).
 *
 * Status: Testnet write transactions validate and relay on the shared node as
 * of April 2026, but shared-node readback still drifts: StorageProgram.getByAddress()
 * and getValue() can return "Unknown message" after successful writes.
 */

export interface StorageAPI {
  /** Read an agent's storage program data. Returns null if not found. */
  read(storageAddress: string): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }>;
  /** List all storage programs owned by this agent. */
  list(): Promise<{ ok: boolean; data?: unknown[]; error?: string }>;
  /** Search storage programs by name. */
  search(query: string, limit?: number): Promise<{ ok: boolean; data?: unknown[]; error?: string }>;
  /** Check if a field exists in a storage program. */
  hasField(storageAddress: string, field: string): Promise<boolean>;
  /** Read a specific field value. */
  readField<T = unknown>(storageAddress: string, field: string): Promise<T | null>;
}

export function createStorageAPI(rpcUrl: string, agentAddress: string, agentName = "agent"): StorageAPI {
  let clientPromise: Promise<ReturnType<typeof import("../../../src/toolkit/network/storage-client.js")["createStorageClient"]>> | null = null;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = import("../../../src/toolkit/network/storage-client.js").then(mod =>
        mod.createStorageClient({ rpcUrl, agentName, agentAddress })
      );
    }
    return clientPromise;
  }

  return {
    async read(storageAddress) {
      try {
        const client = await getClient();
        const result = await client.readState(storageAddress);
        if (!result) return { ok: false, error: "Storage program not found" };
        return { ok: true, data: result.data };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async list() {
      try {
        const client = await getClient();
        const programs = await client.listPrograms();
        return { ok: true, data: programs };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async search(query, limit = 10) {
      try {
        const client = await getClient();
        const programs = await client.searchPrograms(query, limit);
        return { ok: true, data: programs };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },

    async hasField(storageAddress, field) {
      try {
        const client = await getClient();
        return client.hasField(storageAddress, field);
      } catch {
        return false;
      }
    },

    async readField<T = unknown>(storageAddress: string, field: string): Promise<T | null> {
      try {
        const client = await getClient();
        return client.readField<T>(storageAddress, field);
      } catch {
        return null;
      }
    },
  };
}
