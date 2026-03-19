/**
 * Plugin assembler — wires all bridges into a single ElizaOS Plugin.
 *
 * Takes demos FrameworkPlugin[] and optional EventPlugin[] and produces
 * an ElizaPlugin with bridged actions, providers, evaluators, and services.
 */

import type { FrameworkPlugin, EventPlugin } from "../../types.js";
import type { ElizaPlugin } from "./types.js";
import { bridgeAction } from "./action-bridge.js";
import { bridgeProvider } from "./provider-bridge.js";
import { bridgeEvaluator } from "./evaluator-bridge.js";
import { EventSourceService } from "./event-service.js";

export function createElizaPlugin(
  frameworkPlugins: FrameworkPlugin[],
  eventPlugins?: EventPlugin[],
): ElizaPlugin {
  const actions = frameworkPlugins.flatMap((p) => (p.actions || []).map(bridgeAction));
  const providers = frameworkPlugins.flatMap((p) => (p.providers || []).map(bridgeProvider));
  const evaluators = frameworkPlugins.flatMap((p) => (p.evaluators || []).map(bridgeEvaluator));

  const services: EventSourceService[] = [];
  if (eventPlugins?.length) {
    const allSources = eventPlugins.flatMap((p) => p.sources || []);
    const allHandlers = eventPlugins.flatMap((p) => p.handlers || []);
    if (allSources.length > 0) {
      services.push(new EventSourceService(allSources, allHandlers));
    }
  }

  return {
    name: "demos-agents",
    description: "Demos agents framework bridge for ElizaOS",
    actions,
    providers,
    evaluators,
    services,
  };
}
