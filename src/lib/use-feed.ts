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
  /** "miss" = offline with no cached response available. */
  error: "offline-no-cache" | "network" | null;
};

const initialFeed: FeedState = { repos: [], loading: true, error: null };

/**
 * Fetches the repo feed from /api/repos. The service worker transparently
 * serves a cached copy first (stale-while-revalidate), so on reload while
 * offline this resolves with the previously-seen data. We surface a distinct
 * "offline-no-cache" error only when there's no cached entry to fall back on.
 */
export function useRepoFeed() {
  const online = useOnlineStatus();
  const [state, setState] = useState<FeedState>(initialFeed);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/repos", { cache: "no-store" });
      if (!res.ok && res.status === 0) throw new TypeError("network");
      const data = (await res.json()) as Repo[];
      setState({ repos: data, loading: false, error: null });
    } catch {
      setState(
        navigator.onLine
          ? { repos: [], loading: false, error: "network" }
          : { repos: [], loading: false, error: "offline-no-cache" },
      );
    }
  }, []);

  // Fetch on mount and whenever connectivity returns, so the feed picks up
  // fresh data after an offline episode. load() drives setState asynchronously;
  // the fetch-on-reconnect pattern is intentional.
  useEffect(() => {
    if (!online) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [online, load]);

  return { ...state, online, reload: load };
}
