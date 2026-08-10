"use client";

import { useCallback, useEffect, useState } from "react";
import { RepoCard } from "@/components/repo-card";
import { useOnlineStatus, useRepoFeed } from "@/lib/use-feed";
import type { Repo } from "@/lib/types";

type SearchState =
  | { mode: "idle" }
  | { mode: "loading" }
  | { mode: "results"; repos: Repo[]; count: number }
  | { mode: "offline-no-cache" }
  | { mode: "error" };

function ConnectionBadge({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
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

export function RepoFeed() {
  const { repos, loading, error, online, reload } = useRepoFeed();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ mode: "idle" });
  // Debounced search: fires when the user stops typing for 350ms.
  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSearch({ mode: "idle" });
      return;
    }
    setSearch({ mode: "loading" });
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
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
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void runSearch(query), 350);
    return () => clearTimeout(handle);
  }, [query, runSearch]);

  const showingSearch =
    search.mode === "results" || search.mode === "loading" || query.trim() !== "";
  const list =
    search.mode === "results" ? search.repos : repos;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Foundry
          </h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reload}
              disabled={loading}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
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
        <p className="mt-1 text-sm text-muted-foreground">
          Découverte de dépôts GitHub hors-ligne. Les données consultées
          restent disponibles sans connexion.
        </p>
      </header>

      <div className="mb-6">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher (ex: jeu d'échecs, game engine…)"
            className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </div>

      {!online && !loading && !showingSearch ? (
        <OfflineNotice hasCache={error !== "offline-no-cache"} />
      ) : null}

      {showingSearch && search.mode === "offline-no-cache" ? (
        <OfflineNotice hasCache={false} />
      ) : null}

      {loading && !showingSearch ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : null}

      {showingSearch && search.mode === "loading" ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Recherche…
        </p>
      ) : null}

      {!loading || showingSearch ? (
        list.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {list.slice(0, 60).map((repo) => (
              <RepoCard key={repo.id} repo={repo} />
            ))}
          </div>
        ) : !showingSearch && error === "offline-no-cache" ? null : showingSearch &&
          search.mode !== "loading" ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Aucun résultat.
          </p>
        ) : null
      ) : null}
    </div>
  );
}

function OfflineNotice({ hasCache }: { hasCache: boolean }) {
  return hasCache ? (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
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
    <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-center">
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
