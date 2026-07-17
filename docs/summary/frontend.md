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
  (`ActivityListParams {limit, before, q, from, to, sportType}`), `sportTypes()`,
  `refreshActivity(id)` (POST), `config()` (`{maptilerKey}`), `streams(id)`,
  `settings`/`saveSettings`, `startSync`, `syncStatus`. Errors → `ApiError(status)`.
- `stores/settings.ts` (Pinia setup store) — `settings` seeded from
  `DEFAULT_SETTINGS`; `load()` GET; `update(patch)` applies immediately,
  **debounced 500 ms PUT** of the full object; `saveError`.
- `stores/activities.ts` — list + cursor pagination (PAGE_SIZE 50) + selection
  - **filters**: `filters: ActivityFilters {q, from, to, sportType}` ('' = off),
    `EMPTY_FILTERS`, `setFilters(patch)` merges then resets list & reloads,
    `loadMore()` sends only non-empty filters, `sportTypes` loaded with the first
    page, `select(id)`.
- `composables/useStreams.ts` — watches selected id, module-level
  `Map<number, ActivityStreams>` cache, 404 → `missing`; returns `reload()`
  which evicts the current id from the cache and refetches.
- Store `refreshActivity(id)` calls the refresh endpoint and replaces the
  summary in place (throws on failure — callers surface the error).

## Auth UX

Sign-in page = the app itself when `authStatus` says disconnected ("Connect
with Strava" link → OAuth). `?denied=<athleteId>` after a refused login shows
the id so the admin can extend the allowlist. When connected, the sync bar's
slot shows the athlete name + "Log out" (POST logout then hard reload).

## DashboardPage

Layout: `SyncStatusBar` on top; aside 320 px = `ActivityFilters` +
`ActivityList` (in `.list-wrap`); main = `.controls` row (`SettingsPanel`,
"↻ Reload from Strava" button when an activity is selected — store refresh +
`reloadStreams()`, inline error — and `ActivityStats` pushed right) then
`.visuals` flex row = `.chart-area` (flex 2,
`VerticalSpeedChart`) + `.map-area` (flex 1, `MapPanel`, only when streams
loaded). Computes `model = computeVSpeedModel(streams, settings)` once
(null unless streams have altitude); `hoverIndex` ref bridges chart → map.
Fetches `api.config()` on mount for the MapTiler key.

## Chart

- `chart/computeVSpeed.ts` — `computeVSpeedModel(streams, settings) →
VSpeedModel {streams, instant, short, long, ascents, descents, pauses,
ascentStats, descentStats}`. Instant series runs on `medianFilter(alt, 5)`.
  Single computation point for chart + stats + segments.
- `chart/buildChartOptions.ts` — **rendering only**, `(model, settings) →
EChartsOption`. 6 line series; colors = validated dataviz categorical slots
  (blue/aqua/yellow instant/short/long, green ascent, magenta `#e87ba4`
  descent, violet `#4a3aa7` slope — orange failed validation next to magenta;
  sub-3:1 colors are relieved by direct end-labels). The slope series is
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

- `map/mapStyles.ts` (pure, unit-tested): `availableLayers(key)` (no key →
  streets only), `styleFor(layer, key)` (MapTiler `streets-v2`/`hybrid` style
  URLs; no key → inline OSM raster style), `terrainSource(key)`
  (terrain-rgb-v2 raster-dem), **`toLngLat` — Strava is `[lat,lng]`, MapLibre
  wants `[lng,lat]`, always swap through this helper**, `boundsOf`,
  `traceGeoJSON`.
- `components/MapPanel.vue` — props `{latlng|null, hoverIndex|null,
maptilerKey|null}`. States: `latlng===null` → "No GPS trace" text; WebGL
  init failure → "Map unavailable" (`failed` ref, constructor try/catch +
  map 'error' event with no canvas). Overlays (trace source/layer, terrain +
  pitch 60) re-applied on every `style.load` (style switches wipe them).
  Marker follows `hoverIndex`. Remounted per activity via `:key="selectedId"`
  in DashboardPage. MapLibre's attribution control renders its own
  `<details><summary>` — scope selectors in tests.

## Other components (presentational)

- `ActivityList.vue` — props activities/selectedId/hasMore/loading, emits
  select/loadMore. Empty text: "No activities yet.".
- `ActivityFilters.vue` — props `{filters, sportTypes}`, emits
  `update(patch)`; search input debounced 300 ms in-component, date/sport emit
  immediately, Clear button only when a filter is active.
- `ActivityStats.vue` — props `{ascent, descent}: SegmentAggregate`; renders
  `↑ 650 m · 612 m/h` / `—` when null.
- `SettingsPanel.vue` — 7 number inputs (fields array), clamps to min/max,
  writes through settings store. `SyncStatusBar.vue` — polls
  `/api/sync/status` every 2 s, "Sync now" button, emits `synced`.
