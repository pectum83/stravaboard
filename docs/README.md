# stravaBoard

Private **family** dashboard for analysing the **vertical speed** of Strava
activities. Each family member signs in with their own Strava account (an
allowlist of athlete ids keeps strangers out) and sees strictly their own
data. Activities sync (with their time/distance/altitude/GPS streams) into a
local SQLite database, and the chart plots five vertical-speed series over
distance:

- **Instant** — computed over a 60 s window (configurable)
- **Short-term** — 120 s window (configurable)
- **Long-term** — 5 min window (configurable)
- **Ascent mean** — mean vertical speed of each detected ascent, small descents
  inside a climb filtered out (thresholds configurable), the value written at
  the right end of each segment
- **Descent mean** — the exact mirror for descents, drawn below zero
- **Terrain slope** — the grade in % over a 100 m distance window
  (configurable), dashed on its own right-side axis

Ascent/descent means exclude **pauses**: periods where the GPS position stays
within ~5 m for more than 30 s (threshold configurable) — detected from
position, not from GPS speed. Whole-activity ascent and descent means are shown
above the chart. A **map panel** beside the chart shows the activity trace with
streets / satellite / 3D-terrain layers, and hovering the chart moves a marker
along the trace. The activity list can be **filtered** by word, date range and
sport type (all gathered in a collapsible "Filters & sort" section) and
**sorted** by date, best mean ascent speed, or total elevation gain. The list
opens on **Hike** by default when you have any hikes. The three best activities
in each ranking get 🥇🥈🥉 **badges** — computed within the current filter, so a
filtered view badges its own best — and the mean ascent speed is shown on every
activity. The sport-type filter lists only **analyzable** sports (those with
elevation data), so indoor/flat activity types don't clutter it. A
**"↻ Reload from Strava"** button
re-fetches the selected activity (data and streams) — use it after cropping or
otherwise editing an activity on strava.com. Each activity can also be
**renamed and re-typed inline**: hover a row (or select it on a phone) and click
the ✎ pencil to edit its name and sport type. The change is **written straight
back to Strava** — it appears in your feed and the mobile app — so it needs the
write permission; the first time, log out and reconnect to grant it. The layout is
responsive: on phones the
list, chart and map stack vertically and the chart switches to a compact
rendering.

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
The mean-ascent-speed ranking used for sorting and badges is computed with
fixed standard parameters, so it stays stable regardless of your chart
settings; it is backfilled locally (no extra Strava calls) on the next sync.

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

## Family accounts

Authentication IS the Strava login: the OAuth callback creates the account,
sets a long-lived signed session cookie, and everything the API serves is
scoped to that athlete. Sync runs per athlete (shared Strava rate limit);
settings, filters and stats are personal.

To add a family member:

1. Add their Strava athlete id to `ALLOWED_ATHLETE_IDS` in the `.env`
   (comma-separated) and restart the server. If they sign in before being
   added, the sign-in page shows their id — copy it from there.
2. Check the Strava API application's **athlete capacity** at
   <https://www.strava.com/settings/api> — new apps may be limited to one
   connected athlete until an increase is requested.
3. They open the site, click **Connect with Strava**, and their history
   starts syncing.

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

Production runs on a VPS at <https://strava.pectum.fr> behind Caddy
(automatic Let's Encrypt HTTPS). Access control is the app's own Strava
login + `ALLOWED_ATHLETE_IDS` allowlist — every API route except the auth
flow and `/api/health` requires the session cookie. The Fastify server
serves the built web app itself and binds `127.0.0.1:3001` so nothing
bypasses the proxy.

Layout on the VPS (`/home/ubuntu/stravaboard`): `server/` (bundled dist +
migrations), `web/` (built SPA), `data/stravaboard.sqlite`, `.env`,
`package.json` + `node_modules` (5 runtime deps). Runs as the `stravaboard`
systemd unit on Node 22 (`/usr/local/bin/node22`, an nvm symlink).

- `deploy/setup-vps.sh [host]` — one-time, idempotent provisioning: Node 22,
  Caddy, app layout, systemd unit, production `.env` (copies the Strava/
  MapTiler keys from the local `.env`), Caddyfile with a generated basic-auth
  password (printed once).
- `deploy/deploy.sh [--skip-checks] [host]` — every release: quality gates,
  build, rsync artifacts, install runtime deps, restart, health check.

Notes:

- The Strava app's **Authorization Callback Domain** must be the production
  hostname for OAuth grants made through the site.
- Strava refresh tokens rotate: after the VPS syncs once, a local dev
  instance sharing the copied database will eventually need its own
  re-connect. Treat the VPS as the primary instance.
