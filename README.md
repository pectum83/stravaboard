# stravaBoard

Private dashboard for analysing the **vertical speed** of your Strava activities.
It syncs your activities (with their altitude/time/distance streams) into a local
SQLite database and plots four vertical-speed series over distance:

- **Instant** — computed over a 2 s window (configurable)
- **Short-term** — 60 s window (configurable)
- **Long-term** — 5 min window (configurable)
- **Ascent mean** — mean vertical speed of each detected ascent, with small
  descents inside a climb filtered out (thresholds configurable)

## Stack

pnpm workspaces monorepo:

| Package           | What                                                        |
| ----------------- | ----------------------------------------------------------- |
| `apps/web`        | Vue 3 (Composition API, TS) + Vite + Apache ECharts + Pinia |
| `apps/server`     | Fastify (TS) + Drizzle ORM on better-sqlite3                |
| `packages/shared` | Shared types + the pure vertical-speed algorithms           |
| `e2e`             | Playwright smoke tests against a seeded server              |

## Prerequisites

- Node 22 (`nvm use` picks it up from `.nvmrc`)
- pnpm (`corepack enable pnpm`)
- A Strava API application — create one at
  <https://www.strava.com/settings/api>:
  - **Authorization Callback Domain**: `localhost`
  - Note the **Client ID** and **Client Secret**

## Setup

```bash
pnpm install
cp .env.example .env
# fill STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env
```

## Development

```bash
pnpm dev
```

- Web app: <http://localhost:5173> (proxies `/api` to the server)
- API server: <http://localhost:3001>

Open the web app and click **Connect with Strava**. After the OAuth grant the
server starts syncing your history automatically; progress is shown in the top
bar. Strava's rate limits (200 requests / 15 min, 2000 / day) mean a large
history takes a while on first sync — the sync checkpoints after every activity
and resumes on its own (even across restarts), so you can leave it running or
stop it at any point. Every later launch only imports what's new.

## Quality gates

```bash
pnpm lint          # ESLint over the whole repo
pnpm format:check  # Prettier
pnpm typecheck     # tsc / vue-tsc per package
pnpm test          # Vitest unit + API tests (all packages)
pnpm test:coverage # same, with coverage thresholds enforced
pnpm build         # production builds
pnpm e2e           # Playwright smoke suite (needs `pnpm build` first)
```

Tests never call the real Strava API: unit and API tests inject a stubbed
`fetch`, and the e2e suite runs the real server against a local Strava stub
with a seeded database (`e2e/seed.ts`).

CI (`.github/workflows/ci.yml`) runs lint, format, typecheck, tests with
coverage (shared ≥ 90 %, server ≥ 80 %), builds, and the e2e suite on every
push and pull request.

## How the sync works

1. `GET /athlete/activities?after=<checkpoint>` pages through everything newer
   than the last fully-imported activity (oldest first) and stores summaries.
2. Each pending activity's altitude/time/distance streams are fetched and
   stored; the checkpoint advances only after an activity's streams are safely
   in the database, so interruptions resume exactly where they stopped.
3. Activities without streams (manual entries, trainer rides) are marked and
   shown greyed-out with a "no elevation data" badge.
4. Strava rotates refresh tokens on every refresh; the server always persists
   the newest one.

## Data

Everything lives in one SQLite file (`DATABASE_PATH`, default
`apps/server/data/stravaboard.sqlite` in dev). Raw streams are kept verbatim,
so future chart types need no re-sync. Back it up by copying the file.

## Deployment

V1 targets local use. The design is deployment-ready for a VPS: the server can
serve the built web app itself (`WEB_DIST_PATH`), all configuration is
environment-based, and the OAuth redirect derives from `APP_BASE_URL`.
**Before exposing it on the internet, put it behind authentication** (e.g.
reverse-proxy basic auth) — the API grants read access to all your private
activities.
