import { eq, sql } from 'drizzle-orm'
import type { AllowedAthlete } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { allowedAthletes, athletes } from '../db/schema.js'

/** The allowlist joined with the athletes that already connected. */
export function listAllowed(db: Db): AllowedAthlete[] {
  return db
    .select({
      athleteId: allowedAthletes.athleteId,
      note: allowedAthletes.note,
      addedAt: allowedAthletes.addedAt,
      name: athletes.displayName,
    })
    .from(allowedAthletes)
    .leftJoin(athletes, eq(athletes.id, allowedAthletes.athleteId))
    .orderBy(allowedAthletes.athleteId)
    .all()
    .map((row) => ({ ...row, name: row.name ?? null, connected: row.name !== null }))
}

export function countAllowed(db: Db): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(allowedAthletes)
      .get()?.n ?? 0
  )
}

export function isAllowed(db: Db, athleteId: number): boolean {
  return (
    db.select().from(allowedAthletes).where(eq(allowedAthletes.athleteId, athleteId)).get() !==
    undefined
  )
}

/** Add an id; re-adding an existing one is a no-op (the note is kept). */
export function addAllowed(db: Db, athleteId: number, note: string | null, now: string): void {
  db.insert(allowedAthletes)
    .values({ athleteId, note, addedAt: now })
    .onConflictDoNothing({ target: allowedAthletes.athleteId })
    .run()
}

/** Returns false when the id was not on the list. */
export function removeAllowed(db: Db, athleteId: number): boolean {
  if (!isAllowed(db, athleteId)) return false
  db.delete(allowedAthletes).where(eq(allowedAthletes.athleteId, athleteId)).run()
  return true
}

/**
 * First-boot bootstrap: copy ALLOWED_ATHLETE_IDS into the table when it is
 * still empty. Afterwards the table is the source of truth, so an id removed
 * from the admin page never comes back.
 */
export function seedAllowlist(db: Db, athleteIds: number[], now: string): void {
  if (athleteIds.length === 0 || countAllowed(db) > 0) return
  for (const athleteId of athleteIds) {
    addAllowed(db, athleteId, 'from ALLOWED_ATHLETE_IDS', now)
  }
}
