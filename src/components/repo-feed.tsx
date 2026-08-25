"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Search, Settings as SettingsIcon, RefreshCw, Wifi, WifiOff, SlidersHorizontal } from "lucide-react";
import { RepoCard } from "@/components/repo-card";
import { NotificationBell } from "@/components/notification-bell";
import { useOnlineStatus, useRepoFeed, type FeedSort } from "@/lib/use-feed";
import { useSettings } from "@/lib/settings";
import { useInterests, useFeedback } from "@/lib/use-user";
import { OnboardingFlow } from "@/components/onboarding";
import { getMessages } from "@/lib/i18n";
import type { Repo } from "@/lib/types";

const t = getMessages("en");

type SearchState =
  | { mode: "idle" }
  | { mode: "loading" }
  | { mode: "results"; repos: Repo[]; count: number }
  | { mode: "offline-no-cache" }
  | { mode: "error" };

// Score threshold for showing the commercial-potential pill on a card. Below
// this the score is marginal and the badge would add noise without signal.
const SCORE_PILL_THRESHOLD = 30;

const ONBOARDING_KEY = "foundry.onboarded.v1";

function ConnectionBadge({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        online
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}
    >
      {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
      {online ? t.feed.online : t.feed.offline}
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
  const options: { value: FeedSort; label: string }[] = [
    { value: "recommend", label: t.feed.forYou },
    { value: "stars", label: t.feed.stars },
    { value: "score", label: t.feed.potential },
  ];
  return (
    <div className="inline-flex rounded-full border border-input bg-card p-0.5 text-xs">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onSort(opt.value)}
          className={`rounded-full px-3 py-1 font-medium transition-colors ${
            sort === opt.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const FEED_SCROLL_KEY = "foundry.feed.scroll.v1";
const VALID_SORTS: FeedSort[] = ["recommend", "stars", "score"];

export function RepoFeed() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <FeedInner />
    </Suspense>
  );
}

function FeedInner() {
  const { settings } = useSettings();
  const minStars = settings.minStars;

  // Sort lives in the URL so navigating to a repo and BACK restores the tab
  // you were on (instead of resetting to "For you"), and the view is
  // shareable/bookmarkable.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rawSort = searchParams.get("sort") as FeedSort | null;
  const sort: FeedSort = rawSort && VALID_SORTS.includes(rawSort) ? rawSort : "recommend";
  const setSort = useCallback(
    (s: FeedSort) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("sort", s);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const { topics: interests } = useInterests();
  const { liked, disliked } = useFeedback();
  const { repos, loading, loadingMore, hasMore, error, online, reload, loadMore } =
    useRepoFeed(minStars, sort, interests, liked, disliked);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ mode: "idle" });
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Onboarding gate: show the interest-selection flow on first visit. We read
  // localStorage in the lazy initializer so there's no effect-driven setState.
  const [onboarded, setOnboarded] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(ONBOARDING_KEY) === "1";
    } catch {
      return true;
    }
  });
  const finishOnboarding = () => {
    try { window.localStorage.setItem(ONBOARDING_KEY, "1"); } catch { /* ignore */ }
    setOnboarded(true);
    void reload();
  };

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

  // Scroll restore: save position when navigating away to a repo detail,
  // restore it when the user comes back — so "back" returns to the exact spot
  // in the feed, not the top.
  useEffect(() => {
    const saved = sessionStorage.getItem(FEED_SCROLL_KEY);
    if (saved !== null) {
      sessionStorage.removeItem(FEED_SCROLL_KEY);
      const y = Number(saved);
      if (Number.isFinite(y) && y > 0) {
        // Wait a tick for the feed to render before scrolling.
        requestAnimationFrame(() => window.scrollTo(0, y));
      }
    }
    const save = () => {
      try {
        sessionStorage.setItem(FEED_SCROLL_KEY, String(window.scrollY));
      } catch {
        /* ignore */
      }
    };
    // Save on any repo-card click (the Link navigation) and on pagehide.
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('a[href^="/repos/"]')) save();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", save);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", save);
    };
  }, []);

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

  if (!onboarded) {
    return <OnboardingFlow onDone={finishOnboarding} />;
  }

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
        interestCount={interests.length}
      />

      <main className="mx-auto w-full max-w-screen-2xl px-4 pb-20 pt-6 sm:px-5">
        {sort === "recommend" && interests.length === 0 && !showingSearch ? (
          <RecommendEmptyState />
        ) : null}

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
                    {loadingMore ? t.common.loading : t.feed.scrollForMore}
                  </span>
                </div>
              ) : !showingSearch ? (
                <p className="pt-10 text-center text-sm text-muted-foreground">
                  {t.feed.endOfFeed}
                </p>
              ) : null}
            </>
          ) : showingSearch && search.mode !== "loading" ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {t.feed.noResults} “{query.trim()}”.
            </p>
          ) : !showingSearch && error === "offline-no-cache" ? null : null
        ) : null}
      </main>
    </div>
  );
}

function RecommendEmptyState() {
  return (
    <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
      <SlidersHorizontal className="mx-auto mb-3 size-6 text-primary" />
      <p className="text-sm font-medium text-foreground">
        {t.feed.personalizeTitle}
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {t.feed.personalizeBody}
      </p>
      <Link
        href="/settings"
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <SettingsIcon className="size-4" />
        {t.feed.personalizeCta}
      </Link>
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
  interestCount,
}: {
  query: string;
  onQuery: (v: string) => void;
  online: boolean;
  loading: boolean;
  onReload: () => void;
  sort: FeedSort;
  onSort: (s: FeedSort) => void;
  interestCount: number;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-screen-2xl px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h1 className="min-w-0 shrink-0 text-xl font-bold tracking-tight text-foreground">
            Foundry
          </h1>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <SortToggle sort={sort} onSort={onSort} />
            <NotificationBell />
            <Link
              href="/settings"
              className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t.nav.settings}
            >
              <SettingsIcon className="size-4" />
              {interestCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 inline-flex size-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">
                  {interestCount}
                </span>
              ) : null}
            </Link>
            <button
              type="button"
              onClick={onReload}
              disabled={loading}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              aria-label={t.common.loading}
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <ConnectionBadge online={online} />
          </div>
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t.feed.searchPlaceholder}
            className="w-full rounded-full border border-input bg-card py-2.5 pl-11 pr-4 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-4 focus:ring-ring/15"
            aria-label={t.feed.searchPlaceholder}
          />
        </div>
      </div>
    </header>
  );
}

function OfflineNotice({ hasCache }: { hasCache: boolean }) {
  return hasCache ? (
    <div className="mb-6 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
      <WifiOff className="size-4 shrink-0" />
      {t.feed.offlineCached}
    </div>
  ) : (
    <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center">
      <p className="font-medium text-destructive">{t.feed.offline}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t.feed.offlineNoCache}
      </p>
    </div>
  );
}

/** Re-export so layout/page can import a single entry. */
export { useOnlineStatus };
