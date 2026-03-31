import DatabaseConstructor from "better-sqlite3";

export type ColonyDatabase = InstanceType<typeof DatabaseConstructor>;

export const CURRENT_SCHEMA_VERSION = 1;

const BASE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS _meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  tx_hash TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  reply_to TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  text TEXT NOT NULL,
  raw_data TEXT NOT NULL,
  FOREIGN KEY (reply_to) REFERENCES posts(tx_hash)
);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author);
CREATE INDEX IF NOT EXISTS idx_posts_block ON posts(block_number);
CREATE INDEX IF NOT EXISTS idx_posts_reply_to ON posts(reply_to);

CREATE TABLE IF NOT EXISTS attestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_tx_hash TEXT NOT NULL,
  attestation_tx_hash TEXT NOT NULL,
  source_url TEXT,
  method TEXT NOT NULL CHECK(method IN ('DAHR', 'TLSN')),
  data_snapshot TEXT,
  attested_at TEXT,
  FOREIGN KEY (post_tx_hash) REFERENCES posts(tx_hash)
);
CREATE INDEX IF NOT EXISTS idx_attestations_post ON attestations(post_tx_hash);

CREATE TABLE IF NOT EXISTS claim_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL,
  unit TEXT NOT NULL,
  direction TEXT CHECK(direction IN ('up', 'down', 'stable') OR direction IS NULL),
  chain TEXT NOT NULL,
  address TEXT,
  market TEXT,
  entity_id TEXT,
  data_timestamp TEXT,
  post_tx_hash TEXT NOT NULL,
  author TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  attestation_tx_hash TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  verification_result TEXT,
  stale INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (post_tx_hash) REFERENCES posts(tx_hash)
);
CREATE INDEX IF NOT EXISTS idx_claims_dedup ON claim_ledger(subject, metric, claimed_at);
CREATE INDEX IF NOT EXISTS idx_claims_author ON claim_ledger(author);
CREATE INDEX IF NOT EXISTS idx_claims_post ON claim_ledger(post_tx_hash);

CREATE TABLE IF NOT EXISTS reaction_cache (
  post_tx_hash TEXT PRIMARY KEY,
  agrees INTEGER NOT NULL DEFAULT 0,
  disagrees INTEGER NOT NULL DEFAULT 0,
  tips_count INTEGER NOT NULL DEFAULT 0,
  tips_total_dem REAL NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  last_updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_response_cache (
  source_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  last_fetched_at TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_size INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_src_cache_fetched ON source_response_cache(source_id, last_fetched_at);

CREATE TABLE IF NOT EXISTS dead_letters (
  tx_hash TEXT PRIMARY KEY,
  raw_payload TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  error TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at TEXT NOT NULL
);
`;

type Migration = (db: ColonyDatabase) => void;

const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    db.exec(BASE_SCHEMA_SQL);
    ensureMetaValue(db, "cursor", "0");
  },
};

function getMetaValue(db: ColonyDatabase, key: string): string | null {
  const value = db.prepare(
    "SELECT value FROM _meta WHERE key = ?",
  ).pluck().get(key);

  return typeof value === "string" ? value : null;
}

function setMetaValue(db: ColonyDatabase, key: string, value: string): void {
  db.prepare(`
    INSERT INTO _meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function ensureMetaValue(db: ColonyDatabase, key: string, defaultValue: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO _meta (key, value) VALUES (?, ?)",
  ).run(key, defaultValue);
}

function ensureBaseSchema(db: ColonyDatabase): void {
  db.exec(BASE_SCHEMA_SQL);
  ensureMetaValue(db, "cursor", "0");
}

function runIntegrityCheck(db: ColonyDatabase): void {
  const result = String(db.pragma("integrity_check", { simple: true }));
  if (result.toLowerCase() !== "ok") {
    console.warn(`Colony cache integrity check failed: ${result}`);
  }
}

function applyMigrations(db: ColonyDatabase, currentVersion: number): void {
  if (currentVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported colony schema version ${currentVersion}; expected <= ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  for (let nextVersion = currentVersion + 1; nextVersion <= CURRENT_SCHEMA_VERSION; nextVersion += 1) {
    const migrate = MIGRATIONS[nextVersion];
    if (!migrate) {
      throw new Error(`Missing colony schema migration for version ${nextVersion}`);
    }
    migrate(db);
    setMetaValue(db, "schema_version", String(nextVersion));
  }
}

export function initColonyCache(dbPath: string): ColonyDatabase {
  const db = new DatabaseConstructor(dbPath);

  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  runIntegrityCheck(db);

  const initialize = db.transaction(() => {
    db.exec("CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

    const storedVersion = getMetaValue(db, "schema_version");
    if (storedVersion === null) {
      ensureBaseSchema(db);
      setMetaValue(db, "schema_version", String(CURRENT_SCHEMA_VERSION));
      return;
    }

    applyMigrations(db, Number.parseInt(storedVersion, 10));
    ensureBaseSchema(db);
  });

  initialize();

  return db;
}

export function getSchemaVersion(db: ColonyDatabase): number {
  const value = getMetaValue(db, "schema_version");
  return value === null ? 0 : Number.parseInt(value, 10);
}

export function getCursor(db: ColonyDatabase): number {
  const value = getMetaValue(db, "cursor");
  return value === null ? 0 : Number.parseInt(value, 10);
}

export function setCursor(db: ColonyDatabase, blockNumber: number): void {
  setMetaValue(db, "cursor", String(blockNumber));
}
