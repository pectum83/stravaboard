# Architecture

pnpm workspaces monorepo (`pnpm-workspace.yaml`), TypeScript everywhere, ESM.

```
apps/web          Vue 3 Composition API + Vite + ECharts (vue-echarts) + MapLibre GL + Pinia
apps/server       Fastify + Drizzle ORM on better-sqlite3, env-config via zod
packages/shared   @stravaboard/shared — types + pure algorithms (no I/O, 100% coverage)
e2e               Playwright suite: real server + seeded sqlite + local Strava stub, offline
```

- Web imports shared code as `@stravaboard/shared` (workspace:*). Server also.
- Dependency direction: web/server → shared. Never the reverse.

## Environment

- **Node 22 required**; shell default may be v20 → run
  `source ~/.nvm/nvm.sh && nvm use` before any pnpm command.
- Root `.env` (loaded by the server entry point `apps/server/src/index.ts`);
  template `.env.example`. Keys: `STRAVA_CLIENT_ID/SECRET`, `PORT` (3001),
  `DATABASE_PATH`, `APP_BASE_URL`, `WEB_APP_URL`, `WEB_DIST_PATH`,
  `STRAVA_API_BASE/OAUTH_BASE` (overridden in tests), `MAPTILER_KEY`
  (optional; empty → map falls back to plain OSM, no satellite/3D).
- Config parsing: `apps/server/src/config.ts` (zod schema, defaults).

## Commands (from repo root)

```
pnpm dev            # server :3001 + vite :5173 (proxy /api → :3001)
pnpm build          # tsup (server, copies db migrations to dist) + vite build
pnpm test           # vitest all packages + playwright e2e (e2e serves the BUILT web app → build first)
pnpm test:coverage  # vitest only, thresholds enforced
pnpm typecheck      # tsc / vue-tsc
pnpm lint / format:check / format
pnpm e2e            # playwright only
```

## Runtime wiring

- `apps/server/src/app.ts` `buildApp({config, db, fetchImpl, syncOptions})` —
  creates Fastify, `StravaClient`, `SyncService`, registers routes
  (auth, config, settings, sync, activities), optional static serving of
  `WEB_DIST_PATH` with SPA fallback.
- `apps/server/src/db/client.ts` `openDb(path)` — opens sqlite (`:memory:` in
  tests), WAL, FK on, **applies drizzle migrations automatically** from
  `src/db/migrations/` (copied next to the bundle at build time).
- OAuth: single athlete, tokens in DB, refresh rotation persisted
  (`src/strava/oauth.ts`). Rate limiting from Strava response headers
  (`src/sync/rateLimiter.ts`).

## Deployment

Local-first; VPS-ready (server serves built web app, env-based config). Not
yet deployed. Auth must be added at the reverse proxy before exposing.
