import { describe, expect, it } from 'vitest'
import { connectAthlete, session, testApp, testDb } from './helpers.js'

describe('GET /api/config', () => {
  it('requires a session (it exposes the MapTiler key)', async () => {
    const { app } = await testApp({ MAPTILER_KEY: 'k-123' })
    const res = await app.inject({ method: 'GET', url: '/api/config' })
    expect(res.statusCode).toBe(401)
  })

  it('serves a null key when MAPTILER_KEY is not configured', async () => {
    const db = testDb()
    connectAthlete(db, 1)
    const { app } = await testApp({}, db)
    const res = await app.inject({ method: 'GET', url: '/api/config', cookies: session(app, 1) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ maptilerKey: null })
  })

  it('exposes the configured MapTiler key to a logged-in athlete', async () => {
    const db = testDb()
    connectAthlete(db, 1)
    const { app } = await testApp({ MAPTILER_KEY: 'k-123' }, db)
    const res = await app.inject({ method: 'GET', url: '/api/config', cookies: session(app, 1) })
    expect(res.json()).toEqual({ maptilerKey: 'k-123' })
  })
})
