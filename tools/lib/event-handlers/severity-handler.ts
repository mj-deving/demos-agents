/**
 * Shared severity-based log handler factory.
 * Maps event types to severity levels and produces log_only actions.
 *
 * Used by handlers that need to classify events by severity and log them
 * (e.g., market alerts, incident alerts). Each handler controls its own
 * params shape via the buildParams callback.
 */

import type { AgentEvent, EventAction, EventHandler } from "../../../core/types.js";

export interface SeverityMapping {
  /** Event type to severity level mapping */
  severities: Record<string, "critical" | "warning" | "info">;
  /** Default severity for unmapped event types */
  defaultSeverity?: "critical" | "warning" | "info";
}

export interface SeverityHandlerConfig {
  name: string;
  eventTypes: readonly string[];
  mapping: SeverityMapping;
  /** Build the full params object from the event. Must include reason and severity. */
  buildParams: (event: AgentEvent, severity: "critical" | "warning" | "info") => Record<string, unknown>;
}

export function createSeverityHandler(config: SeverityHandlerConfig): EventHandler {
  const { name, eventTypes, mapping, buildParams } = config;
  const defaultSeverity = mapping.defaultSeverity ?? "info";

  return {
    name,
    eventTypes: [...eventTypes],

    async handle(event: AgentEvent): Promise<EventAction | null> {
      const severity = mapping.severities[event.type] ?? defaultSeverity;
      return {
        type: "log_only",
        params: buildParams(event, severity),
      };
    },
  };
}
