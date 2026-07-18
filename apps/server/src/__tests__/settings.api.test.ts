import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@stravaboard/shared'
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
