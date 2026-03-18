/**
 * MarketAlertHandler — evaluates DeFi protocol events and decides action.
 *
 * Pure handler: receives a protocol event, returns an EventAction or null.
 * No side effects — the action executor handles rate limits and publishing.
 */

import type { AgentEvent, EventAction, EventHandler } from "../../../core/types.js";
import { PROTOCOL_EVENT_TYPES, type ProtocolEvent } from "../event-sources/protocol-events.js";

/**
 * Create a market alert event handler.
 *
 * Strategy:
 * - Exploits are always logged at critical severity
 * - Governance events are logged at info severity
 * - TVL and rate changes are logged for future threshold-based publishing
 */
export function createMarketAlertHandler(): EventHandler {
  return {
    name: "market-alert",
    eventTypes: [...PROTOCOL_EVENT_TYPES],

    async handle(event: AgentEvent): Promise<EventAction | null> {
      const payload = event.payload as ProtocolEvent;

      // Exploits always get logged at critical severity
      if (event.type === "exploit") {
        return {
          type: "log_only",
          params: {
            reason: `Protocol exploit detected: ${payload.protocol}`,
            severity: "critical",
            protocol: payload.protocol,
            data: payload.data,
          },
        };
      }

      // Governance events get logged
      if (event.type === "governance") {
        return {
          type: "log_only",
          params: {
            reason: `Governance event: ${payload.protocol}`,
            severity: "info",
            protocol: payload.protocol,
            data: payload.data,
          },
        };
      }

      // TVL and rate changes — log for now, publish when threshold met
      return {
        type: "log_only",
        params: {
          reason: `Market event ${event.type}: ${payload.protocol}`,
          severity: "info",
          protocol: payload.protocol,
          data: payload.data,
        },
      };
    },
  };
}
