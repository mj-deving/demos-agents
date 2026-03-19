/**
 * Watermark adapter — bridges ElizaOS DatabaseAdapter to demos WatermarkStore.
 *
 * Uses ElizaOS memory table to persist source watermarks, keyed by sourceId
 * stored in the memory content text field.
 */

import type { WatermarkStore } from "../../types.js";
import type { ElizaDatabaseAdapter } from "./types.js";

const WATERMARK_TABLE = "demos_watermarks";
const WATERMARK_ROOM = "demos-watermarks-room";

export function createElizaWatermarkStore(adapter: ElizaDatabaseAdapter): WatermarkStore {
  return {
    async load(sourceId: string): Promise<unknown | null> {
      const memories =
        (await adapter.getMemoriesByRoomIds?.({
          tableName: WATERMARK_TABLE,
          roomIds: [WATERMARK_ROOM],
        })) || [];
      const match = memories.find((m) => m.content?.text === sourceId);
      return match?.content?.watermark ?? null;
    },
    async save(sourceId: string, watermark: unknown): Promise<void> {
      // Remove existing watermark for this source
      const existing =
        (await adapter.getMemoriesByRoomIds?.({
          tableName: WATERMARK_TABLE,
          roomIds: [WATERMARK_ROOM],
        })) || [];
      const match = existing.find((m) => m.content?.text === sourceId);
      if (match?.id) {
        await adapter.removeMemory?.(match.id, WATERMARK_TABLE);
      }
      await adapter.createMemory?.(
        {
          content: { text: sourceId, watermark },
          roomId: WATERMARK_ROOM,
        },
        WATERMARK_TABLE,
      );
    },
    async loadAll(): Promise<Record<string, unknown>> {
      const memories =
        (await adapter.getMemoriesByRoomIds?.({
          tableName: WATERMARK_TABLE,
          roomIds: [WATERMARK_ROOM],
        })) || [];
      const result: Record<string, unknown> = {};
      for (const m of memories) {
        if (m.content?.text) {
          result[m.content.text] = m.content.watermark ?? null;
        }
      }
      return result;
    },
  };
}
