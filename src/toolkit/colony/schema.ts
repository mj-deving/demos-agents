import DatabaseConstructor from "better-sqlite3";

export type ColonyDatabase = InstanceType<typeof DatabaseConstructor>;

export const CURRENT_SCHEMA_VERSION = 7;

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
  tx_id INTEGER,
  from_ed25519 TEXT,
  nonce INTEGER,
  amount REAL,
  network_fee REAL,
  rpc_fee REAL,
  additional_fee REAL,
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
  chain_verified INTEGER DEFAULT 0,
  chain_method TEXT,
  chain_data TEXT,
  resolved_at TEXT,
  retry_count INTEGER DEFAULT 0,
  FOREIGN KEY (post_tx_hash) REFERENCES posts(tx_hash)
);
CREATE INDEX IF NOT EXISTS idx_attestations_post ON attestations(post_tx_hash);
CREATE INDEX IF NOT EXISTS idx_attestations_unresolved ON attestations(chain_verified) WHERE chain_verified = 0;
CREATE INDEX IF NOT EXISTS idx_attestations_post_verified ON attestations(post_tx_hash, chain_verified);

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

CREATE TABLE IF NOT EXISTS hive_reactions (
  tx_hash TEXT PRIMARY KEY,
  tx_id INTEGER,
  target_tx_hash TEXT NOT NULL,
  reaction_type TEXT NOT NULL CHECK(reaction_type IN ('agree', 'disagree')),
  author TEXT NOT NULL,
  from_ed25519 TEXT,
  block_number INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  nonce INTEGER,
  amount REAL,
  network_fee REAL,
  rpc_fee REAL,
  additional_fee REAL,
  raw_data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_hive_reactions_target ON hive_reactions(target_tx_hash);
CREATE INDEX IF NOT EXISTS idx_hive_reactions_author ON hive_reactions(author);
CREATE INDEX IF NOT EXISTS idx_hive_reactions_block ON hive_reactions(block_number);
`;

type Migration = (db: ColonyDatabase) => void;

/** Check whether a column exists on a table (for idempotent ALTER TABLE migrations). */
function hasColumn(db: ColonyDatabase, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    db.exec(BASE_SCHEMA_SQL);
    ensureMetaValue(db, "cursor", "0");
  },
  2: (db) => {
    // Add transaction-level metadata columns to posts (all SDK RawTransaction fields).
    // New columns are nullable — existing rows get NULL, which is correct (data unknown for old rows).
    db.exec(`
      ALTER TABLE posts ADD COLUMN tx_id INTEGER;
      ALTER TABLE posts ADD COLUMN from_ed25519 TEXT;
      ALTER TABLE posts ADD COLUMN nonce INTEGER;
      ALTER TABLE posts ADD COLUMN amount REAL;
      ALTER TABLE posts ADD COLUMN network_fee REAL;
      ALTER TABLE posts ADD COLUMN rpc_fee REAL;
      ALTER TABLE posts ADD COLUMN additional_fee REAL;
    `);

    // Individual HIVE reaction records (complements the aggregate reaction_cache).
    // Each agree/disagree on-chain transaction becomes one row here.
    db.exec(`
      CREATE TABLE IF NOT EXISTS hive_reactions (
        tx_hash TEXT PRIMARY KEY,
        tx_id INTEGER,
        target_tx_hash TEXT NOT NULL,
        reaction_type TEXT NOT NULL CHECK(reaction_type IN ('agree', 'disagree')),
        author TEXT NOT NULL,
        from_ed25519 TEXT,
        block_number INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        nonce INTEGER,
        amount REAL DEFAULT 0,
        network_fee REAL DEFAULT 0,
        rpc_fee REAL DEFAULT 0,
        additional_fee REAL DEFAULT 0,
        raw_data TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_hive_reactions_target ON hive_reactions(target_tx_hash);
      CREATE INDEX IF NOT EXISTS idx_hive_reactions_author ON hive_reactions(author);
      CREATE INDEX IF NOT EXISTS idx_hive_reactions_block ON hive_reactions(block_number);
    `);
  },
  3: (db) => {
    // FTS5 full-text search index on posts (text + tags).
    // content=posts syncs via triggers; content_rowid=rowid for JOIN.
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
        text, tags, content=posts, content_rowid=rowid
      );
    `);

    // Sync triggers with COALESCE for NULL safety
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
        INSERT INTO posts_fts(rowid, text, tags)
        VALUES (NEW.rowid, COALESCE(NEW.text, ''), COALESCE(NEW.tags, '[]'));
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
        INSERT INTO posts_fts(posts_fts, rowid, text, tags)
        VALUES ('delete', OLD.rowid, COALESCE(OLD.text, ''), COALESCE(OLD.tags, '[]'));
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
        INSERT INTO posts_fts(posts_fts, rowid, text, tags)
        VALUES ('delete', OLD.rowid, COALESCE(OLD.text, ''), COALESCE(OLD.tags, '[]'));
        INSERT INTO posts_fts(rowid, text, tags)
        VALUES (NEW.rowid, COALESCE(NEW.text, ''), COALESCE(NEW.tags, '[]'));
      END;
    `);

    // Rebuild index from existing data
    db.exec(`INSERT INTO posts_fts(posts_fts) VALUES('rebuild');`);
  },
  4: (db) => {
    // Phase 5.5: Colony Intelligence Layer — agent profiles and interaction tracking.
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_profiles (
        address TEXT PRIMARY KEY,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        post_count INTEGER DEFAULT 0,
        avg_agrees REAL DEFAULT 0,
        avg_disagrees REAL DEFAULT 0,
        topics_json TEXT DEFAULT '[]',
        trust_score REAL DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        our_tx_hash TEXT NOT NULL,
        their_tx_hash TEXT,
        their_address TEXT NOT NULL,
        interaction_type TEXT NOT NULL CHECK(interaction_type IN ('reply_to_us','we_replied','agreed','disagreed','tipped_us','we_tipped')),
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_interactions_address ON interactions(their_address);
      CREATE INDEX IF NOT EXISTS idx_interactions_type ON interactions(interaction_type);
    `);
  },
  5: (db) => {
    // Phase 8a: Proof ingestion — on-chain verification of other agents' attestations.
    // chain_verified tri-state: 0=unresolved, 1=verified on chain, -1=permanent failure
    // Idempotent: columns may already exist from BASE_SCHEMA_SQL on fresh DBs.
    for (const col of [
      ["chain_verified", "INTEGER DEFAULT 0"],
      ["chain_method", "TEXT"],
      ["chain_data", "TEXT"],
      ["resolved_at", "TEXT"],
    ]) {
      if (!hasColumn(db, "attestations", col[0])) {
        db.exec(`ALTER TABLE attestations ADD COLUMN ${col[0]} ${col[1]};`);
      }
    }
    // Partial index for efficient batch queries on unresolved attestations
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_attestations_unresolved
        ON attestations(chain_verified) WHERE chain_verified = 0;
    `);
  },
  6: (db) => {
    // Phase 8b: Retry tracking for proof ingestion + composite indexes for verified engagement.
    // Idempotent: column may already exist from BASE_SCHEMA_SQL on fresh DBs.
    if (!hasColumn(db, "attestations", "retry_count")) {
      db.exec(`ALTER TABLE attestations ADD COLUMN retry_count INTEGER DEFAULT 0;`);
    }
    // Composite index for efficient verified-count-by-author queries (Feature 3/4)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_attestations_post_verified
        ON attestations(post_tx_hash, chain_verified);
    `);
  },
  7: (db) => {
    // Phase 5.6: Vector embeddings for semantic search via sqlite-vec.
    // vec0 virtual table stores 384-dim float32 embeddings keyed by post rowid.
    // Requires sqlite-vec extension to be loaded before this migration runs.
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_posts USING vec0(embedding float[384]);
    `);
    // Tracking table: maps post rowid to vec_posts rowid and records embedding state.
    db.exec(`
      CREATE TABLE IF NOT EXISTS post_embeddings (
        post_rowid INTEGER PRIMARY KEY,
        vec_rowid INTEGER NOT NULL,
        embedded_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_post_embeddings_vec ON post_embeddings(vec_rowid);
    `);
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
  const db = new DatabaseConstructor(dbPath, { allowExtension: true });

  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  runIntegrityCheck(db);

  // Load sqlite-vec extension for vector search (Phase 5.6)
  try {
    db.enableLoadExtension(true);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqliteVec = require("sqlite-vec");
    sqliteVec.load(db);
    db.enableLoadExtension(false);
  } catch {
    // sqlite-vec not available — vector search will be disabled
  }

  const initialize = db.transaction(() => {
    db.exec("CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");

    const storedVersion = getMetaValue(db, "schema_version");
    if (storedVersion === null) {
      ensureBaseSchema(db);
      // BASE_SCHEMA_SQL covers migrations 1-2. Run any migration-only additions (3+).
      const BASE_SCHEMA_COVERS = 2;
      if (BASE_SCHEMA_COVERS < CURRENT_SCHEMA_VERSION) {
        setMetaValue(db, "schema_version", String(BASE_SCHEMA_COVERS));
        applyMigrations(db, BASE_SCHEMA_COVERS);
      } else {
        setMetaValue(db, "schema_version", String(CURRENT_SCHEMA_VERSION));
      }
      return;
    }

    applyMigrations(db, Number.parseInt(storedVersion, 10));
    // Idempotent: ensures any new tables/indexes from BASE_SCHEMA_SQL exist.
    // Safe because BASE_SCHEMA_SQL uses CREATE TABLE/INDEX IF NOT EXISTS.
    // Migrations that ALTER existing tables must not conflict with BASE_SCHEMA_SQL.
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
