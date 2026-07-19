import { and, asc, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { ActivitySummary, StreamsStatus } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { activities, activityStreams } from '../db/schema.js'

export interface ActivityRow {
  id: number
  /** Owner (Strava athlete id). */
  athleteId: number
  ascentMeanVSpeed?: number | null
  /** Lift-excluded climbing gain (m); NULL = not computed yet, 0 = no ascent. */
  ascentGainM?: number | null
  /** Total descent (m, positive, not speed-capped); NULL = not computed, 0 = no descent. */
  descentLossM?: number | null
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

export type ActivitySort = 'date' | 'ascentSpeed' | 'elevation' | 'descent' | 'effort'

/** Metric value NULL sorts last: activities without data rank below a 0. */
const METRIC_NULL = -1

/**
 * Effort score in km-effort (equivalent flat kilometres):
 *
 *   distanceKm + (D+ / 100) × (Vspeed / 400)
 *
 * Base is the classic mountaineering equivalence (100 m of climb ≈ 1 km on the
 * flat, both in energy and in Swiss-rule time at 4 km/h / 400 m/h), so a long
 * flat walk scores its full distance. The climb part is then weighted by the
 * mean ascent speed relative to the 400 m/h reference: physiological load ≈
 * duration × intensity² (TRIMP/TSS model), and with climb duration D+/Vspeed
 * and intensity Vspeed/400 that collapses to a linear Vspeed/400 factor. At
 * exactly 400 m/h the formula degrades to the plain km-effort rule.
 *
 * NULL until the climb metrics are computed (a pending activity must not rank
 * on distance alone). `effortScore` is the TS mirror — the cursor built from a
 * row must equal what SQL computes for it, bit for bit, so both keep the exact
 * same operations in the exact same order.
 */
const effortExpr = sql<number>`(${activities.distanceM} / 1000.0) + (${activities.ascentGainM} * COALESCE(${activities.ascentMeanVSpeed}, 0)) / 40000.0`

/** TS mirror of `effortExpr` (see there); null when metrics are not computed. */
function effortScore(row: ActivityRow): number | null {
  if (row.ascentGainM == null) return null
  return row.distanceM / 1000.0 + (row.ascentGainM * (row.ascentMeanVSpeed ?? 0)) / 40000.0
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
      return sql<number>`COALESCE(${activities.ascentGainM}, ${METRIC_NULL})`
    case 'descent':
      return sql<number>`COALESCE(${activities.descentLossM}, ${METRIC_NULL})`
    case 'effort':
      return sql<number>`COALESCE(${effortExpr}, ${METRIC_NULL})`
  }
}

/** Opaque keyset cursor `<sortValue>:<id>` for the next page under a sort. */
export function cursorFor(sort: ActivitySort, row: ActivityRow): string {
  const value =
    sort === 'date'
      ? row.startDateEpoch
      : sort === 'elevation'
        ? (row.ascentGainM ?? METRIC_NULL)
        : sort === 'descent'
          ? (row.descentLossM ?? METRIC_NULL)
          : sort === 'effort'
            ? (effortScore(row) ?? METRIC_NULL)
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

/**
 * Top activity ids by effort score (see `effortExpr`), within `filter`. Only
 * activities whose metrics are computed rank (a pending row would rank on
 * distance alone, then jump once its climb is known); flat activities qualify
 * through their distance term.
 */
export function topByEffort(
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
        sql`${activities.ascentGainM} IS NOT NULL`,
        sql`${effortExpr} > 0`,
        ...filterConditions(filter),
      ),
    )
    .orderBy(sql`${effortExpr} DESC`, desc(activities.id))
    .limit(count)
    .all()
    .map((r) => r.id)
}

/** Top activity ids by lift-excluded climbing gain (positive only), within `filter`. */
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
        sql`${activities.ascentGainM} > 0`,
        ...filterConditions(filter),
      ),
    )
    .orderBy(desc(activities.ascentGainM), desc(activities.id))
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

/**
 * Store the computed sort/badge metrics (mean ascent speed + lift-excluded
 * climbing gain + total descent).
 */
export function setActivityMetrics(
  db: Db,
  id: number,
  meanVSpeed: number | null,
  gainM: number | null,
  descentLossM: number | null,
): void {
  db.update(activities)
    .set({ ascentMeanVSpeed: meanVSpeed, ascentGainM: gainM, descentLossM })
    .where(eq(activities.id, id))
    .run()
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

/**
 * Every one of an athlete's done activities that has a stored stream set — the
 * full recompute set when a metric-affecting setting changes. Unlike
 * `listMissingMetrics` it ignores whether a metric is already stored (all are
 * replaced); returned in one shot, ids are cheap even for a large history.
 */
export function listDoneActivityIds(db: Db, athleteId: number): number[] {
  return db
    .select({ id: activities.id })
    .from(activities)
    .innerJoin(activityStreams, eq(activityStreams.activityId, activities.id))
    .where(and(eq(activities.athleteId, athleteId), eq(activities.streamsStatus, 'done')))
    .all()
    .map((r) => r.id)
}

/**
 * Whole-filter totals for the activity list: how many activities match `filter`
 * and their cumulated lift-excluded climbing gain (m) — the same D+ shown per
 * row (NULL metrics count as 0), so the total agrees with the visible figures.
 */
export function aggregateActivities(
  db: Db,
  athleteId: number,
  filter: ActivityFilter = {},
): { count: number; totalAscentGainM: number } {
  const row = db
    .select({
      total: count(),
      totalAscentGainM: sql<number>`COALESCE(SUM(${activities.ascentGainM}), 0)`,
    })
    .from(activities)
    .where(and(eq(activities.athleteId, athleteId), ...filterConditions(filter)))
    .get()
  return { count: row?.total ?? 0, totalAscentGainM: row?.totalAscentGainM ?? 0 }
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
    ascentGainM: row.ascentGainM ?? null,
    descentLossM: row.descentLossM ?? null,
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
