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

Bad GPS is filtered out: altitude **spikes are despiked** before any analysis
(so a stray fix at the end of a track no longer invents a climb), sustained
**noise bursts are flattened** — the garbage a submerged watch records during a
mid-hike lake swim (readings bouncing hundreds of meters up AND down within a
minute, which used to add thousands of fake descent meters) is replaced by the
altitude where the burst started — and
**fast climbs above a cap** — mechanical ski lifts (even slow resort ones,
~1450 m/h), or artefacts faster than any human ascent — are shown greyed on the
chart and left out of the ascent mean, badges and sort (descents aren't capped,
since skiing/running downhill is genuinely fast). The cap is the
**Lift/artefact cap** setting (default 1400 m/h); the chart and the ranking use
the same value.

Ascent/descent means exclude **pauses**: periods where the GPS position stays
within a small radius (the **Pause radius** setting, default 5 m) for longer
than the **Pause threshold** (default 30 s) — detected from position, not from
GPS speed. A break interrupted by a short nearby wander (stepping away for a
photo and sitting back down) counts as **one** pause, wander included, instead
of a string of separate markers; and a "pause" during which the altitude keeps
changing (slow steep climbing) or the GPS track is frozen while the distance
advances (lost GPS fix) is discarded as movement. Each excluded pause is marked
with a small round token on the chart's baseline, the pause length in seconds
inside it, so you can see where and how long you stopped. Above the chart, a stats strip shows the
activity **length**, **total duration** (elapsed and moving), the **total paused
time**, and the whole-activity ascent and descent means. A **map panel** beside
the chart shows the activity trace with
streets / **topo** (contour lines + hillshade) / satellite / 3D-terrain layers,
and hovering the chart moves a marker
along the trace. The activity list can be **filtered** by word, date range and
sport type (all gathered in a collapsible "Filters & sort" section) and
**sorted** by date, best mean ascent speed, climbing gain, **most descent**
(total D− — useful for point-to-point outings like alpine ski or multi-day
treks, where you descend far more than you climb; when sorted this way each row
shows its D−), or **best effort** (the 💪 km-effort score below; each row then
shows its score). Just above the list, a line totals the **number of activities**
in the current filter and their **cumulated D+**. The list
opens on **Hike** by default when you have any hikes. The three best activities
in each ranking get 🥇🥈🥉 **badges**, tagged ⚡ for the ascent-speed podium,
⬆️ for the climbing-gain one and 💪 for **effort** — a combined score in
"km-effort" (equivalent flat kilometres): `distance (km) + D+/100 × Vspeed/400`.
The base is the classic mountaineering equivalence (100 m of climb ≈ 1 km on
the flat), so a long flat walk earns its full distance; the climb part is then
scaled by your mean ascent speed against a 400 m/h reference, so the same
1000 m D+ counts more when climbed fast. Badges are computed within the
current filter, so a filtered view badges its own best, and the mean ascent
speed is shown on every activity. The **D+** and the climbing-gain ranking count only the real climbing
you did (the same lift/artefact-excluded ascents as above), so a day with a lift
ranks on what you skinned, not what the lift gave you — this can read lower than
Strava's total elevation gain. The sport-type filter lists only **analyzable** sports (those with
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
  for the topo (contour), satellite and 3D map layers. Without it the map falls
  back to plain OpenStreetMap.

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
The mean-ascent-speed ranking (and the climbing-gain and descent figures) used
for sorting, badges and the list is computed from your own analysis settings, so
it always matches the chart: changing the pause threshold, pause radius, minimum
gain, tolerance or lift cap re-ranks your activities and updates the list figures
right away (recomputed locally, no extra Strava calls). Window and slope settings only
affect the chart.

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

1. Open the **admin page** (`/#/admin`, the _Admin_ link next to your name —
   only the owner sees it) and add their Strava athlete id. It takes effect
   immediately, no restart needed.
2. Check the Strava API application's **athlete capacity** at
   <https://www.strava.com/settings/api> — new apps may be limited to one
   connected athlete until an increase is requested.
3. They open the site, click **Connect with Strava**, and their history
   starts syncing.

If somebody signs in before being added, they are refused: the sign-in page
shows their athlete id, and — when the SMTP settings are filled in (see
`.env.example`) — the owner receives an email with the id and name, at most one
per athlete per hour. `ALLOWED_ATHLETE_IDS` in the `.env` only seeds the list
the first time the app runs; after that the admin page is the source of truth.

The admin page also has a **Restart the server** button, for the rare case where
you edited the server's `.env` by hand and need it reloaded.

## Borrowed someone else's watch?

If you recorded an outing on another family member's watch, the activity — and
its heart rate — lands on _their_ Strava, so yours never scores the effort.
The admin page's **Import an activity from another account** panel fixes that:
pick the account, pick the activity (only the ones with a ❤️ can be imported),
adjust the name, and click _Import onto my account_. Behind the scenes the
recording is rebuilt as a TCX file and uploaded to your account, so Strava
recomputes your Relative Effort and fitness curve with your own heart-rate
zones. It takes a few seconds; the panel then links to the new activity.

The imported activity appears in stravaBoard immediately — it is stored on the
spot, because the regular sync only asks Strava for activities _started_ after
the last one it knows, and an import is backdated by definition. Their copy
stays on their account (Strava's API cannot delete it); importing the same
activity twice simply points you back at the copy you already have. If you already created your
own copy of that day by hand, delete it on strava.com first — heart rate cannot
be added to an existing activity.

The same import is available from a shell, for scripting:

```bash
deploy/import-activity.sh --activity 19790883454 --dry-run   # inspect first
deploy/import-activity.sh --activity 19790883454
```

## The recording stopped halfway through

A watch that stops at the top of a climb leaves one outing on Strava as two
activities. Strava has no merge, and its API cannot add samples to an existing
activity, so the fix is to build a single file covering both — and invent the
stretch nobody recorded. `deploy/merge-activities.sh` does that: the athlete
stands still where the first recording ended, then walks to where the second
one starts, with a heart rate that recovers and climbs back the way a real one
would.

```bash
# 1. Build it and look at it. Nothing is sent to Strava.
deploy/merge-activities.sh --first 20254065755 --second 20256244123 \
  --name "Plateau du Vercors" --pause 1440 --dry-run
#    → merge-artifacts/: the TCX, a GeoJSON of the invented stretch to drop on
#      a map, and a snapshot of both activities.

# 2. Delete both originals on strava.com. Strava refuses an upload that
#    overlaps an existing activity, and the merged file starts where the first
#    one did. The snapshot from step 1 is now the only copy of their heart
#    rate and cadence — keep it until the merge is on Strava.

# 3. Upload, reading everything from the snapshot.
deploy/merge-activities.sh --from-snapshot merge-artifacts/stravaboard-merge.sources.json \
  --name "Plateau du Vercors" --pause 1440
```

`--pause <seconds>` and `--speed <m/s>` are two ways of saying the same thing:
give one and the other follows from the distance between the two ends.

**Check the invented line against the ground.** Strava recomputes elevation from
its own terrain model when it takes in an uploaded file, so the merged activity
shows whatever the terrain does under the path — not the altitudes in the file.
A straight line between two points of a mountain outing happily walks through a
ravine, and the result is a hiker who dives 200 m and climbs back out in a
quarter of an hour. Look at the GeoJSON on a map, and route around with
`--via "lat,lng;lat,lng"`; leave the walk enough of the gap that the climb rate
stays believable. The
merged activity is stored in stravaBoard straight away, like an import; run a
sync from the admin page to fetch its streams. The two originals keep their
rows in stravaBoard until you delete them there too.

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
