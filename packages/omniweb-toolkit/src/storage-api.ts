/**
 * Storage API — on-chain programmable databases via Demos StorageProgram.
 *
 * Wraps the existing storage-client.ts which uses @kynesyslabs/demosdk/storage.
 * StorageProgram is a Demos chain primitive (NOT SuperColony/HIVE).
 *
 * Status: Testnet write transactions validate and relay on the shared node as
 * of April 2026. When the shared-node StorageProgram read RPC drifts and returns
 * "Unknown message", this package falls back to recent confirmed storageProgram
 * transactions to reconstruct state for read/list/search helpers.
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

interface StorageProgramReader {
  getTransactions?(start?: number | "latest", limit?: number): Promise<Array<{
    id?: number;
    hash?: string;
    blockNumber?: number;
    status?: string;
    from?: string;
    to?: string;
    type?: string;
    content?: string | Record<string, unknown>;
    timestamp?: number | string;
  }>>;
}

interface FallbackProgramState {
  storageAddress: string;
  programName: string;
  data: Record<string, unknown>;
  owner: string;
  updatedAt: number;
}

export function createStorageAPI(
  rpcUrl: string,
  agentAddress: string,
  agentName = "agent",
  reader?: StorageProgramReader,
): StorageAPI {
  let clientPromise: Promise<ReturnType<typeof import("../../../src/toolkit/network/storage-client.js")["createStorageClient"]>> | null = null;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = import("../../../src/toolkit/network/storage-client.js").then(mod =>
        mod.createStorageClient({ rpcUrl, agentName, agentAddress })
      );
    }
    return clientPromise;
  }

  async function loadRecentStorageProgramStates(limit = 300): Promise<Map<string, FallbackProgramState>> {
    if (!reader?.getTransactions) return new Map();

    const collected: Array<{
      id?: number;
      hash?: string;
      blockNumber?: number;
      status?: string;
      from?: string;
      to?: string;
      type?: string;
      content?: string | Record<string, unknown>;
      timestamp?: number | string;
    }> = [];
    let start: number | "latest" = "latest";

    for (let page = 0; page < 5 && collected.length < limit; page++) {
      const txs = await reader.getTransactions(start, 100);
      if (!Array.isArray(txs) || txs.length === 0) break;
      collected.push(...txs.filter((tx) => tx?.type === "storageProgram"));

      const lastTx = txs[txs.length - 1];
      if (typeof lastTx?.id !== "number" || lastTx.id <= 1) break;
      const nextStart = Math.max(1, lastTx.id - 100);
      if (nextStart === start) break;
      start = nextStart;
    }

    return reconstructPrograms(collected.slice(0, limit));
  }

  function reconstructPrograms(
    txs: Array<{
      blockNumber?: number;
      status?: string;
      from?: string;
      to?: string;
      content?: string | Record<string, unknown>;
      timestamp?: number | string;
    }>,
  ): Map<string, FallbackProgramState> {
    const sorted = [...txs].sort((left, right) => {
      const leftBlock = Number(left.blockNumber ?? 0);
      const rightBlock = Number(right.blockNumber ?? 0);
      if (leftBlock !== rightBlock) return leftBlock - rightBlock;
      return Number(left.timestamp ?? 0) - Number(right.timestamp ?? 0);
    });

    const states = new Map<string, FallbackProgramState>();

    for (const tx of sorted) {
      if (tx.status !== "confirmed") continue;
      const parsed = parseStorageProgramOperation(tx);
      if (!parsed) continue;

      const existing = states.get(parsed.storageAddress) ?? {
        storageAddress: parsed.storageAddress,
        programName: parsed.programName ?? parsed.storageAddress,
        data: {},
        owner: parsed.owner,
        updatedAt: parsed.timestamp,
      };

      existing.owner = parsed.owner || existing.owner;
      existing.updatedAt = parsed.timestamp;
      if (parsed.programName) existing.programName = parsed.programName;

      switch (parsed.operation) {
        case "CREATE_STORAGE_PROGRAM":
          existing.data = isRecord(parsed.data) ? structuredClone(parsed.data) : {};
          break;
        case "WRITE_STORAGE":
          if (isRecord(parsed.data)) {
            existing.data = structuredClone(parsed.data);
          }
          break;
        case "SET_FIELD":
          if (parsed.field) existing.data[parsed.field] = parsed.value;
          break;
        case "DELETE_FIELD":
          if (parsed.field) delete existing.data[parsed.field];
          break;
        case "APPEND_ITEM":
          if (parsed.field) {
            const current = Array.isArray(existing.data[parsed.field])
              ? [...(existing.data[parsed.field] as unknown[])]
              : [];
            current.push(parsed.value);
            existing.data[parsed.field] = current;
          }
          break;
        case "SET_ITEM":
          if (parsed.field && typeof parsed.index === "number") {
            const current = Array.isArray(existing.data[parsed.field])
              ? [...(existing.data[parsed.field] as unknown[])]
              : [];
            current[parsed.index] = parsed.value;
            existing.data[parsed.field] = current;
          }
          break;
        case "DELETE_ITEM":
          if (parsed.field && typeof parsed.index === "number" && Array.isArray(existing.data[parsed.field])) {
            const current = [...(existing.data[parsed.field] as unknown[])];
            current.splice(parsed.index, 1);
            existing.data[parsed.field] = current;
          }
          break;
      }

      states.set(parsed.storageAddress, existing);
    }

    return states;
  }

  function parseStorageProgramOperation(tx: {
    from?: string;
    to?: string;
    content?: string | Record<string, unknown>;
    timestamp?: number | string;
  }): {
    storageAddress: string;
    programName?: string;
    operation: string;
    owner: string;
    data?: unknown;
    field?: string;
    value?: unknown;
    index?: number;
    timestamp: number;
  } | null {
    const content = typeof tx.content === "string" ? safeParse(tx.content) : tx.content;
    if (!isRecord(content)) return null;
    const rawData = content.data;
    const payload = Array.isArray(rawData) && rawData[0] === "storageProgram" ? rawData[1] : rawData;
    if (!isRecord(payload) || typeof payload.operation !== "string") return null;
    const storageAddress =
      typeof payload.storageAddress === "string"
        ? payload.storageAddress
        : typeof tx.to === "string"
          ? tx.to
          : "";
    if (!storageAddress) return null;

    return {
      storageAddress,
      programName: typeof payload.programName === "string" ? payload.programName : undefined,
      operation: payload.operation,
      owner: typeof tx.from === "string" ? tx.from : "",
      data: payload.data,
      field: typeof payload.field === "string" ? payload.field : undefined,
      value: payload.value,
      index: typeof payload.index === "number" ? payload.index : undefined,
      timestamp: Number(tx.timestamp ?? 0),
    };
  }

  function safeParse(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  return {
    async read(storageAddress) {
      try {
        const client = await getClient();
        const result = await client.readState(storageAddress);
        if (result && typeof result.storageAddress === "string" && isRecord(result.data)) {
          return { ok: true, data: result.data };
        }
        const fallback = (await loadRecentStorageProgramStates()).get(storageAddress);
        if (!fallback) return { ok: false, error: "Storage program not found" };
        return { ok: true, data: fallback.data };
      } catch (e) {
        const fallback = (await loadRecentStorageProgramStates()).get(storageAddress);
        if (fallback) return { ok: true, data: fallback.data };
        return { ok: false, error: (e as Error).message };
      }
    },

    async list() {
      try {
        const client = await getClient();
        const programs = await client.listPrograms();
        if (Array.isArray(programs)) return { ok: true, data: programs };
        const fallback = [...(await loadRecentStorageProgramStates()).values()]
          .filter((program) => !program.owner || program.owner === agentAddress)
          .map((program) => ({
            storageAddress: program.storageAddress,
            programName: program.programName,
            data: program.data,
          }));
        return { ok: true, data: fallback };
      } catch (e) {
        const fallback = [...(await loadRecentStorageProgramStates()).values()]
          .filter((program) => !program.owner || program.owner === agentAddress)
          .map((program) => ({
            storageAddress: program.storageAddress,
            programName: program.programName,
            data: program.data,
          }));
        if (fallback.length > 0) return { ok: true, data: fallback };
        return { ok: false, error: (e as Error).message };
      }
    },

    async search(query, limit = 10) {
      try {
        const client = await getClient();
        const programs = await client.searchPrograms(query, limit);
        if (Array.isArray(programs)) return { ok: true, data: programs };
        const normalized = query.toLowerCase();
        const fallback = [...(await loadRecentStorageProgramStates()).values()]
          .filter((program) => program.programName.toLowerCase().includes(normalized))
          .slice(0, limit)
          .map((program) => ({
            storageAddress: program.storageAddress,
            programName: program.programName,
            data: program.data,
          }));
        return { ok: true, data: fallback };
      } catch (e) {
        const normalized = query.toLowerCase();
        const fallback = [...(await loadRecentStorageProgramStates()).values()]
          .filter((program) => program.programName.toLowerCase().includes(normalized))
          .slice(0, limit)
          .map((program) => ({
            storageAddress: program.storageAddress,
            programName: program.programName,
            data: program.data,
          }));
        if (fallback.length > 0) return { ok: true, data: fallback };
        return { ok: false, error: (e as Error).message };
      }
    },

    async hasField(storageAddress, field) {
      try {
        const client = await getClient();
        const direct = await client.hasField(storageAddress, field);
        if (direct) return true;
        const fallback = (await loadRecentStorageProgramStates()).get(storageAddress);
        return !!fallback && Object.prototype.hasOwnProperty.call(fallback.data, field);
      } catch {
        const fallback = (await loadRecentStorageProgramStates()).get(storageAddress);
        return !!fallback && Object.prototype.hasOwnProperty.call(fallback.data, field);
      }
    },

    async readField<T = unknown>(storageAddress: string, field: string): Promise<T | null> {
      try {
        const client = await getClient();
        const direct = await client.readField<T>(storageAddress, field);
        if (direct !== null) return direct;
        const fallback = (await loadRecentStorageProgramStates()).get(storageAddress);
        if (!fallback || !Object.prototype.hasOwnProperty.call(fallback.data, field)) return null;
        return fallback.data[field] as T;
      } catch {
        const fallback = (await loadRecentStorageProgramStates()).get(storageAddress);
        if (!fallback || !Object.prototype.hasOwnProperty.call(fallback.data, field)) return null;
        return fallback.data[field] as T;
      }
    },
  };
}
