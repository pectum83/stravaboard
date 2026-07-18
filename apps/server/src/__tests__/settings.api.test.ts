import type { FastifyInstance } from 'fastify'
import { describe, expect, it } from 'vitest'
import {
  activityMetrics,
  DEFAULT_SETTINGS,
  metricParamsFromSettings,
  type ActivityStreams,
} from '@stravaboard/shared'
import { getActivity, upsertActivity, type ActivityRow } from '../repositories/activities.repo.js'
import { saveStreams } from '../repositories/streams.repo.js'
import { connectAthlete, session, testApp, testDb } from './helpers.js'

describe('settings API', () => {
  it('requires a session', async () => {
    const { app } = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(res.statusCode).toBe(401)
  })

  it('GET returns defaults for a fresh athlete', async () => {
    const db = testDb()
    connectAthlete(db, 1)
    const { app } = await testApp({}, db)
    const res = await app.inject({ method: 'GET', url: '/api/settings', cookies: session(app, 1) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(DEFAULT_SETTINGS)
  })

  it('PUT persists valid settings, per athlete', async () => {
    const db = testDb()
    connectAthlete(db, 1)
    connectAthlete(db, 2)
    const { app } = await testApp({}, db)
    const next = { ...DEFAULT_SETTINGS, shortWindowS: 90 }
    const put = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: next,
      cookies: session(app, 1),
    })
    expect(put.statusCode).toBe(200)

    const mine = await app.inject({ method: 'GET', url: '/api/settings', cookies: session(app, 1) })
    expect(mine.json()).toEqual(next)
    // The other family member keeps their own defaults.
    const theirs = await app.inject({
      method: 'GET',
      url: '/api/settings',
      cookies: session(app, 2),
    })
    expect(theirs.json()).toEqual(DEFAULT_SETTINGS)
  })

  it('PUT rejects invalid settings', async () => {
    const db = testDb()
    connectAthlete(db, 1)
    const { app } = await testApp({}, db)
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { ...DEFAULT_SETTINGS, instantWindowS: 0 },
      cookies: session(app, 1),
    })
    expect(res.statusCode).toBe(400)
  })

  it('bounds the pause radius to 2–15 m', async () => {
    const db = testDb()
    connectAthlete(db, 1)
    const { app } = await testApp({}, db)
    const cookies = session(app, 1)
    const put = (pauseRadiusM: number) =>
      app.inject({
        method: 'PUT',
        url: '/api/settings',
        payload: { ...DEFAULT_SETTINGS, pauseRadiusM },
        cookies,
      })
    expect((await put(3)).statusCode).toBe(200)
    expect((await put(1)).statusCode).toBe(400)
    expect((await put(16)).statusCode).toBe(400)
  })
})

describe('settings API — metric recompute', () => {
  function doneActivity(id: number, athleteId = 1): ActivityRow {
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
      streamsStatus: 'done',
      rawSummary: '{}',
    }
  }

  /** A climb split by a 100 s standstill: its ascent mean depends on the pause threshold. */
  function climbWithPause(): ActivityStreams {
    const time: number[] = []
    const distance: number[] = []
    const altitude: number[] = []
    const add = (t: number, d: number, a: number) => {
      time.push(t)
      distance.push(d)
      altitude.push(a)
    }
    for (let t = 0; t <= 500; t++) add(t, t * 6, 100 + t * 0.2)
    const dPause = distance[distance.length - 1]!
    const aPause = altitude[altitude.length - 1]!
    for (let k = 1; k <= 100; k++) add(500 + k, dPause, aPause)
    for (let t = 501; t <= 1000; t++) add(t + 100, t * 6, 100 + t * 0.2)
    return { time, distance, altitude, latlng: [] }
  }

  const put = (app: FastifyInstance, settings: object) =>
    app.inject({ method: 'PUT', url: '/api/settings', payload: settings, cookies: session(app, 1) })

  async function seeded() {
    const db = testDb()
    connectAthlete(db, 1)
    upsertActivity(db, doneActivity(1))
    const streams = climbWithPause()
    saveStreams(db, 1, streams, '2026-01-01')
    const { app } = await testApp({}, db)
    return { db, app, streams }
  }

  it('recomputes the stored ascent metric when a metric setting changes', async () => {
    const { db, app, streams } = await seeded()
    expect(getActivity(db, 1)!.ascentMeanVSpeed ?? null).toBeNull() // not computed yet

    // Pause threshold above the 100 s standstill → the pause counts, lower mean.
    const counted = { ...DEFAULT_SETTINGS, pauseThresholdS: 150 }
    expect((await put(app, counted)).statusCode).toBe(200)
    const at150 = getActivity(db, 1)!.ascentMeanVSpeed
    expect(at150).toBeCloseTo(
      activityMetrics(streams, metricParamsFromSettings(counted))!.meanVSpeed,
      6,
    )

    // Pause threshold below the standstill → the pause is excluded, higher mean.
    const excluded = { ...DEFAULT_SETTINGS, pauseThresholdS: 30 }
    await put(app, excluded)
    const at30 = getActivity(db, 1)!.ascentMeanVSpeed
    expect(at30).toBeCloseTo(
      activityMetrics(streams, metricParamsFromSettings(excluded))!.meanVSpeed,
      6,
    )
    expect(at30!).toBeGreaterThan(at150!)
  })

  it('does not recompute when only a chart-only setting changes', async () => {
    const { db, app } = await seeded()
    // Establish a stored metric via a metric-setting change.
    await put(app, { ...DEFAULT_SETTINGS, pauseThresholdS: 150 })
    const before = getActivity(db, 1)!.ascentMeanVSpeed
    expect(before).not.toBeNull()

    // Swap in streams whose metric would be 0 — a recompute would change `before`.
    const flat: ActivityStreams = {
      time: [0, 1],
      distance: [0, 6],
      altitude: [100, 100],
      latlng: [],
    }
    saveStreams(db, 1, flat, '2026-01-02')
    // Change ONLY slopeWindowM (chart-only); the metric setting pauseThresholdS is unchanged.
    await put(app, { ...DEFAULT_SETTINGS, pauseThresholdS: 150, slopeWindowM: 250 })
    expect(getActivity(db, 1)!.ascentMeanVSpeed).toBe(before)
  })

  it('survives a malformed stream set during recompute (no 500)', async () => {
    const db = testDb()
    connectAthlete(db, 1)
    upsertActivity(db, doneActivity(1))
    // time/distance lengths disagree → unrankable; recompute must not throw.
    const bad: ActivityStreams = {
      time: [0, 1, 2],
      distance: [0],
      altitude: [100, 101, 102],
      latlng: [],
    }
    saveStreams(db, 1, bad, '2026-01-01')
    const { app } = await testApp({}, db)
    const res = await put(app, { ...DEFAULT_SETTINGS, pauseThresholdS: 60 })
    expect(res.statusCode).toBe(200)
    expect(getActivity(db, 1)!.ascentMeanVSpeed).toBe(0)
  })
})
