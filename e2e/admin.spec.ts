import { expect, test } from '@playwright/test'
import { login } from './login.js'
import { stubMapTiles } from './mapStub.js'

// Never click "Restart the server" here — it would kill the server under test.
test('admin page manages the sign-in allowlist', async ({ page }) => {
  await stubMapTiles(page)
  await login(page)

  await page.getByRole('link', { name: 'Admin' }).click()
  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible()

  // Seeded from ALLOWED_ATHLETE_IDS on first boot.
  const rows = page.locator('.allowlist tbody tr')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('4242')

  await page.locator('.add-id').fill('1234567')
  await page.locator('.add-note').fill('cousin Paul')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(rows).toHaveCount(2)
  // Ordered by athlete id: 4242 then 1234567.
  await expect(rows.nth(1)).toContainText('cousin Paul')

  // Removing asks for confirmation, then drops the row.
  page.once('dialog', (dialog) => dialog.accept())
  await rows.nth(1).getByRole('button', { name: 'Remove' }).click()
  await expect(rows).toHaveCount(1)

  await page.getByRole('link', { name: 'Back to the dashboard' }).click()
  await expect(page.locator('button.item').first()).toBeVisible()
})
