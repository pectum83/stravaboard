import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@stravaboard/shared'
import { testApp } from './helpers.js'

describe('settings API', () => {
  it('GET returns defaults on a fresh database', async () => {
    const { app } = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(DEFAULT_SETTINGS)
  })

  it('PUT persists valid settings', async () => {
    const { app } = await testApp()
    const next = { ...DEFAULT_SETTINGS, shortWindowS: 90 }
    const put = await app.inject({ method: 'PUT', url: '/api/settings', payload: next })
    expect(put.statusCode).toBe(200)
    const get = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(get.json()).toEqual(next)
  })

  it('PUT rejects invalid settings', async () => {
    const { app } = await testApp()
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { ...DEFAULT_SETTINGS, instantWindowS: 0 },
    })
    expect(res.statusCode).toBe(400)
  })
})
