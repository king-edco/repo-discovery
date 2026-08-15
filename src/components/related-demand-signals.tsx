import Link from "next/link";
import type { DemandSignalMatch } from "@/lib/demand-matching";

// Source metadata: label + accent classes for the badge. Each demand source
// gets a distinct color so the badge is recognizable at a glance.
const SOURCE_META: Record<
  string,
  { label: string; badge: string }
> = {
  hackernews: {
    label: "Hacker News",
    badge: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  },
  stackexchange: {
    label: "Stack Exchange",
    badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
  currents: {
    label: "Currents",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
};

function sourceMeta(source: string) {
  return SOURCE_META[source] ?? {
    label: source,
    badge: "bg-muted text-muted-foreground border-border",
  };
}

function SourceBadge({ source }: { source: string }) {
  const meta = sourceMeta(source);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}
    >
      {meta.label}
    </span>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      className="size-3.5 shrink-0 text-muted-foreground"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg
      className="size-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ScoreIcon() {
  return (
    <svg
      className="size-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3v18h18" />
      <path d="m7 14 3-3 3 3 5-5" />
    </svg>
  );
}

function DemandSignalCard({ signal }: { signal: DemandSignalMatch }) {
  const title = signal.title.trim();
  // Excerpt: prefer content, fall back to the (already-truncated) title.
  const excerpt = signal.content?.trim() || signal.title.trim();

  const host = (() => {
    if (!signal.url) return null;
    try {
      return new URL(signal.url).host;
    } catch {
      return null;
    }
  })();

  const similarityPct = Math.round(signal.similarity * 100);

  return (
    <article className="group flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30">
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={signal.source} />
        <span className="text-xs text-muted-foreground">
          #{signal.niche_keyword}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
          {similarityPct}% pertinent
        </span>
      </div>

      <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
        {title}
      </h3>

      {excerpt && excerpt !== title ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {excerpt}
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {signal.score > 0 ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <ScoreIcon />
            {signal.score}
          </span>
        ) : null}
        {signal.num_comments > 0 ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <CommentIcon />
            {signal.num_comments}
          </span>
        ) : null}
        {signal.url ? (
          <a
            href={signal.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 font-medium text-primary transition-colors hover:text-primary/80"
          >
            {host ?? "Source"}
            <ExternalLinkIcon />
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function RelatedDemandSignals({
  signals,
}: {
  signals: DemandSignalMatch[];
}) {
  return (
    <section aria-labelledby="demand-signals-heading">
      <h2
        id="demand-signals-heading"
        className="mb-1 text-lg font-semibold tracking-tight text-foreground"
      >
        Signaux de demande liés
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Discussions et actualités autour des sujets proches de ce dépôt,
        issues de Hacker News, Stack Exchange et Currents.
      </p>

      {signals.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-10 text-center">
          <svg
            className="size-6 text-muted-foreground/60"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <p className="text-sm font-medium text-foreground">
            Aucun signal de demande détecté pour ce repo
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Aucune discussion ou actualité ne dépasse le seuil de pertinence.
            Réessayez après avoir relancé l&apos;ingestion des signaux.
          </p>
          <Link
            href="/"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            Explorer d&apos;autres dépôts
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {signals.map((s) => (
            <DemandSignalCard key={s.id} signal={s} />
          ))}
        </div>
      )}
    </section>
  );
}
