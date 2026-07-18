import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_SETTINGS } from '@stravaboard/shared'
import { useSettingsStore } from '../stores/settings'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    settings: vi.fn(),
    saveSettings: vi.fn(),
  },
}))

const DEBOUNCE_MS = 500

describe('settings store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(api.settings).mockResolvedValue({ ...DEFAULT_SETTINGS })
    vi.mocked(api.saveSettings).mockResolvedValue({ ...DEFAULT_SETTINGS })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('signals a recompute after saving a metric-affecting change', async () => {
    const store = useSettingsStore()
    store.update({ pauseThresholdS: 120 })
    // Applied immediately (the chart reacts) but the save is debounced.
    expect(store.settings.pauseThresholdS).toBe(120)
    expect(store.metricsRecomputedAt).toBe(0)

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(api.saveSettings).toHaveBeenCalledOnce()
    expect(store.metricsRecomputedAt).not.toBe(0) // watchers reload the list
  })

  it('does not signal a recompute for a chart-only change', async () => {
    const store = useSettingsStore()
    store.update({ slopeWindowM: 250 })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(api.saveSettings).toHaveBeenCalledOnce()
    expect(store.metricsRecomputedAt).toBe(0)
  })

  it('does not signal when a metric setting is set to its current value', async () => {
    const store = useSettingsStore()
    store.update({ pauseThresholdS: DEFAULT_SETTINGS.pauseThresholdS })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(store.metricsRecomputedAt).toBe(0)
  })

  it('signals once when a metric and a chart change coalesce into one save', async () => {
    const store = useSettingsStore()
    store.update({ slopeWindowM: 250 })
    store.update({ pauseThresholdS: 90 })
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)

    expect(api.saveSettings).toHaveBeenCalledOnce() // debounced into a single PUT
    expect(store.metricsRecomputedAt).not.toBe(0)
  })
})
