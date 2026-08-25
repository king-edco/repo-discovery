# Foundry

A Next.js PWA built with the App Router, TypeScript, Tailwind CSS, shadcn/ui, and Serwist.

## Getting started

```bash
pnpm install
pnpm run dev
```

The app runs at http://localhost:3000.

## Scripts

- `pnpm run dev` â€” start the dev server (webpack mode)
- `pnpm run build` â€” production build (generates the service worker)
- `pnpm run start` â€” serve the production build
- `pnpm run lint` â€” lint
- `pnpm run typecheck` â€” typecheck app + service worker
- `pnpm run db:generate` â€” generate a Drizzle migration from the schema
- `pnpm run db:migrate` â€” apply pending Drizzle migrations
- `pnpm run db:studio` â€” open Drizzle Studio to inspect the DB
- `pnpm ingest` â€” fetch top public GitHub repos (>100 stars) into the DB
- `pnpm reembed` â€” re-vectorize all repos already in the DB with the current
  embedding model, without re-fetching READMEs from GitHub. Run this after
  swapping the embedding model (old vectors are invalid until regenerated).
  Pass `--empty-only` to backfill only rows that have no embedding yet.
- `pnpm verify-embeddings` â€” check that embeddings exist in the DB and that the
  generated vector dimension is 384 (multilingual-e5-small)
- `pnpm notify-digest` Ñ create in-app notifications for users whose interests
  match recently ingested repos (idempotent per day; run on a cron)

## Accounts, plans & monetization

- **Auth** Ñ Better Auth (email/password + optional GitHub/Google OAuth),
  30-day cookie sessions, Drizzle adapter on the same SQLite file. Protected
  routes resolve the user from the session Ñ no client-supplied user ids.
  Set `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`; OAuth needs the provider
  client id/secret (see `.env.example`).
- **Plans** Ñ `user.plan` is `free` or `pro`. Free: feed, search, plain
  summaries, saved ideas. Pro unlocks cross-data insights: commercial
  competitors, demand signals, commercial score, `sort=score`, and the AI
  business pitch. Gating is enforced server-side in every API route.
- **Billing** Ñ Stripe Checkout + webhook (`/api/billing/*`) flips `plan` to
  `pro` on `checkout.session.completed`. Disabled (503) unless
  `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRO_PRICE_ID` are set.
- **Feedback forwarding** Ñ `/api/feedback` and repo-level feedback reasons are
  emailed to `FEEDBACK_INBOX_EMAIL` via Resend (`RESEND_API_KEY`, `EMAIL_FROM`).
- **Notifications** Ñ in-app notifications (`/api/notifications`, bell in the
  feed header) + `pnpm notify-digest` for interest-based new-repo digests.
- **Analytics** Ñ PostHog pageviews when `NEXT_PUBLIC_POSTHOG_KEY` is set
  (the CSP `connect-src` is extended automatically); analytics-free otherwise.

## Ingestion

`pnpm ingest` runs `src/scripts/ingest.ts`, which uses the GitHub Search API
(via `@octokit/rest`) to fetch up to 200 public repos with more than 100 stars,
sorted by stars descending. For each repo it stores id, name, full_name,
description, url, stars, language, license, topics, and the first 3000 chars of
the README (fetched via the contents API). Existing rows are upserted on `id`,
so re-running the script updates fields instead of creating duplicates.

A semantic `embedding` (384-dim, L2-normalized) is generated for each repo from the
concatenation of its description and the first 500 chars of the README, using
`Xenova/multilingual-e5-small` via Transformers.js (q8-quantized ONNX, pure
Node/CPU, no Python). E5 requires a task prefix on the input: repos are indexed
with the `passage: ` prefix (see `embedPassage` in `src/lib/embeddings.ts`). The
model is loaded once at script startup and reused for all repos. Because the
output dimension (384) matches the previous model, no SQLite schema migration is
needed when swapping models â€” just run `pnpm reembed` to regenerate vectors.

Requires a GitHub token. Copy `.env.example` to `.env.local` and set
`GITHUB_TOKEN`. Rate limiting is handled by `@octokit/plugin-throttling`
(automatic backoff) plus a pre-flight check that sleeps when remaining requests
drop below a floor.

## Database

SQLite via `better-sqlite3` + Drizzle ORM, stored at `data/foundry.db` (gitignored).
The file and `repos` table are created automatically on first server start (simple
`CREATE TABLE IF NOT EXISTS` migration in `src/db/index.ts`).

Schema (`src/db/schema.ts`):

| column        | type    | notes                          |
| ------------- | ------- | ------------------------------ |
| id            | TEXT PK | GitHub repo id                 |
| name          | TEXT    |                                |
| full_name     | TEXT    |                                |
| description   | TEXT    | nullable                       |
| url           | TEXT    |                                |
| stars         | INTEGER |                                |
| language      | TEXT    | nullable                       |
| license       | TEXT    | nullable                       |
| readme_text   | TEXT    | nullable, first 3000 chars     |
| embedding     | TEXT    | nullable, JSON 384-dim floats  |
| topics        | TEXT    | JSON stringified               |
| pushed_at     | TEXT    | ISO date                       |
| ingested_at   | TEXT    | ISO date, defaults to now()    |

## API

- `GET /api/repos` â€” returns all repos as JSON, sorted by `stars` descending.
  The `embedding` column is excluded from the response to keep the payload small.
- `GET /api/search?q=<query>` â€” semantic search. Embeds the query with the same
  multilingual-e5-small model (using the E5 `query: ` prefix), computes cosine
  similarity against every repo's stored embedding in memory, and returns the
  repos sorted by similarity descending with a `similarity` score (0â€“1) on each
  hit. Cross-lingual: a French query surfaces repos documented only in English.
  The `embedding` field is excluded from results. Returns `400` if `q` is
  missing, empty, or whitespace-only.

## PWA

- Web manifest: `src/app/manifest.ts` (served at `/manifest.webmanifest`)
- Service worker source: `src/app/sw.ts` (bundled to `public/sw.js` at build time via Serwist)
- The service worker is disabled in development and enabled in production.
- Installable on mobile (Chrome Android) once served over HTTPS.

