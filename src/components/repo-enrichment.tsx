"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles, Lightbulb, Lock, RefreshCw, FileText } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { getMessages } from "@/lib/i18n";

const t = getMessages("en");

type EnrichmentData = {
  plainSummary: string;
  businessPitch: string | null;
  pitchLocked?: boolean;
  source: "heuristic" | "gemini";
  cachedAt: string | null;
  geminiAvailable: boolean;
};

export function RepoEnrichment({ repoId }: { repoId: string }) {
  const [data, setData] = useState<EnrichmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/repos/${repoId}/enrichment`);
        if (!res.ok) return;
        const d = (await res.json()) as EnrichmentData;
        if (!cancelled) { setData(d); setLoading(false); }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [repoId]);

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/enrichment?force=1`);
      if (res.ok) {
        const d = (await res.json()) as EnrichmentData;
        setData(d);
      }
    } catch {
      /* ignore */
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Plain-language summary */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
            <Sparkles className="size-4 text-primary" />
            En bref
          </h3>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
              data.source === "gemini"
                ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                : "bg-sky-500/10 text-sky-600 dark:text-sky-400"
            }`}>
              {data.source === "gemini" ? "IA Gemini" : "Heuristique"}
            </span>
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              title="Régénérer"
            >
              <RefreshCw className={`size-3 ${regenerating ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <p className="text-[15px] leading-relaxed text-foreground/90">{data.plainSummary}</p>
      </section>

      {/* Business pitch — Pro-only cross-data insight */}
      <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
          <Lightbulb className="size-4 text-amber-500" />
          Idée de business
        </h3>
        {data.pitchLocked ? (
          <div className="flex flex-col items-start gap-3">
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Lock className="size-3.5" />
              {t.locked.title} — {t.locked.body}
            </p>
            <Link
              href="/settings"
              className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background"
            >
              {t.locked.cta}
            </Link>
          </div>
        ) : (
          <p className="text-[15px] leading-relaxed text-foreground/90">{data.businessPitch}</p>
        )}
      </section>
    </div>
  );
}

export function ReadmeToggle({ readmeText }: { readmeText: string | null }) {
  const [showRaw, setShowRaw] = useState(false);
  if (!readmeText) {
    return (
      <p className="text-sm text-muted-foreground">Aucun README disponible pour ce dépôt.</p>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <FileText className="size-3.5" />
        {showRaw ? "Masquer le README technique" : "Voir le README technique"}
      </button>
      {showRaw ? <Markdown>{readmeText}</Markdown> : null}
    </div>
  );
}
