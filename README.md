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

## PWA

- Web manifest: `src/app/manifest.ts` (served at `/manifest.webmanifest`)
- Service worker source: `src/app/sw.ts` (bundled to `public/sw.js` at build time via Serwist)
- The service worker is disabled in development and enabled in production.
- Installable on mobile (Chrome Android) once served over HTTPS.

