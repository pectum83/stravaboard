import { defineConfig } from '@playwright/test'
import { APP_PORT, DB_PATH, STUB_PORT, WEB_DIST } from './paths.js'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'pnpm exec tsx stravaStubServer.ts',
      url: `http://localhost:${STUB_PORT}/health`,
      reuseExistingServer: false,
      env: { STUB_PORT: String(STUB_PORT) },
    },
    {
      command: 'pnpm exec tsx serveSeeded.ts',
      url: `http://localhost:${APP_PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(APP_PORT),
        DATABASE_PATH: DB_PATH,
        WEB_DIST_PATH: WEB_DIST,
        WEB_APP_URL: '/',
        STRAVA_API_BASE: `http://localhost:${STUB_PORT}/api/v3`,
        STRAVA_OAUTH_BASE: `http://localhost:${STUB_PORT}/oauth`,
        STRAVA_CLIENT_ID: 'e2e',
        STRAVA_CLIENT_SECRET: 'e2e',
        // Exercises the keyed map path; all MapTiler traffic is route-stubbed
        // in the specs, so no real request ever leaves the machine.
        MAPTILER_KEY: 'e2e-key',
      },
    },
  ],
})
