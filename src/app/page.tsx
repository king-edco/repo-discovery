import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Check,
  Crosshair,
  Quote,
  ScanSearch,
  Target,
  Trophy,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { getSession } from "@/lib/session";
import { getMessages } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Foundry — Find your next business idea in open source",
  description:
    "Foundry scans GitHub, cross-matches repos against real market demand and commercial competitors, and scores every repo's business potential — so you build the idea worth your time.",
  openGraph: {
    title: "Foundry — Find your next business idea in open source",
    description:
      "Semantic search + demand signals + competitor analysis for thousands of open-source repos. Discover the idea worth building.",
    type: "website",
  },
};

// Pre-login product landing. Signed-in users go straight to the feed.
export default async function Home() {
  const session = await getSession();
  if (session) redirect("/feed");

  const t = getMessages("en");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Foundry",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: t.landing.heroSubtitle,
    offers: [
      { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD" },
      { "@type": "Offer", name: "Pro", price: "10", priceCurrency: "USD" },
    ],
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2 font-semibold">
          <Logo className="size-7" />
          {t.common.appName}
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            {t.landing.betaBadge}
          </span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/login" className="rounded-full px-4 py-2 hover:bg-muted">
            {t.nav.login}
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-foreground px-4 py-2 text-background"
          >
            {t.landing.ctaStart}
          </Link>
        </nav>
      </header>

      <section className="py-20 text-center">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          {t.landing.heroTitle}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
          {t.landing.heroSubtitle}
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-background"
          >
            {t.landing.ctaStart} <ArrowRight className="size-4" />
          </Link>
          <Link href="/login" className="text-sm underline underline-offset-4">
            {t.landing.ctaLogin}
          </Link>
        </div>
      </section>

      <section className="py-12">
        <h2 className="text-center text-2xl font-semibold">{t.landing.howTitle}</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {[
            { icon: ScanSearch, title: t.landing.how1Title, body: t.landing.how1Body },
            { icon: Crosshair, title: t.landing.how2Title, body: t.landing.how2Body },
            { icon: Trophy, title: t.landing.how3Title, body: t.landing.how3Body },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-2xl border p-6">
              <Icon className="size-6" />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* About us — the origin story */}
      <section className="py-12">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-2xl font-semibold">{t.landing.aboutTitle}</h2>
          <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
            <p>{t.landing.aboutBody1}</p>
            <p>{t.landing.aboutBody2}</p>
            <p>{t.landing.aboutBody3}</p>
          </div>
          <div className="mt-8 flex items-start gap-4 rounded-2xl border bg-muted/40 p-6">
            <Target className="mt-0.5 size-6 shrink-0" />
            <div>
              <h3 className="font-semibold text-foreground">{t.landing.aboutMission}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.landing.aboutMissionBody}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-12">
        <h2 className="text-center text-2xl font-semibold">
          {t.landing.testimonialsTitle}
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {t.landing.testimonials.map((tm) => (
            <figure key={tm.name} className="rounded-2xl border p-6">
              <Quote className="size-5 text-muted-foreground" />
              <blockquote className="mt-3 text-sm leading-relaxed text-foreground">
                {tm.quote}
              </blockquote>
              <figcaption className="mt-4">
                <p className="text-sm font-semibold">{tm.name}</p>
                <p className="text-xs text-muted-foreground">{tm.role}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Detailed pricing */}
      <section className="py-12" id="pricing">
        <h2 className="text-center text-2xl font-semibold">{t.landing.pricingTitle}</h2>
        <div className="mx-auto mt-10 grid max-w-3xl gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border p-6">
            <h3 className="font-semibold">{t.landing.freeTitle}</h3>
            <p className="mt-1 text-3xl font-bold">{t.landing.freePrice}</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {t.landing.pricingFree.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="mt-6 block rounded-full border px-4 py-2 text-center text-sm"
            >
              {t.landing.freeCta}
            </Link>
          </div>
          <div className="rounded-2xl border-2 border-foreground p-6">
            <h3 className="flex items-center gap-2 font-semibold">
              {t.landing.proTitle}
              <span className="rounded-full bg-foreground px-2 py-0.5 text-xs text-background">
                {t.common.pro}
              </span>
            </h3>
            <p className="mt-1 text-3xl font-bold">{t.landing.proPrice}</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {t.landing.pricingPro.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="mt-6 block rounded-full bg-foreground px-4 py-2 text-center text-sm text-background"
            >
              {t.landing.proCta}
            </Link>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {t.landing.pricingNote}
        </p>
      </section>

      <footer className="mt-16 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Logo className="size-4" />
        {t.common.tagline}
      </footer>
    </main>
  );
}
