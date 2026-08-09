import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { repos } from "./schema";

export type DB = BetterSQLite3Database<typeof import("./schema")>;

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

  const db = drizzle(sqlite, { schema: { repos } });

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
  `);

  // Add the embedding column to pre-existing tables (no-op if present).
  const cols = sqlite.prepare("PRAGMA table_info(repos)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "embedding")) {
    sqlite.exec("ALTER TABLE repos ADD COLUMN embedding TEXT;");
  }

  return db;
}

export function getDb(): DB {
  if (!globalThis.__foundryDb) {
    globalThis.__foundryDb = createDb();
  }
  return globalThis.__foundryDb;
}
