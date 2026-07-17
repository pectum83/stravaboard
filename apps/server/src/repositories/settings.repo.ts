import { eq } from 'drizzle-orm'
import { DEFAULT_SETTINGS, type Settings } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { settings } from '../db/schema.js'

const keyFor = (athleteId: number) => `settings:${athleteId}`

export function getSettings(db: Db, athleteId: number): Settings {
  const row = db
    .select()
    .from(settings)
    .where(eq(settings.key, keyFor(athleteId)))
    .get()
  if (!row) return { ...DEFAULT_SETTINGS }
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<Settings>) }
}

export function saveSettings(db: Db, athleteId: number, value: Settings): void {
  db.insert(settings)
    .values({ key: keyFor(athleteId), value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } })
    .run()
}
