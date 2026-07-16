# stravaBoard — codebase reference (for coding agents)

stravaBoard syncs one athlete's Strava activities into local SQLite and shows,
per activity, five vertical-speed series over distance (instant/short/long
windows, pause-excluded ascent & descent means with per-segment labels),
whole-activity ascent/descent stats, a filterable activity list, and a
MapLibre map whose cursor follows the chart.

**Read this directory instead of the source.** Open only the file(s) matching
your task; each one states the exact paths, signatures and invariants you need
to change code safely.

| File                                                     | Read when the task touches                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| [architecture.md](architecture.md)                       | monorepo layout, commands, env vars, dev/build/run, deployment         |
| [data-and-api.md](data-and-api.md)                       | DB schema, repositories, HTTP endpoints, sync engine & backfill        |
| [algorithms.md](algorithms.md)                           | vertical speed, ascent/descent detection, pauses, aggregates, fixtures |
| [frontend.md](frontend.md)                               | Vue components, stores, chart options, map panel, cursor sync          |
| [testing-and-conventions.md](testing-and-conventions.md) | tests, coverage, quality gates, commit style, gotchas                  |

Product briefs live one level up: `docs/prompt.md` (v1) and `docs/improve1.md`
(v2 improvements — all implemented). User-facing docs: `docs/README.md`.

Keep these summary files **up to date in the same commit** as any behavior
change they describe.
