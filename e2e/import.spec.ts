import { expect, test } from '@playwright/test'
import { login } from './login.js'
import { stubMapTiles } from './mapStub.js'

// Runs in its own project, AFTER every other spec: importing writes a new
// activity into the shared seeded database — a Hike, which also makes the list
// default its sport filter to Hike — and nothing else may observe that.
test("admin page imports another athlete's activity onto my account", async ({ page }) => {
  await stubMapTiles(page)
  await login(page)

  await page.getByRole('link', { name: 'Admin' }).click()
  await expect(
    page.getByRole('heading', { name: 'Import an activity from another account' }),
  ).toBeVisible()

  // The other household account is preselected; its heart-rate activity shows up.
  const candidates = page.locator('.candidates li')
  await expect(candidates).toHaveCount(1)
  await expect(candidates.first()).toContainText('Borrowed Watch Hike')
  await expect(candidates.first()).toContainText('2026-08-18')

  await candidates.first().locator('button').click()
  await page.getByRole('button', { name: 'Import onto my account' }).click()

  const link = page.locator('.imported a')
  await expect(link).toHaveAttribute('href', 'https://www.strava.com/activities/990001')
  await expect(page.locator('.imported')).toContainText('130 bpm average')
})
