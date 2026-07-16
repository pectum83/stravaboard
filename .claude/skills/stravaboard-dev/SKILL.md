---
name: stravaboard-dev
description: Development workflow and quality rules for the stravaBoard repo. Use before ANY code change here — points to the codebase summary (read that instead of the source) and lists the gates every commit must pass.
---

# stravaBoard development workflow

## 1. Orient from the summary, not the source

Read `docs/summary/index.md` first, then ONLY the summary file(s) matching the
task (architecture / data-and-api / algorithms / frontend /
testing-and-conventions). They carry exact paths, signatures, invariants and
gotchas — open source files only to make the actual edit. This is the whole
point of the summary: don't burn context re-deriving the codebase.

Product history: `docs/prompt.md` (v1 brief), `docs/improve1.md` (v2 brief).

## 2. Environment

- Node 22 required, shell default may be older:
  `source ~/.nvm/nvm.sh && nvm use` before any pnpm command.
- Everything runs from the repo root via pnpm workspace filters.

## 3. Quality bar (business quality, decided with the user)

- Full TypeScript. Pure algorithms live in `packages/shared` and are written
  test-first against synthetic fixtures with exact known ground truth.
- New endpoint → Fastify `app.inject` API tests (incl. invalid input → 400).
  New component → @vue/test-utils test. New behavior → e2e coverage.
- Tests are 100 % offline: Strava is always stubbed; map tile/style traffic in
  e2e goes through `e2e/mapStub.ts`.
- Coverage thresholds enforced: shared ≥ 90 %, server ≥ 80 %.
- Chart colors only from the validated dataviz palette (validate additions).
- Settings: merged over `DEFAULT_SETTINGS`; add field + default + zod range +
  panel input; never rewrite stored rows.

## 4. Gates before every commit (all must pass)

```bash
source ~/.nvm/nvm.sh && nvm use
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test:coverage
pnpm build && pnpm e2e        # e2e serves the BUILT app — build first
```

## 5. Commits & push

Imperative sentence-case one-liner + explanatory body (match
`git log --oneline`), no conventional-commit prefixes. Group commits
logically (one green commit per work package). Work directly on `main`;
push to `origin` when the requested task is complete.

## 6. Keep the summary honest

Any change to schema, API, algorithms, components or conventions updates the
matching `docs/summary/*.md` file **in the same commit**. Also keep
`docs/README.md` (user-facing) in sync with feature changes.
