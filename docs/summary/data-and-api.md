# Data model, API, sync

## Multi-user model (family)

Every family member logs in with their own Strava account. Identity = Strava
OAuth; a **signed session cookie** (`session`, `@fastify/cookie`, secret
`COOKIE_SECRET`, ~180 d) holds the athlete id. `src/auth/session.ts`
registers an onRequest guard: every `/api/*` route except `/api/auth/*` and
`/api/health` 401s without a valid cookie and sets `req.athleteId`.
`ALLOWED_ATHLETE_IDS` (comma-separated, empty = anyone) gates the OAuth
callback: denied athletes are redirected to `/?denied=<id>` with nothing
persisted. All data is partitioned by athlete id; routes must never serve
another athlete's rows (ownership check on `/:id/streams` and `/:id/refresh`
returns 404, not 403).

## SQLite schema — `apps/server/src/db/schema.ts`

Migrations in `apps/server/src/db/migrations/` (generate with
`pnpm --filter @stravaboard/server exec drizzle-kit generate --name <slug>`;
applied automatically by `openDb`).

- `athletes`: id (Strava athlete id, PK), displayName (refreshed at each
  login), createdAt.
- `oauth_tokens` (one row PER athlete, PK athlete_id): accessToken,
  refreshToken, expiresAt (epoch s).
- `activities`: id (Strava id, PK — globally unique), **athlete_id** (owner,
  indexed with start_date_epoch), name, sportType, startDate (ISO),
  startDateEpoch, distanceM, movingTimeS, elapsedTimeS, totalElevationGainM,
  **ascentMeanVSpeed** (real, nullable — whole-activity pause-excluded mean
  ascent speed m/h computed from streams with FIXED `STANDARD_SEGMENT_PARAMS`,
  so rankings are settings-independent; NULL = not computed yet, 0 = no
  qualifying ascent; index `idx_activities_athlete_vspeed` on
  (athlete_id, ascent_mean_vspeed) drives the ranked sort),
  streamsStatus `'pending'|'done'|'none'`, rawSummary (full Strava JSON kept verbatim).
- `activity_streams`: activityId (PK, FK), time / distance (JSON number[] text),
  altitude (JSON or NULL), **latlng** (JSON `[lat,lng][]`; **SQL NULL = not
  fetched yet → backfill set; `'[]'` = activity has no GPS, terminal**), fetchedAt.
- `sync_state` (one row per athlete, PK athlete_id): lastActivityStartEpoch
  (checkpoint), status, error.
- `settings`: key/value JSON — key `settings:<athleteId>`, merged over
  `DEFAULT_SETTINGS` on read (so new setting fields get defaults for free;
  stored values are never rewritten).
- Migration `0002_multi_athlete.sql` was HAND-WRITTEN (data-preserving table
  rebuilds + backfill of the single v2 athlete); its snapshot/journal were
  hand-edited too — drizzle-kit generate needs a TTY for rename prompts.
- Migration `0003_activity_metrics.sql` (also hand-written incl.
  snapshot/journal) adds `ascent_mean_vspeed` + `idx_activities_athlete_vspeed`.
  Existing rows stay NULL and are backfilled locally on next sync (no API).

## Repositories — `apps/server/src/repositories/*.repo.ts`

- `activities.repo`: `upsertActivity`, `upsertActivitySummary` (never resets
  streamsStatus), `listActivities(db, {limit, cursor, filter, sort})` with
  `ActivityFilter {q, fromEpoch, toEpochExclusive, sportType}` (q uses LIKE
  with `ESCAPE '\'`, wildcards escaped by `escapeLike`; ASCII-case-insensitive
  only) and `ActivitySort 'date'|'ascentSpeed'|'elevation'`. **Composite keyset
  cursor** `{value, id}` (`sortValueExpr` COALESCEs the metric to `METRIC_NULL
= -1`, orders `value DESC, id DESC`; WHERE `value < c.value OR (value =
c.value AND id < c.id)`); `cursorFor(sort,row)`→`"<value>:<id>"`,
  `parseCursor(str)`. `topByAscentSpeed`/`topByElevation` (metric/elevation > 0,
  top-N ids for badges, take an optional `ActivityFilter` so badges match the
  visible list); `setAscentMeanVSpeed`, `listMissingMetrics` (rows with
  streams but NULL metric, for local backfill). Filter predicates are shared by
  the list and the rankings via `filterConditions(filter)`. `listSportTypes`
  (distinct, sorted, **only analyzable types**: ≥1 activity with
  `totalElevationGainM > 0`), `listPendingStreams`/`count…`,
  `listStreamsMissingLatlng`/
  `countStreamsMissingLatlng` (streams_status='done' AND latlng IS NULL, oldest
  first), `toSummary` (includes `ascentMeanVSpeed`).
- `streams.repo`: `saveStreams` (upsert; latlng null→SQL NULL, array→JSON),
  `getStreams` (API mapping returns `latlng: null` for BOTH NULL and `[]`).
- `settings.repo`, `syncState.repo`, `tokens.repo`: single-row get/save.

## HTTP API (all under `/api`, routes in `apps/server/src/routes/`)

- `GET /health` → `{status:'ok'}` (app.ts) — the only always-public data route.
- `GET /auth/status` → `{connected, athleteId?, name?}` from the session;
  `GET /auth/strava/login` → redirect; `GET /auth/strava/callback` → code
  exchange (exchangeCode does NOT persist; the callback checks the allowlist,
  then saves tokens + athlete and sets the cookie), starts sync, redirects;
  `POST /auth/logout` clears the cookie. All other routes below require the
  session and are scoped to `req.athleteId`.
- `GET /config` → `{maptilerKey: string|null}` (config.ts; null when unset).
- `GET/PUT /settings` — zod: instantWindowS 1–600, shortWindowS 1–3600,
  longWindowS 1–7200, ascentMinGainM 1–1000, ascentDescentToleranceM 0–500,
  pauseThresholdS int 5–600, slopeWindowM int 10–2000. PUT requires the full
  object.
- `POST /sync` (202 fire-and-forget); `GET /sync/status` → `SyncStatus`
  (state, fetchedActivities, pendingStreams, pendingLatlngBackfill,
  rateLimitResumeAt?, error?).
- `GET /activities?limit&before&sort&q&from&to&sportType` → `ActivitiesPage`.
  `sort` = `date`(default)|`ascentSpeed`|`elevation`. `before` is the composite
  cursor `"<value>:<id>"` (exclusive), always newest/highest first; filters
  compose with it. `nextBefore` is built with `cursorFor` for the chosen sort.
  `from`/`to` are `YYYY-MM-DD`, `to` inclusive (implemented as `< to+86400`).
  Invalid query or malformed cursor → 400.
- `GET /activities/badges?q&from&to&sportType` → `ActivityBadges
{ascentSpeed:number[], elevation:number[]}` — top-3 activity ids per ranking
  (metric/elevation > 0) **within the same filter as the list**, so a filtered
  view badges its own best. For the 🥇🥈🥉 medals in the list.
- `GET /activities/sport-types` → `string[]` distinct sorted, **only analyzable
  types** (≥1 activity with `totalElevationGainM > 0`); indoor/flat types
  (trainer, weights, pool) never clutter the filter.
- `POST /activities/:id/refresh` → re-fetches summary + streams from Strava
  (for activities edited/cropped on strava.com); 200 `ActivitySummary`,
  404 unknown locally OR gone from Strava (local data untouched), 429 with
  `resumeAt` on rate limit. Streams gone → status 'none', stale rows deleted.
- `GET /activities/:id/streams` → `ActivityStreams` (shared type:
  `{time, distance, altitude|null, latlng|null}`); 404 with `streamsStatus`
  when absent.

## Strava client & sync — `apps/server/src/strava/`, `src/sync/syncService.ts`

- `StravaClient.getStreams` requests `keys=time,distance,altitude,latlng`
  (`key_by_type=true`). Add new stream kinds here + `strava/types.ts`
  (`StravaStreamSet`) + `toStoredStreams()` in syncService + schema/migration +
  streams.repo + shared `ActivityStreams`.
- `StravaClient` methods all take `athleteId` first (token refresh is
  per-athlete via `ensureFreshToken(config, db, athleteId, …)`); the
  RateLimiter stays shared — Strava limits are per application.
  `SyncService.refreshActivity(id)` derives the athlete from the stored row.
- `SyncService.run()` iterates `listConnectedAthleteIds` sequentially; one
  athlete's failure records its error state and continues with the next.
  Per athlete: three passes, each wrapped in `retryingOnRateLimit`
  (sleeps through 429/limit windows; transient `TypeError: fetch failed`
  retried with backoff, budget reset on progress via `progressMarker()`):
  1. `fetchNewSummaries` — pages `?after=checkpoint-1`, upserts summaries as
     pending.
  2. `fetchPendingStreams` — per pending activity oldest-first: fetch streams,
     save, mark done (404 → 'none'), then advance checkpoint. Stores latlng
     (missing stream → `[]`), so new syncs never create NULL latlng. Saving
     goes through `storeStreams`, which also computes and persists
     `ascentMeanVSpeed` (`activityAscentMean(streams) ?? 0`). `runFor` starts
     with `computeMissingMetrics` — a local, no-API backfill over
     `listMissingMetrics` so legacy rows get the metric.
  3. `backfillLatlng` — batches of `listStreamsMissingLatlng(50)`, re-fetches
     the full stream set (`refetchStreamsFor`); on 404 rewrites existing
     streams with `latlng: []`. **Invariant: every visit writes non-NULL
     latlng → each legacy activity fetched at most once ever; progress lives
     in the column (resumable for free). Runs last so it can't starve new
     activities.**
