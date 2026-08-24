"use client";

import { useCallback, useEffect, useState } from "react";

// Client-side store for interests + feedback, synced to the server (SQLite via
// the API). The user identity comes from the auth session — no userId is ever
// sent by the client. localStorage caches keep the UI instant between renders.

type InterestState = { topics: string[]; loading: boolean };
type FeedbackState = { liked: string[]; disliked: string[]; loading: boolean };

const INTEREST_CACHE_KEY = "foundry.interests.v1";
const FEEDBACK_CACHE_KEY = "foundry.feedback.v1";

function readCache<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeCache<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function useInterests() {
  const [state, setState] = useState<InterestState>({
    topics: typeof window !== "undefined" ? readCache<string[]>(INTEREST_CACHE_KEY, []) : [],
    loading: true,
  });

  // Load from server on mount (authoritative).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user/interests");
        if (!res.ok) {
          if (!cancelled) setState((s) => ({ ...s, loading: false }));
          return;
        }
        const data = (await res.json()) as string[];
        if (cancelled) return;
        setState({ topics: data, loading: false });
        writeCache(INTEREST_CACHE_KEY, data);
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setInterests = useCallback(async (topics: string[]) => {
    setState({ topics, loading: false });
    writeCache(INTEREST_CACHE_KEY, topics);
    try {
      await fetch("/api/user/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(topics),
      });
    } catch {
      /* server sync best-effort */
    }
  }, []);

  return { ...state, setInterests };
}

export function useFeedback() {
  const [state, setState] = useState<FeedbackState>(() => {
    if (typeof window === "undefined") return { liked: [], disliked: [], loading: true };
    const cached = readCache<{ liked: string[]; disliked: string[] }>(FEEDBACK_CACHE_KEY, { liked: [], disliked: [] });
    return { liked: cached.liked, disliked: cached.disliked, loading: true };
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user/feedback");
        if (!res.ok) {
          if (!cancelled) setState((s) => ({ ...s, loading: false }));
          return;
        }
        const data = (await res.json()) as { liked: string[]; disliked: string[] };
        if (cancelled) return;
        setState({ ...data, loading: false });
        writeCache(FEEDBACK_CACHE_KEY, data);
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const vote = useCallback(
    async (repoId: string, feedback: "like" | "dislike", reason?: string) => {
      setState((s) => {
        const liked = new Set(s.liked);
        const disliked = new Set(s.disliked);
        if (feedback === "like") { liked.add(repoId); disliked.delete(repoId); }
        else { disliked.add(repoId); liked.delete(repoId); }
        const next = { liked: [...liked], disliked: [...disliked] };
        writeCache(FEEDBACK_CACHE_KEY, next);
        return { ...next, loading: false };
      });
      try {
        await fetch("/api/user/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoId, feedback, reason }),
        });
      } catch {
        /* best-effort */
      }
    },
    [],
  );

  const removeVote = useCallback(async (repoId: string) => {
    setState((s) => {
      const liked = s.liked.filter((id) => id !== repoId);
      const disliked = s.disliked.filter((id) => id !== repoId);
      const next = { liked, disliked };
      writeCache(FEEDBACK_CACHE_KEY, next);
      return { ...next, loading: false };
    });
    try {
      await fetch(`/api/user/feedback?repoId=${encodeURIComponent(repoId)}`, {
        method: "DELETE",
      });
    } catch {
      /* best-effort */
    }
  }, []);

  return { ...state, vote, removeVote };
}
