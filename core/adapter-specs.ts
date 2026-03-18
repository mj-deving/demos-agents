/**
 * Adapter Interface Specs — Design Only (WS2 Deferred)
 *
 * These interfaces define how external frameworks (Eliza OS, OpenClaw)
 * can integrate with the demos-agents plugin system. No implementation yet.
 *
 * The adapter pattern bridges external framework events/actions to
 * our FrameworkPlugin and EventPlugin interfaces.
 */

import type { FrameworkPlugin, EventPlugin, AgentEvent, EventAction } from "./types.js";

// ── Eliza OS Adapter ────────────────────────────────

/**
 * Eliza OS adapter — bridges Eliza's character/action system to demos-agents plugins.
 *
 * Eliza OS uses:
 * - Characters (similar to our personas)
 * - Actions (similar to our Action type)
 * - Providers (similar to our DataProvider)
 * - Evaluators (similar to our Evaluator)
 *
 * The adapter translates between Eliza's runtime model and our plugin interfaces.
 * Eliza plugins register as FrameworkPlugins, and Eliza actions map to our Action type.
 */
export interface ElizaOSAdapter {
  /** Convert an Eliza character definition to a demos-agents persona config */
  importCharacter(elizaCharacter: unknown): { name: string; topics: string[] };

  /** Wrap an Eliza action as a demos-agents FrameworkPlugin Action */
  wrapAction(elizaAction: unknown): FrameworkPlugin["actions"];

  /** Wrap an Eliza provider as a demos-agents DataProvider */
  wrapProvider(elizaProvider: unknown): FrameworkPlugin["providers"];

  /** Wrap an Eliza evaluator as a demos-agents Evaluator */
  wrapEvaluator(elizaEvaluator: unknown): FrameworkPlugin["evaluators"];

  /** Create a FrameworkPlugin from an Eliza plugin package */
  createPlugin(elizaPlugin: unknown): FrameworkPlugin;
}

// ── OpenClaw Adapter ────────────────────────────────

/**
 * OpenClaw adapter — bridges OpenClaw's IRC bot system to demos-agents plugins.
 *
 * OpenClaw uses:
 * - Bot configs (channel, nick, commands)
 * - Message handlers (incoming IRC messages)
 * - Command handlers (user commands like !help)
 *
 * The adapter translates IRC events to our AgentEvent type and
 * maps our EventAction responses back to IRC messages.
 */
export interface OpenClawAdapter {
  /** Convert an IRC message to an AgentEvent */
  messageToEvent(ircMessage: {
    channel: string;
    nick: string;
    text: string;
    timestamp: number;
  }): AgentEvent<{ channel: string; nick: string; text: string }>;

  /** Convert an EventAction to an IRC response */
  actionToMessage(action: EventAction): {
    target: string;  // channel or nick
    text: string;
  } | null;

  /** Create an EventPlugin from an OpenClaw bot config */
  createPlugin(botConfig: {
    nick: string;
    channels: string[];
    commandPrefix: string;
  }): EventPlugin;
}

// ── Shared Adapter Utilities ────────────────────────

/**
 * Generic adapter factory — creates an adapter that translates between
 * an external framework's event/action model and demos-agents plugins.
 *
 * This is the pattern all adapters should follow:
 * 1. Import: external → demos-agents types
 * 2. Export: demos-agents types → external
 * 3. Plugin: create FrameworkPlugin or EventPlugin from external config
 */
export interface AdapterFactory<TConfig, TPlugin extends FrameworkPlugin | EventPlugin> {
  /** Adapter name (e.g., "eliza-os", "openclaw") */
  name: string;

  /** Create a plugin from external config */
  createPlugin(config: TConfig): TPlugin;

  /** Validate external config before creating plugin */
  validateConfig(config: unknown): config is TConfig;
}
