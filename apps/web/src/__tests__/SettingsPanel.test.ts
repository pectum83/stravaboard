import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => {
    // Discard any pending debounced-save timers so they can't fire in a later test.
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('renders the eight setting fields with current values', () => {
    const wrapper = mount(SettingsPanel)
    const inputs = wrapper.findAll('input')
    expect(inputs).toHaveLength(8)
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('60')
    expect((inputs[1]!.element as HTMLInputElement).value).toBe('120')
    expect((inputs[2]!.element as HTMLInputElement).value).toBe('300')
    expect((inputs[5]!.element as HTMLInputElement).value).toBe('30')
    expect((inputs[6]!.element as HTMLInputElement).value).toBe('100')
    expect((inputs[7]!.element as HTMLInputElement).value).toBe('1400')
  })

  it('commits on change (blur) and saves debounced', async () => {
    const wrapper = mount(SettingsPanel)
    const store = useSettingsStore()
    await wrapper.findAll('input')[1]!.setValue('90') // setValue fires input + change
    expect(store.settings.shortWindowS).toBe(90)
    expect(api.saveSettings).not.toHaveBeenCalled()

    vi.advanceTimersByTime(600)
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ shortWindowS: 90 }))
  })

  it('commits on Enter without waiting for blur', async () => {
    const wrapper = mount(SettingsPanel)
    const store = useSettingsStore()
    const input = wrapper.findAll('input')[1]!
    // Type without committing (input only), then press Enter.
    input.element.value = '75'
    await input.trigger('input')
    expect(store.settings.shortWindowS).toBe(120)
    await input.trigger('keydown', { key: 'Enter' })
    expect(store.settings.shortWindowS).toBe(75)
  })

  it('lets the field be cleared and retyped without snapping mid-edit', async () => {
    const wrapper = mount(SettingsPanel)
    const store = useSettingsStore()
    const input = wrapper.findAll('input')[1]!
    // Simulate keystrokes (input events only) — nothing commits until blur/Enter.
    input.element.value = ''
    await input.trigger('input')
    input.element.value = '5'
    await input.trigger('input')
    expect(store.settings.shortWindowS).toBe(120)
    expect(api.saveSettings).not.toHaveBeenCalled()
    await input.trigger('change')
    expect(store.settings.shortWindowS).toBe(5)
  })

  it('reverts an emptied field to its stored value on commit', async () => {
    const wrapper = mount(SettingsPanel)
    const store = useSettingsStore()
    const input = wrapper.findAll('input')[1]!
    input.element.value = ''
    await input.trigger('input')
    await input.trigger('change')
    expect(store.settings.shortWindowS).toBe(120)
    expect((input.element as HTMLInputElement).value).toBe('120')
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

  it('clamps values outside the allowed range on commit', async () => {
    const wrapper = mount(SettingsPanel)
    const store = useSettingsStore()
    await wrapper.findAll('input')[0]!.setValue('0')
    expect(store.settings.instantWindowS).toBe(1)
  })
})
