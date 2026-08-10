import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheableResponsePlugin,
  ExpirationPlugin,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

// Runtime caching for the JSON API routes that back the feed. We use
// stale-while-revalidate so a cached response is served immediately (even
// while offline) and the cache is refreshed in the background when the
// network is available. Entries expire after a week / 50 entries so the
// cache can't grow unbounded across many searches.
const apiCache = new StaleWhileRevalidate({
  cacheName: "foundry-api",
  plugins: [
    new CacheableResponsePlugin({ statuses: [0, 200] }),
    new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 }),
  ],
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }) =>
        url.pathname === "/api/repos" || url.pathname === "/api/search",
      handler: apiCache,
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
