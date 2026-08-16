import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { Markdown } from "@/components/markdown";
import { RelatedDemandSignals } from "@/components/related-demand-signals";
import { CompetitiveLandscape } from "@/components/competitive-landscape";
import { CommercialScoreCard } from "@/components/commercial-score";
import { computeCommercialScore, findCompetitors, findRelatedDemandSignals } from "@/lib/hybrid-search";
import { formatCount, langColor, parseTopics, previewImage } from "@/lib/format";

export const dynamic = "force-dynamic";

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </svg>
      Retour au feed
    </Link>
  );
}

function StatChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm">
      {children}
    </span>
  );
}

export default async function RepoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getDb();
  const repo = db
    .select({
      id: repos.id,
      name: repos.name,
      full_name: repos.full_name,
      description: repos.description,
      url: repos.url,
      stars: repos.stars,
      language: repos.language,
      license: repos.license,
      readme_text: repos.readme_text,
      topics: repos.topics,
      pushed_at: repos.pushed_at,
      ingested_at: repos.ingested_at,
      embedding: repos.embedding,
    })
    .from(repos)
    .where(eq(repos.id, id))
    .get();

  if (!repo) notFound();

  const topics = parseTopics(repo.topics);

  // Demand-signal matching via hybrid search: sqlite-vec KNN (cosine) + FTS5
  // BM25, fused by Reciprocal Rank Fusion. Captures both semantic neighbours
  // and exact-term lexical matches the embedding alone would smooth over.
  const repoVec = repo.embedding ? (JSON.parse(repo.embedding) as number[]) : null;
  const demandMatches = findRelatedDemandSignals(repo, repoVec);

  // Commercial competitors (Wikidata corpus) via the same hybrid search over
  // market_competitors. Embedding-driven, so it works for any repo without
  // category wiring.
  const competitors = findCompetitors(repo, repoVec);

  // On-demand 0–100 commercial-potential score folding demand intensity,
  // license weight, and competitive saturation. Not stored.
  const commercialScore = computeCommercialScore(repo, repoVec);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6">
        <BackLink />

        {/* Hero preview image */}
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-muted shadow-sm">
          <div className="relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewImage(repo.full_name)}
              alt={`Aperçu de ${repo.full_name}`}
              className="h-auto w-full"
            />
          </div>
        </div>

        {/* Title + description */}
        <header className="mt-7 space-y-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              {repo.name}
            </h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {repo.full_name}
            </p>
          </div>
          {repo.description ? (
            <p className="text-lg leading-relaxed text-muted-foreground">
              {repo.description}
            </p>
          ) : null}
        </header>

        {/* Stats as chips */}
        <section className="mt-5 flex flex-wrap gap-2">
          <StatChip>
            <svg className="size-4 text-amber-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17l-6.2 3.3 1.6-6.8L2.2 8.9l6.9-.6L12 2z" />
            </svg>
            <span className="font-medium tabular-nums text-foreground">
              {formatCount(repo.stars)}
            </span>
            <span className="text-muted-foreground">étoiles</span>
          </StatChip>
          {repo.language ? (
            <StatChip>
              <span
                className="size-3 rounded-full"
                style={{ backgroundColor: langColor(repo.language) }}
                aria-hidden="true"
              />
              <span className="font-medium text-foreground">{repo.language}</span>
            </StatChip>
          ) : null}
          {repo.license ? (
            <StatChip>
              <svg className="size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v18" />
                <path d="M3 7l4-4 4 4" />
                <path d="M3 7h8" />
                <path d="M13 17l4 4 4-4" />
                <path d="M13 17h8" />
              </svg>
              <span className="font-medium text-foreground">{repo.license}</span>
            </StatChip>
          ) : null}
          <StatChip>
            <svg className="size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3v18h18" />
              <path d="m7 14 3-3 3 3 5-5" />
            </svg>
            <span className="text-muted-foreground">Mis à jour</span>
            <time className="font-medium text-foreground" dateTime={repo.pushed_at}>
              {new Date(repo.pushed_at).toLocaleDateString("fr-FR", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </time>
          </StatChip>
        </section>

        {/* Topics */}
        {topics.length > 0 ? (
          <section className="mt-4 flex flex-wrap gap-2">
            {topics.map((t) => (
              <span
                key={t}
                className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
              >
                #{t}
              </span>
            ))}
          </section>
        ) : null}

        {/* View on GitHub link */}
        <div className="mt-6">
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.2-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.9 1.2 1.9 1.2 3.2 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
            </svg>
            Voir sur GitHub
          </a>
        </div>

        <hr className="my-8 border-border" />

        {/* README */}
        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
            README
          </h2>
          {repo.readme_text ? (
            <Markdown>{repo.readme_text}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucun README disponible pour ce dépôt.
            </p>
          )}
        </section>

        <hr className="my-8 border-border" />

        {/* Commercial potential score */}
        <CommercialScoreCard score={commercialScore} />

        <hr className="my-8 border-border" />

        {/* Competitive landscape */}
        <CompetitiveLandscape competitors={competitors} />

        <hr className="my-8 border-border" />

        {/* Demand-signal matching */}
        <RelatedDemandSignals signals={demandMatches} />
      </div>
    </main>
  );
}
