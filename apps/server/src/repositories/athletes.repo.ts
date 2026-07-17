import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { athletes } from '../db/schema.js'

export interface AthleteRow {
  /** Strava athlete id. */
  id: number
  displayName: string
  createdAt: string
}

export function getAthlete(db: Db, id: number): AthleteRow | null {
  return db.select().from(athletes).where(eq(athletes.id, id)).get() ?? null
}

/** Create on first login; keep the display name fresh on later logins. */
export function upsertAthlete(db: Db, id: number, displayName: string, now: string): void {
  db.insert(athletes)
    .values({ id, displayName, createdAt: now })
    .onConflictDoUpdate({ target: athletes.id, set: { displayName } })
    .run()
}
