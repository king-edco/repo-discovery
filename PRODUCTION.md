# Foundry — Production Go-Live Guide

Everything that must be done to run Foundry in production. Work through this
top to bottom; each section lists the config, why it matters, and how to
verify it. The app is designed to be **plug and play**: with only the
required env vars set it boots and works; optional services (OAuth, Stripe,
Resend, PostHog) light up automatically when their keys are present and
degrade gracefully when absent.

## 1. Prerequisites

- Node.js ≥ 20, pnpm (`corepack enable`)
- A host that can run a persistent Node server (the app needs a filesystem
  for `data/foundry.db` — SQLite). Vercel-style serverless is **not**
  supported for the DB as-is; use a VM / container / Fly.io / Railway with a
  persistent volume mounted at `data/`.
- A public HTTPS domain. HTTPS is required (HSTS + secure cookies).

## 2. Environment variables

Copy `.env.example` → `.env.local` (dev) or your platform's env config
(prod). **Never commit real secrets.**

### Required

| Variable | What | How to get |
|---|---|---|
| `BETTER_AUTH_SECRET` | Signs session cookies | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Public base URL, e.g. `https://foundry.example.com` | your domain |

### Data ingestion (required for content)

| Variable | What |
|---|---|
| `GITHUB_TOKEN` | GitHub PAT (`public_repo` scope) — <https://github.com/settings/tokens> |
| `CURRENTS_API_KEY` | Optional, demand signals from news — <https://currentsapi.services/> |
| `SCHEDULER_ENABLED` | Optional — `false` disables the internal ingestion scheduler (default on) |
| `CORPUS_CAP` | Optional — max repos kept before eviction (default `50000`) |

### Optional services

| Service | Variables | Behavior when unset |
|---|---|---|
| GitHub OAuth | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | button hidden |
| Google OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | button hidden |
| Stripe billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID` | upgrade shows "not configured" |
| Resend email | `RESEND_API_KEY`, `EMAIL_FROM`, `FEEDBACK_INBOX_EMAIL` | feedback endpoint returns 503 |
| PostHog analytics | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | analytics disabled |
| Gemini enrichment | `GEMINI_API_KEY` | heuristic enrichment instead |
| Admin ops | `ENRICHMENT_ADMIN_KEY` | force-regeneration always denied |

## 3. Third-party setup

### OAuth (optional but recommended)

- **GitHub**: <https://github.com/settings/developers> → New OAuth App.
  Callback: `{BETTER_AUTH_URL}/api/auth/callback/github`.
- **Google**: <https://console.cloud.google.com/apis/credentials> → OAuth
  client (Web). Redirect URI: `{BETTER_AUTH_URL}/api/auth/callback/google`.

### Stripe (billing)

1. Create a Product "Foundry Pro" with a recurring monthly price (USD 10).
2. Copy the price ID → `STRIPE_PRO_PRICE_ID`.
3. Add a webhook: endpoint `{BETTER_AUTH_URL}/api/billing/webhook`,
   event `checkout.session.completed`. Copy the signing secret →
   `STRIPE_WEBHOOK_SECRET`.
4. Secret key → `STRIPE_SECRET_KEY`. Test with Stripe test-mode keys first
   (card `4242 4242 4242 4242`).

### Resend (email)

1. Verify your sending domain in Resend (SPF/DKIM records).
2. API key → `RESEND_API_KEY`; sender like `Foundry <noreply@yourdomain.com>`
   → `EMAIL_FROM`; your support inbox → `FEEDBACK_INBOX_EMAIL`.

### PostHog (analytics)

Create a project, copy the project API key → `NEXT_PUBLIC_POSTHOG_KEY`.
The CSP `connect-src` is extended automatically when set.

## 4. Build & run

```bash
pnpm install --frozen-lockfile
pnpm build          # next build --webpack (Turbopack incompatible w/ Serwist)
pnpm start -p 3000
```

Database tables, columns and search indexes are created automatically on
first boot (idempotent). **Content ingestion is self-driving**: an internal
scheduler (started at server boot, `src/lib/scheduler.ts`) gradually ingests
repos every ~30 min, targeting the topics your users actually pick (explore/
exploit), pre-warming their OG preview images, and evicting low-value repos
once the corpus passes `CORPUS_CAP` (default 50k). With only `GITHUB_TOKEN`
set, the app feeds itself — no cron required on a single-instance deploy.

Set `SCHEDULER_ENABLED=false` on all but one instance if you ever run
multi-instance. For a one-time large backfill you can still run the CLI:

```bash
pnpm ingest            # repos (needs GITHUB_TOKEN) — or ingest-bounded for a quick corpus
pnpm ingest-demand     # demand signals
pnpm crawl-competitors # commercial competitors
pnpm reindex-search    # only if you change the embedding model later
```

Optional cron for the heavier jobs (the scheduler covers repo ingestion):

```cron
30 3 * * *  cd /app && pnpm ingest-demand >> /var/log/foundry-demand.log 2>&1
0 9 * * *   cd /app && pnpm notify-digest >> /var/log/foundry-digest.log 2>&1
```

## 5. Security checklist

- [ ] `BETTER_AUTH_SECRET` is a fresh random 32+ byte value (not shared, not committed)
- [ ] HTTPS only; `Strict-Transport-Security` is sent automatically in prod
- [ ] `ENRICHMENT_ADMIN_KEY` set if you ever use `?force=1` enrichment
- [ ] GitHub PAT has minimal scope (`public_repo`)
- [ ] Stripe webhook secret is the **webhook** signing secret (`whsec_…`), not the API key
- [ ] Backups: `data/foundry.db` (WAL — use `sqlite3 .backup` or Litestream)
- [ ] Dependency audit in CI: `pnpm audit`
- [ ] Reverse proxy (nginx/Caddy/Cloudflare) in front; body-size limits on
      non-API routes are handled in-app, but a proxy-level limit is good hygiene
- [ ] Rate limiting: auth endpoints are rate-limited in-app (5/min on
      sign-in/sign-up). Add proxy-level limits for extra protection.

## 6. Post-deploy verification

```bash
curl -s -o /dev/null -w "%{http_code}" https://YOUR_DOMAIN/            # 200 (landing)
curl -s -o /dev/null -w "%{http_code}" https://YOUR_DOMAIN/api/repos   # 401 (auth required)
curl -s -X POST https://YOUR_DOMAIN/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"you@test.dev","password":"password123"}'  # 200
```

Then in the browser: sign up → feed loads → open a repo → cross-data
sections show the Pro lock → upgrade flow (test-mode Stripe) → plan flips to
Pro → cross-data sections unlock. If `pnpm notify-digest` has run, the bell
shows a digest notification.

## 7. Scaling notes

The repo's AGENTS.md documents the swap points: sqlite-vec → Qdrant/LanceDB
beyond ~100k vectors; Transformers.js → dedicated embedding service when
crawl throughput becomes the bottleneck; SQLite → Postgres for multi-instance
concurrency. None of these are needed at beta scale.
