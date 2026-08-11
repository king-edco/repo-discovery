"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useSettings, usePrefersDark, resolveDark } from "@/lib/settings";

function SettingsIcon() {
  return (
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    </svg>
  );
}

/**
 * Unregister every service worker and drop all Cache Storage entries, forcing a
 * clean resync of the offline cache (this includes the service-worker cache of
 * /api/og preview images). Then reloads the feed so the browser re-fetches OG
 * images fresh. Reports progress in the button label so the user gets feedback
 * that something happened (it's otherwise instant).
 */
function useClearOfflineCache() {
  const [state, setState] = useState<"idle" | "clearing" | "done" | "error">("idle");

  const clear = useCallback(async () => {
    setState("clearing");
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
      setState("done");
      setTimeout(() => setState("idle"), 1500);
      // Reload with a cache-busting query so the browser re-fetches OG preview
      // images instead of serving the HTTP-cached (possibly stale) copies.
      const url = new URL(window.location.href);
      url.searchParams.set("nocache", String(Date.now()));
      url.pathname = "/";
      window.location.href = url.toString();
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2500);
    }
  }, []);

  return { state, clear };
}

function ThemeToggle() {
  const { settings, update } = useSettings();
  const systemDark = usePrefersDark();
  const isDark = resolveDark(settings.theme, systemDark);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-xl bg-muted text-foreground">
          {isDark ? <MoonIcon /> : <SunIcon />}
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">Thème</p>
          <p className="text-xs text-muted-foreground">
            {settings.theme === "system" ? "Système" : settings.theme === "dark" ? "Sombre" : "Clair"}
          </p>
        </div>
      </div>
      <div role="group" aria-label="Choix du thème" className="flex rounded-full bg-muted p-1 text-sm">
        {(["light", "system", "dark"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => update({ theme: t })}
            aria-pressed={settings.theme === t}
            className={`rounded-full px-3 py-1.5 font-medium transition-colors ${
              settings.theme === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "light" ? "Clair" : t === "dark" ? "Sombre" : "Système"}
          </button>
        ))}
      </div>
    </div>
  );
}

function MinStarsInput() {
  const { settings, update } = useSettings();

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-xl bg-muted text-foreground">
          <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17l-6.2 3.3 1.6-6.8L2.2 8.9l6.9-.6L12 2z" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">Étoiles minimum</p>
          <p className="text-xs text-muted-foreground">Masquer les dépôts avec moins d’étoiles.</p>
        </div>
      </div>
      <input
        type="number"
        min={0}
        step={1000}
        inputMode="numeric"
        value={settings.minStars}
        onChange={(e) => update({ minStars: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
        aria-label="Nombre minimum d'étoiles"
        className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-right text-sm tabular-nums text-foreground shadow-sm focus:border-ring focus:outline-none focus:ring-4 focus:ring-ring/15"
      />
    </div>
  );
}

function ClearCacheButton() {
  const { state, clear } = useClearOfflineCache();
  const label =
    state === "clearing" ? "Vidage…" : state === "done" ? "Cache vidé ✓" : state === "error" ? "Échec du vidage" : "Vider le cache hors-ligne";

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-xl bg-muted text-foreground">
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">Cache hors-ligne</p>
          <p className="text-xs text-muted-foreground">Force une resynchronisation propre.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={state === "clearing"}
        className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto w-full max-w-2xl px-4 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex size-8 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Retour"
            >
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 19-7-7 7-7" />
                <path d="M19 12H5" />
              </svg>
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
              <SettingsIcon />
              Réglages
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-20 pt-6">
        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-card p-5">
            <ThemeToggle />
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <MinStarsInput />
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <ClearCacheButton />
          </div>
          <p className="px-1 pt-2 text-xs text-muted-foreground">
            Ces réglages sont stockés localement dans votre navigateur. Le seuil d’étoiles s’applique au feed et à la recherche.
          </p>
        </div>
      </main>
    </div>
  );
}
