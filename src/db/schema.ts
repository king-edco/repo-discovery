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
  // --- AI enrichment (generated on demand, cached) ---
  // Plain-language summary for non-technical readers. Heuristic by default;
  // upgraded via Gemini when GEMINI_API_KEY is set. Null until generated.
  plain_summary: text("plain_summary"),
  // Business idea pitch tied to the repo + its demand/competitor context.
  // Heuristic by default; Gemini-upgraded when available.
  business_pitch: text("business_pitch"),
  // "heuristic" | "gemini" — records which generator produced the enrichment
  // so the UI can show a provenance badge and re-generate if a key is added.
  enrichment_source: text("enrichment_source"),
  enriched_at: text("enriched_at"),
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

// --- Commercial competitors ------------------------------------------------
// Software products pulled from Wikidata (SPARQL). Each row is one product;
// the `wikidata_id` is the dedup key (Q-id). The `embedding` column holds the
// canonical 384-dim e5 passage embedding (JSON stringified float[]) shared
// with repos/demand_signals so a repo's KNN neighbours over `competitor_vectors`
// are its closest commercial competitors — no category wiring required.

export const marketCompetitors = sqliteTable("market_competitors", {
  // Wikidata Q-id, e.g. "Q305936" (VS Code). Stable across re-crawls.
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  // Free-text category label from the Wikidata class the product is an
  // instance of (e.g. "software", "integrated development environment").
  // Stored for display + as embedding input, not as a join key.
  category: text("category"),
  // Canonical Wikidata entity URL (https://www.wikidata.org/wiki/Q...).
  source_url: text("source_url").notNull(),
  // Official website when Wikidata has one (P856); nullable.
  website: text("website"),
  // License label from Wikidata (P275) when available, e.g. "MIT License",
  // "proprietary license". Used by the commercial-score license weight.
  license: text("license"),
  // Primary programming language label (P277) when available.
  language: text("language"),
  crawled_at: text("crawled_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  // 384-dim e5 embedding (JSON stringified float[]), passage prefix.
  embedding: text("embedding"),
});

export type MarketCompetitor = typeof marketCompetitors.$inferSelect;
export type NewMarketCompetitor = typeof marketCompetitors.$inferInsert;

// --- User feedback (likes / dislikes) --------------------------------------
// One row per (user_id, repo_id) vote. user_id is a client-generated anonymous
// id stored in localStorage (single-user app, no auth). The reason is the
// free-text or picked reason captured after a vote. Embedding of the repo is
// captured at vote time so the recommendation engine can boost/demote
// semantically similar repos without re-reading the repos table.

export const FEEDBACK_TYPES = ["like", "dislike"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const repoFeedback = sqliteTable("repo_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: text("user_id").notNull(),
  repo_id: text("repo_id").notNull(),
  feedback: text("feedback").notNull(), // "like" | "dislike"
  reason: text("reason"),
  created_at: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type RepoFeedback = typeof repoFeedback.$inferSelect;
export type NewRepoFeedback = typeof repoFeedback.$inferInsert;

// --- User interests --------------------------------------------------------
// One row per (user_id, topic). Populated during onboarding or from the
// settings page. The recommendation engine uses these to score repos by
// tag/topic overlap and to build a centroid interest embedding.

export const userInterests = sqliteTable("user_interests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: text("user_id").notNull(),
  topic: text("topic").notNull(),
  created_at: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type UserInterest = typeof userInterests.$inferSelect;
export type NewUserInterest = typeof userInterests.$inferInsert;

// --- User interest embedding (centroid) ------------------------------------
// The aggregate interest vector: the mean of the e5 embeddings of the user's
// liked repos + interests. One row per user_id. Recomputed when interests or
// feedback change. Used as the KNN query vector for the recommendation feed.

export const userProfile = sqliteTable("user_profile", {
  user_id: text("user_id").primaryKey(),
  embedding: text("embedding"), // JSON float[]
  liked_repo_ids: text("liked_repo_ids").notNull().default("[]"), // JSON string[]
  disliked_repo_ids: text("disliked_repo_ids").notNull().default("[]"),
  updated_at: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type UserProfile = typeof userProfile.$inferSelect;
export type NewUserProfile = typeof userProfile.$inferInsert;

// Tables-only schema object (excludes non-table exports like DEMAND_SOURCES)
// so the Drizzle DB type matches the config passed to `drizzle()`.
export const schema = {
  repos,
  demandSignals,
  demandQuota,
  marketCompetitors,
  repoFeedback,
  userInterests,
  userProfile,
};
