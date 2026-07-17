import { expect, test } from '@playwright/test'
import { login } from './login.js'
import { stubMapTiles } from './mapStub.js'

test('map panel shows the trace with layer options and follows the chart cursor', async ({
  page,
}) => {
  await stubMapTiles(page)
  await login(page)

  await page.locator('button.item', { hasText: 'Morning Mountain Run' }).click()
  const mapArea = page.locator('.map-area')
  await expect(mapArea).toBeVisible()

  // WebGL may be unavailable in some headless environments; the panel then
  // degrades to a visible fallback. Either state is a pass, a blank panel is not.
  const canvas = mapArea.locator('canvas.maplibregl-canvas')
  const fallback = mapArea.getByText('Map unavailable')
  await expect(canvas.or(fallback).first()).toBeVisible()

  if (await canvas.isVisible()) {
    // Layer switcher present with the keyed options
    const pills = mapArea.locator('.layer-switch button')
    await expect(pills).toHaveText(['streets', 'satellite', 'terrain'])

    // Hovering the chart drops a synced cursor marker on the map
    const chart = page.locator('.chart canvas').first()
    const box = (await chart.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(mapArea.locator('.maplibregl-marker')).toBeVisible()
  }

  // The GPS-less activity shows the no-trace placeholder instead of a map
  await page.locator('button.item', { hasText: 'Indoor Trainer Session' }).click()
  await expect(page.getByText('has no elevation data')).toBeVisible()
})
