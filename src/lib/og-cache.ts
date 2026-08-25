import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

// Persistent on-disk cache for trimmed repo OG preview images.
//
// Why disk, not just memory: the in-memory Map dies on every server restart,
// so after each deploy the first view of every repo re-hit GitHub (1–3s each)
// and scrolling the feed stalled on dozens of concurrent cold fetches. A disk
// cache survives restarts, so a preview is fetched from upstream exactly once
// per repo and served instantly forever after (until evicted).
//
// Layout: one PNG per repo, filename = sha256(fullName).hex + ".png", under
// data/og-cache/. A tiny LRU sweep keeps the directory bounded. The DB lives
// on the same volume, so this adds no external infra.

const CACHE_DIR = path.join(process.cwd(), "data", "og-cache");
const MAX_FILES = 5000; // ~5000 repos × ~60–130KB ≈ <1GB worst case

function ensureDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function keyFor(fullName: string): string {
  return createHash("sha256").update(fullName).digest("hex") + ".png";
}

export function ogCacheGet(fullName: string): Buffer | null {
  try {
    const p = path.join(CACHE_DIR, keyFor(fullName));
    if (!existsSync(p)) return null;
    return readFileSync(p);
  } catch {
    return null;
  }
}

export function ogCacheSet(fullName: string, data: Buffer): void {
  try {
    ensureDir();
    writeFileSync(path.join(CACHE_DIR, keyFor(fullName)), data);
  } catch {
    /* disk full / read-only — memory cache still covers this run */
  }
}

export function ogCacheDelete(fullName: string): void {
  try {
    const p = path.join(CACHE_DIR, keyFor(fullName));
    if (existsSync(p)) unlinkSync(p);
  } catch {
    /* ignore */
  }
}

// Evict least-recently-modified files once we exceed MAX_FILES. Called after
// writes on a coarse probability so the sweep cost is amortized.
export function ogCacheSweep(maxFiles: number = MAX_FILES): void {
  try {
    ensureDir();
    const files = readdirSync(CACHE_DIR);
    if (files.length <= maxFiles) return;
    const withMtime = files
      .map((f) => {
        try {
          return { f, mtime: statSync(path.join(CACHE_DIR, f)).mtimeMs };
        } catch {
          return { f, mtime: 0 };
        }
      })
      .sort((a, b) => a.mtime - b.mtime);
    const toDelete = withMtime.slice(0, files.length - maxFiles);
    for (const { f } of toDelete) {
      try {
        unlinkSync(path.join(CACHE_DIR, f));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export const OG_CACHE_MAX_FILES = MAX_FILES;
