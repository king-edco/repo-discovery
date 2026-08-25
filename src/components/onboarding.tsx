"use client";

import { useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { useInterests } from "@/lib/use-user";
import { getMessages } from "@/lib/i18n";

const t = getMessages("en");

// Interest domains presented during onboarding. Ordered from broad consumer
// interests to technical ones — the app is for everyone looking for ideas,
// not only developers. The full TOPICS list is available in settings later.
const ONBOARDING_DOMAINS: { label: string; icon: string; topics: string[] }[] = [
  { label: "Content creation & social media", icon: "🎬", topics: ["content-creation", "youtube", "tiktok", "instagram", "social-media", "blog", "newsletter", "podcast", "streaming"] },
  { label: "Music & audio", icon: "🎵", topics: ["music", "music-production", "spotify", "dj", "guitar", "piano", "synthesizer", "karaoke"] },
  { label: "Gaming & esports", icon: "🎮", topics: ["game", "game-development", "esports", "minecraft", "steam", "twitch", "discord-bot", "rpg", "unity", "godot"] },
  { label: "Business & entrepreneurship", icon: "💼", topics: ["entrepreneurship", "startup", "marketing", "seo", "e-commerce", "shopify", "freelance", "investing", "personal-finance"] },
  { label: "Sports & outdoors", icon: "⚽", topics: ["sports", "football", "soccer", "basketball", "running", "cycling", "fitness", "hiking", "camping"] },
  { label: "Food, travel & lifestyle", icon: "🍳", topics: ["recipes", "cooking", "food", "coffee", "restaurant", "travel", "fashion", "beauty"] },
  { label: "Home, DIY & garden", icon: "🏡", topics: ["home-automation", "smart-home", "gardening", "diy", "woodworking", "3d-printing", "iot", "arduino"] },
  { label: "Learning & self-improvement", icon: "📚", topics: ["education", "language-learning", "courses", "flashcards", "meditation", "habits", "journaling", "books"] },
  { label: "Entertainment & pop culture", icon: "🍿", topics: ["movies", "tv-shows", "anime", "comics", "books", "memes", "chess", "emulator"] },
  { label: "Family, pets & community", icon: "🐾", topics: ["parenting", "pets", "dogs", "cats", "volunteering", "nonprofit"] },
  { label: "AI & data", icon: "🧠", topics: ["machine-learning", "deep-learning", "nlp", "llm", "computer-vision", "data-visualization", "data-analysis", "chatbot"] },
  { label: "Web & app development", icon: "🌐", topics: ["react", "vue", "nextjs", "typescript", "frontend", "backend", "api", "android", "ios", "flutter"] },
  { label: "Dev tools & infra", icon: "🛠️", topics: ["developer-tools", "cli", "docker", "kubernetes", "database", "postgresql", "security", "cryptography"] },
  { label: "Design & media", icon: "🎨", topics: ["design", "figma", "photography", "photo-editor", "video", "video-editor", "animation", "pixel-art", "3d"] },
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
      const allSelected = topics.every((tp) => next.has(tp));
      if (allSelected) topics.forEach((tp) => next.delete(tp));
      else topics.forEach((tp) => next.add(tp));
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
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex size-14 items-center justify-center rounded-2xl bg-primary/10">
            <Logo className="size-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t.onboarding.title}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted-foreground">
            {t.onboarding.subtitle}
          </p>
        </div>

        <div className="space-y-4">
          {ONBOARDING_DOMAINS.map((domain) => {
            const allSelected = domain.topics.every((tp) => selected.has(tp));
            return (
              <div key={domain.label} className="rounded-2xl border border-border bg-card p-5">
                <button
                  type="button"
                  onClick={() => toggleDomain(domain.topics)}
                  className="mb-3 flex w-full items-center justify-between"
                >
                  <span className="inline-flex items-center gap-2.5 text-sm font-semibold text-foreground">
                    <span className="text-lg">{domain.icon}</span>
                    {domain.label}
                  </span>
                  <span
                    className={`inline-flex size-5 items-center justify-center rounded-md border transition-colors ${
                      allSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
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

        <div className="mt-8 flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            {selected.size === 0
              ? t.onboarding.noneSelected
              : `${selected.size} ${selected.size > 1 ? t.onboarding.selectedPlural : t.onboarding.selectedSingular}`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={finish}
              className="rounded-full px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t.onboarding.skip}
            </button>
            <button
              type="button"
              onClick={finish}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
            >
              {t.onboarding.continue}
              <ArrowRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
