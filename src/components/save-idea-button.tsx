"use client";

import { useCallback, useEffect, useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { getMessages } from "@/lib/i18n";

const t = getMessages("en");

// Saves/unsaves a repo to the user's "Saved ideas" list. State is loaded once
// from the server; toggling is optimistic with server sync best-effort.

export function SaveIdeaButton({ repoId }: { repoId: string }) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/saved-ideas");
        if (!res.ok) return;
        const data = (await res.json()) as { ideas: Array<{ repoId: string }> };
        if (!cancelled) setSaved(data.ideas.some((i) => i.repoId === repoId));
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const next = !saved;
    setSaved(next);
    try {
      const res = await fetch("/api/saved-ideas", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId }),
      });
      if (!res.ok) setSaved(!next); // roll back on failure
    } catch {
      setSaved(!next);
    } finally {
      setBusy(false);
    }
  }, [busy, saved, repoId]);

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={saved}
      className={`inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition-colors ${
        saved
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent"
      }`}
    >
      {saved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
      {saved ? t.repo.savedIdea : t.repo.saveIdea}
    </button>
  );
}
