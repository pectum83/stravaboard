# stravaBoard

Private dashboard for analysing the **vertical speed** of your Strava activities.
It syncs your activities (with their time/distance/altitude/GPS streams) into a
local SQLite database and plots five vertical-speed series over distance:

- **Instant** — computed over a 60 s window (configurable)
- **Short-term** — 120 s window (configurable)
- **Long-term** — 5 min window (configurable)
- **Ascent mean** — mean vertical speed of each detected ascent, small descents
  inside a climb filtered out (thresholds configurable), the value written at
  the right end of each segment
- **Descent mean** — the exact mirror for descents, drawn below zero

Ascent/descent means exclude **pauses**: periods where the GPS position stays
within ~5 m for more than 30 s (threshold configurable) — detected from
position, not from GPS speed. Whole-activity ascent and descent means are shown
above the chart. A **map panel** beside the chart shows the activity trace with
streets / satellite / 3D-terrain layers, and hovering the chart moves a marker
along the trace. The activity list can be **filtered** by word, date range and
sport type.

## Stack

pnpm workspaces monorepo:

| Package           | What                                                                      |
| ----------------- | ------------------------------------------------------------------------- |
| `apps/web`        | Vue 3 (Composition API, TS) + Vite + Apache ECharts + MapLibre GL + Pinia |
| `apps/server`     | Fastify (TS) + Drizzle ORM on better-sqlite3                              |
| `packages/shared` | Shared types + the pure vertical-speed/pause algorithms                   |
| `e2e`             | Playwright tests against a seeded server (fully offline)                  |

## Prerequisites

- Node 22 (`nvm use` picks it up from `.nvmrc`)
- pnpm (`corepack enable pnpm`)
- A Strava API application — create one at
  <https://www.strava.com/settings/api>:
  - **Authorization Callback Domain**: `localhost`
  - Note the **Client ID** and **Client Secret**
- Optional: a free MapTiler key (<https://cloud.maptiler.com/account/keys/>)
  for the satellite and 3D map layers. Without it the map falls back to plain
  OpenStreetMap.

## Setup

```bash
pnpm install
cp .env.example .env
# fill STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET (and MAPTILER_KEY) in .env
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

**Upgrading from v1:** activities synced before GPS tracks were stored are
re-fetched once (streams only) by an automatic backfill pass at the end of the
next sync. It respects the same rate limits and resumes across restarts; the
map shows "No GPS trace" for an activity until its backfill has run. Settings
already saved in v1 keep their values (the new defaults — instant 60 s, short
120 s — only apply to fresh databases); adjust them in the Settings panel.

## Quality gates

```bash
pnpm lint          # ESLint over the whole repo
pnpm format:check  # Prettier
pnpm typecheck     # tsc / vue-tsc per package
pnpm test          # Vitest unit + API tests (all packages) + Playwright e2e
pnpm test:coverage # unit tests with coverage thresholds enforced
pnpm build         # production builds
pnpm e2e           # Playwright suite alone (needs `pnpm build` first)
```

Tests never call the real Strava API or any map tile server: unit and API
tests inject a stubbed `fetch`, and the e2e suite runs the real server against
a local Strava stub with a seeded database (`e2e/seed.ts`) and route-stubs all
MapTiler/OSM traffic.

CI (`.github/workflows/ci.yml`) runs lint, format, typecheck, tests with
coverage (shared ≥ 90 %, server ≥ 80 %), builds, and the e2e suite on every
push and pull request.

## How the sync works

1. `GET /athlete/activities?after=<checkpoint>` pages through everything newer
   than the last fully-imported activity (oldest first) and stores summaries.
2. Each pending activity's time/distance/altitude/latlng streams are fetched
   and stored; the checkpoint advances only after an activity's streams are
   safely in the database, so interruptions resume exactly where they stopped.
3. A backfill pass re-fetches streams for activities stored before the GPS
   column existed (NULL `latlng` marks them; `[]` means "no GPS", terminal),
   each at most once ever.
4. Activities without streams (manual entries, trainer rides) are marked and
   shown greyed-out with a "no elevation data" badge.
5. Strava rotates refresh tokens on every refresh; the server always persists
   the newest one.

## Data

Everything lives in one SQLite file (`DATABASE_PATH`, default
`apps/server/data/stravaboard.sqlite` in dev). Raw streams are kept verbatim,
so future chart types need no re-sync. Back it up by copying the file.

## Deployment

The design is deployment-ready for a VPS: the server can serve the built web
app itself (`WEB_DIST_PATH`), all configuration is environment-based, and the
OAuth redirect derives from `APP_BASE_URL`.
**Before exposing it on the internet, put it behind authentication** (e.g.
reverse-proxy basic auth) — the API grants read access to all your private
activities, and `/api/config` exposes your MapTiler key to any visitor.
