"use client";

import { useCallback, useEffect, useState } from "react";
import { useUserId } from "@/lib/user-id";

// Client-side store for interests + feedback, synced to the server (SQLite via
// the recommendation API). Interests and feedback also persist in localStorage
// so the client knows its state without a round-trip on every render.

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
  const userId = useUserId();
  const [state, setState] = useState<InterestState>({
    topics: typeof window !== "undefined" ? readCache<string[]>(INTEREST_CACHE_KEY, []) : [],
    loading: true,
  });

  // Load from server on mount (authoritative).
  useEffect(() => {
    if (userId === "anon") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/user/interests?userId=${encodeURIComponent(userId)}`);
        if (!res.ok) return;
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
  }, [userId]);

  const setInterests = useCallback(
    async (topics: string[]) => {
      setState({ topics, loading: false });
      writeCache(INTEREST_CACHE_KEY, topics);
      try {
        await fetch(`/api/user/interests?userId=${encodeURIComponent(userId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(topics),
        });
      } catch {
        /* server sync best-effort */
      }
    },
    [userId],
  );

  return { ...state, setInterests };
}

export function useFeedback() {
  const userId = useUserId();
  const [state, setState] = useState<FeedbackState>(() => {
    if (typeof window === "undefined") return { liked: [], disliked: [], loading: true };
    const cached = readCache<{ liked: string[]; disliked: string[] }>(FEEDBACK_CACHE_KEY, { liked: [], disliked: [] });
    return { liked: cached.liked, disliked: cached.disliked, loading: true };
  });

  useEffect(() => {
    if (userId === "anon") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/user/feedback?userId=${encodeURIComponent(userId)}`);
        if (!res.ok) return;
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
  }, [userId]);

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
        await fetch(`/api/user/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, repoId, feedback, reason }),
        });
      } catch {
        /* best-effort */
      }
    },
    [userId],
  );

  const removeVote = useCallback(
    async (repoId: string) => {
      setState((s) => {
        const liked = s.liked.filter((id) => id !== repoId);
        const disliked = s.disliked.filter((id) => id !== repoId);
        const next = { liked, disliked };
        writeCache(FEEDBACK_CACHE_KEY, next);
        return { ...next, loading: false };
      });
      try {
        await fetch(`/api/user/feedback?userId=${encodeURIComponent(userId)}&repoId=${encodeURIComponent(repoId)}`, {
          method: "DELETE",
        });
      } catch {
        /* best-effort */
      }
    },
    [userId],
  );

  return { ...state, vote, removeVote };
}
