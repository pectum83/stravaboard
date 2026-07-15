import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@stravaboard/shared'
import {
  countPendingStreams,
  countStreamsMissingLatlng,
  getActivity,
  listActivities,
  listPendingStreams,
  listStreamsMissingLatlng,
  setStreamsStatus,
  upsertActivity,
  type ActivityRow,
} from '../repositories/activities.repo.js'
import { getSettings, saveSettings } from '../repositories/settings.repo.js'
import { getStreams, saveStreams } from '../repositories/streams.repo.js'
import { getSyncState, saveSyncState } from '../repositories/syncState.repo.js'
import { getTokens, saveTokens } from '../repositories/tokens.repo.js'
import { testDb } from './helpers.js'

function activity(id: number, epoch: number, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id,
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

describe('tokens repo', () => {
  it('returns null when no tokens stored', () => {
    expect(getTokens(testDb())).toBeNull()
  })

  it('stores and overwrites the single token row', () => {
    const db = testDb()
    saveTokens(db, { athleteId: 7, accessToken: 'a1', refreshToken: 'r1', expiresAt: 100 })
    saveTokens(db, { athleteId: 7, accessToken: 'a2', refreshToken: 'r2', expiresAt: 200 })
    expect(getTokens(db)).toEqual({
      athleteId: 7,
      accessToken: 'a2',
      refreshToken: 'r2',
      expiresAt: 200,
    })
  })
})

describe('settings repo', () => {
  it('returns defaults when nothing stored', () => {
    expect(getSettings(testDb())).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips saved settings', () => {
    const db = testDb()
    const custom = { ...DEFAULT_SETTINGS, shortWindowS: 90 }
    saveSettings(db, custom)
    expect(getSettings(db)).toEqual(custom)
  })
})

describe('activities repo', () => {
  it('upserts without duplicating', () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000))
    upsertActivity(db, activity(1, 1000, { name: 'Renamed' }))
    expect(listActivities(db, { limit: 10 })).toHaveLength(1)
    expect(getActivity(db, 1)?.name).toBe('Renamed')
  })

  it('pages newest-first with exclusive keyset cursor', () => {
    const db = testDb()
    for (const [id, epoch] of [
      [1, 1000],
      [2, 2000],
      [3, 3000],
    ] as const) {
      upsertActivity(db, activity(id, epoch))
    }
    const first = listActivities(db, { limit: 2 })
    expect(first.map((a) => a.id)).toEqual([3, 2])
    const second = listActivities(db, { limit: 2, beforeEpoch: first[1]!.startDateEpoch })
    expect(second.map((a) => a.id)).toEqual([1])
  })

  it('tracks pending streams oldest-first', () => {
    const db = testDb()
    upsertActivity(db, activity(1, 2000))
    upsertActivity(db, activity(2, 1000))
    upsertActivity(db, activity(3, 3000, { streamsStatus: 'done' }))
    expect(countPendingStreams(db)).toBe(2)
    expect(listPendingStreams(db, 10).map((a) => a.id)).toEqual([2, 1])
    setStreamsStatus(db, 2, 'none')
    expect(countPendingStreams(db)).toBe(1)
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
  it('lists only done activities whose stored latlng is SQL NULL, oldest first', () => {
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

    expect(listStreamsMissingLatlng(db, 10).map((a) => a.id)).toEqual([3, 1])
    expect(countStreamsMissingLatlng(db)).toBe(2)
  })
})

describe('sync state repo', () => {
  it('defaults to epoch 0 / idle', () => {
    expect(getSyncState(testDb())).toEqual({
      lastActivityStartEpoch: 0,
      status: 'idle',
      error: null,
    })
  })

  it('merges partial updates', () => {
    const db = testDb()
    saveSyncState(db, { lastActivityStartEpoch: 123 })
    saveSyncState(db, { status: 'syncing' })
    expect(getSyncState(db)).toEqual({
      lastActivityStartEpoch: 123,
      status: 'syncing',
      error: null,
    })
  })
})
