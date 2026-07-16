# Data model, API, sync

## SQLite schema — `apps/server/src/db/schema.ts`

Migrations in `apps/server/src/db/migrations/` (generate with
`pnpm --filter @stravaboard/server exec drizzle-kit generate --name <slug>`;
applied automatically by `openDb`).

- `oauth_tokens` (single row id=1): athleteId, accessToken, refreshToken, expiresAt (epoch s).
- `activities`: id (Strava id, PK), name, sportType, startDate (ISO),
  startDateEpoch, distanceM, movingTimeS, elapsedTimeS, totalElevationGainM,
  streamsStatus `'pending'|'done'|'none'`, rawSummary (full Strava JSON kept verbatim).
- `activity_streams`: activityId (PK, FK), time / distance (JSON number[] text),
  altitude (JSON or NULL), **latlng** (JSON `[lat,lng][]`; **SQL NULL = not
  fetched yet → backfill set; `'[]'` = activity has no GPS, terminal**), fetchedAt.
- `sync_state` (single row): lastActivityStartEpoch (checkpoint), status, error.
- `settings`: key/value JSON — single key `'settings'`, merged over
  `DEFAULT_SETTINGS` on read (so new setting fields get defaults for free;
  stored values are never rewritten).

## Repositories — `apps/server/src/repositories/*.repo.ts`

- `activities.repo`: `upsertActivity`, `upsertActivitySummary` (never resets
  streamsStatus), `listActivities(db, {limit, beforeEpoch, filter})` with
  `ActivityFilter {q, fromEpoch, toEpochExclusive, sportType}` (q uses LIKE
  with `ESCAPE '\'`, wildcards escaped by `escapeLike`; ASCII-case-insensitive
  only), `listSportTypes` (distinct, sorted), `listPendingStreams`/`count…`,
  `listStreamsMissingLatlng`/`countStreamsMissingLatlng` (streams_status='done'
  AND latlng IS NULL, oldest first), `toSummary`.
- `streams.repo`: `saveStreams` (upsert; latlng null→SQL NULL, array→JSON),
  `getStreams` (API mapping returns `latlng: null` for BOTH NULL and `[]`).
- `settings.repo`, `syncState.repo`, `tokens.repo`: single-row get/save.

## HTTP API (all under `/api`, routes in `apps/server/src/routes/`)

- `GET /health` → `{status:'ok'}` (app.ts)
- `GET /auth/status`; `GET /auth/strava/login` → redirect;
  `GET /auth/strava/callback` → token exchange, starts sync, redirects.
- `GET /config` → `{maptilerKey: string|null}` (config.ts; null when unset).
- `GET/PUT /settings` — zod: instantWindowS 1–600, shortWindowS 1–3600,
  longWindowS 1–7200, ascentMinGainM 1–1000, ascentDescentToleranceM 0–500,
  pauseThresholdS int 5–600. PUT requires the full object.
- `POST /sync` (202 fire-and-forget); `GET /sync/status` → `SyncStatus`
  (state, fetchedActivities, pendingStreams, pendingLatlngBackfill,
  rateLimitResumeAt?, error?).
- `GET /activities?limit&before&q&from&to&sportType` → `ActivitiesPage`.
  Keyset cursor `before` = startDateEpoch (exclusive), newest first; filters
  compose with the cursor. `from`/`to` are `YYYY-MM-DD`, `to` inclusive
  (implemented as `< to+86400`). Invalid query → 400.
- `GET /activities/sport-types` → `string[]` distinct sorted.
- `GET /activities/:id/streams` → `ActivityStreams` (shared type:
  `{time, distance, altitude|null, latlng|null}`); 404 with `streamsStatus`
  when absent.

## Strava client & sync — `apps/server/src/strava/`, `src/sync/syncService.ts`

- `StravaClient.getStreams` requests `keys=time,distance,altitude,latlng`
  (`key_by_type=true`). Add new stream kinds here + `strava/types.ts`
  (`StravaStreamSet`) + `toStoredStreams()` in syncService + schema/migration +
  streams.repo + shared `ActivityStreams`.
- `SyncService.run()` = three passes, each wrapped in `retryingOnRateLimit`
  (sleeps through 429/limit windows; transient `TypeError: fetch failed`
  retried with backoff, budget reset on progress via `progressMarker()`):
  1. `fetchNewSummaries` — pages `?after=checkpoint-1`, upserts summaries as
     pending.
  2. `fetchPendingStreams` — per pending activity oldest-first: fetch streams,
     save, mark done (404 → 'none'), then advance checkpoint. Stores latlng
     (missing stream → `[]`), so new syncs never create NULL latlng.
  3. `backfillLatlng` — batches of `listStreamsMissingLatlng(50)`, re-fetches
     the full stream set (`refetchStreamsFor`); on 404 rewrites existing
     streams with `latlng: []`. **Invariant: every visit writes non-NULL
     latlng → each legacy activity fetched at most once ever; progress lives
     in the column (resumable for free). Runs last so it can't starve new
     activities.**
