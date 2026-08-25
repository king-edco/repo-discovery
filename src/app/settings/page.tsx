"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Settings as SettingsIcon, Sun, Moon, Star, Trash2, Tag, Check } from "lucide-react";
import { useSettings, usePrefersDark, resolveDark } from "@/lib/settings";
import { useInterests } from "@/lib/use-user";
import { TOPICS } from "@/lib/topics";
import { AccountSettings, FeedbackSettings } from "@/components/account-settings";

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
      url.pathname = "/feed";
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
          {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
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
          <Star className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">Étoiles minimum</p>
          <p className="text-xs text-muted-foreground">Masquer les dépôts avec moins d&apos;étoiles.</p>
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

function InterestsPicker() {
  const { topics: selected, setInterests } = useInterests();
  const selectedSet = new Set(selected);

  const toggle = (topic: string) => {
    const next = new Set(selectedSet);
    if (next.has(topic)) next.delete(topic);
    else next.add(topic);
    void setInterests([...next]);
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-xl bg-muted text-foreground">
          <Tag className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">Centres d&apos;intérêt</p>
          <p className="text-xs text-muted-foreground">
            Personnalisez le feed « Pour vous ». {selected.length} sélectionné{selected.length > 1 ? "s" : ""}.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {TOPICS.map((topic) => {
          const active = selectedSet.has(topic);
          return (
            <button
              key={topic}
              type="button"
              onClick={() => toggle(topic)}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              }`}
              aria-pressed={active}
            >
              {active ? <Check className="size-3" /> : null}
              {topic}
            </button>
          );
        })}
      </div>
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
          <Trash2 className="size-4" />
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
              href="/feed"
              className="inline-flex size-8 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Retour"
            >
              <ArrowLeft className="size-4" />
            </Link>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
              <SettingsIcon className="size-5" />
              Réglages
            </h1>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pb-20 pt-6">
        <div className="space-y-3">
          <AccountSettings />
          <FeedbackSettings />
          <div className="rounded-2xl border border-border bg-card p-5">
            <InterestsPicker />
          </div>
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
            Ces réglages sont stockés localement dans votre navigateur. Le seuil d&apos;étoiles s&apos;applique au feed et à la recherche.
          </p>
        </div>
      </main>
    </div>
  );
}
