/**
 * Storage Client — wraps @kynesyslabs/demosdk StorageProgram for agent use.
 *
 * Provides a higher-level API for agents to create, read, and write
 * on-chain Storage Programs with deterministic addressing.
 *
 * SDK-aware (imports StorageProgram) — lives in tools/lib/ not core/.
 */

import {
  StorageProgram,
  type StorageProgramData,
  type StorageProgramListItem,
} from "@kynesyslabs/demosdk/storage";

// ── Types ───────────────────────────────────────────

export interface StorageClientConfig {
  rpcUrl: string;
  agentName: string;
  agentAddress: string;
}

export interface AgentStateProgram {
  storageAddress: string;
  programName: string;
  data: Record<string, unknown>;
}

// ── Client ──────────────────────────────────────────

/**
 * Create a storage client for an agent.
 * Provides deterministic naming and simplified CRUD.
 */
export function createStorageClient(config: StorageClientConfig) {
  const { rpcUrl, agentName, agentAddress } = config;

  /** Derive the deterministic storage address for agent state. */
  function deriveStateAddress(nonce: number): string {
    return StorageProgram.deriveStorageAddress(
      agentAddress,
      `${agentName}-state`,
      nonce,
    );
  }

  /** Create a Storage Program payload for agent state (initial creation). */
  function createStatePayload(
    initialData: Record<string, unknown>,
    nonce: number,
    acl: "public" | "private" = "public",
  ) {
    const aclConfig =
      acl === "public" ? StorageProgram.publicACL() : StorageProgram.privateACL();
    return StorageProgram.createStorageProgram(
      agentAddress,
      `${agentName}-state`,
      initialData,
      "json",
      aclConfig,
      { nonce },
    );
  }

  /** Create a write payload to update the full state. */
  function writeStatePayload(storageAddress: string, data: Record<string, unknown>) {
    return StorageProgram.writeStorage(storageAddress, data, "json");
  }

  /** Create a setField payload for a single field update. */
  function setFieldPayload(storageAddress: string, field: string, value: unknown) {
    return StorageProgram.setField(storageAddress, field, value);
  }

  /** Create an appendItem payload for array fields. */
  function appendItemPayload(storageAddress: string, field: string, value: unknown) {
    return StorageProgram.appendItem(storageAddress, field, value);
  }

  /** Create a deleteField payload. */
  function deleteFieldPayload(storageAddress: string, field: string) {
    return StorageProgram.deleteField(storageAddress, field);
  }

  /** Read agent's state from chain. Returns null if not found. */
  async function readState(storageAddress: string): Promise<AgentStateProgram | null> {
    const data = await StorageProgram.getByAddress(rpcUrl, storageAddress, agentAddress);
    if (!data) return null;
    return {
      storageAddress: data.storageAddress,
      programName: data.programName,
      data: (data.data as Record<string, unknown>) ?? {},
    };
  }

  /** Read a specific field from storage. */
  async function readField<T = unknown>(storageAddress: string, field: string): Promise<T | null> {
    const result = await StorageProgram.getValue<T>(rpcUrl, storageAddress, field, agentAddress);
    return result?.value ?? null;
  }

  /** Check if a field exists. */
  async function hasField(storageAddress: string, field: string): Promise<boolean> {
    const result = await StorageProgram.hasField(rpcUrl, storageAddress, field, agentAddress);
    return result?.exists ?? false;
  }

  /** List all storage programs owned by this agent. */
  async function listPrograms(): Promise<StorageProgramListItem[]> {
    return StorageProgram.getByOwner(rpcUrl, agentAddress, agentAddress);
  }

  /** Search for storage programs by name prefix. */
  async function searchPrograms(query: string, limit = 10): Promise<StorageProgramListItem[]> {
    return StorageProgram.searchByName(rpcUrl, query, { limit, identity: agentAddress });
  }

  /** Validate data size before creating/writing. */
  function validateSize(data: Record<string, unknown>): boolean {
    return StorageProgram.validateSize(data, "json");
  }

  /** Calculate storage fee in DEM. */
  function calculateFee(data: Record<string, unknown>): bigint {
    return StorageProgram.calculateStorageFee(data, "json");
  }

  return {
    deriveStateAddress,
    createStatePayload,
    writeStatePayload,
    setFieldPayload,
    appendItemPayload,
    deleteFieldPayload,
    readState,
    readField,
    hasField,
    listPrograms,
    searchPrograms,
    validateSize,
    calculateFee,
  };
}

export type StorageClient = ReturnType<typeof createStorageClient>;
