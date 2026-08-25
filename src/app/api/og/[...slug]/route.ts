import sharp from "sharp";
import { ogCacheGet, ogCacheSet, ogCacheDelete, ogCacheSweep } from "@/lib/og-cache";

export const dynamic = "force-dynamic";

const UPSTREAM = "https://opengraph.githubassets.com/1/";
// Images are content-stable per repo (the trimmed card changes only when
// GitHub re-renders it), so we cache aggressively: memory for the hot set,
// disk forever, and a long immutable browser cache. ?refresh=1 busts all.
const TTL = 60 * 60 * 24 * 7; // 7 days browser cache
const IMMUTABLE = `public, max-age=${TTL}, s-maxage=${TTL}, immutable`;

// In-process cache of trimmed images. Upstream (githubassets) is flaky under
// load, so memoizing the trimmed buffer per repo avoids re-hitting it on every
// reload once we have a good copy. The cache is BOUNDED: the path segment is
// attacker-controlled, so an unbounded Map would let arbitrary repo names grow
// resident memory without limit. Oldest entries are evicted (insertion order).
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, Buffer>();

function cacheSet(key: string, value: Buffer): void {
  if (cache.has(key)) cache.delete(key); // refresh recency
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// GitHub owner/repo names: alphanumerics, hyphens, underscores, dots. Anything
// else is junk that would only waste upstream fetches and cache entries.
const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

// When upstream can't resolve a repo (e.g. typo, private, rate-limited) it
// silently returns this generic GitHub Octocat image instead of the repo's
// real preview card. Detect it by its exact size so we never cache/serve it as
// if it were a real repo preview — that would pin a wrong image for the cache
// TTL and the server's lifetime. (Bytes of the canonical Octocat PNG.)
const GENERIC_OCTOCAT_BYTES = 506737;

/**
 * Proxies the GitHub OpenGraph preview image for a repo and trims its built-in
 * white padding (the opengraph mirror renders repos on a white canvas with
 * ~6% margins on every side). Returning the trimmed image lets the feed card
 * render a true edge-to-edge preview instead of a card floating in whitespace.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/og/[...slug]">) {
  const { slug } = await ctx.params;
  const fullName = slug.map(decodeURIComponent).join("/");

  if (!fullName || fullName.includes("..") || fullName.includes("//")) {
    return new Response("Bad repo path", { status: 400 });
  }

  // Build the upstream URL with a LITERAL slash between owner and repo.
  // opengraph.githubassets.com expects `1/{owner}/{repo}`; encoding the slash
  // as %2F (e.g. `encodeURIComponent("a/b")`) makes it treat the whole string
  // as one path segment, fail to resolve the repo, and fall back to GitHub's
  // generic Octocat image instead of the repo's real preview card.
  const [owner, repo, ...rest] = fullName.split("/");
  if (!owner || !repo || rest.length > 0 || !NAME_RE.test(owner) || !NAME_RE.test(repo)) {
    return new Response("Bad repo path", { status: 400 });
  }
  const upstreamUrl = `${UPSTREAM}${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // ?refresh=1 busts the in-memory cache for this repo so a stale/bad image
  // (e.g. a generic Octocat cached during a flaky moment) can be re-fetched
  // without restarting the server. Useful when debugging ingestion of new repos.
  const refresh = new URL(request.url).searchParams.has("refresh");
  if (!refresh) {
    const mem = cache.get(fullName);
    if (mem) {
      return new Response(new Uint8Array(mem), {
        headers: { "Content-Type": "image/png", "Cache-Control": IMMUTABLE, "X-Content-Type-Options": "nosniff" },
      });
    }
    const disk = ogCacheGet(fullName);
    if (disk) {
      cacheSet(fullName, disk); // warm memory for subsequent hits this run
      return new Response(new Uint8Array(disk), {
        headers: { "Content-Type": "image/png", "Cache-Control": IMMUTABLE, "X-Content-Type-Options": "nosniff" },
      });
    }
  } else {
    cache.delete(fullName);
    ogCacheDelete(fullName);
  }

  let upstream: ArrayBuffer | null = null;
  // Upstream (githubassets) is flaky under load in some environments; retry a
  // few times with a short backoff before falling back.
  for (let attempt = 0; attempt < 4 && upstream === null; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 150 * attempt));
    try {
      const res = await fetch(upstreamUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`upstream ${res.status}`);
      upstream = await res.arrayBuffer();
    } catch {
      /* retry */
    }
  }

  if (upstream === null) {
    // Couldn't reach the trim pipeline — redirect the browser straight to the
    // upstream image so the card still renders a preview (with padding) instead
    // of a broken image.
    return Response.redirect(upstreamUrl, 302);
  }

  // Reject the generic Octocat placeholder: never cache or serve it as a real
  // repo preview. Return a 404 so the card shows its fallback (placeholder)
  // rather than a misleading image pinned for the cache TTL.
  if (upstream.byteLength === GENERIC_OCTOCAT_BYTES) {
    return new Response("repo preview not available", { status: 404 });
  }

  try {
    const trimmed = await sharp(Buffer.from(upstream))
      // Trim the uniform white canvas the opengraph renderer adds around content.
      .trim({ background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toBuffer();

    cacheSet(fullName, trimmed);
    ogCacheSet(fullName, trimmed);
    if (Math.random() < 0.02) ogCacheSweep(); // amortized LRU sweep
    return new Response(new Uint8Array(trimmed), {
      headers: { "Content-Type": "image/png", "Cache-Control": IMMUTABLE, "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    // Sharp failed for some reason — fall back to the raw upstream bytes so the
    // card still shows something rather than a broken image.
    return new Response(new Uint8Array(upstream), {
      headers: { "Content-Type": "image/png", "Cache-Control": IMMUTABLE },
    });
  }
}
