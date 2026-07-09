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

export function getTokens(db: Db): StoredTokens | null {
  const row = db.select().from(oauthTokens).where(eq(oauthTokens.id, 1)).get()
  if (!row) return null
  const { id: _id, ...tokens } = row
  return tokens
}

export function saveTokens(db: Db, tokens: StoredTokens): void {
  db.insert(oauthTokens)
    .values({ id: 1, ...tokens })
    .onConflictDoUpdate({ target: oauthTokens.id, set: tokens })
    .run()
}
