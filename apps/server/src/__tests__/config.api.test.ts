import { describe, expect, it } from 'vitest'
import { testApp } from './helpers.js'

describe('GET /api/config', () => {
  it('serves a null key when MAPTILER_KEY is not configured', async () => {
    const { app } = await testApp()
    const res = await app.inject({ method: 'GET', url: '/api/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ maptilerKey: null })
  })

  it('exposes the configured MapTiler key', async () => {
    const { app } = await testApp({ MAPTILER_KEY: 'k-123' })
    const res = await app.inject({ method: 'GET', url: '/api/config' })
    expect(res.json()).toEqual({ maptilerKey: 'k-123' })
  })
})
