"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RepoCard } from "@/components/repo-card";
import { useOnlineStatus, useRepoFeed, type FeedSort } from "@/lib/use-feed";
import { useSettings } from "@/lib/settings";
import type { Repo } from "@/lib/types";

type SearchState =
  | { mode: "idle" }
  | { mode: "loading" }
  | { mode: "results"; repos: Repo[]; count: number }
  | { mode: "offline-no-cache" }
  | { mode: "error" };

// Score threshold for showing the commercial-potential pill on a card. Below
// this the score is marginal and the badge would add noise without signal.
const SCORE_PILL_THRESHOLD = 30;

function ConnectionBadge({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        online
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}
    >
      <span
        className={`size-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {online ? "En ligne" : "Hors-ligne"}
    </span>
  );
}

function SortToggle({
  sort,
  onSort,
}: {
  sort: FeedSort;
  onSort: (s: FeedSort) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-input bg-card p-0.5 text-xs">
      <button
        type="button"
        onClick={() => onSort("stars")}
        className={`rounded-full px-3 py-1 font-medium transition-colors ${
          sort === "stars" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Étoiles
      </button>
      <button
        type="button"
        onClick={() => onSort("score")}
        className={`rounded-full px-3 py-1 font-medium transition-colors ${
          sort === "score" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Potentiel commercial
      </button>
    </div>
  );
}

export function RepoFeed() {
  const { settings } = useSettings();
  const minStars = settings.minStars;
  const [sort, setSort] = useState<FeedSort>("stars");
  const { repos, loading, loadingMore, hasMore, error, online, reload, loadMore } = useRepoFeed(minStars, sort);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ mode: "idle" });
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Debounced search: fires when the user stops typing for 350ms.
  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearch({ mode: "idle" });
      return;
    }
    setSearch({ mode: "loading" });
    try {
      const url = new URL("/api/search", location.origin);
      url.searchParams.set("q", trimmed);
      if (minStars > 0) url.searchParams.set("minStars", String(minStars));
      const res = await fetch(url.toString());
      if (!res.ok && res.status === 0) throw new TypeError("network");
      const data = (await res.json()) as { count: number; results: Repo[] };
      setSearch({ mode: "results", repos: data.results, count: data.count });
    } catch {
      if (!navigator.onLine) {
        setSearch({ mode: "offline-no-cache" });
      } else {
        setSearch({ mode: "error" });
      }
    }
  }, [minStars]);

  useEffect(() => {
    const handle = setTimeout(() => void runSearch(query), 350);
    return () => clearTimeout(handle);
  }, [query, runSearch]);

  const showingSearch =
    search.mode === "results" || search.mode === "loading" || query.trim() !== "";
  const list = search.mode === "results" ? search.repos : repos;

  // Infinite scroll via IntersectionObserver on a sentinel element. The feed
  // is now server-paginated, so hitting the sentinel fetches the next page.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || showingSearch) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, showingSearch]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <StickyHeader
        query={query}
        onQuery={setQuery}
        online={online}
        loading={loading}
        onReload={reload}
        sort={sort}
        onSort={setSort}
      />

      <main className="mx-auto w-full max-w-screen-2xl px-4 pb-20 pt-6 sm:px-5">
        {!online && !loading && !showingSearch ? (
          <OfflineNotice hasCache={error !== "offline-no-cache"} />
        ) : null}

        {showingSearch && search.mode === "offline-no-cache" ? (
          <OfflineNotice hasCache={false} />
        ) : null}

        {loading && !showingSearch ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="aspect-[1.91/1] w-full animate-pulse bg-muted" />
                <div className="space-y-2 p-5">
                  <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {showingSearch && search.mode === "loading" ? (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card"
              >
                <div className="aspect-[1.91/1] w-full animate-pulse bg-muted" />
                <div className="space-y-2 p-5">
                  <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {!loading || showingSearch ? (
          list.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((repo) => (
                  <RepoCard
                    key={repo.id}
                    repo={repo}
                    scorePill={
                      repo.commercialScore !== undefined && repo.commercialScore >= SCORE_PILL_THRESHOLD
                        ? repo.commercialScore
                        : undefined
                    }
                  />
                ))}
              </div>
              {!showingSearch && hasMore ? (
                <div ref={sentinelRef} className="py-8 text-center">
                  <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    {loadingMore ? (
                          <span className="size-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
                    ) : null}
                    {loadingMore ? "Chargement…" : "Faire défiler pour plus"}
                  </span>
                </div>
              ) : !showingSearch ? (
                <p className="pt-10 text-center text-sm text-muted-foreground">
                  Vous êtes à la fin du feed.
                </p>
              ) : null}
            </>
          ) : showingSearch && search.mode !== "loading" ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Aucun résultat pour « {query.trim()} ».
            </p>
          ) : !showingSearch && error === "offline-no-cache" ? null : null
        ) : null}
      </main>
    </div>
  );
}

function StickyHeader({
  query,
  onQuery,
  online,
  loading,
  onReload,
  sort,
  onSort,
}: {
  query: string;
  onQuery: (v: string) => void;
  online: boolean;
  loading: boolean;
  onReload: () => void;
  sort: FeedSort;
  onSort: (s: FeedSort) => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Foundry
          </h1>
          <div className="flex items-center gap-2">
            <SortToggle sort={sort} onSort={onSort} />
            <Link
              href="/settings"
              className="inline-flex size-8 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Réglages"
            >
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Link>
            <button
              type="button"
              onClick={onReload}
              disabled={loading}
              className="inline-flex size-8 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              aria-label="Recharger"
            >
              <svg
                className={`size-4 ${loading ? "animate-spin" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
            <ConnectionBadge online={online} />
          </div>
        </div>

        <div className="relative mt-3">
          <svg
            className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Rechercher un dépôt…"
            className="w-full rounded-full border border-input bg-card py-2.5 pl-11 pr-4 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-4 focus:ring-ring/15"
            aria-label="Rechercher un dépôt"
          />
        </div>
      </div>
    </header>
  );
}

function OfflineNotice({ hasCache }: { hasCache: boolean }) {
  return hasCache ? (
    <div className="mb-6 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
      <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M1 1l22 22" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      Hors-ligne — affichage des données en cache. La connexion rétablie, les
      données se rafraîchiront.
    </div>
  ) : (
    <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center">
      <p className="font-medium text-destructive">Hors-ligne</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Aucune donnée en cache pour cette requête. Reconnectez-vous pour
        charger le feed.
      </p>
    </div>
  );
}

/** Re-export so layout/page can import a single entry. */
export { useOnlineStatus };
