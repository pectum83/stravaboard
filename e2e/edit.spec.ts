import { expect, test } from '@playwright/test'
import { login } from './login.js'
import { stubMapTiles } from './mapStub.js'

test.beforeEach(async ({ page }) => {
  await stubMapTiles(page)
  await login(page)
  await expect(page.locator('button.item')).toHaveCount(3)
})

test('renames and re-types an activity through the inline form', async ({ page }) => {
  // Intercept the write so the shared seeded DB stays pristine for other
  // specs; the real server PATCH → Strava path is covered by server tests.
  // We assert the request the UI sends and drive the list off the response.
  let sent: unknown
  await page.route('**/api/activities/1', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    sent = route.request().postDataJSON()
    await route.fulfill({
      json: {
        id: 1,
        name: 'Renamed Peak',
        sportType: 'Hike',
        startDate: '2026-06-20T07:30:00Z',
        distanceM: 15_000,
        movingTimeS: 3600,
        elapsedTimeS: 3600,
        totalElevationGainM: 650,
        streamsStatus: 'done',
        ascentMeanVSpeed: 600,
      },
    })
  })

  const first = page.locator('button.item').first()
  await expect(first).toContainText('Morning Mountain Run')

  // Selecting a row reveals its edit affordance; open the inline form.
  await first.click()
  await page.locator('li.row').first().locator('.edit-toggle').click()

  const form = page.locator('form.edit')
  // Type key-by-key (not fill) so a re-focus/re-select on every keystroke
  // would drop characters — guards the "only one character sticks" bug.
  const nameField = form.getByLabel('Activity name')
  await nameField.fill('')
  await nameField.pressSequentially('Renamed Peak')
  await expect(nameField).toHaveValue('Renamed Peak')
  await form.getByLabel('Sport type').selectOption('Hike')
  await form.getByRole('button', { name: 'Save' }).click()

  // Only the changed fields are sent.
  await expect.poll(() => sent).toEqual({ name: 'Renamed Peak', sportType: 'Hike' })

  // The list reflects the write immediately (name + new sport type).
  const updated = page.locator('button.item').first()
  await expect(updated).toContainText('Renamed Peak')
  await expect(updated).toContainText('Hike')
})

test('cancelling the edit leaves the activity unchanged', async ({ page }) => {
  const first = page.locator('button.item').first()
  await first.click()
  await page.locator('li.row').first().locator('.edit-toggle').click()

  const form = page.locator('form.edit')
  await form.getByLabel('Activity name').fill('Should not stick')
  await form.getByRole('button', { name: 'Cancel' }).click()

  await expect(page.locator('form.edit')).toHaveCount(0)
  await expect(page.locator('button.item').first()).toContainText('Morning Mountain Run')
})
