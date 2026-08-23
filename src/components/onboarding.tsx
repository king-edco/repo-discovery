"use client";

import { useState } from "react";
import { Check, ArrowRight, Sparkles } from "lucide-react";
import { useInterests } from "@/lib/use-user";

// Curated subset of topics presented during onboarding. We group them into
// domains so the user can pick a whole area at once, plus allow granular
// selection. The full TOPICS list is available in settings later.
const ONBOARDING_DOMAINS: { label: string; icon: string; topics: string[] }[] = [
  { label: "Intelligence artificielle", icon: "🧠", topics: ["machine-learning", "deep-learning", "nlp", "transformer", "llm", "computer-vision"] },
  { label: "Web & frontend", icon: "🌐", topics: ["react", "vue", "svelte", "nextjs", "typescript", "frontend", "css", "tailwind"] },
  { label: "Jeux & multimédia", icon: "🎮", topics: ["game", "game-engine", "video", "music", "animation", "pixel-art", "godot", "unity"] },
  { label: "Data & analytics", icon: "📊", topics: ["data-visualization", "data-analysis", "pandas", "dashboard", "dataset", "etl"] },
  { label: "Dev tools", icon: "🛠️", topics: ["developer-tools", "cli", "terminal", "editor", "testing", "ci-cd", "debugger"] },
  { label: "Backend & APIs", icon: "⚡", topics: ["api", "rest-api", "graphql", "backend", "microservices", "webserver"] },
  { label: "Bases de données", icon: "🗄️", topics: ["database", "sql", "nosql", "postgresql", "sqlite", "redis", "search-engine"] },
  { label: "Cloud & infra", icon: "☁️", topics: ["docker", "kubernetes", "terraform", "serverless", "monitoring", "aws"] },
  { label: "Sécurité", icon: "🔒", topics: ["security", "cryptography", "authentication", "penetration-testing", "reverse-engineering"] },
  { label: "Finance & crypto", icon: "💰", topics: ["finance", "trading", "cryptocurrency", "blockchain", "ethereum"] },
  { label: "Mobile", icon: "📱", topics: ["android", "ios", "flutter", "kotlin", "swift"] },
  { label: "Science & éducation", icon: "🔬", topics: ["science", "physics", "biology", "math", "education", "tutorial"] },
];

export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const { setInterests } = useInterests();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (topic: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  const toggleDomain = (topics: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = topics.every((t) => next.has(t));
      if (allSelected) topics.forEach((t) => next.delete(t));
      else topics.forEach((t) => next.add(t));
      return next;
    });
  };

  const finish = async () => {
    await setInterests([...selected]);
    onDone();
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
        {/* Hero */}
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <Sparkles className="size-7 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Bienvenue sur Foundry
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
            Découvrez des dépôts open source avec un vrai potentiel business.
            Sélectionnez vos centres d&apos;intérêt pour un feed personnalisé.
          </p>
        </div>

        {/* Domain groups */}
        <div className="space-y-4">
          {ONBOARDING_DOMAINS.map((domain) => {
            const allSelected = domain.topics.every((t) => selected.has(t));
            return (
              <div
                key={domain.label}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <button
                  type="button"
                  onClick={() => toggleDomain(domain.topics)}
                  className="mb-3 flex w-full items-center justify-between"
                >
                  <span className="inline-flex items-center gap-2.5 text-sm font-semibold text-foreground">
                    <span className="text-lg">{domain.icon}</span>
                    {domain.label}
                  </span>
                  <span className={`inline-flex size-5 items-center justify-center rounded-md border transition-colors ${
                    allSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}>
                    {allSelected ? <Check className="size-3.5" /> : null}
                  </span>
                </button>
                <div className="flex flex-wrap gap-2">
                  {domain.topics.map((topic) => {
                    const active = selected.has(topic);
                    return (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => toggle(topic)}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                        }`}
                      >
                        {topic}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-8 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {selected.size === 0
              ? "Aucun intérêt sélectionné"
              : `${selected.size} intérêt${selected.size > 1 ? "s" : ""} sélectionné${selected.size > 1 ? "s" : ""}`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={finish}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Passer
            </button>
            <button
              type="button"
              onClick={finish}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              Continuer
              <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
