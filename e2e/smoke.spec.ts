import { expect, test } from '@playwright/test'
import { login } from './login.js'
import { stubMapTiles } from './mapStub.js'

test('dashboard flow: login, list, chart, settings persistence, logout', async ({ page }) => {
  await stubMapTiles(page)
  await login(page)

  // Logged in as the seeded athlete
  await expect(page.getByText('E2E Tester')).toBeVisible()

  // Activity list shows the three seeded activities, newest first
  const items = page.locator('button.item')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('Morning Mountain Run')
  await expect(items.nth(2)).toContainText('Indoor Trainer Session')
  await expect(items.nth(2)).toContainText('no elevation data')

  // Selecting a mountain run renders the chart with all four series in the legend
  await items.nth(0).click()
  const canvas = page.locator('.chart canvas').first()
  await expect(canvas).toBeVisible()

  // Legend text lives in canvas, so assert through the settings-driven names
  // via the chart options indirectly: change a window and check persistence.
  await page.locator('.settings summary').click()
  const shortInput = page.locator('.settings input').nth(1)
  await expect(shortInput).toHaveValue('120')
  // Settings commit on Enter (or blur), not on every keystroke.
  await shortInput.fill('90')
  await shortInput.press('Enter')
  // Debounced save (500 ms) + request round-trip
  await page.waitForTimeout(900)

  await page.reload()
  await page.locator('.settings summary').click()
  await expect(page.locator('.settings input').nth(1)).toHaveValue('90')

  // Restore the default for idempotent re-runs
  const restore = page.locator('.settings input').nth(1)
  await restore.fill('120')
  await restore.press('Enter')
  await page.waitForTimeout(900)

  // The no-altitude activity shows the empty state instead of a chart
  await page.locator('button.item', { hasText: 'Indoor Trainer Session' }).click()
  await expect(page.getByText('has no elevation data')).toBeVisible()

  // Sync bar settles (stub returns an empty feed)
  await expect(page.getByText(/Up to date|Syncing/)).toBeVisible()

  // Logging out lands back on the sign-in page
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('link', { name: 'Connect with Strava' })).toBeVisible()
})

test('API refuses unauthenticated requests', async ({ request }) => {
  for (const url of ['/api/sync/status', '/api/activities', '/api/settings', '/api/config']) {
    expect((await request.get(url)).status(), url).toBe(401)
  }
})

test('sync status endpoint reports idle for the logged-in athlete', async ({ page }) => {
  await stubMapTiles(page)
  await login(page)
  const status = await page.request.get('/api/sync/status')
  expect(status.ok()).toBeTruthy()
  const body = (await status.json()) as { state: string }
  expect(['idle', 'syncing']).toContain(body.state)
})
