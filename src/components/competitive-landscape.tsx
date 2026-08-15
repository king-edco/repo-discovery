import type { CompetitorMatch } from "@/lib/hybrid-search";

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

function MatchBadge({ matchedBy }: { matchedBy: CompetitorMatch["matchedBy"] }) {
  const meta = {
    both: { label: "Sémantique + lexical", cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
    vector: { label: "Sémantique", cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
    fts: { label: "Lexical", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  }[matchedBy];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function CompetitorCard({ competitor }: { competitor: CompetitorMatch }) {
  const similarityPct = Math.round(competitor.similarity * 100);
  const link = competitor.website || competitor.source_url;
  const host = (() => {
    if (!competitor.website) return null;
    try {
      return new URL(competitor.website).host.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();

  return (
    <article className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30">
      <div className="flex flex-wrap items-center gap-2">
        {competitor.category ? (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {competitor.category}
          </span>
        ) : null}
        <MatchBadge matchedBy={competitor.matchedBy} />
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary tabular-nums">
          {similarityPct}% proche
        </span>
      </div>

      <h3 className="line-clamp-1 text-sm font-semibold leading-snug text-foreground">
        {competitor.name}
      </h3>

      {competitor.description ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {competitor.description}
        </p>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {competitor.license ? (
          <span className="inline-flex items-center gap-1">
            <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v18" />
              <path d="M3 7l4-4 4 4" />
              <path d="M3 7h8" />
              <path d="M13 17l4 4 4-4" />
              <path d="M13 17h8" />
            </svg>
            {competitor.license}
          </span>
        ) : null}
        {competitor.language ? <span>{competitor.language}</span> : null}
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 font-medium text-primary transition-colors hover:text-primary/80"
          >
            {host ?? "Fiche Wikidata"}
            <ExternalLinkIcon />
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function CompetitiveLandscape({
  competitors,
}: {
  competitors: CompetitorMatch[];
}) {
  return (
    <section aria-labelledby="competitors-heading">
      <h2
        id="competitors-heading"
        className="mb-1 text-lg font-semibold tracking-tight text-foreground"
      >
        Paysage concurrentiel
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Produits commerciaux les plus proches, issus de Wikidata et trouvés par
        recherche sémantique sur l&apos;embedding du dépôt.
      </p>

      {competitors.length === 0 ? (
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
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M9 22V12h6v10" />
          </svg>
          <p className="text-sm font-medium text-foreground">
            Aucun concurrent détecté pour ce dépôt
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Lancez <code className="rounded bg-muted px-1 py-0.5">pnpm crawl-competitors</code>{" "}
            pour alimenter le corpus de produits, puis réessayez.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {competitors.map((c) => (
            <CompetitorCard key={c.id} competitor={c} />
          ))}
        </div>
      )}
    </section>
  );
}
