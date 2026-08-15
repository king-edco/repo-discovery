import type { CommercialScore } from "@/lib/hybrid-search";

// Visual gauge for the 0–100 commercial-potential score. The label + colour
// band make the score legible at a glance: a repo scoring 60+ reads as a real
// opportunity, <20 as marginal.

function band(score: number): { label: string; cls: string; ring: string } {
  if (score >= 70) {
    return {
      label: "Élevé",
      cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
      ring: "stroke-emerald-500",
    };
  }
  if (score >= 40) {
    return {
      label: "Modéré",
      cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
      ring: "stroke-amber-500",
    };
  }
  if (score >= 15) {
    return {
      label: "Faible",
      cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
      ring: "stroke-orange-500",
    };
  }
  return {
    label: "Marginal",
    cls: "bg-muted text-muted-foreground border-border",
    ring: "stroke-muted-foreground",
  };
}

function Gauge({ score, ring }: { score: number; ring: string }) {
  // Compact circular gauge: a 36px ring with a proportional arc.
  const r = 15;
  const c = 2 * Math.PI * r;
  const dash = (score / 100) * c;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="shrink-0" aria-hidden="true">
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        className="stroke-muted"
        strokeWidth="3"
      />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        className={ring}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 18 18)"
      />
      <text
        x="18"
        y="20"
        textAnchor="middle"
        className="fill-foreground text-[9px] font-bold tabular-nums"
      >
        {score}
      </text>
    </svg>
  );
}

/** Compact pill shown on repo cards in the feed (score above the threshold). */
export function CommercialScorePill({ score }: { score: number }) {
  const b = band(score);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${b.cls}`}
      title={`Potentiel commercial : ${score}/100 (${b.label})`}
    >
      <svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2v20" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
      {score}
    </span>
  );
}

/** Full breakdown card for the repo detail page. */
export function CommercialScoreCard({ score }: { score: CommercialScore }) {
  const b = band(score.score);
  return (
    <section aria-labelledby="commercial-score-heading">
      <h2
        id="commercial-score-heading"
        className="mb-4 text-lg font-semibold tracking-tight text-foreground"
      >
        Potentiel commercial
      </h2>
      <div className={`flex items-center gap-4 rounded-xl border p-5 ${b.cls}`}>
        <Gauge score={score.score} ring={b.ring} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{score.score}</span>
            <span className="text-sm opacity-80">/ 100 — {b.label}</span>
          </div>
          <p className="mt-1 text-xs opacity-80">
            {score.demandCount} signaux de demande · {score.competitorCount} concurrents · licence ×{score.licenseWeight.toFixed(1)}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">Demande</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {score.components.demand}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">Licence</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            ×{score.components.license.toFixed(1)}
          </dd>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <dt className="text-xs text-muted-foreground">Saturation</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            ×{score.components.saturation.toFixed(2)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
