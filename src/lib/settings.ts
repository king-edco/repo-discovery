"use client";

import { useCallback, useEffect, useSyncExternalStore, useState } from "react";

/**
 * Local settings for the single-user app. Persisted in localStorage so they
 * survive reloads without needing a backend table. Keep this minimal — only
 * preferences that genuinely change the product behaviour day-to-day.
 */
export type Settings = {
  /** "light" | "dark" | "system" — resolved to a concrete class on <html>. */
  theme: "light" | "dark" | "system";
  /** Hide repos with fewer than this many stars in the feed and search. */
  minStars: number;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  minStars: 0,
};

const KEY = "foundry.settings.v1";

// --- Module-scoped singleton store -------------------------------------------------
// Multiple hooks (the global ThemeApplier + the Settings page UI) must react to
// the same settings, so we keep one in-memory copy and broadcast changes to
// every subscriber. Writes also hit localStorage for persistence + cross-tab
// sync via the `storage` event.

let memory: Settings = DEFAULT_SETTINGS;
let memoryLoaded = false;
const listeners = new Set<() => void>();

function loadFromStorage(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : "system",
      minStars: Number.isFinite(parsed.minStars) && parsed.minStars! >= 0 ? parsed.minStars! : 0,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function persist(next: Settings): void {
  memory = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }
  for (const l of listeners) l();
}

function subscribe(callback: () => void): () => void {
  // Lazy-load on first subscriber so server render stays on defaults.
  if (!memoryLoaded && typeof window !== "undefined") {
    memory = loadFromStorage();
    memoryLoaded = true;
    window.addEventListener("storage", onStorage);
  }
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function onStorage(e: StorageEvent): void {
  if (e.key === KEY) {
    memory = loadFromStorage();
    for (const l of listeners) l();
  }
}

function getSnapshot(): Settings {
  return memory;
}

function getServerSnapshot(): Settings {
  return DEFAULT_SETTINGS;
}

/**
 * Returns the full settings object + an updater. Backed by a module-scoped
 * singleton store so every component (the global theme applier, the Settings
 * page, the feed) shares one source of truth and updates stay in sync.
 */
export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const hydrated = useHydrated();

  const update = useCallback((patch: Partial<Settings>) => {
    persist({ ...memory, ...patch });
  }, []);

  return { settings, update, hydrated };
}

function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);
  return hydrated;
}

/**
 * Returns whether the resolved theme is dark, given the user's preference and
 * the OS prefers-color-scheme.
 */
export function resolveDark(theme: Settings["theme"], systemDark: boolean): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return systemDark;
}

/**
 * Tracks the OS-level prefers-color-scheme so "system" theme resolves live.
 */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(mq.matches);
    function onChange(e: MediaQueryListEvent) {
      setDark(e.matches);
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

/**
 * Applies the resolved theme to <html> and keeps it in sync with the user
 * preference and the OS scheme. Returns the current settings + updater so the
 * caller can render the toggle UI.
 */
export function useTheme() {
  const { settings, update, hydrated } = useSettings();
  const systemDark = usePrefersDark();
  const isDark = resolveDark(settings.theme, systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
  }, [isDark]);

  return { theme: settings.theme, setTheme: (t: Settings["theme"]) => update({ theme: t }), isDark, hydrated };
}
