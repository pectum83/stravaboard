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

  // Sport filter
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

test('filters compose: word plus sport with no match shows an empty list', async ({ page }) => {
  await page.getByLabel('filter by name').fill('Mountain')
  await page.getByLabel('sport type').selectOption('VirtualRide')
  await expect(page.locator('button.item')).toHaveCount(0)
  await expect(page.getByText('No activities')).toBeVisible()
})
