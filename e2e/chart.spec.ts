import { expect, test } from '@playwright/test'
import { stubMapTiles } from './mapStub.js'

test('mountain run shows chart with whole-activity ascent/descent means', async ({ page }) => {
  await stubMapTiles(page)
  await page.goto('/')

  await page.locator('button.item', { hasText: 'Morning Mountain Run' }).click()
  await expect(page.locator('.chart canvas').first()).toBeVisible()

  // Whole-activity stats (DOM, not canvas): both means present with units.
  const stats = page.locator('.stats')
  await expect(stats).toBeVisible()
  await expect(stats.locator('.ascent')).toContainText('m/h')
  await expect(stats.locator('.descent')).toContainText('m/h')
  // The mountain profile climbs ~650 m in total.
  await expect(stats.locator('.ascent')).toContainText('↑')
  await expect(stats.locator('.descent')).toContainText('↓')

  // The flat run has no ascent/descent segments -> em dashes.
  await page.locator('button.item', { hasText: 'Flat River Loop' }).click()
  await expect(stats.locator('.ascent')).toContainText('—')
})
