import { asc, count, desc, eq, lt } from 'drizzle-orm'
import type { ActivitySummary, StreamsStatus } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { activities } from '../db/schema.js'

export interface ActivityRow {
  id: number
  name: string
  sportType: string
  startDate: string
  startDateEpoch: number
  distanceM: number
  movingTimeS: number
  elapsedTimeS: number
  totalElevationGainM: number
  streamsStatus: StreamsStatus
  rawSummary: string
}

export function upsertActivity(db: Db, row: ActivityRow): void {
  const { id, ...rest } = row
  db.insert(activities).values(row).onConflictDoUpdate({ target: activities.id, set: rest }).run()
}

/**
 * Upsert a synced summary WITHOUT touching streamsStatus on re-sync:
 * an activity whose streams are already stored must not go back to 'pending'.
 */
export function upsertActivitySummary(db: Db, row: ActivityRow): void {
  const { id, streamsStatus, ...summaryFields } = row
  db.insert(activities)
    .values(row)
    .onConflictDoUpdate({ target: activities.id, set: summaryFields })
    .run()
}

/** Page of activities, newest first; `beforeEpoch` is an exclusive keyset cursor. */
export function listActivities(
  db: Db,
  { limit, beforeEpoch }: { limit: number; beforeEpoch?: number },
): ActivityRow[] {
  const where = beforeEpoch === undefined ? undefined : lt(activities.startDateEpoch, beforeEpoch)
  return db
    .select()
    .from(activities)
    .where(where)
    .orderBy(desc(activities.startDateEpoch), desc(activities.id))
    .limit(limit)
    .all()
}

export function getActivity(db: Db, id: number): ActivityRow | null {
  return db.select().from(activities).where(eq(activities.id, id)).get() ?? null
}

export function setStreamsStatus(db: Db, id: number, status: StreamsStatus): void {
  db.update(activities).set({ streamsStatus: status }).where(eq(activities.id, id)).run()
}

/** Activities still waiting for streams, oldest first (sync processes in start order). */
export function listPendingStreams(db: Db, limit: number): ActivityRow[] {
  return db
    .select()
    .from(activities)
    .where(eq(activities.streamsStatus, 'pending'))
    .orderBy(asc(activities.startDateEpoch))
    .limit(limit)
    .all()
}

export function countPendingStreams(db: Db): number {
  const row = db
    .select({ n: count() })
    .from(activities)
    .where(eq(activities.streamsStatus, 'pending'))
    .get()
  return row?.n ?? 0
}

export function toSummary(row: ActivityRow): ActivitySummary {
  return {
    id: row.id,
    name: row.name,
    sportType: row.sportType,
    startDate: row.startDate,
    distanceM: row.distanceM,
    movingTimeS: row.movingTimeS,
    elapsedTimeS: row.elapsedTimeS,
    totalElevationGainM: row.totalElevationGainM,
    streamsStatus: row.streamsStatus,
  }
}
