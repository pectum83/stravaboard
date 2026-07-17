import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { syncState } from '../db/schema.js'

export interface SyncStateRow {
  lastActivityStartEpoch: number
  status: string
  error: string | null
}

export function getSyncState(db: Db, athleteId: number): SyncStateRow {
  const row = db.select().from(syncState).where(eq(syncState.athleteId, athleteId)).get()
  if (!row) return { lastActivityStartEpoch: 0, status: 'idle', error: null }
  const { athleteId: _id, ...state } = row
  return state
}

export function saveSyncState(db: Db, athleteId: number, state: Partial<SyncStateRow>): void {
  const next = { ...getSyncState(db, athleteId), ...state }
  db.insert(syncState)
    .values({ athleteId, ...next })
    .onConflictDoUpdate({ target: syncState.athleteId, set: next })
    .run()
}
