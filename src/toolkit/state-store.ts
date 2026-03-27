/**
 * FileStateStore — default StateStore implementation using file persistence.
 *
 * Uses proper-lockfile for exclusive file locking on all read-modify-write
 * operations. State files stored in ~/.config/demos/ by default.
 *
 * Locking is cooperative — external processes modifying state files
 * directly bypass all guards.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import lockfile from "proper-lockfile";
import type { StateStore, Unlock } from "./types.js";

const DEFAULT_STATE_DIR = resolve(homedir(), ".config", "demos");

export class FileStateStore implements StateStore {
  private readonly dir: string;
  private dirEnsured = false;

  constructor(dir?: string) {
    this.dir = dir ?? DEFAULT_STATE_DIR;
  }

  async get(key: string): Promise<string | null> {
    const path = this.keyPath(key);
    try {
      return await readFile(path, "utf-8");
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.ensureDir();
    const path = this.keyPath(key);
    await writeFile(path, value, "utf-8");
  }

  async lock(key: string, ttlMs: number): Promise<Unlock> {
    await this.ensureDir();
    const path = this.keyPath(key);

    // Ensure the file exists (proper-lockfile requires it).
    // Use append mode: creates if missing, no-op if exists — single syscall, TOCTOU-safe.
    const { open: openFile } = await import("node:fs/promises");
    const fh = await openFile(path, "a");
    await fh.close();

    const release = await lockfile.lock(path, {
      stale: ttlMs,
      retries: {
        retries: 10,
        minTimeout: 50,
        maxTimeout: 1000,
        factor: 2,
      },
    });

    return async () => {
      await release();
    };
  }

  private keyPath(key: string): string {
    // Sanitize key to safe filename
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return resolve(this.dir, `state-${safe}.json`);
  }

  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    await mkdir(this.dir, { recursive: true });
    this.dirEnsured = true;
  }
}
