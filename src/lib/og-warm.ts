import { ogCacheGet, ogCacheSet } from "@/lib/og-cache";

// Background pre-warming of repo OG preview images during ingestion. The feed
// should never wait on githubassets at render time — by fetching + trimming +
// disk-caching each repo's image as it's ingested, the first feed render for a
// repo serves the preview from disk instantly.
//
// Bounded concurrency (a small worker pool) so a large ingestion run doesn't
// open hundreds of sockets at once. Already-cached images are skipped, so
// re-ingestion is cheap.

const UPSTREAM = "https://opengraph.githubassets.com/1/";
const CONCURRENCY = 4;
const GENERIC_OCTOCAT_BYTES = 506737;

const queue: string[] = [];
const queued = new Set<string>();
let active = 0;

async function fetchAndCache(fullName: string): Promise<void> {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) return;
  const url = `${UPSTREAM}${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === GENERIC_OCTOCAT_BYTES) return; // don't cache placeholders
    const sharp = (await import("sharp")).default;
    const trimmed = await sharp(buf)
      .trim({ background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();
    ogCacheSet(fullName, trimmed);
  } catch {
    /* best-effort pre-warm; the OG route falls back to live fetch on miss */
  }
}

async function pump(): Promise<void> {
  while (active < CONCURRENCY && queue.length > 0) {
    const name = queue.shift()!;
    queued.delete(name);
    active++;
    void fetchAndCache(name).finally(() => {
      active--;
      void pump();
    });
  }
}

/** Queue a repo's OG image for background pre-warming. Idempotent per name. */
export function prewarmOgImage(fullName: string): void {
  if (queued.has(fullName)) return;
  if (ogCacheGet(fullName)) return; // already cached
  queued.add(fullName);
  queue.push(fullName);
  void pump();
}
