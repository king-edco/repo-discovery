import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { schema } from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

const DB_PATH = resolve(process.cwd(), "data/foundry.db");

declare global {
  var __foundryDb: DB | undefined;
}

function createDb(): DB {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");

  const db = drizzle(sqlite, { schema });

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

  return db;
}

export function getDb(): DB {
  if (!globalThis.__foundryDb) {
    globalThis.__foundryDb = createDb();
  }
  return globalThis.__foundryDb;
}
