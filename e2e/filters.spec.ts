import { expect, test } from '@playwright/test'
import { login } from './login.js'
import { stubMapTiles } from './mapStub.js'

test.beforeEach(async ({ page }) => {
  await stubMapTiles(page)
  await login(page)
  await expect(page.locator('button.item')).toHaveCount(3)
  // Filters live in a collapsible section — open it before interacting.
  await page.locator('.filters summary').click()
})

test('filters the list by name, sport and date range, and clears', async ({ page }) => {
  const items = page.locator('button.item')

  // Word filter (debounced)
  await page.getByLabel('filter by name').fill('Mountain')
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('Morning Mountain Run')

  // Clear restores everything
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(items).toHaveCount(3)

  // Sport filter — only analyzable types appear (VirtualRide has no elevation).
  const sportOptions = page.getByLabel('sport type').locator('option')
  await expect(sportOptions).toHaveText(['All sports', 'Run', 'TrailRun'])
  await page.getByLabel('sport type').selectOption('Run')
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('Flat River Loop')
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(items).toHaveCount(3)

  // Date range: only the June 15 activity falls inside
  await page.getByLabel('from date').fill('2026-06-12')
  await page.getByLabel('to date').fill('2026-06-16')
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('Flat River Loop')

  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(items).toHaveCount(3)
})

test('sorts by most descent and shows whole-filter totals', async ({ page }) => {
  // The list header summarises the whole (unfiltered) set.
  const summary = page.locator('.list-summary')
  await expect(summary).toContainText('3 activities')
  await expect(summary).toContainText('D+')

  // Most descent: the mountain run (two long descents) leads, and the meta line
  // switches to the D− readout.
  await page.getByLabel('sort by').selectOption({ label: 'Most descent' })
  const items = page.locator('button.item')
  await expect(items.first()).toContainText('Morning Mountain Run')
  await expect(items.first()).toContainText('D-')

  // Best effort: the mountain run leads on the km-effort score and the meta
  // line switches to the 💪 readout; the metric-less trainer session is last.
  await page.getByLabel('sort by').selectOption({ label: 'Best effort' })
  await expect(items.first()).toContainText('Morning Mountain Run')
  await expect(items.first()).toContainText('km-eff')
  await expect(items.last()).toContainText('Indoor Trainer Session')
})

test('filters compose: word plus sport with no match shows an empty list', async ({ page }) => {
  // "Mountain" matches only the TrailRun; requiring sport type Run yields none.
  await page.getByLabel('filter by name').fill('Mountain')
  await page.getByLabel('sport type').selectOption('Run')
  await expect(page.locator('button.item')).toHaveCount(0)
  await expect(page.getByText('No activities')).toBeVisible()
})
