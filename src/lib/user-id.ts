"use client";

import { useEffect, useSyncExternalStore } from "react";

// Anonymous client-side user id. Generated once, persisted in localStorage.
// No auth — this is a single-user app. The id lets the server-side
// recommendation engine store feedback + interests per browser.
const UID_KEY = "foundry.uid.v1";

function getOrCreateUid(): string {
  if (typeof window === "undefined") return "anon";
  try {
    let uid = window.localStorage.getItem(UID_KEY);
    if (!uid) {
      uid = `u_${crypto.randomUUID()}`;
      window.localStorage.setItem(UID_KEY, uid);
    }
    return uid;
  } catch {
    return "anon";
  }
}

let cachedUid: string | null = null;
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  if (cachedUid === null && typeof window !== "undefined") {
    cachedUid = getOrCreateUid();
  }
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): string {
  if (cachedUid === null) {
    cachedUid = getOrCreateUid();
  }
  return cachedUid;
}

function getServerSnapshot(): string {
  return "anon";
}

export function useUserId(): string {
  const uid = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (cachedUid === null) cachedUid = getOrCreateUid();
    if (!listeners.size) {
      // ensure initialized on mount even if no subscriber yet
    }
  }, []);
  return uid;
}
