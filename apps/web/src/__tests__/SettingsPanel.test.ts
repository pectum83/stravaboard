import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { DEFAULT_SETTINGS } from '@stravaboard/shared'
import SettingsPanel from '../components/SettingsPanel.vue'
import { useSettingsStore } from '../stores/settings'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    settings: vi.fn(),
    saveSettings: vi.fn(),
  },
}))

describe('SettingsPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.mocked(api.saveSettings).mockResolvedValue({ ...DEFAULT_SETTINGS })
  })

  it('renders the six setting fields with current values', () => {
    const wrapper = mount(SettingsPanel)
    const inputs = wrapper.findAll('input')
    expect(inputs).toHaveLength(6)
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('60')
    expect((inputs[1]!.element as HTMLInputElement).value).toBe('120')
    expect((inputs[2]!.element as HTMLInputElement).value).toBe('300')
    expect((inputs[5]!.element as HTMLInputElement).value).toBe('30')
  })

  it('updates the store immediately and saves debounced', async () => {
    const wrapper = mount(SettingsPanel)
    const store = useSettingsStore()
    await wrapper.findAll('input')[1]!.setValue('90')
    expect(store.settings.shortWindowS).toBe(90)
    expect(api.saveSettings).not.toHaveBeenCalled()

    vi.advanceTimersByTime(600)
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ shortWindowS: 90 }))
  })

  it('collapses rapid edits into a single save', async () => {
    const wrapper = mount(SettingsPanel)
    const input = wrapper.findAll('input')[1]!
    await input.setValue('70')
    vi.advanceTimersByTime(200)
    await input.setValue('80')
    vi.advanceTimersByTime(600)
    expect(api.saveSettings).toHaveBeenCalledTimes(1)
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ shortWindowS: 80 }))
  })

  it('clamps values outside the allowed range', async () => {
    const wrapper = mount(SettingsPanel)
    const store = useSettingsStore()
    await wrapper.findAll('input')[0]!.setValue('0')
    expect(store.settings.instantWindowS).toBe(1)
  })
})
