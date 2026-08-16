import Link from "next/link";
import type { Repo } from "@/lib/types";
import { CommercialScorePill } from "@/components/commercial-score";
import { formatCount, langColor, previewDescription, previewImage } from "@/lib/format";

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17l-6.2 3.3 1.6-6.8L2.2 8.9l6.9-.6L12 2z" />
    </svg>
  );
}

function ScaleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v18" />
      <path d="M3 7l4-4 4 4" />
      <path d="M3 7h8" />
      <path d="M13 17l4 4 4-4" />
      <path d="M13 17h8" />
    </svg>
  );
}

export function RepoCard({ repo, scorePill }: { repo: Repo; scorePill?: number }) {
  const description = previewDescription(repo.description, repo.readme_text);
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
            <StarIcon className="size-4 text-amber-500" />
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
              <ScaleIcon className="size-4" />
              <span>{repo.license}</span>
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
