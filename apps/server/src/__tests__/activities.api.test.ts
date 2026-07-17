import { describe, expect, it } from 'vitest'
import { getActivity, upsertActivity, type ActivityRow } from '../repositories/activities.repo.js'
import { getStreams, saveStreams } from '../repositories/streams.repo.js'
import type { Db } from '../db/client.js'
import { connectAthlete, session, testApp, testDb } from './helpers.js'
import { makeActivity, stravaStub, type StravaStubOptions } from './stravaStub.js'

function activity(id: number, epoch: number, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id,
    athleteId: 1,
    name: `Activity ${id}`,
    sportType: 'TrailRun',
    startDate: new Date(epoch * 1000).toISOString(),
    startDateEpoch: epoch,
    distanceM: 10_000,
    movingTimeS: 3600,
    elapsedTimeS: 3700,
    totalElevationGainM: 500,
    streamsStatus: 'done',
    rawSummary: '{}',
    ...overrides,
  }
}

async function appWithAthlete(db = testDb()) {
  connectAthlete(db, 1)
  const { app } = await testApp({}, db)
  return { app, db, cookies: session(app, 1) }
}

describe('activities API', () => {
  it('requires a session', async () => {
    const { app } = await testApp()
    expect((await app.inject({ method: 'GET', url: '/api/activities' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/api/activities/1/streams' })).statusCode) //
      .toBe(401)
  })

  it('lists newest-first with keyset pagination', async () => {
    const db = testDb()
    for (let i = 1; i <= 5; i++) upsertActivity(db, activity(i, i * 1000))
    const { app, cookies } = await appWithAthlete(db)

    const p1 = await app.inject({ method: 'GET', url: '/api/activities?limit=2', cookies })
    const body1 = p1.json()
    expect(body1.activities.map((a: { id: number }) => a.id)).toEqual([5, 4])
    expect(body1.nextBefore).toBe('4000')

    const p2 = await app.inject({
      method: 'GET',
      url: `/api/activities?limit=2&before=${body1.nextBefore}`,
      cookies,
    })
    expect(p2.json().activities.map((a: { id: number }) => a.id)).toEqual([3, 2])

    const last = await app.inject({
      method: 'GET',
      url: '/api/activities?limit=2&before=2000',
      cookies,
    })
    expect(last.json().activities.map((a: { id: number }) => a.id)).toEqual([1])
    expect(last.json().nextBefore).toBeUndefined()
  })

  it("never serves another athlete's activities or streams", async () => {
    const db = testDb()
    connectAthlete(db, 2)
    upsertActivity(db, activity(1, 1000)) // athlete 1
    upsertActivity(db, activity(2, 2000, { athleteId: 2 }))
    saveStreams(db, 2, { time: [0], distance: [0], altitude: [1], latlng: [] }, '2026-01-01')
    const { app, cookies } = await appWithAthlete(db)

    const list = await app.inject({ method: 'GET', url: '/api/activities', cookies })
    expect(list.json().activities.map((a: { id: number }) => a.id)).toEqual([1])

    const streams = await app.inject({ method: 'GET', url: '/api/activities/2/streams', cookies })
    expect(streams.statusCode).toBe(404)

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/activities/2/refresh',
      cookies,
    })
    expect(refresh.statusCode).toBe(404)
  })

  it('rejects invalid pagination query', async () => {
    const { app, cookies } = await appWithAthlete()
    const res = await app.inject({ method: 'GET', url: '/api/activities?limit=0', cookies })
    expect(res.statusCode).toBe(400)
  })

  it('filters by name substring, case-insensitively', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { name: 'Morning Mountain Run' }))
    upsertActivity(db, activity(2, 2000, { name: 'Flat River Loop' }))
    const { app, cookies } = await appWithAthlete(db)

    const res = await app.inject({ method: 'GET', url: '/api/activities?q=mountain', cookies })
    expect(res.json().activities.map((a: { id: number }) => a.id)).toEqual([1])

    const none = await app.inject({ method: 'GET', url: '/api/activities?q=alpine', cookies })
    expect(none.json().activities).toEqual([])
  })

  it('matches LIKE wildcards in the search literally', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { name: '100% climb' }))
    upsertActivity(db, activity(2, 2000, { name: 'plain run' }))
    const { app, cookies } = await appWithAthlete(db)
    const res = await app.inject({ method: 'GET', url: '/api/activities?q=%25', cookies }) // '%'
    expect(res.json().activities.map((a: { id: number }) => a.id)).toEqual([1])
  })

  it('filters by inclusive date range', async () => {
    const db = testDb()
    const day = (d: string) => Date.parse(`${d}T12:00:00Z`) / 1000
    upsertActivity(db, activity(1, day('2026-06-10')))
    upsertActivity(db, activity(2, day('2026-06-15')))
    upsertActivity(db, activity(3, day('2026-06-20')))
    const { app, cookies } = await appWithAthlete(db)

    const res = await app.inject({
      method: 'GET',
      url: '/api/activities?from=2026-06-12&to=2026-06-15',
      cookies,
    })
    // `to` day itself is included
    expect(res.json().activities.map((a: { id: number }) => a.id)).toEqual([2])

    const upper = await app.inject({ method: 'GET', url: '/api/activities?to=2026-06-15', cookies })
    expect(upper.json().activities.map((a: { id: number }) => a.id)).toEqual([2, 1])
  })

  it('filters by sport type and combines filters with pagination', async () => {
    const db = testDb()
    for (let i = 1; i <= 4; i++) {
      upsertActivity(db, activity(i, i * 1000, { sportType: i % 2 === 0 ? 'Run' : 'TrailRun' }))
    }
    const { app, cookies } = await appWithAthlete(db)

    const runs = await app.inject({ method: 'GET', url: '/api/activities?sportType=Run', cookies })
    expect(runs.json().activities.map((a: { id: number }) => a.id)).toEqual([4, 2])

    // Cursor pages stay consistent under an active filter
    const p1 = await app.inject({
      method: 'GET',
      url: '/api/activities?sportType=Run&limit=1',
      cookies,
    })
    expect(p1.json().activities.map((a: { id: number }) => a.id)).toEqual([4])
    const p2 = await app.inject({
      method: 'GET',
      url: `/api/activities?sportType=Run&limit=1&before=${p1.json().nextBefore}`,
      cookies,
    })
    expect(p2.json().activities.map((a: { id: number }) => a.id)).toEqual([2])
  })

  it('rejects malformed date filters', async () => {
    const { app, cookies } = await appWithAthlete()
    const res = await app.inject({
      method: 'GET',
      url: '/api/activities?from=15-06-2026',
      cookies,
    })
    expect(res.statusCode).toBe(400)
  })

  it('lists distinct sport types, sorted', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { sportType: 'TrailRun' }))
    upsertActivity(db, activity(2, 2000, { sportType: 'Run' }))
    upsertActivity(db, activity(3, 3000, { sportType: 'TrailRun' }))
    const { app, cookies } = await appWithAthlete(db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/sport-types', cookies })
    expect(res.json()).toEqual(['Run', 'TrailRun'])
  })

  describe('POST /api/activities/:id/refresh', () => {
    async function refreshApp(db: Db, stubOpts: StravaStubOptions) {
      connectAthlete(db, 1)
      const stub = stravaStub(stubOpts)
      const { app } = await testApp(
        {
          STRAVA_API_BASE: 'https://strava.test/api/v3',
          STRAVA_OAUTH_BASE: 'https://strava.test/oauth',
        },
        db,
        stub.fetchImpl,
      )
      return { app, cookies: session(app, 1) }
    }

    it('re-fetches the summary and streams from Strava', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000, { name: 'Before crop' }))
      saveStreams(db, 101, { time: [0, 1], distance: [0, 5], altitude: [1, 2], latlng: [] }, 'old')

      const cropped = makeActivity(101, new Date(1000 * 1000).toISOString(), {
        name: 'After crop',
        distance: 9000,
      })
      const { app, cookies } = await refreshApp(db, { activities: [cropped] })

      const res = await app.inject({ method: 'POST', url: '/api/activities/101/refresh', cookies })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ id: 101, name: 'After crop', distanceM: 9000 })
      // Streams replaced by the stub's fresh set (incl. latlng)
      expect(getStreams(db, 101)?.altitude).toEqual([100, 101, 102, 103])
      expect(getStreams(db, 101)?.latlng).not.toBeNull()
      expect(getActivity(db, 101)?.streamsStatus).toBe('done')
    })

    it('404s for an activity unknown locally', async () => {
      const { app, cookies } = await refreshApp(testDb(), { activities: [] })
      const res = await app.inject({ method: 'POST', url: '/api/activities/9/refresh', cookies })
      expect(res.statusCode).toBe(404)
    })

    it('404s without touching local data when Strava no longer has the activity', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000, { name: 'Kept' }))
      const { app, cookies } = await refreshApp(db, { activities: [] })

      const res = await app.inject({ method: 'POST', url: '/api/activities/101/refresh', cookies })
      expect(res.statusCode).toBe(404)
      expect(res.json().error).toContain('Strava')
      expect(getActivity(db, 101)?.name).toBe('Kept')
    })

    it('drops stale streams when Strava stops serving them', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000))
      saveStreams(db, 101, { time: [0], distance: [0], altitude: [1], latlng: [] }, 'old')
      const { app, cookies } = await refreshApp(db, {
        activities: [makeActivity(101, new Date(1000 * 1000).toISOString())],
        noStreams: [101],
      })

      const res = await app.inject({ method: 'POST', url: '/api/activities/101/refresh', cookies })
      expect(res.statusCode).toBe(200)
      expect(res.json().streamsStatus).toBe('none')
      expect(getStreams(db, 101)).toBeNull()
    })

    it('surfaces Strava rate limiting as 429 with a resume time', async () => {
      const db = testDb()
      upsertActivity(db, activity(101, 1000))
      const { app, cookies } = await refreshApp(db, {
        activities: [makeActivity(101, new Date(1000 * 1000).toISOString())],
        rateLimit429Count: 1,
      })

      const res = await app.inject({ method: 'POST', url: '/api/activities/101/refresh', cookies })
      expect(res.statusCode).toBe(429)
      expect(res.json().resumeAt).toBeDefined()
    })
  })

  it('serves stored streams', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000))
    const latlng: [number, number][] = [
      [45.1, 6.05],
      [45.10005, 6.05],
    ]
    saveStreams(db, 1, { time: [0, 1], distance: [0, 5], altitude: [10, 11], latlng }, '2026-01-01')
    const { app, cookies } = await appWithAthlete(db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/1/streams', cookies })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ time: [0, 1], distance: [0, 5], altitude: [10, 11], latlng })
  })

  it('404s with the streams status when streams are absent', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { streamsStatus: 'none' }))
    const { app, cookies } = await appWithAthlete(db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/1/streams', cookies })
    expect(res.statusCode).toBe(404)
    expect(res.json().streamsStatus).toBe('none')
  })

  it('404s for an unknown activity', async () => {
    const { app, cookies } = await appWithAthlete()
    const res = await app.inject({ method: 'GET', url: '/api/activities/9/streams', cookies })
    expect(res.statusCode).toBe(404)
  })
})
