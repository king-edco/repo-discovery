import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Star, Scale, TrendingUp, Calendar, ExternalLink, Lock } from "lucide-react";
import { getDb } from "@/db";
import { repos } from "@/db/schema";
import { RelatedDemandSignals } from "@/components/related-demand-signals";
import { CompetitiveLandscape } from "@/components/competitive-landscape";
import { CommercialScoreCard } from "@/components/commercial-score";
import { RepoEnrichment, ReadmeToggle } from "@/components/repo-enrichment";
import { FeedbackButtons } from "@/components/feedback-buttons";
import { SaveIdeaButton } from "@/components/save-idea-button";
import { computeCommercialScore, findCompetitors, findRelatedDemandSignals } from "@/lib/hybrid-search";
import { formatCount, langColor, parseTopics, previewImage } from "@/lib/format";
import { safeExternalUrl } from "@/lib/security";
import { getSession, isPro } from "@/lib/session";
import { getMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function BackLink() {
  return (
    <Link
      href="/feed"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Retour au feed
    </Link>
  );
}

// Upsell placeholder shown to free users in place of cross-data insights.
function LockedInsights() {
  const t = getMessages("en");
  return (
    <section className="rounded-2xl border border-dashed border-border bg-muted/40 p-8 text-center">
      <Lock className="mx-auto size-6 text-muted-foreground" />
      <h2 className="mt-3 text-lg font-semibold text-foreground">{t.locked.title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t.locked.body}</p>
      <Link
        href="/settings"
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background"
      >
        {t.locked.cta}
      </Link>
    </section>
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

  const session = await getSession();
  if (!session) redirect("/login");
  const pro = isPro(session.user as { plan?: string });

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

  // Cross-data insights (demand signals, competitors, commercial score) are
  // Pro-only — skip the KNN/BM25 work entirely for free users.
  const repoVec = pro && repo.embedding ? (JSON.parse(repo.embedding) as number[]) : null;
  const demandMatches = pro ? findRelatedDemandSignals(repo, repoVec) : [];
  const competitors = pro ? findCompetitors(repo, repoVec) : [];
  const commercialScore = pro ? computeCommercialScore(repo, repoVec) : null;

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
            <Star className="size-4 text-amber-500" />
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
              <Scale className="size-4 text-muted-foreground" />
              <span className="font-medium text-foreground">{repo.license}</span>
            </StatChip>
          ) : null}
          <StatChip>
            <Calendar className="size-4 text-muted-foreground" />
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

        {/* View on GitHub link + save idea */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href={safeExternalUrl(repo.url) ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-accent"
          >
            <ExternalLink className="size-4" />
            Voir sur GitHub
          </a>
          <SaveIdeaButton repoId={repo.id} />
        </div>

        <hr className="my-8 border-border" />

        {/* AI enrichment: plain summary + business pitch (cached, generated on demand) */}
        <section>
          <h2 className="mb-4 inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
            <TrendingUp className="size-5 text-primary" />
            En bref & opportunité
          </h2>
          <RepoEnrichment repoId={repo.id} />
        </section>

        <hr className="my-8 border-border" />

        {/* Feedback */}
        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight text-foreground">
            Votre avis
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Ce dépôt vous a-t-il été utile ? Votre feedback affine les recommandations.
          </p>
          <FeedbackButtons repoId={repo.id} />
        </section>

        <hr className="my-8 border-border" />

        {/* README (toggle: plain summary first, raw technical README on demand) */}
        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
            README
          </h2>
          <ReadmeToggle readmeText={repo.readme_text} />
        </section>

        <hr className="my-8 border-border" />

        {/* Cross-data insights: commercial score, competitors, demand signals */}
        {pro && commercialScore ? (
          <>
            <CommercialScoreCard score={commercialScore} />

            <hr className="my-8 border-border" />

            <CompetitiveLandscape competitors={competitors} />

            <hr className="my-8 border-border" />

            <RelatedDemandSignals signals={demandMatches} />
          </>
        ) : (
          <LockedInsights />
        )}
      </div>
    </main>
  );
}
