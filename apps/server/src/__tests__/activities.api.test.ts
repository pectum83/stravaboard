import { describe, expect, it } from 'vitest'
import { upsertActivity, type ActivityRow } from '../repositories/activities.repo.js'
import { saveStreams } from '../repositories/streams.repo.js'
import { testApp, testDb } from './helpers.js'

function activity(id: number, epoch: number, overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id,
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

describe('activities API', () => {
  it('lists newest-first with keyset pagination', async () => {
    const db = testDb()
    for (let i = 1; i <= 5; i++) upsertActivity(db, activity(i, i * 1000))
    const { app } = await testApp({}, db)

    const p1 = await app.inject({ method: 'GET', url: '/api/activities?limit=2' })
    const body1 = p1.json()
    expect(body1.activities.map((a: { id: number }) => a.id)).toEqual([5, 4])
    expect(body1.nextBefore).toBe('4000')

    const p2 = await app.inject({
      method: 'GET',
      url: `/api/activities?limit=2&before=${body1.nextBefore}`,
    })
    expect(p2.json().activities.map((a: { id: number }) => a.id)).toEqual([3, 2])

    const last = await app.inject({ method: 'GET', url: '/api/activities?limit=2&before=2000' })
    expect(last.json().activities.map((a: { id: number }) => a.id)).toEqual([1])
    expect(last.json().nextBefore).toBeUndefined()
  })

  it('rejects invalid pagination query', async () => {
    const { app } = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/activities?limit=0' })
    expect(res.statusCode).toBe(400)
  })

  it('filters by name substring, case-insensitively', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { name: 'Morning Mountain Run' }))
    upsertActivity(db, activity(2, 2000, { name: 'Flat River Loop' }))
    const { app } = await testApp({}, db)

    const res = await app.inject({ method: 'GET', url: '/api/activities?q=mountain' })
    expect(res.json().activities.map((a: { id: number }) => a.id)).toEqual([1])

    const none = await app.inject({ method: 'GET', url: '/api/activities?q=alpine' })
    expect(none.json().activities).toEqual([])
  })

  it('matches LIKE wildcards in the search literally', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { name: '100% climb' }))
    upsertActivity(db, activity(2, 2000, { name: 'plain run' }))
    const { app } = await testApp({}, db)
    const res = await app.inject({ method: 'GET', url: '/api/activities?q=%25' }) // '%'
    expect(res.json().activities.map((a: { id: number }) => a.id)).toEqual([1])
  })

  it('filters by inclusive date range', async () => {
    const db = testDb()
    const day = (d: string) => Date.parse(`${d}T12:00:00Z`) / 1000
    upsertActivity(db, activity(1, day('2026-06-10')))
    upsertActivity(db, activity(2, day('2026-06-15')))
    upsertActivity(db, activity(3, day('2026-06-20')))
    const { app } = await testApp({}, db)

    const res = await app.inject({
      method: 'GET',
      url: '/api/activities?from=2026-06-12&to=2026-06-15',
    })
    // `to` day itself is included
    expect(res.json().activities.map((a: { id: number }) => a.id)).toEqual([2])

    const upper = await app.inject({ method: 'GET', url: '/api/activities?to=2026-06-15' })
    expect(upper.json().activities.map((a: { id: number }) => a.id)).toEqual([2, 1])
  })

  it('filters by sport type and combines filters with pagination', async () => {
    const db = testDb()
    for (let i = 1; i <= 4; i++) {
      upsertActivity(db, activity(i, i * 1000, { sportType: i % 2 === 0 ? 'Run' : 'TrailRun' }))
    }
    const { app } = await testApp({}, db)

    const runs = await app.inject({ method: 'GET', url: '/api/activities?sportType=Run' })
    expect(runs.json().activities.map((a: { id: number }) => a.id)).toEqual([4, 2])

    // Cursor pages stay consistent under an active filter
    const p1 = await app.inject({ method: 'GET', url: '/api/activities?sportType=Run&limit=1' })
    expect(p1.json().activities.map((a: { id: number }) => a.id)).toEqual([4])
    const p2 = await app.inject({
      method: 'GET',
      url: `/api/activities?sportType=Run&limit=1&before=${p1.json().nextBefore}`,
    })
    expect(p2.json().activities.map((a: { id: number }) => a.id)).toEqual([2])
  })

  it('rejects malformed date filters', async () => {
    const { app } = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/activities?from=15-06-2026' })
    expect(res.statusCode).toBe(400)
  })

  it('lists distinct sport types, sorted', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { sportType: 'TrailRun' }))
    upsertActivity(db, activity(2, 2000, { sportType: 'Run' }))
    upsertActivity(db, activity(3, 3000, { sportType: 'TrailRun' }))
    const { app } = await testApp({}, db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/sport-types' })
    expect(res.json()).toEqual(['Run', 'TrailRun'])
  })

  it('serves stored streams', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000))
    const latlng: [number, number][] = [
      [45.1, 6.05],
      [45.10005, 6.05],
    ]
    saveStreams(db, 1, { time: [0, 1], distance: [0, 5], altitude: [10, 11], latlng }, '2026-01-01')
    const { app } = await testApp({}, db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/1/streams' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ time: [0, 1], distance: [0, 5], altitude: [10, 11], latlng })
  })

  it('404s with the streams status when streams are absent', async () => {
    const db = testDb()
    upsertActivity(db, activity(1, 1000, { streamsStatus: 'none' }))
    const { app } = await testApp({}, db)
    const res = await app.inject({ method: 'GET', url: '/api/activities/1/streams' })
    expect(res.statusCode).toBe(404)
    expect(res.json().streamsStatus).toBe('none')
  })

  it('404s for an unknown activity', async () => {
    const { app } = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/activities/9/streams' })
    expect(res.statusCode).toBe(404)
  })
})
