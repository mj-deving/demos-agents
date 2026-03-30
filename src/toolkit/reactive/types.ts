/**
 * Reactive toolkit types.
 *
 * These contracts are framework-agnostic and safe to reuse from the toolkit
 * without depending on strategy modules.
 */

/** An event emitted by a source after diff/filter. */
export interface AgentEvent<T = unknown> {
  /** Unique event ID (source:type:timestamp:hash) */
  id: string;
  /** Which source produced this event */
  sourceId: string;
  /** Event type (e.g., "reply", "ask_mention", "balance_changed") */
  type: string;
  /** When the event was detected (Unix ms) */
  detectedAt: number;
  /** Source-specific payload */
  payload: T;
  /** The watermark AFTER this event (for persistence) */
  watermark: unknown;
}

/** SC-tier action types (SuperColony feed operations) */
export type SCActionType = "publish" | "reply" | "react" | "tip" | "log_only";

/** Omniweb-tier action types (full Demos ecosystem operations) */
export type OmniwebActionType =
  | SCActionType
  | "transfer"
  | "bridge"
  | "store"
  | "attest"
  | "workflow"
  | "assign_task"
  | "private_transfer"
  | "zk_prove";

/** Minimal structural constraint for actions handled by the event loop. */
export interface EventActionLike {
  type: string;
  params: Record<string, unknown>;
}

/**
 * An action to execute in response to an event.
 *
 * `TType` is generic so toolkit consumers can use action unions unrelated to
 * the sentinel's Omniweb action set.
 */
export interface EventAction<
  TType extends string = OmniwebActionType,
  TParams extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Action type determines the executor */
  type: TType;
  /** Action-specific parameters */
  params: TParams;
}

/** Default action shape for sentinel and other Omniweb consumers. */
export type OmniwebAction = EventAction<OmniwebActionType>;

/** Narrower action shape for SC-only consumers. */
export type SCAction = EventAction<SCActionType>;

/**
 * A pollable event source. T is the snapshot type.
 *
 * EventSource declares WHAT to poll and HOW to diff.
 * The EventLoop runtime executes the poll-diff-dispatch cycle.
 */
export interface EventSource<T = unknown> {
  /** Unique source identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Event types this source can emit */
  eventTypes: string[];

  /**
   * Fetch current state. Returns a snapshot.
   * Must be idempotent and side-effect-free.
   */
  poll(): Promise<T>;

  /**
   * Compare two snapshots and emit events.
   * Returns empty array if nothing changed.
   * prev is null on first poll (no prior state).
   */
  diff(prev: T | null, curr: T): AgentEvent[];

  /**
   * Extract the watermark from a snapshot for persistence.
   */
  extractWatermark(snapshot: T): unknown;
}

/**
 * Handles events from one or more sources.
 * Handlers are pure: they receive an event and produce an action (or nothing).
 * Side effects go in the action executor, not the handler.
 */
export interface EventHandler<TAction extends EventActionLike = OmniwebAction> {
  /** Handler name (for logging) */
  name: string;
  /** Which event types this handler processes */
  eventTypes: string[];
  /**
   * Process an event. Returns an action to execute, or null to skip.
   * MUST NOT have side effects.
   */
  handle(event: AgentEvent): Promise<TAction | null>;
}

/**
 * Persistent watermark storage.
 * Decoupled from the event loop so it can be file-based, SQLite, or in-memory for tests.
 */
export interface WatermarkStore {
  /** Load watermark for a source. Returns null if first run. */
  load(sourceId: string): Promise<unknown | null>;
  /** Save watermark after successful processing. */
  save(sourceId: string, watermark: unknown): Promise<void>;
  /** Load all watermarks (for diagnostics). */
  loadAll(): Promise<Record<string, unknown>>;
}
