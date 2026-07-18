import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@stravaboard/shared'
import {
  countPendingStreams,
  countStreamsMissingLatlng,
  cursorFor,
  getActivity,
  listActivities,
  listPendingStreams,
  listSportTypes,
  listStreamsMissingLatlng,
  parseCursor,
  setStreamsStatus,
  topByAscentSpeed,
  topByElevation,
  upsertActivity,
  type ActivityRow,
} from '../repositories/activities.repo.js'
import { getAthlete, upsertAthlete } from '../repositories/athletes.repo.js'
import { getSettings, saveSettings } from '../repositories/settings.repo.js'
import { getStreams, saveStreams } from '../repositories/streams.repo.js'
import { getSyncState, saveSyncState } from '../repositories/syncState.repo.js'
import { getTokens, listConnectedAthleteIds, saveTokens } from '../repositories/tokens.repo.js'
import { testDb } from './helpers.js'

function activity(id: number, epoch: number, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id,
    athleteId: 1,
    name: `Activity ${id}`,
    sportType: 'Run',
    startDate: new Date(epoch * 1000).toISOString(),
    startDateEpoch: epoch,
    distanceM: 10_000,
    movingTimeS: 3600,
    elapsedTimeS: 3700,
    totalElevationGainM: 500,
    streamsStatus: 'pending',
    rawSummary: '{}',
    ...overrides,
  }
}

describe('athletes repo', () => {
  it('creates on first login and refreshes the name on later logins', () => {
    const db = testDb()
    upsertAthlete(db, 7, 'Chris', '2026-01-01T00:00:00Z')
    upsertAthlete(db, 7, 'Christophe', '2026-02-01T00:00:00Z')
    expect(getAthlete(db, 7)).toEqual({
      id: 7,
      displayName: 'Christophe',
      createdAt: '2026-01-01T00:00:00Z', // creation date is kept
    })
    expect(getAthlete(db, 8)).toBeNull()
  })
})

describe('tokens repo', () => {
  it('returns null for an athlete without tokens', () => {
    expect(getTokens(testDb(), 7)).toBeNull()
  })

  it('stores one token row per athlete and lists the connected ones', () => {
    const db = testDb()
    saveTokens(db, { athleteId: 7, accessToken: 'a1', refreshToken: 'r1', expiresAt: 100 })
    saveTokens(db, { athleteId: 8, accessToken: 'b1', refreshToken: 's1', expiresAt: 100 })
    saveTokens(db, { athleteId: 7, accessToken: 'a2', refreshToken: 'r2', expiresAt: 200 })
    expect(getTokens(db, 7)).toEqual({
      athleteId: 7,
      accessToken: 'a2',
      refreshToken: 'r2',
      expiresAt: 200,
    })
    expect(getTokens(db, 8)?.accessToken).toBe('b1')
    expect(listConnectedAthleteIds(db).sort()).toEqual([7, 8])
  })
})

describe('settings repo', () => {
  it('returns defaults when nothing stored', () => {
    expect(getSettings(testDb(), 1)).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips saved settings per athlete', () => {
    const db = testDb()
    const custom = { ...DEFAULT_SETTINGS, shortWindowS: 90 }
    saveSettings(db, 1, custom)
    expect(getSettings(db, 1)).toEqual(custom)
    expect(getSettings(db, 2)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('activities repo', () => {
  it('upserts without duplicating', () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000))
    upsertActivity(db, activity(1, 1000, { name: 'Renamed' }))
    expect(listActivities(db, { athleteId: 1, limit: 10 })).toHaveLength(1)
    expect(getActivity(db, 1)?.name).toBe('Renamed')
  })

  it('pages newest-first with exclusive keyset cursor, scoped to the athlete', () => {
    const db = testDb()
    for (const [id, epoch] of [
      [1, 1000],
      [2, 2000],
      [3, 3000],
    ] as const) {
      upsertActivity(db, activity(id, epoch))
    }
    upsertActivity(db, activity(99, 2500, { athleteId: 2 }))

    const first = listActivities(db, { athleteId: 1, limit: 2 })
    expect(first.map((a) => a.id)).toEqual([3, 2])
    const second = listActivities(db, {
      athleteId: 1,
      limit: 2,
      cursor: { value: first[1]!.startDateEpoch, id: first[1]!.id },
    })
    expect(second.map((a) => a.id)).toEqual([1])
    expect(listActivities(db, { athleteId: 2, limit: 10 }).map((a) => a.id)).toEqual([99])
  })

  it('scopes sport types per athlete and only lists analyzable (elevation) ones', () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { sportType: 'Run' }))
    upsertActivity(db, activity(2, 2000, { sportType: 'TrailRun', athleteId: 2 }))
    // A sport whose only activity has no elevation is hidden from the filter.
    upsertActivity(db, activity(3, 3000, { sportType: 'Workout', totalElevationGainM: 0 }))
    // Hike has one flat and one hilly activity → still analyzable, shown once.
    upsertActivity(db, activity(4, 4000, { sportType: 'Hike', totalElevationGainM: 0 }))
    upsertActivity(db, activity(5, 5000, { sportType: 'Hike', totalElevationGainM: 300 }))
    expect(listSportTypes(db, 1)).toEqual(['Hike', 'Run'])
    expect(listSportTypes(db, 2)).toEqual(['TrailRun'])
  })

  it('tracks pending streams oldest-first per athlete', () => {
    const db = testDb()
    upsertActivity(db, activity(1, 2000))
    upsertActivity(db, activity(2, 1000))
    upsertActivity(db, activity(3, 3000, { streamsStatus: 'done' }))
    upsertActivity(db, activity(4, 500, { athleteId: 2 }))
    expect(countPendingStreams(db, 1)).toBe(2)
    expect(listPendingStreams(db, 1, 10).map((a) => a.id)).toEqual([2, 1])
    setStreamsStatus(db, 2, 'none')
    expect(countPendingStreams(db, 1)).toBe(1)
    expect(countPendingStreams(db, 2)).toBe(1)
  })
})

describe('streams repo', () => {
  it('round-trips streams including null altitude', () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000))
    const latlng: [number, number][] = [
      [45.1, 6.05],
      [45.10003, 6.05],
    ]
    saveStreams(
      db,
      1,
      { time: [0, 1], distance: [0, 3], altitude: [100, 101], latlng },
      '2026-01-01',
    )
    expect(getStreams(db, 1)).toEqual({
      time: [0, 1],
      distance: [0, 3],
      altitude: [100, 101],
      latlng,
    })

    saveStreams(
      db,
      1,
      { time: [0, 1], distance: [0, 3], altitude: null, latlng: null },
      '2026-01-02',
    )
    expect(getStreams(db, 1)?.altitude).toBeNull()
  })

  it('returns null for unknown activity', () => {
    expect(getStreams(testDb(), 42)).toBeNull()
  })

  it('serves latlng as null both for "no GPS" ([]) and "not backfilled" (NULL)', () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000))
    saveStreams(db, 1, { time: [0], distance: [0], altitude: [1], latlng: [] }, '2026-01-01')
    expect(getStreams(db, 1)?.latlng).toBeNull()

    upsertActivity(db, activity(2, 2000))
    saveStreams(db, 2, { time: [0], distance: [0], altitude: [1], latlng: null }, '2026-01-01')
    expect(getStreams(db, 2)?.latlng).toBeNull()
  })
})

describe('sorting and badges', () => {
  const withMetric = (id: number, epoch: number, vspeed: number | null, gain: number) =>
    activity(id, epoch, { ascentMeanVSpeed: vspeed, ascentGainM: gain })

  it('sorts by stored ascent speed with NULL metrics last and a working cursor', () => {
    const db = testDb()
    upsertActivity(db, withMetric(1, 1000, 500, 100))
    upsertActivity(db, withMetric(2, 2000, 900, 50))
    upsertActivity(db, withMetric(3, 3000, null, 800)) // not computed yet
    upsertActivity(db, withMetric(4, 4000, 700, 200))

    const page1 = listActivities(db, { athleteId: 1, limit: 2, sort: 'ascentSpeed' })
    expect(page1.map((a) => a.id)).toEqual([2, 4])
    const page2 = listActivities(db, {
      athleteId: 1,
      limit: 2,
      sort: 'ascentSpeed',
      cursor: { value: page1[1]!.ascentMeanVSpeed!, id: page1[1]!.id },
    })
    expect(page2.map((a) => a.id)).toEqual([1, 3])
  })

  it('sorts by total elevation gain', () => {
    const db = testDb()
    upsertActivity(db, withMetric(1, 1000, 500, 100))
    upsertActivity(db, withMetric(2, 2000, 900, 50))
    upsertActivity(db, withMetric(3, 3000, null, 800))
    expect(listActivities(db, { athleteId: 1, limit: 10, sort: 'elevation' }).map((a) => a.id)) //
      .toEqual([3, 1, 2])
  })

  it('ranks top-3 by speed (metric > 0 only) and by elevation, per athlete', () => {
    const db = testDb()
    upsertActivity(db, withMetric(1, 1000, 500, 100))
    upsertActivity(db, withMetric(2, 2000, 900, 50))
    upsertActivity(db, withMetric(3, 3000, 0, 800)) // no qualifying ascent
    upsertActivity(db, withMetric(4, 4000, 700, 200))
    upsertActivity(db, withMetric(5, 5000, 600, 300))
    upsertActivity(db, activity(6, 6000, { athleteId: 2, ascentMeanVSpeed: 9999 }))

    expect(topByAscentSpeed(db, 1, 3)).toEqual([2, 4, 5])
    expect(topByElevation(db, 1, 3)).toEqual([3, 5, 4])
  })

  it('restricts badge rankings to the given filter', () => {
    const db = testDb()
    upsertActivity(db, withMetric(1, 1000, 500, 100)) // Run
    upsertActivity(db, { ...withMetric(2, 2000, 900, 50), sportType: 'Hike' })
    upsertActivity(db, { ...withMetric(3, 3000, 700, 800), sportType: 'Hike' })
    upsertActivity(db, withMetric(4, 4000, 990, 200)) // Run, fastest overall

    // Without a filter the fastest overall (4) leads; filtered to Hike it drops out.
    expect(topByAscentSpeed(db, 1, 3)).toEqual([4, 2, 3])
    expect(topByAscentSpeed(db, 1, 3, { sportType: 'Hike' })).toEqual([2, 3])
    expect(topByElevation(db, 1, 3, { sportType: 'Hike' })).toEqual([3, 2])
  })

  it('round-trips cursors through cursorFor/parseCursor', () => {
    const row = activity(7, 1000, { ascentMeanVSpeed: 612.5 })
    expect(parseCursor(cursorFor('ascentSpeed', row))).toEqual({ value: 612.5, id: 7 })
    expect(parseCursor(cursorFor('date', row))).toEqual({ value: 1000, id: 7 })
    expect(parseCursor('garbage')).toBeNull()
  })
})

describe('latlng backfill queries', () => {
  it("lists only the athlete's done activities whose latlng is SQL NULL, oldest first", () => {
    const db = testDb()
    // 1: legacy row (NULL latlng) -> needs backfill
    upsertActivity(db, activity(1, 2000, { streamsStatus: 'done' }))
    saveStreams(db, 1, { time: [0], distance: [0], altitude: [1], latlng: null }, '2026-01-01')
    // 2: no-GPS row ('[]') -> terminal, not in the backfill set
    upsertActivity(db, activity(2, 1000, { streamsStatus: 'done' }))
    saveStreams(db, 2, { time: [0], distance: [0], altitude: [1], latlng: [] }, '2026-01-01')
    // 3: legacy row too, older than 1
    upsertActivity(db, activity(3, 500, { streamsStatus: 'done' }))
    saveStreams(db, 3, { time: [0], distance: [0], altitude: [1], latlng: null }, '2026-01-01')
    // 4: pending activity without streams -> not in the set
    upsertActivity(db, activity(4, 3000, { streamsStatus: 'pending' }))
    // 5: another athlete's legacy row -> not in athlete 1's set
    upsertActivity(db, activity(5, 100, { streamsStatus: 'done', athleteId: 2 }))
    saveStreams(db, 5, { time: [0], distance: [0], altitude: [1], latlng: null }, '2026-01-01')

    expect(listStreamsMissingLatlng(db, 1, 10).map((a) => a.id)).toEqual([3, 1])
    expect(countStreamsMissingLatlng(db, 1)).toBe(2)
    expect(countStreamsMissingLatlng(db, 2)).toBe(1)
  })
})

describe('sync state repo', () => {
  it('defaults to epoch 0 / idle per athlete', () => {
    expect(getSyncState(testDb(), 1)).toEqual({
      lastActivityStartEpoch: 0,
      status: 'idle',
      error: null,
    })
  })

  it('merges partial updates per athlete', () => {
    const db = testDb()
    saveSyncState(db, 1, { lastActivityStartEpoch: 123 })
    saveSyncState(db, 1, { status: 'syncing' })
    saveSyncState(db, 2, { lastActivityStartEpoch: 456 })
    expect(getSyncState(db, 1)).toEqual({
      lastActivityStartEpoch: 123,
      status: 'syncing',
      error: null,
    })
    expect(getSyncState(db, 2).lastActivityStartEpoch).toBe(456)
  })
})
