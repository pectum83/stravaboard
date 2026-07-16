import type { Page } from '@playwright/test'

/**
 * Keep the e2e suite offline: answer MapTiler style requests with a minimal
 * empty style and swallow OSM tile requests. Must be installed before the
 * page navigates.
 */
export async function stubMapTiles(page: Page): Promise<void> {
  await page.route('**/api.maptiler.com/**', (route) => {
    if (route.request().url().includes('style.json')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
      })
    }
    return route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 204, body: '' }),
  )
}
