import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface ObservationEntry {
  timestamp: number;
  category: string;
  sourceId: string;
  subject: string;
  richness: number;
  data?: unknown;
}

const AUTO_PRUNE_THRESHOLD = 10_000;
const DEFAULT_RETENTION_HOURS = 72;

export class ObservationLog {
  private readonly filePath: string;
  private readonly retentionMs: number;
  private entries: ObservationEntry[];
  private dirty = false;

  constructor(opts: { filePath: string; retentionHours?: number }) {
    this.filePath = opts.filePath;
    this.retentionMs = (opts.retentionHours ?? DEFAULT_RETENTION_HOURS) * 60 * 60 * 1000;
    this.entries = this.load();
  }

  add(entry: Omit<ObservationEntry, "timestamp">): void {
    const full: ObservationEntry = { timestamp: Date.now(), ...entry };
    this.entries.push(full);
    this.dirty = true;

    if (this.entries.length > AUTO_PRUNE_THRESHOLD) {
      this.prune();
    }
  }

  /** Flush pending changes to disk. Call after a batch of add() calls. */
  flush(): void {
    if (!this.dirty) return;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.entries));
    this.dirty = false;
  }

  /** Query entries, newest first. Filters by category and time range. */
  query(opts?: { category?: string; since?: number; limit?: number }): ObservationEntry[] {
    let result = [...this.entries].sort((a, b) => b.timestamp - a.timestamp); // newest first

    if (opts?.category) {
      result = result.filter((e) => e.category === opts.category);
    }

    if (opts?.since != null) {
      result = result.filter((e) => e.timestamp >= opts.since!);
    }

    if (opts?.limit != null) {
      result = result.slice(0, opts.limit);
    }

    return result;
  }

  prune(): number {
    const cutoff = Date.now() - this.retentionMs;
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.timestamp >= cutoff);
    const pruned = before - this.entries.length;

    if (pruned > 0) {
      this.dirty = true;
      this.flush();
    }

    return pruned;
  }

  size(): number {
    return this.entries.length;
  }

  private load(): ObservationEntry[] {
    try {
      if (!existsSync(this.filePath)) {
        return [];
      }
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed as ObservationEntry[];
    } catch {
      return [];
    }
  }
}
