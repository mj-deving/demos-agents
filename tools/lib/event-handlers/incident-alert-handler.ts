/**
 * IncidentAlertHandler — processes infrastructure status change events.
 *
 * Pure handler: receives status change events, returns an EventAction or null.
 * No side effects — the action executor handles logging and notifications.
 */

import type { AgentEvent, EventAction, EventHandler } from "../../../core/types.js";
import { STATUS_EVENT_TYPES } from "../event-sources/status-monitor.js";

/**
 * Create an incident alert event handler.
 *
 * Strategy: classify events by severity based on type and log them.
 * Outages are critical, degradations are warnings, recoveries are info.
 */
export function createIncidentAlertHandler(): EventHandler {
  return {
    name: "incident-alert",
    eventTypes: [...STATUS_EVENT_TYPES],

    async handle(event: AgentEvent): Promise<EventAction | null> {
      // Outages always get logged with critical severity
      if (event.type === "outage") {
        return {
          type: "log_only",
          params: {
            reason: `Service outage detected: ${JSON.stringify(event.payload)}`,
            severity: "critical",
          },
        };
      }

      // Degradations get logged
      if (event.type === "degradation") {
        return {
          type: "log_only",
          params: {
            reason: `Service degradation: ${JSON.stringify(event.payload)}`,
            severity: "warning",
          },
        };
      }

      // Recoveries get logged
      if (event.type === "recovery") {
        return {
          type: "log_only",
          params: {
            reason: `Service recovered: ${JSON.stringify(event.payload)}`,
            severity: "info",
          },
        };
      }

      // Generic status changes
      return {
        type: "log_only",
        params: {
          reason: `Status change: ${JSON.stringify(event.payload)}`,
          severity: "info",
        },
      };
    },
  };
}
