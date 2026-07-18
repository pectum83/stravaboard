import { describe, expect, it } from 'vitest'
import {
  activityMetrics,
  DEFAULT_SETTINGS,
  metricParamsFromSettings,
  type ActivityStreams,
} from '@stravaboard/shared'
import { metricsFor, recomputeAllMetrics } from '../metrics/recompute.js'
import {
  getActivity,
  listDoneActivityIds,
  upsertActivity,
  type ActivityRow,
} from '../repositories/activities.repo.js'
import { saveStreams } from '../repositories/streams.repo.js'
import { testDb } from './helpers.js'

const PARAMS = metricParamsFromSettings(DEFAULT_SETTINGS)

function row(
  id: number,
  athleteId = 1,
  streamsStatus: ActivityRow['streamsStatus'] = 'done',
): ActivityRow {
  return {
    id,
    athleteId,
    name: `Activity ${id}`,
    sportType: 'Hike',
    startDate: new Date(id * 1_000_000).toISOString(),
    startDateEpoch: id * 1000,
    distanceM: 10_000,
    movingTimeS: 3600,
    elapsedTimeS: 3700,
    totalElevationGainM: 500,
    streamsStatus,
    rawSummary: '{}',
  }
}

/** A steady climb (200 m over 1000 s → 720 m/h), no GPS track. */
function climb(): ActivityStreams {
  const time: number[] = []
  const distance: number[] = []
  const altitude: number[] = []
  for (let t = 0; t <= 1000; t++) {
    time.push(t)
    distance.push(t * 6)
    altitude.push(100 + t * 0.2)
  }
  return { time, distance, altitude, latlng: [] }
}

describe('listDoneActivityIds', () => {
  it('returns only the athlete’s done activities that have stored streams', () => {
    const db = testDb()
    upsertActivity(db, row(1))
    saveStreams(db, 1, climb(), '2026-01-01')
    upsertActivity(db, row(2))
    saveStreams(db, 2, climb(), '2026-01-01')
    upsertActivity(db, row(3, 1, 'pending')) // no streams yet
    upsertActivity(db, row(4)) // done but streams never saved
    upsertActivity(db, row(5, 2)) // other athlete
    saveStreams(db, 5, climb(), '2026-01-01')

    expect(listDoneActivityIds(db, 1).sort()).toEqual([1, 2])
  })
})

describe('recomputeAllMetrics', () => {
  it('recomputes every done-with-streams activity, leaving others untouched', () => {
    const db = testDb()
    upsertActivity(db, row(1))
    saveStreams(db, 1, climb(), '2026-01-01')
    upsertActivity(db, row(2, 1, 'pending')) // no streams — untouched
    upsertActivity(db, row(3, 2)) // other athlete — untouched
    saveStreams(db, 3, climb(), '2026-01-01')

    recomputeAllMetrics(db, 1, PARAMS)

    const expected = activityMetrics(climb(), PARAMS)!
    const a1 = getActivity(db, 1)!
    expect(a1.ascentMeanVSpeed).toBeCloseTo(expected.meanVSpeed, 6)
    expect(a1.ascentGainM).toBeCloseTo(expected.gainM, 6)
    expect(a1.descentLossM).toBe(expected.descentLossM)
    // Pending activity and the other athlete keep their NULL metrics.
    expect(getActivity(db, 2)!.ascentMeanVSpeed ?? null).toBeNull()
    expect(getActivity(db, 3)!.ascentMeanVSpeed ?? null).toBeNull()
  })

  it('is a no-op when the athlete has no done activities', () => {
    const db = testDb()
    upsertActivity(db, row(1, 1, 'pending'))
    expect(() => recomputeAllMetrics(db, 1, PARAMS)).not.toThrow()
  })
})

describe('metricsFor', () => {
  it('returns the settings-based metrics for a valid stream set', () => {
    expect(metricsFor(climb(), PARAMS)).toEqual(activityMetrics(climb(), PARAMS))
  })

  it('treats an unexpected failure as unrankable (0/0/0) and logs, without throwing', () => {
    const boom = {
      get altitude(): number[] {
        throw new Error('boom')
      },
    } as unknown as ActivityStreams
    const msgs: string[] = []
    expect(metricsFor(boom, PARAMS, (m) => msgs.push(m))).toEqual({
      meanVSpeed: 0,
      gainM: 0,
      descentLossM: 0,
    })
    expect(msgs[0]).toContain('boom')
  })
})
