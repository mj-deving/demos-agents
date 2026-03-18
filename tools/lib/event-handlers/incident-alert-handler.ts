/**
 * IncidentAlertHandler — processes infrastructure status change events.
 *
 * Pure handler: receives status change events, returns an EventAction or null.
 * No side effects — the action executor handles logging and notifications.
 */

import { createSeverityHandler } from "./severity-handler.js";
import { STATUS_EVENT_TYPES } from "../event-sources/status-monitor.js";

/**
 * Create an incident alert event handler.
 *
 * Strategy: classify events by severity based on type and log them.
 * Outages are critical, degradations are warnings, recoveries are info.
 */
export function createIncidentAlertHandler() {
  return createSeverityHandler({
    name: "incident-alert",
    eventTypes: STATUS_EVENT_TYPES,
    mapping: {
      severities: {
        outage: "critical",
        degradation: "warning",
        recovery: "info",
        status_change: "info",
      },
    },
    buildParams: (event, severity) => {
      const reason =
        event.type === "outage" ? `Service outage detected: ${JSON.stringify(event.payload)}`
        : event.type === "degradation" ? `Service degradation: ${JSON.stringify(event.payload)}`
        : event.type === "recovery" ? `Service recovered: ${JSON.stringify(event.payload)}`
        : `Status change: ${JSON.stringify(event.payload)}`;
      return { reason, severity };
    },
  });
}
