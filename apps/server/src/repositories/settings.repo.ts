import { eq } from 'drizzle-orm'
import { DEFAULT_SETTINGS, type Settings } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { settings } from '../db/schema.js'

const KEY = 'settings'

export function getSettings(db: Db): Settings {
  const row = db.select().from(settings).where(eq(settings.key, KEY)).get()
  if (!row) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<Settings>) }
}

export function saveSettings(db: Db, value: Settings): void {
  db.insert(settings)
    .values({ key: KEY, value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } })
    .run()
}
