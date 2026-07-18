import { expect, test, type Locator } from '@playwright/test'
import { login } from './login.js'
import { stubMapTiles } from './mapStub.js'

/** The "↑ N m/h" ascent-speed number from an activity row's meta line. */
async function ascentSpeed(row: Locator): Promise<number> {
  const text = await row.locator('.meta', { hasText: 'm/h' }).innerText()
  const match = text.match(/↑\s*(\d+)\s*m\/h/)
  if (!match) throw new Error(`no ascent speed in "${text}"`)
  return Number(match[1])
}

test('changing the pause threshold re-ranks the stored ascent speed in the list', async ({
  page,
}) => {
  await stubMapTiles(page)
  await login(page)

  const row = page.locator('button.item', { hasText: 'Morning Mountain Run' })
  const before = await ascentSpeed(row)
  expect(before).toBeGreaterThan(0)

  // Raise the pause threshold above the mountain profile's 90 s standstill so it
  // now counts toward the ascent time. The server recomputes the stored metric
  // and the list reloads to a LOWER pause-included mean.
  await page.locator('.settings summary').click()
  const pauseInput = page.locator('.settings input').nth(5) // 6th field = Pause threshold
  await expect(pauseInput).toHaveValue('30')
  await pauseInput.fill('120')
  await pauseInput.press('Enter')

  await expect.poll(() => ascentSpeed(row), { timeout: 5000 }).toBeLessThan(before)

  // Lowering it back below the standstill excludes the pause again → the original
  // (higher) mean returns — the ranking tracks the setting both ways.
  await pauseInput.fill('30')
  await pauseInput.press('Enter')
  await expect.poll(() => ascentSpeed(row), { timeout: 5000 }).toBe(before)
})
