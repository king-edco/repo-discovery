import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { schema } from "./schema";
import { createVecTables } from "@/lib/vector-db";
import { createFtsTables } from "@/lib/fts";

export type DB = BetterSQLite3Database<typeof schema>;

// The raw better-sqlite3 handle, kept in sync with the Drizzle wrapper. The
// vec0 / FTS5 virtual tables are raw-SQL constructs (Drizzle has no typed API
// for them), so the search-index modules call prepare()/exec() on this handle
// directly. Loading the sqlite-vec extension also requires the raw handle.
const DB_PATH = resolve(process.cwd(), "data/foundry.db");

declare global {
  var __foundryDb: DB | undefined;
  var __foundrySqlite: Database.Database | undefined;
}

/** Raw better-sqlite3 handle (for vec0 / FTS5 raw SQL + extension loading). */
export function getSqlite(): Database.Database {
  if (!globalThis.__foundrySqlite) {
    // createDb() assigns both globals, so one call initializes everything.
    createDb();
  }
  return globalThis.__foundrySqlite!;
}

function createDb(): DB {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  // Concurrent openers (e.g. Next.js page-data workers during `next build`)
  // would otherwise fail instantly with SQLITE_BUSY while another process
  // holds a write lock; wait briefly instead.
  sqlite.pragma("busy_timeout = 5000");
  globalThis.__foundrySqlite = sqlite;

  const db = drizzle(sqlite, { schema });
  // Assign the Drizzle wrapper global here (not in getDb) so that whichever
  // getter (getDb or getSqlite) initializes first, both globals stay in sync
  // and we never create two Database handles on the same file.
  globalThis.__foundryDb = db;

  // Simple migration: create the table if it does not exist.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      description TEXT,
      url TEXT NOT NULL,
      stars INTEGER NOT NULL,
      language TEXT,
      license TEXT,
      readme_text TEXT,
      embedding TEXT,
      topics TEXT NOT NULL,
      pushed_at TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS demand_signals (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      external_id TEXT NOT NULL,
      niche_keyword TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      url TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      num_comments INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      ingested_at TEXT NOT NULL,
      embedding TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_demand_signals_source ON demand_signals(source);
    CREATE INDEX IF NOT EXISTS idx_demand_signals_created_at ON demand_signals(created_at);

    CREATE TABLE IF NOT EXISTS demand_quota (
      source TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS market_competitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      source_url TEXT NOT NULL,
      website TEXT,
      license TEXT,
      language TEXT,
      crawled_at TEXT NOT NULL,
      embedding TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_market_competitors_category ON market_competitors(category);

    CREATE TABLE IF NOT EXISTS repo_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      feedback TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_repo_feedback_user_repo ON repo_feedback(user_id, repo_id);

    CREATE TABLE IF NOT EXISTS user_interests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_interests_user_topic ON user_interests(user_id, topic);

    CREATE TABLE IF NOT EXISTS user_profile (
      user_id TEXT PRIMARY KEY,
      embedding TEXT,
      liked_repo_ids TEXT NOT NULL DEFAULT '[]',
      disliked_repo_ids TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    -- Better Auth core tables (drizzle adapter, provider sqlite).
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      user_agent TEXT,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      issuer TEXT,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      access_token_expires_at INTEGER,
      refresh_token_expires_at INTEGER,
      scope TEXT,
      password TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      repo_id TEXT,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

    CREATE TABLE IF NOT EXISTS saved_ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_ideas_user_repo ON saved_ideas(user_id, repo_id);
  `);

  // Add the embedding column to pre-existing repos tables (no-op if present).
  const repoCols = sqlite.prepare("PRAGMA table_info(repos)").all() as { name: string }[];
  if (!repoCols.some((c) => c.name === "embedding")) {
    sqlite.exec("ALTER TABLE repos ADD COLUMN embedding TEXT;");
  }
  // Add the AI enrichment columns to repos (no-op if present).
  if (!repoCols.some((c) => c.name === "plain_summary")) {
    sqlite.exec("ALTER TABLE repos ADD COLUMN plain_summary TEXT;");
  }
  if (!repoCols.some((c) => c.name === "business_pitch")) {
    sqlite.exec("ALTER TABLE repos ADD COLUMN business_pitch TEXT;");
  }
  if (!repoCols.some((c) => c.name === "enrichment_source")) {
    sqlite.exec("ALTER TABLE repos ADD COLUMN enrichment_source TEXT;");
  }
  if (!repoCols.some((c) => c.name === "enriched_at")) {
    sqlite.exec("ALTER TABLE repos ADD COLUMN enriched_at TEXT;");
  }
  // Add the embedding column to pre-existing demand_signals tables.
  const dsCols = sqlite.prepare("PRAGMA table_info(demand_signals)").all() as { name: string }[];
  if (!dsCols.some((c) => c.name === "embedding")) {
    sqlite.exec("ALTER TABLE demand_signals ADD COLUMN embedding TEXT;");
  }
  // Add the plan column to pre-existing user tables (no-op if present).
  const userCols = sqlite.prepare("PRAGMA table_info(user)").all() as { name: string }[];
  if (userCols.length > 0 && !userCols.some((c) => c.name === "plan")) {
    sqlite.exec("ALTER TABLE user ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';");
  }
  // Add the issuer column to pre-existing account tables (Better Auth 1.7).
  const accountCols = sqlite.prepare("PRAGMA table_info(account)").all() as { name: string }[];
  if (accountCols.length > 0 && !accountCols.some((c) => c.name === "issuer")) {
    sqlite.exec("ALTER TABLE account ADD COLUMN issuer TEXT;");
  }

  // Vector + full-text search indexes (rebuildable projections of the
  // canonical data above). vec0 needs the sqlite-vec extension; FTS5 ships
  // with better-sqlite3. Both are no-ops if the tables already exist.
  createVecTables();
  createFtsTables();

  return db;
}

export function getDb(): DB {
  if (!globalThis.__foundryDb) {
    createDb();
  }
  return globalThis.__foundryDb!;
}
