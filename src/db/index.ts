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
  `);

  // Add the embedding column to pre-existing repos tables (no-op if present).
  const repoCols = sqlite.prepare("PRAGMA table_info(repos)").all() as { name: string }[];
  if (!repoCols.some((c) => c.name === "embedding")) {
    sqlite.exec("ALTER TABLE repos ADD COLUMN embedding TEXT;");
  }
  // Add the embedding column to pre-existing demand_signals tables.
  const dsCols = sqlite.prepare("PRAGMA table_info(demand_signals)").all() as { name: string }[];
  if (!dsCols.some((c) => c.name === "embedding")) {
    sqlite.exec("ALTER TABLE demand_signals ADD COLUMN embedding TEXT;");
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
