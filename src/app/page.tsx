import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Crosshair, ScanSearch, Sparkles, Trophy } from "lucide-react";
import { getSession } from "@/lib/session";
import { getMessages } from "@/lib/i18n";

// Pre-login product landing. Signed-in users go straight to the feed.
export default async function Home() {
  const session = await getSession();
  if (session) redirect("/feed");

  const t = getMessages("en");

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24">
      <header className="flex items-center justify-between py-6">
        <div className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-5" />
          {t.common.appName}
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

      <section className="py-12">
        <h2 className="text-center text-2xl font-semibold">{t.landing.pricingTitle}</h2>
        <div className="mx-auto mt-10 grid max-w-2xl gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border p-6">
            <h3 className="font-semibold">{t.landing.freeTitle}</h3>
            <p className="mt-1 text-3xl font-bold">{t.landing.freePrice}</p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>{t.landing.freeF1}</li>
              <li>{t.landing.freeF2}</li>
              <li>{t.landing.freeF3}</li>
              <li>{t.landing.freeF4}</li>
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
              <li>{t.landing.proF1}</li>
              <li>{t.landing.proF2}</li>
              <li>{t.landing.proF3}</li>
              <li>{t.landing.proF4}</li>
            </ul>
            <Link
              href="/signup"
              className="mt-6 block rounded-full bg-foreground px-4 py-2 text-center text-sm text-background"
            >
              {t.landing.proCta}
            </Link>
          </div>
        </div>
      </section>

      <footer className="mt-16 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="size-4" />
        {t.common.tagline}
      </footer>
    </main>
  );
}
