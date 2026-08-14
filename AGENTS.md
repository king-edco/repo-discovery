<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

# repo-discovery — Project Notes

Next.js 16 PWA (App Router, TypeScript, Tailwind v4, shadcn/ui, Serwist) that
ingests public GitHub repos into SQLite and serves them + semantic search.
Package manager: **pnpm** (`packageManager: pnpm@11.20.0`).

## Stack / key facts
- Next **16.3.0**, React 19, webpack mode (`dev`/`build` use `--webpack`).
- DB: `better-sqlite3` + `drizzle-orm`, file at `data/foundry.db` (gitignored,
  auto-created on first server start, WAL mode). Singleton via `globalThis`.
- Native/ONNX packages in `serverExternalPackages` (next.config.ts):
  `better-sqlite3`, `@huggingface/transformers`, `onnxruntime-node`.
- Build scripts for native modules approved in `pnpm-workspace.yaml`.
- Embeddings: `Xenova/all-MiniLM-L6-v2` via Transformers.js (ONNX, pure Node,
  no Python). 384-dim, mean-pooled, L2-normalized. Singleton in
  `src/lib/embeddings.ts` (`getEmbedder()`). Model cached in HF cache dir.
- PWA: manifest `src/app/manifest.ts`; SW `src/app/sw.ts` → bundled by Serwist
  to `public/sw.js` (gitignored). SW disabled in dev, enabled in prod.

## Commands
- `pnpm dev` / `pnpm build` / `pnpm start`
- `pnpm lint` (eslint), `pnpm typecheck` (`tsc --noEmit` + worker tsconfig)
- `pnpm db:generate|db:migrate|db:studio` (drizzle-kit)
- `pnpm ingest` — `src/scripts/ingest.ts` (needs `GITHUB_TOKEN` in `.env.local`)
- `pnpm verify-embeddings` — checks embedding count + dimension (384) + norm (≈1)

## Source map
- `src/db/schema.ts` — `repos` table (see README for columns). `embedding` is
  nullable TEXT = JSON stringified float[]. `topics` JSON stringified.
- `src/db/index.ts` — `getDb()` singleton; auto `CREATE TABLE IF NOT EXISTS` +
  `ALTER TABLE ... ADD COLUMN embedding` for pre-existing DBs.
- `src/lib/embeddings.ts` — `getEmbedder()` + `cosineSimilarity()`.
- `src/lib/topics.ts` — curated 134 GitHub topics for ingestion strategies.
- `src/lib/types.ts` — shared `Repo` / `SearchResult` shapes.
- `src/lib/use-feed.ts` — client hook fetching the repo feed.
- `src/scripts/ingest.ts` — multi-strategy, resumable ingestion (see below).
- `src/scripts/verify-embeddings.ts` — embedding sanity check.
- `src/app/api/repos/route.ts` — `GET /api/repos`, all repos, stars desc,
  excludes `embedding`. Accepts `?minStars=N` (gte filter).
- `src/app/api/search/route.ts` — `GET /api/search?q=`, in-memory cosine
  similarity over stored embeddings, returns sorted hits + `similarity`,
  excludes `embedding`. `400` on missing/empty `q`. Accepts `?minStars=N`
  (post-filter on results).
- `src/app/api/og/[...slug]/route.ts` — proxy that fetches a repo's opengraph
  preview from githubassets, runs `sharp.trim()` to strip white padding so the
  image renders edge-to-edge in the card, returns PNG. In-memory cache (1h TTL),
  4 retries with backoff for flaky upstream. `previewImage()` in
  `src/lib/format.ts` routes repo images through this proxy.
  **URL pitfall:** upstream `https://opengraph.githubassets.com/1/{owner}/{repo}`
  needs a LITERAL `/` between owner and repo. Do NOT `encodeURIComponent` the
  full `owner/repo` — that encodes the slash as `%2F`, upstream fails to resolve
  the repo, and silently returns the generic GitHub Octocat image (blue/black
  gradient, identical 506KB for every repo) instead of the real card. Encode
  owner and repo SEPARATELY and join with `/`.
  **Generic-Octocat rejection:** when upstream can't resolve a repo (typo,
  private, rate-limited, or the old `%2F`-encoding bug) it silently returns the
  canonical GitHub Octocat placeholder (exactly 506737 bytes, 1200×630) instead
  of the repo's real card. The route detects this by byte length and returns
  `404` so the bad image is NEVER cached/served as if it were the real preview —
  otherwise it would be pinned for the cache TTL + server lifetime. Real repo
  cards are ~60-130KB, 1200×600 (pre-trim).
  **Cache busting:** `?refresh=1` on the OG route clears the in-memory entry
  for that repo and re-fetches upstream. The Settings "Vider le cache" button
  unregisters the service worker + drops Cache Storage + reloads the feed with
  a `nocache` query, forcing fresh OG fetches. Use these when a repo shows a
  stale/wrong preview after a fix.
  **Trim changes aspect ratio:** `sharp.trim()` removes the ~6% white margins,
  so the returned image is WIDER than the OG source's 1.91:1 (e.g. 2.2:1, 2.3:1
  per repo). Therefore card/preview `<img>` must use `w-full h-auto` (let the
  image keep its natural trimmed ratio) — NOT `aspect-[1.91/1]` + `object-cover`.
  A fixed 1.91 box with `object-cover` would CROP the wider trimmed image on both
  sides, hiding the repo name and stats ("Contributors/Used by/Stars/Forks")
  rendered inside the OG image. Applies to BOTH `repo-card.tsx` (feed) and
  `repos/[id]/page.tsx` (detail hero).
- `src/components/repo-card.tsx`, `repo-feed.tsx`, `service-worker-register.tsx`.
  Feed uses a **responsive grid** (`grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3`)
  inside a `max-w-screen-2xl px-4` container so cards fill the viewport width on
  desktop instead of a narrow centered column. Card images stay edge-to-edge
  via `overflow-hidden` + `size-full object-cover`; do not re-add horizontal
  padding around the image. Settings/repo-detail pages intentionally keep a
  narrow `max-w-2xl`/`max-w-3xl` column (forms/articles read better narrow).
  **Mobile overflow:** grid items default to `min-width: auto`, which an
  `<img>` (intrinsic ~1040px) can blow out beyond the viewport on narrow
  screens. The card `<img>` lives inside `overflow-hidden w-full` wrappers so
  it is already clipped, but as defense-in-depth the grid item (`RepoCard`
  `<Link>`) carries `min-w-0` and the root feed container carries
  `overflow-x-hidden`. Do NOT remove these. Verified at 375px/320px:
  `scrollWidth === clientWidth` (0px horizontal overflow).
- `src/components/ui/button.tsx` (shadcn).
- `src/lib/settings.ts` — local settings store (theme + minStars), persisted in
  `localStorage["foundry.settings.v1"]`. Implemented as a **module-scoped
  singleton store** with `useSyncExternalStore` so every consumer (global
  `ThemeApplier`, Settings page UI, feed) shares one reactive source of truth.
  Do NOT revert to per-hook `useState` — separate instances won't sync within
  the same document (the `storage` event only fires across tabs).
- `src/components/theme-script.tsx` — inline `<head>` script that applies the
  theme class before hydration (anti-FOUC).
- `src/components/theme-applier.tsx` — mounted once in the root layout; calls
  `useTheme()` to keep `.dark` on `<html>` in sync everywhere.
- `src/app/settings/page.tsx` — Settings UI: theme toggle (Clair/Système/Sombre),
  minStars number input, "Vider le cache hors-ligne" button.

## Ingestion design (PR #5 — multi-strategy + resumable)
- 6 star-range buckets + 134 topic searches = 140 strategies.
- GitHub Search API capped at 1000 results/query (10×100).
- README via `repos.getReadme` (base64 decode), first 3000 chars; embedding from
  description + first 500 chars of README.
- Resumable: `data/ingest-progress.json` (gitignored) skips completed
  strategies on restart; in-flight strategies re-fetch but skip DB-complete repos.
- Batched existing-row lookup with `inArray()`. Sequential README fetch with
  throttling plugin + bounded retries; on strategy failure, skip ahead & save
  progress (retried on next run) instead of crashing.
- Upserts on `repos.id` via `onConflictDoUpdate` — re-running updates, no dupes.

## Merged PR history (all merged into `main`)
- #1  feat/sqlite-repos       — SQLite + Drizzle + `GET /api/repos`
- #2  feat/github-ingestion    — `pnpm ingest` via octokit Search API (top-200 >100★)
- #3  feat/embeddings          — Transformers.js embeddings (all-MiniLM-L6-v2)
- #4  feat/semantic-search      — `GET /api/search?q=` in-memory cosine sim
- #5  feat/broad-ingestion     — multi-strategy (140), resumable, topics list,
                                 parallel README fetches, offline API caching

## Conventions
- Repo: github.com/king-edco/repo-discovery. PRs authored by an AI agent
  (OpenHands) on behalf of @king-edco; PR bodies note this.
- README is kept in sync with features (documents API, ingestion, DB, PWA).
- `embedding` is intentionally excluded from API responses to keep payloads small.
- **Lint rule `react-hooks/set-state-in-effect` is enforced as an error.** For
  the legitimate "sync from external system on mount" pattern (localStorage,
  matchMedia), suppress with `// eslint-disable-next-line
  react-hooks/set-state-in-effect` on the offending line only. Removing unused
  disable directives matters — eslint flags them as warnings.
- Returning a Node `Buffer` from a `Response` fails the DOM `BodyInit` type:
  wrap as `new Response(new Uint8Array(buf), …)`.
- French UI text with apostrophes must use the curly `'` (U+2019), not `'`, or
  eslint's `react/no-unescaped-entities` errors.
