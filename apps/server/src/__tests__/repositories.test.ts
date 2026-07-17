import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@stravaboard/shared'
import {
  countPendingStreams,
  countStreamsMissingLatlng,
  getActivity,
  listActivities,
  listPendingStreams,
  listSportTypes,
  listStreamsMissingLatlng,
  setStreamsStatus,
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
      beforeEpoch: first[1]!.startDateEpoch,
    })
    expect(second.map((a) => a.id)).toEqual([1])
    expect(listActivities(db, { athleteId: 2, limit: 10 }).map((a) => a.id)).toEqual([99])
  })

  it('scopes sport types per athlete', () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { sportType: 'Run' }))
    upsertActivity(db, activity(2, 2000, { sportType: 'TrailRun', athleteId: 2 }))
    expect(listSportTypes(db, 1)).toEqual(['Run'])
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
