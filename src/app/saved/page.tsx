"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bookmark, Trash2 } from "lucide-react";
import { RepoCard } from "@/components/repo-card";
import type { Repo } from "@/lib/types";

type SavedIdea = {
  repoId: string;
  note: string | null;
  savedAt: string;
  repo: Repo;
};

export default function SavedIdeasPage() {
  const [ideas, setIdeas] = useState<SavedIdea[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/saved-ideas", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { ideas: SavedIdea[] };
        setIdeas(data.ideas);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(repoId: string) {
    setIdeas((prev) => prev.filter((i) => i.repoId !== repoId));
    try {
      await fetch("/api/saved-ideas", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId }),
      });
    } catch {
      void load(); // resync on failure
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-3 px-4 py-4">
          <Link
            href="/feed"
            className="inline-flex size-8 items-center justify-center rounded-full border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Back"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
            <Bookmark className="size-5" />
            Saved ideas
          </h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-screen-2xl px-4 pb-20 pt-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : ideas.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            Nothing saved yet. Tap “Save idea” on a repo to keep it here.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {ideas.map((idea) => (
              <div key={idea.repoId} className="relative min-w-0">
                <RepoCard repo={idea.repo} />
                <button
                  type="button"
                  onClick={() => void remove(idea.repoId)}
                  aria-label="Remove"
                  className="absolute right-3 top-3 z-10 inline-flex size-8 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur transition-colors hover:text-red-600"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
