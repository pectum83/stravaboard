import { and, asc, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { ActivitySummary, StreamsStatus } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { activities, activityStreams } from '../db/schema.js'

export interface ActivityRow {
  id: number
  /** Owner (Strava athlete id). */
  athleteId: number
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

export interface ActivityFilter {
  /** Name substring (SQLite LIKE — case-insensitive for ASCII only). */
  q?: string
  /** Inclusive lower bound on start date, epoch seconds. */
  fromEpoch?: number
  /** Exclusive upper bound on start date, epoch seconds. */
  toEpochExclusive?: number
  sportType?: string
}

/**
 * Page of activities, newest first; `beforeEpoch` is an exclusive keyset
 * cursor. Filters are stable predicates, so they compose with the cursor.
 */
export function listActivities(
  db: Db,
  {
    athleteId,
    limit,
    beforeEpoch,
    filter = {},
  }: { athleteId: number; limit: number; beforeEpoch?: number; filter?: ActivityFilter },
): ActivityRow[] {
  const conditions = [
    eq(activities.athleteId, athleteId),
    beforeEpoch === undefined ? undefined : lt(activities.startDateEpoch, beforeEpoch),
    filter.q === undefined
      ? undefined
      : sql`${activities.name} LIKE ${`%${escapeLike(filter.q)}%`} ESCAPE '\\'`,
    filter.fromEpoch === undefined ? undefined : gte(activities.startDateEpoch, filter.fromEpoch),
    filter.toEpochExclusive === undefined
      ? undefined
      : lt(activities.startDateEpoch, filter.toEpochExclusive),
    filter.sportType === undefined ? undefined : eq(activities.sportType, filter.sportType),
  ].filter((c) => c !== undefined)
  return db
    .select()
    .from(activities)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(activities.startDateEpoch), desc(activities.id))
    .limit(limit)
    .all()
}

/** Escape LIKE wildcards so user input matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Distinct sport types of one athlete's activities, sorted. */
export function listSportTypes(db: Db, athleteId: number): string[] {
  return db
    .selectDistinct({ sportType: activities.sportType })
    .from(activities)
    .where(eq(activities.athleteId, athleteId))
    .orderBy(asc(activities.sportType))
    .all()
    .map((r) => r.sportType)
}

export function getActivity(db: Db, id: number): ActivityRow | null {
  return db.select().from(activities).where(eq(activities.id, id)).get() ?? null
}

export function setStreamsStatus(db: Db, id: number, status: StreamsStatus): void {
  db.update(activities).set({ streamsStatus: status }).where(eq(activities.id, id)).run()
}

/** Activities still waiting for streams, oldest first (sync processes in start order). */
export function listPendingStreams(db: Db, athleteId: number, limit: number): ActivityRow[] {
  return db
    .select()
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), eq(activities.streamsStatus, 'pending')))
    .orderBy(asc(activities.startDateEpoch))
    .limit(limit)
    .all()
}

export function countPendingStreams(db: Db, athleteId: number): number {
  const row = db
    .select({ n: count() })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), eq(activities.streamsStatus, 'pending')))
    .get()
  return row?.n ?? 0
}

/**
 * Activities whose stored streams predate the latlng column (SQL NULL, as
 * opposed to '[]' = "no GPS"), oldest first — the one-time backfill set.
 */
export function listStreamsMissingLatlng(db: Db, athleteId: number, limit: number): ActivityRow[] {
  return db
    .select({
      id: activities.id,
      athleteId: activities.athleteId,
      name: activities.name,
      sportType: activities.sportType,
      startDate: activities.startDate,
      startDateEpoch: activities.startDateEpoch,
      distanceM: activities.distanceM,
      movingTimeS: activities.movingTimeS,
      elapsedTimeS: activities.elapsedTimeS,
      totalElevationGainM: activities.totalElevationGainM,
      streamsStatus: activities.streamsStatus,
      rawSummary: activities.rawSummary,
    })
    .from(activities)
    .innerJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .where(
      and(
        eq(activities.athleteId, athleteId),
        eq(activities.streamsStatus, 'done'),
        isNull(activityStreams.latlng),
      ),
    )
    .orderBy(asc(activities.startDateEpoch))
    .limit(limit)
    .all()
}

export function countStreamsMissingLatlng(db: Db, athleteId: number): number {
  const row = db
    .select({ n: count() })
    .from(activities)
    .innerJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .where(
      and(
        eq(activities.athleteId, athleteId),
        eq(activities.streamsStatus, 'done'),
        isNull(activityStreams.latlng),
      ),
    )
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
