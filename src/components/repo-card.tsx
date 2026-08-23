import Link from "next/link";
import { Star, Scale, ThumbsUp, ThumbsDown } from "lucide-react";
import type { Repo } from "@/lib/types";
import { CommercialScorePill } from "@/components/commercial-score";
import { formatCount, langColor, previewDescription, previewImage } from "@/lib/format";
import { useFeedback } from "@/lib/use-user";

export function RepoCard({ repo, scorePill }: { repo: Repo; scorePill?: number }) {
  const description = previewDescription(repo.description, repo.readme_text);
  const { liked, disliked, vote, removeVote } = useFeedback();
  const isLiked = liked.includes(repo.id);
  const isDisliked = disliked.includes(repo.id);

  const stopAndPrevent = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onLike = (e: React.MouseEvent) => {
    stopAndPrevent(e);
    if (isLiked) void removeVote(repo.id);
    else void vote(repo.id, "like");
  };
  const onDislike = (e: React.MouseEvent) => {
    stopAndPrevent(e);
    if (isDisliked) void removeVote(repo.id);
    else void vote(repo.id, "dislike");
  };

  return (
    <Link
      href={`/repos/${repo.id}`}
      className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative w-full overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewImage(repo.full_name)}
          alt={`Aperçu de ${repo.full_name}`}
          loading="lazy"
          className="h-auto w-full transition-transform duration-500 group-hover:scale-[1.03]"
        />
        {scorePill !== undefined ? (
          <div className="absolute right-2 top-2">
            <CommercialScorePill score={scorePill} />
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="space-y-1.5">
          <h3 className="line-clamp-1 text-lg font-semibold tracking-tight text-foreground group-hover:text-primary">
            {repo.name}
          </h3>
          <p className="text-xs text-muted-foreground">{repo.full_name}</p>
        </div>

        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {description || "Aucune description disponible."}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Star className="size-4 text-amber-500" />
            <span className="font-medium tabular-nums text-foreground">
              {formatCount(repo.stars)}
            </span>
          </span>
          {repo.language ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: langColor(repo.language) }}
                aria-hidden="true"
              />
              <span>{repo.language}</span>
            </span>
          ) : null}
          {repo.license ? (
            <span className="inline-flex items-center gap-1.5">
              <Scale className="size-4" />
              <span>{repo.license}</span>
            </span>
          ) : null}
        </div>

        {/* Quick feedback row — adapts the feed without leaving the card. */}
        <div className="flex items-center gap-1 border-t border-border pt-3">
          <button
            type="button"
            onClick={onLike}
            className={`inline-flex size-7 items-center justify-center rounded-full transition-colors ${
              isLiked
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            aria-label="Utile"
            aria-pressed={isLiked}
          >
            <ThumbsUp className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onDislike}
            className={`inline-flex size-7 items-center justify-center rounded-full transition-colors ${
              isDisliked
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            aria-label="Pas utile"
            aria-pressed={isDisliked}
          >
            <ThumbsDown className="size-3.5" />
          </button>
        </div>
      </div>
    </Link>
  );
}
