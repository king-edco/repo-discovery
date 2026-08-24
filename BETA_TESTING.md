# Foundry — Beta Testing Guide

How to run a pre-release / beta phase before full production. Goal: real
users test the product and give feedback, with minimal cost and risk.

## 1. Beta configuration

Use production mode (`pnpm build && pnpm start`) on a **separate** deployment
(e.g. `beta.yourdomain.com`) with a **separate database** (`data/` volume) so
beta data never touches your prod instance.

### Recommended env for beta

| Setting | Beta choice | Why |
|---|---|---|
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | fresh secret, beta URL | required |
| `GITHUB_TOKEN` | yes | you need a real corpus |
| `GITHUB_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET` | **yes** | frictionless sign-up matters most in beta |
| Stripe | **test-mode keys** | users can "upgrade" for free with `4242 4242 4242 4242`; you see the full Pro flow without charging anyone |
| `RESEND_API_KEY`, `EMAIL_FROM`, `FEEDBACK_INBOX_EMAIL` | **yes** | feedback forwarding is the point of beta — every message lands in your inbox |
| `NEXT_PUBLIC_POSTHOG_KEY` | **yes** | funnels + pageviews tell you where testers drop off |
| `GEMINI_API_KEY` | yes (quota-capped) | richer pitches; heuristic fallback if quota runs out |
| `ENRICHMENT_ADMIN_KEY` | yes | lets you force-regenerate enrichments while iterating |

### Content

Run `pnpm ingest-bounded` first (~2k repos, fast, rate-limit friendly), then
`pnpm ingest-demand` and `pnpm crawl-competitors` so cross-data features have
material to match against. Top up with `pnpm ingest` when you want more.

## 2. Inviting testers

There is no invite system (yet) — anyone with the URL can sign up. Options:

- Keep the beta URL unlisted (obscurity, weakest).
- Put basic-auth in front at the proxy (nginx/Caddy/Cloudflare Access) and
  share the proxy credentials only with testers (simple, effective).
- Cloudflare Access with an email allowlist (strongest, free).

Before sharing: run the post-deploy verification in `PRODUCTION.md` §6 on the
beta URL yourself.

## 3. What to ask testers to do

Give testers a short script so you get comparable feedback:

1. Sign up (try both email and an OAuth provider).
2. Complete onboarding — pick your interests.
3. Browse "For you", search for something in your domain, like/dislike repos.
4. Open a repo detail page; read the summary, pitch, competitors, demand.
5. Save 2–3 ideas; check the Saved page.
6. Try the upgrade flow (Stripe test card `4242 4242 4242 4242`) and confirm
   Pro features unlock.
7. Send feedback via Settings → "Send us feedback" (arrives in
   `FEEDBACK_INBOX_EMAIL`) — and use the thumbs-down "why?" modal on cards.
8. Report anything broken via the same feedback form.

## 4. Collecting & reading the feedback

- **Written feedback** → your `FEEDBACK_INBOX_EMAIL` inbox (via Resend).
- **Behavioral data** → PostHog: pageviews, drop-offs, feature usage.
- **Structured signals** → the DB itself: `user_feedback` (likes/dislikes +
  reasons), `saved_ideas`, `user_interests` tables show what testers actually
  engaged with. Query with `pnpm db:studio`.

Suggested weekly loop during beta:

1. Read inbox feedback, tag themes (bug / confusion / feature request).
2. Check PostHog funnel: landing → signup → feed → detail → upgrade.
3. Fix top issues, redeploy, ask testers to re-verify.

## 5. Known beta limitations (set expectations)

- Repo corpus size depends on how much you've ingested; the feed gets better
  as ingestion runs.
- Notification digests require `pnpm notify-digest` on a cron — set it up or
  the bell stays quiet.
- Heuristic enrichment (no `GEMINI_API_KEY`) is lower quality than Gemini.
- Single-instance SQLite: fine for dozens–hundreds of beta users; see
  `PRODUCTION.md` §7 before opening to the public.

## 6. Graduation checklist: beta → production

- [ ] No open critical bugs from beta feedback
- [ ] Stripe switched from test keys to live keys; webhook re-created for the
      live endpoint; one real purchase tested end-to-end
- [ ] OAuth apps switched/verified for the prod domain callbacks
- [ ] Backups configured for `data/foundry.db`
- [ ] `pnpm audit` clean (or triaged)
- [ ] Landing SEO verified: `sitemap.xml`, `robots.txt`, OG tags render
      (check with a social-share debugger)
- [ ] Basic-auth / Access removed from the prod domain (keep it on beta!)
- [ ] Monitoring: uptime check on `/` + PostHog on prod keys
