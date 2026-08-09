# Foundry

A Next.js PWA built with the App Router, TypeScript, Tailwind CSS, shadcn/ui, and Serwist.

## Getting started

```bash
pnpm install
pnpm run dev
```

The app runs at http://localhost:3000.

## Scripts

- `pnpm run dev` — start the dev server (webpack mode)
- `pnpm run build` — production build (generates the service worker)
- `pnpm run start` — serve the production build
- `pnpm run lint` — lint
- `pnpm run typecheck` — typecheck app + service worker
- `pnpm run db:generate` — generate a Drizzle migration from the schema
- `pnpm run db:migrate` — apply pending Drizzle migrations
- `pnpm run db:studio` — open Drizzle Studio to inspect the DB
- `pnpm ingest` — fetch top public GitHub repos (>100 stars) into the DB

## Ingestion

`pnpm ingest` runs `src/scripts/ingest.ts`, which uses the GitHub Search API
(via `@octokit/rest`) to fetch up to 200 public repos with more than 100 stars,
sorted by stars descending. For each repo it stores id, name, full_name,
description, url, stars, language, license, topics, and the first 3000 chars of
the README (fetched via the contents API). Existing rows are upserted on `id`,
so re-running the script updates fields instead of creating duplicates.

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
| readme_text   | TEXT    | nullable                       |
| topics        | TEXT    | JSON stringified               |
| pushed_at     | TEXT    | ISO date                       |
| ingested_at   | TEXT    | ISO date, defaults to now()    |

## API

- `GET /api/repos` — returns all repos as JSON, sorted by `stars` descending.

## PWA

- Web manifest: `src/app/manifest.ts` (served at `/manifest.webmanifest`)
- Service worker source: `src/app/sw.ts` (bundled to `public/sw.js` at build time via Serwist)
- The service worker is disabled in development and enabled in production.
- Installable on mobile (Chrome Android) once served over HTTPS.

