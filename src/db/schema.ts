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
