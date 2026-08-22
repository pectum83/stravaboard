import { defineConfig } from 'tsup'

export default defineConfig({
  // The import script ships with the server so it can run on the VPS, the only
  // host whose database holds every athlete's Strava tokens.
  entry: ['src/index.ts', 'src/scripts/importActivity.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  // Workspace package ships TS source; it must be bundled, not left as an import.
  noExternal: ['@stravaboard/shared'],
  // rm first: with an existing dist/migrations, `cp -r` would nest the copy
  // (dist/migrations/migrations) and break the migrator in production.
  onSuccess: 'rm -rf dist/migrations && cp -r src/db/migrations dist/migrations',
})
