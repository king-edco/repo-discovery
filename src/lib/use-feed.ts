"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Repo } from "@/lib/types";

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

function getServerOnlineSnapshot(): boolean {
  return true;
}

/**
 * Tracks the browser's online/offline status reactively. The SWR service
 * worker serves cached API responses while offline, but the UI also needs to
 * know the connection state to (a) show an offline badge and (b) distinguish a
 * genuine "no cached data" miss from a transient network blip.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getServerOnlineSnapshot,
  );
}

type FeedState = {
  repos: Repo[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** "miss" = offline with no cached response available. */
  error: "offline-no-cache" | "network" | null;
};

const initialFeed: FeedState = {
  repos: [],
  loading: true,
  loadingMore: false,
  hasMore: true,
  error: null,
};

const PAGE_SIZE = 24;

export type FeedSort = "stars" | "score";

/**
 * Fetches the paginated repo feed from /api/repos. The service worker
 * transparently serves a cached copy first (stale-while-revalidate), so on
 * reload while offline this resolves with the previously-seen data.
 *
 * `minStars` filters repos below the threshold; `sort` ("stars" | "score")
 * re-fetches the first page when changed. Subsequent pages append via
 * `loadMore()` until `hasMore` is false. Page size is fixed server-side.
 */
export function useRepoFeed(minStars: number = 0, sort: FeedSort = "stars") {
  const online = useOnlineStatus();
  const [state, setState] = useState<FeedState>(initialFeed);

  const load = useCallback(async () => {
    try {
      const url = new URL("/api/repos", location.origin);
      if (minStars > 0) url.searchParams.set("minStars", String(minStars));
      if (sort !== "stars") url.searchParams.set("sort", sort);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", "0");
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok && res.status === 0) throw new TypeError("network");
      const data = (await res.json()) as Repo[];
      setState({
        repos: data,
        loading: false,
        loadingMore: false,
        hasMore: data.length === PAGE_SIZE,
        error: null,
      });
    } catch {
      setState(
        navigator.onLine
          ? { repos: [], loading: false, loadingMore: false, hasMore: false, error: "network" }
          : { repos: [], loading: false, loadingMore: false, hasMore: false, error: "offline-no-cache" },
      );
    }
  }, [minStars, sort]);

  const loadMore = useCallback(async () => {
    setState((s) => {
      if (s.loadingMore || !s.hasMore) return s;
      void (async () => {
        try {
          const url = new URL("/api/repos", location.origin);
          if (minStars > 0) url.searchParams.set("minStars", String(minStars));
          if (sort !== "stars") url.searchParams.set("sort", sort);
          url.searchParams.set("limit", String(PAGE_SIZE));
          url.searchParams.set("offset", String(state.repos.length));
          const res = await fetch(url.toString(), { cache: "no-store" });
          if (!res.ok && res.status === 0) throw new TypeError("network");
          const data = (await res.json()) as Repo[];
          setState((s2) => ({
            ...s2,
            repos: [...s2.repos, ...data],
            loadingMore: false,
            hasMore: data.length === PAGE_SIZE,
          }));
        } catch {
          setState((s2) => ({ ...s2, loadingMore: false }));
        }
      })();
      return { ...s, loadingMore: true };
    });
  }, [minStars, sort, state.repos.length]);

  // Fetch on mount, on reconnect, and when the sort/filter changes.
  useEffect(() => {
    if (!online) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [online, load]);

  return { ...state, online, reload: load, loadMore };
}
