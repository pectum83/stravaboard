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
  `HOST`, `DATABASE_PATH`, `APP_BASE_URL`, `WEB_APP_URL`, `WEB_DIST_PATH`,
  `STRAVA_API_BASE/OAUTH_BASE` (overridden in tests), `MAPTILER_KEY`
  (optional; empty → map falls back to plain OSM, no satellite/3D),
  `COOKIE_SECRET` (session signing), `ALLOWED_ATHLETE_IDS` (**first-boot seed**
  of the `allowed_athletes` table, comma-separated; the table is the source of
  truth afterwards — empty table = anyone), `ADMIN_ATHLETE_ID` (the owner; the
  only athlete allowed on `/api/admin/*` and the `#/admin` page; 0 = nobody),
  `SMTP_HOST/PORT/USER/PASSWORD` + `MAIL_FROM`/`MAIL_TO` (alert mail for refused
  sign-ins; empty host/user/password = no mail at all).
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
- OAuth: per-athlete tokens in DB, refresh rotation persisted
  (`src/strava/oauth.ts`); scope `activity:read_all,activity:write` (write
  enables activity rename / re-type). Rate limiting from Strava response headers
  (`src/sync/rateLimiter.ts`).

## Deployment

One-off maintenance script: `apps/server/src/scripts/importActivity.ts` (second
tsup entry → `dist/scripts/importActivity.js`, shipped by the normal rsync)
copies another athlete's activity onto an account, heart rate included. Run it
through `deploy/import-activity.sh --activity <id> [--from|--to <athleteId>]
[--name|--description] [--dry-run]`, which ssh's into the VPS: only that host's
database holds every athlete's tokens, and a refresh **rotates** them, so a run
against a local copy would cost the server its access.

Production: Ubuntu VPS (`ssh crovps`, user ubuntu, passwordless sudo) at
https://strava.pectum.fr — Caddy (basic auth `cro`, bcrypt in
/etc/caddy/Caddyfile, auto-HTTPS) → 127.0.0.1:3001 (`HOST` env pins the
bind). App in /home/ubuntu/stravaboard (server/ dist+migrations, web/ SPA,
data/ sqlite, .env chmod 600); systemd unit `stravaboard` runs
`/usr/local/bin/node22 server/index.js` (nvm symlink) with **`Restart=always`**
— the admin page's restart button exits 0 and relies on systemd to bring the
process back. Scripts:
`deploy/setup-vps.sh` (one-time, idempotent; ensures `COOKIE_SECRET`,
`ALLOWED_ATHLETE_IDS`, `ADMIN_ATHLETE_ID` and copies any `SMTP_*`/`MAIL_*` line
set in the local untracked `.env` — the mailbox password never lands in the
repo), `deploy/deploy.sh
[--skip-checks]` (gates → build → rsync → npm install --omit=dev → restart →
health poll). The runtime package.json is generated from
apps/server/package.json minus the tsup-bundled @stravaboard/shared.
Gotcha: tsup onSuccess must `rm -rf dist/migrations` before copying —
a nested copy breaks the drizzle migrator in production only (dev runs tsx).
