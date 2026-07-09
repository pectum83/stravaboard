import { eq } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { syncState } from '../db/schema.js'

export interface SyncStateRow {
  lastActivityStartEpoch: number
  status: string
  error: string | null
}

export function getSyncState(db: Db): SyncStateRow {
  const row = db.select().from(syncState).where(eq(syncState.id, 1)).get()
  if (!row) return { lastActivityStartEpoch: 0, status: 'idle', error: null }
  const { id: _id, ...state } = row
  return state
}

export function saveSyncState(db: Db, state: Partial<SyncStateRow>): void {
  const current = getSyncState(db)
  const next = { ...current, ...state }
  db.insert(syncState)
    .values({ id: 1, ...next })
    .onConflictDoUpdate({ target: syncState.id, set: next })
    .run()
}
