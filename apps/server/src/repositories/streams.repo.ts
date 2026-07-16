import { eq } from 'drizzle-orm'
import type { ActivityStreams } from '@stravaboard/shared'
import type { Db } from '../db/client.js'
import { activityStreams } from '../db/schema.js'

export function saveStreams(
  db: Db,
  activityId: number,
  streams: ActivityStreams,
  fetchedAt: string,
): void {
  const values = {
    activityId,
    time: JSON.stringify(streams.time),
    distance: JSON.stringify(streams.distance),
    altitude: streams.altitude === null ? null : JSON.stringify(streams.altitude),
    // null stays SQL NULL ("not fetched yet"); [] is stored as '[]' ("no GPS").
    latlng: streams.latlng === null ? null : JSON.stringify(streams.latlng),
    fetchedAt,
  }
  const { activityId: _id, ...rest } = values
  db.insert(activityStreams)
    .values(values)
    .onConflictDoUpdate({ target: activityStreams.activityId, set: rest })
    .run()
}

export function deleteStreams(db: Db, activityId: number): void {
  db.delete(activityStreams).where(eq(activityStreams.activityId, activityId)).run()
}

export function getStreams(db: Db, activityId: number): ActivityStreams | null {
  const row = db
    .select()
    .from(activityStreams)
    .where(eq(activityStreams.activityId, activityId))
    .get()
  if (!row) return null
  const latlng = row.latlng === null ? null : (JSON.parse(row.latlng) as [number, number][])
  return {
    time: JSON.parse(row.time) as number[],
    distance: JSON.parse(row.distance) as number[],
    altitude: row.altitude === null ? null : (JSON.parse(row.altitude) as number[]),
    // Clients see null both for "no GPS" and "not backfilled yet".
    latlng: latlng !== null && latlng.length > 0 ? latlng : null,
  }
}
