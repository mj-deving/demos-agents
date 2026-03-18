/**
 * MarketAlertHandler — evaluates DeFi protocol events and decides action.
 *
 * Pure handler: receives a protocol event, returns an EventAction or null.
 * No side effects — the action executor handles rate limits and publishing.
 */

import { createSeverityHandler } from "./severity-handler.js";
import { PROTOCOL_EVENT_TYPES, type ProtocolEvent } from "../event-sources/protocol-events.js";

/**
 * Create a market alert event handler.
 *
 * Strategy:
 * - Exploits are always logged at critical severity
 * - Governance events are logged at info severity
 * - TVL and rate changes are logged for future threshold-based publishing
 */
export function createMarketAlertHandler() {
  return createSeverityHandler({
    name: "market-alert",
    eventTypes: PROTOCOL_EVENT_TYPES,
    mapping: {
      severities: {
        exploit: "critical",
        governance: "info",
        tvl_change: "info",
        rate_change: "info",
      },
    },
    buildParams: (event, severity) => {
      const payload = event.payload as ProtocolEvent;
      const reason =
        event.type === "exploit" ? `Protocol exploit detected: ${payload.protocol}`
        : event.type === "governance" ? `Governance event: ${payload.protocol}`
        : `Market event ${event.type}: ${payload.protocol}`;
      return { reason, severity, protocol: payload.protocol, data: payload.data };
    },
  });
}
