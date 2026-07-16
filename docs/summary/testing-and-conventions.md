# Testing, quality gates, conventions

## Test layout

- `packages/shared/src/__tests__/` — Vitest, pure unit tests with synthetic
  fixtures + exact ground truths (`fixtures.ts`; see algorithms.md). Coverage
  threshold **≥ 90 %** (currently 100 %).
- `apps/server/src/__tests__/` — Vitest; API tests via Fastify `app.inject`
  (no supertest), `:memory:` sqlite (`helpers.ts: testDb/testConfig/testApp`),
  Strava doubled by `stravaStub.ts` (in-memory fetch impl: activities,
  streams incl. latlng, 404s, 429s). Coverage **≥ 80 %**.
- `apps/web/src/__tests__/` — Vitest + @vue/test-utils + happy-dom.
  Debounces tested with `vi.useFakeTimers()`. MapLibre mocked with
  `vi.hoisted` + `vi.mock('maplibre-gl')` (see `MapPanel.test.ts`).
- `e2e/*.spec.ts` — Playwright: boots the Strava stub + the real server on a
  freshly seeded DB (`seed.ts`: mountain run with 90 s mid-climb pause +
  latlng, flat run, streamless VirtualRide), serving the **built** web app
  (`pnpm build` first!). Config sets `MAPTILER_KEY: 'e2e-key'`.

## Hard rules

- **Tests never touch the network.** Strava is stubbed everywhere; in e2e all
  MapTiler/OSM traffic is intercepted by `e2e/mapStub.ts: stubMapTiles(page)`
  — call it in every new spec before `page.goto`.
- New pure algorithm → shared package + fixture-based tests written against
  known ground truth. New endpoint → `app.inject` tests incl. validation
  failures. New component → mounted component test.
- Map assertions in e2e must tolerate WebGL-less environments (assert canvas
  OR the "Map unavailable" fallback).

## Gates — all must pass before every commit

```
source ~/.nvm/nvm.sh && nvm use   # Node 22; shell default may be v20
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test:coverage                # unit + API with thresholds
pnpm build && pnpm e2e            # e2e serves the built app
```

(`pnpm test` from the root also runs e2e — it fails without a fresh build.)
CI (`.github/workflows/ci.yml`): checks job (lint/format/typecheck/coverage/
build) then e2e job (playwright chromium).

## Conventions

- Full TypeScript, ESM, `.js` extensions on relative imports in server/shared.
- Prettier + ESLint enforced; run `pnpm format` after larger edits.
- Commits: imperative sentence-case one-liners with an explanatory body,
  no conventional-commit prefixes; logically grouped; committed on `main`;
  push when the task is done (`origin` = github.com:pectum83/stravaboard).
- Settings design: stored settings JSON is merged over `DEFAULT_SETTINGS` —
  add a new setting = add field + default + zod range + SettingsPanel field;
  never rewrite stored rows.
- Chart colors come from the validated dataviz palette (run the dataviz
  validator when adding a series color).
- e2e selectors: scope to component classes (`.settings input`,
  `.chart canvas`) — bare `input`/`canvas`/`summary` are ambiguous (filters,
  map canvas, maplibre attribution `<summary>`).
