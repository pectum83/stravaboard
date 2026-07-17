import { expect, test } from '@playwright/test'
import { login } from './login.js'
import { stubMapTiles } from './mapStub.js'

// iPhone 15 dimensions (Playwright's descriptor, minus its webkit default —
// the suite runs on chromium, which honours isMobile/hasTouch the same way).
test.use({
  viewport: { width: 393, height: 659 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
})

test('phone layout stacks list, chart and map without horizontal overflow', async ({ page }) => {
  await stubMapTiles(page)
  await login(page)

  // List spans the full width and stays usable
  const items = page.locator('button.item')
  await expect(items).toHaveCount(3)
  const aside = await page.locator('aside').boundingBox()
  expect(aside!.width).toBeGreaterThan(380)

  await items.first().click()
  const chart = page.locator('.chart-area')
  const map = page.locator('.map-area')
  await expect(chart.locator('canvas').first()).toBeVisible()
  await expect(map).toBeVisible()

  // Stacked vertically: the map starts below the chart
  const chartBox = (await chart.boundingBox())!
  const mapBox = (await map.boundingBox())!
  expect(mapBox.y).toBeGreaterThanOrEqual(chartBox.y + chartBox.height - 1)
  expect(chartBox.width).toBeGreaterThan(360)

  // Whole-activity stats remain visible on the wrapped controls row
  await expect(page.locator('.stats')).toBeVisible()

  // No sideways scrolling anywhere
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
