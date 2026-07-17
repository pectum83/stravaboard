import { expect, type Page } from '@playwright/test'

/**
 * Sign in through the real OAuth flow: the Strava stub's /oauth/authorize
 * bounces straight back to the callback, which sets the session cookie for
 * the seeded athlete (4242) and lands on the dashboard.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: 'Connect with Strava' }).click()
  await expect(page.locator('button.item').first()).toBeVisible()
}
