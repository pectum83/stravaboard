import { defineStore } from 'pinia'
import { ref } from 'vue'
import { DEFAULT_SETTINGS, METRIC_SETTING_KEYS, type Settings } from '@stravaboard/shared'
import { api } from '../api/client'

const SAVE_DEBOUNCE_MS = 500

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const loaded = ref(false)
  const saveError = ref<string | null>(null)
  /**
   * Bumped after a save that changed a metric-affecting setting (which the
   * server recomputes into the stored ranking metrics). Watch it to reload the
   * activity list/badges once the new values are in place.
   */
  const metricsRecomputedAt = ref(0)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  // Whether any change coalesced into the pending debounce window touches a
  // setting that feeds the stored metrics.
  let pendingMetricChange = false

  async function load(): Promise<void> {
    settings.value = await api.settings()
    loaded.value = true
  }

  /** Apply immediately (chart reacts), persist debounced. */
  function update(patch: Partial<Settings>): void {
    if (METRIC_SETTING_KEYS.some((k) => k in patch && patch[k] !== settings.value[k])) {
      pendingMetricChange = true
    }
    settings.value = { ...settings.value, ...patch }
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      const metricChanged = pendingMetricChange
      pendingMetricChange = false
      void api
        .saveSettings(settings.value)
        .then(() => {
          saveError.value = null
          // The server recomputed the stored metrics for a metric-affecting
          // change; signal watchers to reload once the PUT (recompute) resolved.
          if (metricChanged) metricsRecomputedAt.value = Date.now()
        })
        .catch((err: unknown) => {
          saveError.value = err instanceof Error ? err.message : String(err)
          // Keep the flag so a later successful save still triggers the reload.
          if (metricChanged) pendingMetricChange = true
        })
    }, SAVE_DEBOUNCE_MS)
  }

  return { settings, loaded, saveError, metricsRecomputedAt, load, update }
})
