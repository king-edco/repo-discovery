import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const repos = sqliteTable("repos", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  full_name: text("full_name").notNull(),
  description: text("description"),
  url: text("url").notNull(),
  stars: integer("stars").notNull(),
  language: text("language"),
  license: text("license"),
  readme_text: text("readme_text"),
  // 384-dim embedding (multilingual-e5-small via Transformers.js, q8 ONNX),
  // stored as a JSON stringified float[] (e.g. "[0.0123, -0.0456, ...]"). Null
  // until embeddings are generated. E5 uses a "passage: " prefix for indexed
  // documents; see src/lib/embeddings.ts.
  embedding: text("embedding"),
  topics: text("topics").notNull(),
  pushed_at: text("pushed_at").notNull(),
  ingested_at: text("ingested_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type Repo = typeof repos.$inferSelect;
export type NewRepo = typeof repos.$inferInsert;

// --- Demand signals -------------------------------------------------------
// Posts/questions/news gathered from external "demand" APIs (Hacker News,
// Stack Exchange, Currents). Each row is one item, deduplicated by the
// (source, external_id) pair — the same item returned across runs or niches
// upserts in place rather than duplicating.

export const DEMAND_SOURCES = ["hackernews", "stackexchange", "currents"] as const;
export type DemandSource = (typeof DEMAND_SOURCES)[number];

export const demandSignals = sqliteTable("demand_signals", {
  // Composite key: "<source>:<external_id>" (e.g. "hackernews:9271246").
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  external_id: text("external_id").notNull(),
  niche_keyword: text("niche_keyword").notNull(),
  title: text("title").notNull(),
  content: text("content"),
  url: text("url"),
  score: integer("score").default(0).notNull(),
  num_comments: integer("num_comments").default(0).notNull(),
  created_at: text("created_at").notNull(),
  ingested_at: text("ingested_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  // 384-dim embedding (multilingual-e5-small, E5 "passage: " prefix),
  // stored as a JSON stringified float[]. Null until generated.
  embedding: text("embedding"),
});

export type DemandSignal = typeof demandSignals.$inferSelect;
export type NewDemandSignal = typeof demandSignals.$inferInsert;

// --- Currents API daily quota tracker -------------------------------------
// The Currents free tier is strictly limited to 250 requests/day (verified
// in the dashboard — NOT the 1000/day claimed elsewhere online). This row
// is the persisted, reset-at-midnight counter that enforces the cap across
// multiple runs of the ingestion script within the same UTC day.

export const demandQuota = sqliteTable("demand_quota", {
  // Always "currents" — one row per monitored source.
  source: text("source").primaryKey(),
  date: text("date").notNull(), // UTC YYYY-MM-DD
  count: integer("count").default(0).notNull(),
  updated_at: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type DemandQuota = typeof demandQuota.$inferSelect;
export type NewDemandQuota = typeof demandQuota.$inferInsert;

// Tables-only schema object (excludes non-table exports like DEMAND_SOURCES)
// so the Drizzle DB type matches the config passed to `drizzle()`.
export const schema = { repos, demandSignals, demandQuota };
