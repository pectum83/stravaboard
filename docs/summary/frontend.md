# Frontend — `apps/web/src/`

Single page, no router. Entry `main.ts` → `App.vue` → `pages/DashboardPage.vue`.
Scoped CSS, light palette only, no CSS framework.

**Responsive**: one breakpoint, `(max-width: 900px)` (`COMPACT_MEDIA_QUERY` in
`composables/useMediaQuery.ts`). Below it DashboardPage stacks vertically
(full-width list capped at 38vh, chart 380px, map 320px, page scrolls,
controls wrap) and the chart renders in compact mode (see buildChartOptions).
`index.html` sets `viewport-fit=cover`; `.dashboard` uses `100dvh` +
`env(safe-area-inset-*)` for iPhone notch/Dynamic Island.

## Data flow

- `api/client.ts` — typed fetch wrappers: `authStatus`, `activities(params)`
  (`ActivityListParams {limit, before, sort, q, from, to, sportType}`; `sort:
ActivitySort 'date'|'ascentSpeed'|'elevation'|'descent'`, omitted when `'date'`),
  `badges(params?)` (`ActivityBadgeParams` = the list filter minus paging/sort →
  `ActivityBadges`), `stats(params?)` (same filter → `ActivityAggregate {count,
totalAscentGainM}`), `sportTypes()`, `refreshActivity(id)` (POST),
  `config()` (`{maptilerKey}`), `streams(id)`, `settings`/`saveSettings`,
  `startSync`, `syncStatus`, `updateActivity(id, {name?, sportType?})` (PATCH).
  Errors → `ApiError(status)`.
- `stores/settings.ts` (Pinia setup store) — `settings` seeded from
  `DEFAULT_SETTINGS`; `load()` GET; `update(patch)` applies immediately,
  **debounced 500 ms PUT** of the full object; `saveError`. Tracks whether any
  change coalesced into the pending PUT touches a `METRIC_SETTING_KEYS` field and,
  on a successful save, bumps `metricsRecomputedAt` (the server recomputed the
  stored metrics) — DashboardPage watches it to reload the list/badges/totals.
- `stores/activities.ts` — list + composite-cursor pagination (PAGE_SIZE 50) +
  selection
  - **filters**: `filters: ActivityFilters {q, from, to, sportType}` ('' = off),
    `EMPTY_FILTERS`, `setFilters(patch)` merges then resets list & reloads,
    `loadMore()` sends only non-empty filters + the active sort, `sportTypes`
    loaded with the first page, `select(id)`.
  - **sort & badges & totals**: `sort` ref (default `'date'`), `setSort(next)`
    resets & reloads; `badges` ref (`NO_BADGES` default) + `aggregate` ref
    (`{count,totalAscentGainM}`, the whole-filter totals for the list header);
    `loadBadges()`/`loadAggregate()` send the active filter (`activeFilterParams()`)
    so both reflect only the visible set. `loadFirstPage`, `setFilters` and
    `refreshActivity` reload badges **and** the aggregate (a reload can change a
    ranking or the totals). `reload()` re-runs the current query in place;
    `reloadRankings()` = `reload` + `loadBadges` + `loadAggregate` (after a change
    that can re-rank, e.g. a metric-affecting settings change the server recomputed).
  - **default sport**: `loadFirstPage` loads sport types first, then opens on
    `DEFAULT_SPORT_TYPE = 'Hike'` when it's among them and the user hasn't
    touched the sport filter (`sportTypeTouched`, set by any `setFilters` sport
    change incl. Clear). No hikes → stays unfiltered; the choice survives
    re-syncs.
- `composables/useStreams.ts` — watches selected id, module-level
  `Map<number, ActivityStreams>` cache, 404 → `missing`; returns `reload()`
  which evicts the current id from the cache and refetches.
- Store `refreshActivity(id)` calls the refresh endpoint and replaces the
  summary in place (throws on failure — callers surface the error).
- Store `editActivity(id, {name?, sportType?})` PATCHes the activity (written
  through to Strava), replaces the summary in place, and reloads `sportTypes`
  when the sport type changed (throws on failure).

## Auth UX

Sign-in page = the app itself when `authStatus` says disconnected ("Connect
with Strava" link → OAuth). `?denied=<athleteId>` after a refused login shows
the id so the admin can extend the allowlist. When connected, the sync bar's
slot shows the athlete name + "Log out" (POST logout then hard reload).

## DashboardPage

Layout: `SyncStatusBar` on top; aside 320 px = `ActivityFilters` + a
`.list-summary` line (`listSummary` computed: "N activities · D+ … m" from
`store.aggregate`) + `ActivityList` (in `.list-wrap`); main = `.controls` row
(`SettingsPanel`, "↻ Reload from Strava" button when an activity is selected —
store refresh + `reloadStreams()`, inline error — and `ActivityStats` pushed
right) then `.visuals` flex row = `.chart-area` (flex 2, `VerticalSpeedChart`) +
`.map-area` (flex 1, `MapPanel`, only when streams loaded). Computes `model =
computeVSpeedModel(streams, settings)` once (null unless streams have altitude);
`hoverIndex` ref bridges chart → map. `ActivityStats` also receives the selected
summary's distance/elapsed/moving. Fetches `api.config()` on mount for the
MapTiler key. Watches `settingsStore.metricsRecomputedAt` and calls
`activitiesStore.reloadRankings()` so a metric-affecting settings change refreshes
the list/badges/totals (the chart already reacts to `settings` via `model`).

## Chart

- `chart/computeVSpeed.ts` — `computeVSpeedModel(streams, settings) →
VSpeedModel {streams, instant, short, long, ascents, descents, excludedAscents,
pauses, pausedS, ascentStats, descentStats}` (`pausedS` = Σ pause durations, the
  total excluded-pause time shown in the stats). Altitude is `despike`d once at entry
  (feeds every series/slope/segment); the instant series then runs
  `medianFilter(alt, 5)` on top. Ascents are split via `partitionSegments(...,
settings.liftMaxVSpeed)`: lift/artefact climbs above the cap go to
  `excludedAscents` and out of `ascents`/`ascentStats`; descents are not capped.
  Single computation point for chart + stats + segments. Streams whose
  time/distance/altitude lengths disagree (a missing/partial distance stream)
  return an **empty model** rather than throwing deep in a windowing helper.
- `chart/buildChartOptions.ts` — **rendering only**, `(model, settings) →
EChartsOption`. `toPairs` collapses a run of samples at the SAME distance to one
  point (a stop freezes distance while time advances, so many samples share one
  x — plotted raw they stack into a vertical spike and duplicate the tooltip
  rows). 6 line series (7 when there are excluded climbs); colors =
  validated dataviz categorical slots (blue/aqua/yellow instant/short/long, green
  ascent, magenta `#e87ba4` descent, violet `#4a3aa7` slope — orange failed
  validation next to magenta; sub-3:1 colors are relieved by direct end-labels).
  A muted-grey (`#898781`) `Excluded (lift/artefact)` segment series is inserted
  before slope **only when `model.excludedAscents` is non-empty**. A `Pauses`
  series (also only when `model.pauses` is non-empty) draws one round token per
  excluded pause on the baseline (`[distance[startIndex]/1000, 0]`) with the
  duration in seconds inside — an invisible width-0 line with null-separated
  circle symbols (`symbolSize 20`), the neutral ink `#52514e` (not a categorical
  hue), white inside-label. The slope series is
  dashed on a second right-side `%` yAxis (`yAxisIndex: 1`, `alignTicks` so
  zero lines match) with its own tooltip valueFormatter. Third param
  `{compact}` (phones): tighter grid, no series-name endLabels and no `m/h`
  axis name (both collide with the two-row wrapped legend); per-segment value
  labels stay. Segment series
  (ascent/descent means): one horizontal segment per detection,
  `[startKm,v] → {value:[endKm,v], label:{show, position:'right', formatter:
rounded value}} → null`. **Gotcha: per-datapoint labels only render on
  symbols → segment series use `showSymbol:true, symbolSize:0`** (invisible),
  NOT `showSymbol:false`. Series-level `endLabel` shows the series name
  (that's why `grid.right` is 110). `dataZoom` inside, tooltip axis/cross.
- `chart/cursor.ts` — `nearestIndexByKm(distance, km) → index|null` (binary
  search, meters).
- `components/VerticalSpeedChart.vue` — props `{model, settings}`, renders
  vue-echarts `VChart`; listens `@updateaxispointer` + `@globalout` (echarts
  event names are lowercase-normalized) and emits `hoverIndex` (stream index
  | null) via `nearestIndexByKm`.

## Map

- `map/mapStyles.ts` (pure, unit-tested): `MapLayerId` =
  `streets|topo|satellite|terrain`; `availableLayers(key)` (no key → streets
  only, else all four), `styleFor(layer, key)` via `MAPTILER_STYLE` lookup
  (streets/terrain→`streets-v2`, topo→`outdoor-v2` = Outdoor contours+hillshade,
  satellite→`hybrid`; no key → inline OSM raster style), `terrainSource(key)`
  (terrain-rgb-v2 raster-dem), **`toLngLat` — Strava is `[lat,lng]`, MapLibre
  wants `[lng,lat]`, always swap through this helper**, `boundsOf`,
  `traceGeoJSON`.
- `components/MapPanel.vue` — props `{latlng|null, hoverIndex|null,
maptilerKey|null}`. Opens on the `topo` layer when a key is set, else `streets`.
  States: `latlng===null` → "No GPS trace" text; WebGL
  init failure → "Map unavailable" (`failed` ref, constructor try/catch +
  map 'error' event with no canvas). Overlays (trace source/layer, terrain +
  pitch 60) re-applied on every `style.load` (style switches wipe them).
  Marker follows `hoverIndex`. Remounted per activity via `:key="selectedId"`
  in DashboardPage. MapLibre's attribution control renders its own
  `<details><summary>` — scope selectors in tests.

## Other components (presentational)

- `ActivityList.vue` — props activities/selectedId/hasMore/loading/**badges**/
  **sort**, emits select/loadMore. Shows `D+ <n> m` (`ascentGainM`, lift-excluded
  — not Strava's raw total) in the meta line; the secondary metric follows the
  `sort` prop — `· D- <n> m` (`descentLossM`) under the `descent` sort, else
  `· ↑ <n> m/h` (ascentMeanVSpeed when present) — plus 🥇🥈🥉 medals before the
  name via `badgeMap` (id → medals, with a `#N <ranking>` title); each medal
  carries a raised `.medal-kind` icon naming its ranking (⚡ ascent speed,
  ⬆️ elevation, 💪 effort — the server's km-effort score). Empty text:
  "No activities yet.". **Inline edit**: a per-row
  `.edit-toggle` pencil (revealed on row hover or when the row is selected —
  works on touch via selection) swaps the row for a `form.edit` (name input +
  sport `<select>` from `STRAVA_SPORT_TYPES`, Save/Cancel, Esc cancels). Save
  drives `store.editActivity` directly (like SettingsPanel uses the settings
  store), sending only changed fields; local `saving`/`editError` state, form
  stays open on failure.
- `ActivityFilters.vue` — props `{filters, sportTypes, sort}`, emits
  `update(patch)` + `update:sort`. Wrapped in a collapsible `<details class=
"filters">`; the `<summary>` shows the active sort + "· filtered" note so it
  stays informative when closed. Search input debounced 300 ms in-component,
  date/sport/sort emit immediately, Clear button only when a filter is active.
- `ActivityStats.vue` — props `{distanceM, elapsedS, movingTimeS, pausedS,
ascent, descent}` (`ascent`/`descent` are `SegmentAggregate`). Renders the
  activity length (`12.3 km`), total duration (`H:MM:SS elapsed (M:SS moving)`),
  the total excluded-pause time (`⏸ M:SS`), then `↑ 650 m · 612 m/h` /
  `—` (null) for each mean. `DashboardPage` renders it only when both `model` and
  `selectedActivity` exist (distance/elapsed/moving come from the summary,
  `pausedS` from the model).
- `SettingsPanel.vue` — collapsible `<details>` of 9 number inputs (fields
  array). Each input is a **local draft** (`drafts` reactive, synced from the
  store via a deep watch); `commit(field)` on `@change` (blur) **and**
  `@keydown.enter` clamps to min/max, writes through the settings store, and
  normalises the text — so typing/clearing never fights a controlled value and
  Enter applies immediately. An empty/garbage field reverts to the stored value
  on commit. `SyncStatusBar.vue` — polls `/api/sync/status` every 2 s, "Sync
  now" button, emits `synced`.
