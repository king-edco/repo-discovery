// Backfill OG preview images for the EXISTING corpus into the disk cache.
// Ingestion pre-warms new repos, but repos already in the DB have cold caches
// until their first live view. Run once: `pnpm og-backfill`. Uses the shared
// pre-warm queue (bounded 4-wide); safe to re-run (skips cached).

import { getDb } from "../db";
import { repos } from "../db/schema";
import { prewarmOgImage } from "../lib/og-warm";
import { ogCacheGet, OG_CACHE_MAX_FILES } from "../lib/og-cache";

function main() {
  const db = getDb();
  const rows = db.select({ full_name: repos.full_name }).from(repos).all();
  let queued = 0;
  for (const r of rows) {
    if (!r.full_name || ogCacheGet(r.full_name)) continue;
    prewarmOgImage(r.full_name);
    queued++;
    if (queued >= OG_CACHE_MAX_FILES) break; // respect the cache cap
  }
  console.log(`og-backfill: queued ${queued} repo previews (${rows.length} total in DB).`);
  console.log("Pre-warm runs in the background; the feed stops cold-fetching once done.");
}

main();
