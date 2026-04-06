/**
 * Webhooks domain — CRUD for push notifications.
 */

import type { SuperColonyApiClient } from "../supercolony/api-client.js";
import type { WebhooksPrimitives } from "./types.js";

export function createWebhooksPrimitives(deps: { apiClient: SuperColonyApiClient }): WebhooksPrimitives {
  return {
    async list() {
      return deps.apiClient.listWebhooks();
    },

    async create(url, events) {
      return deps.apiClient.createWebhook(url, events);
    },

    async delete(webhookId) {
      return deps.apiClient.deleteWebhook(webhookId);
    },
  };
}
