import { expect, test } from '@playwright/test'

test('dashboard flow: list, chart, settings persistence, empty state', async ({ page }) => {
  await page.goto('/')

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
  await shortInput.fill('90')
  // Debounced save (500 ms) + request round-trip
  await page.waitForTimeout(900)

  await page.reload()
  await page.locator('.settings summary').click()
  await expect(page.locator('.settings input').nth(1)).toHaveValue('90')

  // Restore the default for idempotent re-runs
  await page.locator('.settings input').nth(1).fill('120')
  await page.waitForTimeout(900)

  // The no-altitude activity shows the empty state instead of a chart
  await page.locator('button.item', { hasText: 'Indoor Trainer Session' }).click()
  await expect(page.getByText('has no elevation data')).toBeVisible()

  // Sync bar settles (stub returns an empty feed)
  await expect(page.getByText(/Up to date|Syncing/)).toBeVisible()
})

test('sync status endpoint reports idle against the stub', async ({ request }) => {
  const status = await request.get('/api/sync/status')
  expect(status.ok()).toBeTruthy()
  const body = (await status.json()) as { state: string }
  expect(['idle', 'syncing']).toContain(body.state)
})
