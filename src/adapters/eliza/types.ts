/**
 * ElizaOS type stubs (from @elizaos/core).
 *
 * These mirror the ElizaOS interfaces we bridge to. When @elizaos/core is added
 * as a devDependency, these can be replaced with direct imports.
 */

export interface ElizaCharacter {
  name: string;
  bio: string;
  topics: string[];
  style: { post: string[] };
  plugins: string[];
  settings: Record<string, unknown>;
}

export interface ElizaAction {
  name: string;
  similes: string[];
  description: string;
  examples: unknown[];
  validate: (runtime: ElizaRuntime, message: ElizaMessage, state?: ElizaState) => Promise<boolean>;
  handler: (runtime: ElizaRuntime, message: ElizaMessage, state?: ElizaState) => Promise<ElizaActionResult>;
}

export interface ElizaActionResult {
  success: boolean;
  text?: string;
  values?: Record<string, unknown>;
  data?: unknown;
}

export interface ElizaProvider {
  get: (runtime: ElizaRuntime, message: ElizaMessage, state?: ElizaState) => Promise<string>;
}

export interface ElizaEvaluator {
  name: string;
  description: string;
  similes: string[];
  examples: unknown[];
  alwaysRun: boolean;
  validate: (runtime: ElizaRuntime, message: ElizaMessage, state?: ElizaState) => Promise<boolean>;
  handler: (runtime: ElizaRuntime, message: ElizaMessage, state?: ElizaState) => Promise<void>;
}

export interface ElizaService {
  serviceType: string;
  capabilityDescription: string;
  start?(...args: unknown[]): Promise<void>;
  stop?(): Promise<void>;
}

export interface ElizaPlugin {
  name: string;
  description: string;
  actions?: ElizaAction[];
  providers?: ElizaProvider[];
  evaluators?: ElizaEvaluator[];
  services?: ElizaService[];
}

export interface ElizaRuntime {
  log?(...args: unknown[]): void;
  getSetting?(key: string): string | undefined;
  emit?(event: string, data: unknown): void;
}

export interface ElizaMessage {
  content?: { text?: string };
  [key: string]: unknown;
}

export type ElizaState = Record<string, unknown>;

export interface ElizaDatabaseAdapter {
  getMemoriesByRoomIds?(opts: { tableName: string; roomIds: string[] }): Promise<ElizaMemory[]>;
  createMemory?(memory: ElizaMemory, tableName: string): Promise<void>;
  removeMemory?(memoryId: string, tableName: string): Promise<void>;
}

export interface ElizaMemory {
  id?: string;
  content: { text: string; [key: string]: unknown };
  roomId: string;
  userId?: string;
  agentId?: string;
  [key: string]: unknown;
}
