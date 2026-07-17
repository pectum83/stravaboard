import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { oauthTokens } from '../db/schema.js'

export interface StoredTokens {
  athleteId: number
  accessToken: string
  refreshToken: string
  /** Unix epoch seconds. */
  expiresAt: number
}

export function getTokens(db: Db, athleteId: number): StoredTokens | null {
  return db.select().from(oauthTokens).where(eq(oauthTokens.athleteId, athleteId)).get() ?? null
}

export function saveTokens(db: Db, tokens: StoredTokens): void {
  const { athleteId: _id, ...rest } = tokens
  db.insert(oauthTokens)
    .values(tokens)
    .onConflictDoUpdate({ target: oauthTokens.athleteId, set: rest })
    .run()
}

/** Athlete ids with stored tokens — the accounts the sync loop processes. */
export function listConnectedAthleteIds(db: Db): number[] {
  return db
    .select({ athleteId: oauthTokens.athleteId })
    .from(oauthTokens)
    .all()
    .map((r) => r.athleteId)
}
