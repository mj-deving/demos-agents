/**
 * FrameworkPlugin — the extension point for building custom agents.
 *
 * A plugin bundles hooks, data providers, evaluators, actions, and configuration
 * into a single installable unit. The session loop discovers and invokes
 * plugins at the appropriate lifecycle points.
 *
 * Taxonomy inspired by Eliza's Action/Provider/Evaluator/Service pattern
 * (the gold standard from framework research).
 */

import type { LLMProvider } from "./lib/llm/llm-provider.js";
import type { AgentConfig } from "./lib/agent-config.js";
import type {
  AgentEvent,
  EventAction,
  EventHandler,
  EventSource,
  OmniwebAction,
} from "./toolkit/reactive/types.js";
export type {
  AgentEvent,
  EventAction,
  EventActionLike,
  EventHandler,
  EventSource,
  OmniwebAction,
  OmniwebActionType,
  SCAction,
  SCActionType,
  WatermarkStore,
} from "./toolkit/reactive/types.js";

// ── Core Plugin Types ───────────────────────────────

/**
 * A hook function that runs at a lifecycle point.
 * Returns void or a modified context object.
 */
export type HookFn<T = unknown> = (context: T) => void | Promise<void>;

/**
 * A data provider supplies external data to the agent loop.
 * Providers are invoked during the SENSE phase.
 */
export interface DataProvider {
  /** Unique provider name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Fetch data for a given topic */
  fetch(topic: string, options?: Record<string, unknown>): Promise<ProviderResult>;
}

export interface ProviderResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

/**
 * An evaluator scores or filters content at decision points.
 * Evaluators run during the ACT phase (gate, match, quality).
 */
export interface Evaluator {
  /** Unique evaluator name */
  name: string;
  /** What this evaluator checks */
  description: string;
  /** Evaluate content and return a score/decision */
  evaluate(input: EvaluatorInput): Promise<EvaluatorResult>;
}

/**
 * Framework-agnostic evaluator input.
 * The `context` map carries domain-specific fields (e.g., topic, category
 * for SuperColony; message, roomId for Eliza). Core doesn't prescribe
 * what goes in context — adapters populate it for their framework.
 */
export interface EvaluatorInput {
  /** The text content to evaluate */
  text: string;
  /** Framework-agnostic context map — domain fields go here */
  context: Record<string, unknown>;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface EvaluatorResult {
  pass: boolean;
  score?: number;
  reason: string;
  details?: Record<string, unknown>;
}

// ── Action Interface ──────────────────────────────

/**
 * An action is an executable capability that an agent can perform.
 * Actions are the primary unit of work in cross-framework adapters
 * (maps to Eliza's Action, OpenClaw's Gateway tool).
 *
 * Handlers are pure: validate decides if the action should run,
 * execute performs it and returns a result.
 */
export interface Action {
  /** Unique action name (e.g., "publish", "react", "search") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Optional aliases for discovery (e.g., ["post", "share"]) */
  aliases?: string[];
  /** Check if this action should run for the given input */
  validate(input: ActionInput): Promise<boolean>;
  /** Execute the action and return a result */
  execute(input: ActionInput): Promise<ActionResult>;
}

/**
 * Framework-agnostic action input.
 * Like EvaluatorInput, uses a context map so adapters can populate
 * domain-specific fields without core knowing about them.
 */
export interface ActionInput {
  /** Framework-agnostic context (e.g., message text, topic, parameters) */
  context: Record<string, unknown>;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** Result data (action-specific) */
  data?: unknown;
  /** Human-readable text output */
  text?: string;
  /** Error message on failure */
  error?: string;
}

// ── Plugin Interface ────────────────────────────────

/**
 * FrameworkPlugin — the primary extension mechanism.
 *
 * Plugins can provide any combination of hooks, providers, evaluators,
 * and actions. All fields are optional — implement only what your plugin needs.
 */
export interface FrameworkPlugin {
  /** Plugin name (used for logging and diagnostics) */
  name: string;

  /** Plugin version (semver) */
  version: string;

  /** Human-readable description */
  description?: string;

  /**
   * Lifecycle hooks — run at specific points in the session loop.
   * Keys are hook names (e.g., "beforeSense", "afterPublish").
   */
  hooks?: Record<string, HookFn>;

  /** Data providers — supply external data during SENSE */
  providers?: DataProvider[];

  /** Evaluators — score/filter content during ACT */
  evaluators?: Evaluator[];

  /** Actions — executable capabilities (publish, react, search, etc.) */
  actions?: Action[];

  /**
   * Initialize the plugin. Called once when the plugin is registered.
   * Receives the agent config and LLM provider for setup.
   */
  init?(config: AgentConfig, llm?: LLMProvider): Promise<void>;

  /**
   * Cleanup function. Called when the session ends.
   */
  destroy?(): Promise<void>;
}

// ── Omniweb Action Param Interfaces ─────────────────

/** Params for "transfer" action — DEM transfer to address */
export interface TransferParams {
  to: string;
  amount: number;
  memo?: string;
}

/** Params for "store" action — write to Storage Program */
export interface StoreParams {
  operation: "create" | "write" | "set_field" | "append_item" | "delete_field";
  storageAddress?: string;
  programName?: string;
  field?: string;
  value?: unknown;
  data?: Record<string, unknown>;
  acl?: "public" | "private" | "restricted";
}

/** Params for "attest" action — standalone attestation */
export interface AttestParams {
  url: string;
  method?: "dahr" | "tlsn";
  storeProof?: boolean;
  storageAddress?: string;
}

/**
 * EventPlugin — extension point for event-driven agents.
 *
 * Parallel to FrameworkPlugin but scoped to event lifecycle.
 * Both can coexist in the same PluginRegistry (via name/version).
 */
export interface EventPlugin {
  /** Plugin name (used for logging and diagnostics) */
  name: string;

  /** Plugin version (semver) */
  version: string;

  /** Human-readable description */
  description?: string;

  /** Event lifecycle hooks */
  eventHooks?: {
    /** Called when any event is detected (logging, metrics) */
    onEvent?(event: AgentEvent): Promise<void>;
    /** Called before executing an action. Return false to veto. */
    beforeAction?(event: AgentEvent, action: EventAction): Promise<boolean>;
    /** Called after action execution (logging, follow-up) */
    afterAction?(event: AgentEvent, action: EventAction, result: unknown): Promise<void>;
    /** Called when handler or action throws (alerting, circuit breaking) */
    onError?(event: AgentEvent, error: Error): Promise<void>;
  };

  /** Event sources this plugin provides */
  sources?: EventSource<unknown>[];

  /** Event handlers this plugin provides */
  handlers?: EventHandler<OmniwebAction>[];

  /** Initialize on plugin registration */
  init?(config: AgentConfig): Promise<void>;

  /** Cleanup on session/loop end */
  destroy?(): Promise<void>;
}

// ── Plugin Registry ─────────────────────────────────

/**
 * Register plugins (both session and event) with the framework.
 * This is the main entry point for plugin installation.
 */
export interface PluginRegistry {
  /** Register a session plugin */
  register(plugin: FrameworkPlugin): void;
  /** Register an event plugin */
  registerEvent(plugin: EventPlugin): void;
  /** Get all session plugins */
  getAll(): FrameworkPlugin[];
  /** Get all event plugins */
  getAllEvents(): EventPlugin[];
  /** Get a session plugin by name */
  get(name: string): FrameworkPlugin | undefined;
  /** Get all hooks for a given lifecycle point */
  getHooks(hookName: string): HookFn[];
  /** Get all data providers */
  getProviders(): DataProvider[];
  /** Get all evaluators */
  getEvaluators(): Evaluator[];
  /** Get all actions across all plugins */
  getActions(): Action[];
  /** Get all event sources across all event plugins */
  getEventSources(): EventSource<unknown>[];
  /** Get all event handlers across all event plugins */
  getEventHandlers(): EventHandler<OmniwebAction>[];
}

/**
 * Create a new plugin registry.
 */
export function createPluginRegistry(): PluginRegistry {
  const plugins: FrameworkPlugin[] = [];
  const eventPlugins: EventPlugin[] = [];

  return {
    register(plugin: FrameworkPlugin): void {
      plugins.push(plugin);
    },
    registerEvent(plugin: EventPlugin): void {
      eventPlugins.push(plugin);
    },
    getAll(): FrameworkPlugin[] {
      return [...plugins];
    },
    getAllEvents(): EventPlugin[] {
      return [...eventPlugins];
    },
    get(name: string): FrameworkPlugin | undefined {
      return plugins.find((p) => p.name === name);
    },
    getHooks(hookName: string): HookFn[] {
      return plugins
        .filter((p) => p.hooks?.[hookName])
        .map((p) => p.hooks![hookName]);
    },
    getProviders(): DataProvider[] {
      return plugins.flatMap((p) => p.providers || []);
    },
    getEvaluators(): Evaluator[] {
      return plugins.flatMap((p) => p.evaluators || []);
    },
    getActions(): Action[] {
      return plugins.flatMap((p) => p.actions || []);
    },
    getEventSources(): EventSource<any>[] {
      return eventPlugins.flatMap((p) => p.sources || []);
    },
    getEventHandlers(): EventHandler<OmniwebAction>[] {
      return eventPlugins.flatMap((p) => p.handlers || []);
    },
  };
}

// ── Shared Utility Types ─────────────────────────

/** Function signature for running a CLI tool as subprocess. */
export type RunToolFn = (toolPath: string, args: string[], label: string) => Promise<unknown>;
