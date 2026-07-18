import { and, asc, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { ActivitySummary, StreamsStatus } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { activities, activityStreams } from '../db/schema.js'

export interface ActivityRow {
  id: number
  /** Owner (Strava athlete id). */
  athleteId: number
  ascentMeanVSpeed?: number | null
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

export type ActivitySort = 'date' | 'ascentSpeed' | 'elevation'

/** Metric value NULL sorts last: activities without data rank below a 0. */
const METRIC_NULL = -1

export interface ActivityFilter {
  /** Name substring (SQLite LIKE — case-insensitive for ASCII only). */
  q?: string
  /** Inclusive lower bound on start date, epoch seconds. */
  fromEpoch?: number
  /** Exclusive upper bound on start date, epoch seconds. */
  toEpochExclusive?: number
  sportType?: string
}

/** Predicate conditions shared by the list page and the badge rankings. */
function filterConditions(filter: ActivityFilter) {
  return [
    filter.q === undefined
      ? undefined
      : sql`${activities.name} LIKE ${`%${escapeLike(filter.q)}%`} ESCAPE '\\'`,
    filter.fromEpoch === undefined ? undefined : gte(activities.startDateEpoch, filter.fromEpoch),
    filter.toEpochExclusive === undefined
      ? undefined
      : lt(activities.startDateEpoch, filter.toEpochExclusive),
    filter.sportType === undefined ? undefined : eq(activities.sportType, filter.sportType),
  ].filter((c) => c !== undefined)
}

/** Sort column expression; the metric coalesces NULL below every real value. */
function sortValueExpr(sort: ActivitySort) {
  switch (sort) {
    case 'date':
      return sql<number>`${activities.startDateEpoch}`
    case 'ascentSpeed':
      return sql<number>`COALESCE(${activities.ascentMeanVSpeed}, ${METRIC_NULL})`
    case 'elevation':
      return sql<number>`${activities.totalElevationGainM}`
  }
}

/** Opaque keyset cursor `<sortValue>:<id>` for the next page under a sort. */
export function cursorFor(sort: ActivitySort, row: ActivityRow): string {
  const value =
    sort === 'date'
      ? row.startDateEpoch
      : sort === 'elevation'
        ? row.totalElevationGainM
        : (row.ascentMeanVSpeed ?? METRIC_NULL)
  return `${value}:${row.id}`
}

/** Parse a cursor produced by `cursorFor`; null when malformed. */
export function parseCursor(before: string): { value: number; id: number } | null {
  const m = /^(-?\d+(?:\.\d+)?):(\d+)$/.exec(before)
  if (!m) return null
  return { value: Number(m[1]), id: Number(m[2]) }
}

/**
 * Page of activities under a sort (descending, id-desc tiebreak); `cursor`
 * is an exclusive composite keyset cursor from `cursorFor`. Filters are
 * stable predicates, so they compose with the cursor.
 */
export function listActivities(
  db: Db,
  {
    athleteId,
    limit,
    cursor,
    filter = {},
    sort = 'date',
  }: {
    athleteId: number
    limit: number
    cursor?: { value: number; id: number }
    filter?: ActivityFilter
    sort?: ActivitySort
  },
): ActivityRow[] {
  const value = sortValueExpr(sort)
  const conditions = [
    eq(activities.athleteId, athleteId),
    cursor === undefined
      ? undefined
      : sql`(${value} < ${cursor.value} OR (${value} = ${cursor.value} AND ${activities.id} < ${cursor.id}))`,
    ...filterConditions(filter),
  ].filter((c) => c !== undefined)
  return db
    .select()
    .from(activities)
    .where(and(...conditions))
    .orderBy(sql`${value} DESC`, desc(activities.id))
    .limit(limit)
    .all()
}

/**
 * Top activity ids by stored ascent mean speed (positive metric only), within
 * the same optional filter as the list so badges reflect the visible set.
 */
export function topByAscentSpeed(
  db: Db,
  athleteId: number,
  count: number,
  filter: ActivityFilter = {},
): number[] {
  return db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        sql`${activities.ascentMeanVSpeed} > 0`,
        ...filterConditions(filter),
      ),
    )
    .orderBy(sql`${activities.ascentMeanVSpeed} DESC`, desc(activities.id))
    .limit(count)
    .all()
    .map((r) => r.id)
}

/** Top activity ids by total elevation gain (positive only), within `filter`. */
export function topByElevation(
  db: Db,
  athleteId: number,
  count: number,
  filter: ActivityFilter = {},
): number[] {
  return db
    .select({ id: activities.id })
    .from(activities)
    .where(
      and(
        eq(activities.athleteId, athleteId),
        sql`${activities.totalElevationGainM} > 0`,
        ...filterConditions(filter),
      ),
    )
    .orderBy(desc(activities.totalElevationGainM), desc(activities.id))
    .limit(count)
    .all()
    .map((r) => r.id)
}

/**
 * Update user-editable summary fields (name, sport type) after an edit is
 * written to Strava. Only the given fields change; streams, elevation and the
 * derived metric are unaffected by a rename/retype, so they're left intact.
 */
export function updateActivityFields(
  db: Db,
  id: number,
  fields: { name?: string; sportType?: string },
): void {
  db.update(activities).set(fields).where(eq(activities.id, id)).run()
}

/** Store the computed sort/badge metric for one activity. */
export function setAscentMeanVSpeed(db: Db, id: number, value: number | null): void {
  db.update(activities).set({ ascentMeanVSpeed: value }).where(eq(activities.id, id)).run()
}

/**
 * Athlete's done activities with streams whose metric was never computed
 * (NULL) — the local metric backfill set. Bounded by `limit` per pass.
 */
export function listMissingMetrics(db: Db, athleteId: number, limit: number): number[] {
  return db
    .select({ id: activities.id })
    .from(activities)
    .innerJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .where(
      and(
        eq(activities.athleteId, athleteId),
        eq(activities.streamsStatus, 'done'),
        isNull(activities.ascentMeanVSpeed),
      ),
    )
    .limit(limit)
    .all()
    .map((r) => r.id)
}

/** Escape LIKE wildcards so user input matches literally. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Distinct sport types of one athlete's *analyzable* activities, sorted. A type
 * only appears when it has at least one activity with elevation data
 * (totalElevationGainM > 0) — indoor/no-elevation types (trainer, weights, pool)
 * have nothing to rank or chart, so they never clutter the filter.
 */
export function listSportTypes(db: Db, athleteId: number): string[] {
  return db
    .selectDistinct({ sportType: activities.sportType })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), sql`${activities.totalElevationGainM} > 0`))
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
    ascentMeanVSpeed: row.ascentMeanVSpeed ?? null,
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
