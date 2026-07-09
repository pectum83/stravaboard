import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_SETTINGS, type Settings } from '@stravaboard/shared'
import { api } from '../api/client'

const SAVE_DEBOUNCE_MS = 500

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const loaded = ref(false)
  const saveError = ref<string | null>(null)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<void> {
    settings.value = await api.settings()
    loaded.value = true
  }

  /** Apply immediately (chart reacts), persist debounced. */
  function update(patch: Partial<Settings>): void {
    settings.value = { ...settings.value, ...patch }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void api
        .saveSettings(settings.value)
        .then(() => {
          saveError.value = null
        })
        .catch((err: unknown) => {
          saveError.value = err instanceof Error ? err.message : String(err)
        })
    }, SAVE_DEBOUNCE_MS)
  }

  return { settings, loaded, saveError, load, update }
})
