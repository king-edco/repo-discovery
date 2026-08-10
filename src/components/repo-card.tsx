"use client";

import type { Repo } from "@/lib/types";

function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function parseTopics(topics: string): string[] {
  try {
    const parsed = JSON.parse(topics);
    return Array.isArray(parsed) ? parsed.slice(0, 4) : [];
  } catch {
    return [];
  }
}

export function RepoCard({ repo }: { repo: Repo }) {
  const topics = parseTopics(repo.topics);
  return (
    <a
      href={repo.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-sm font-medium text-foreground group-hover:text-primary">
            {repo.full_name}
          </h3>
          {repo.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {repo.description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1 text-amber-500">
          <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17l-6.2 3.3 1.6-6.8L2.2 8.9l6.9-.6L12 2z" />
          </svg>
          <span className="text-xs font-medium tabular-nums">
            {formatStars(repo.stars)}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {repo.language ? (
          <span className="rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
            {repo.language}
          </span>
        ) : null}
        {topics.map((t) => (
          <span
            key={t}
            className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
          >
            {t}
          </span>
        ))}
      </div>
    </a>
  );
}
