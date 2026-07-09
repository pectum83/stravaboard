import { ref, watch, type Ref } from 'vue'
import type { ActivityStreams } from '@stravaboard/shared'
import { api, ApiError } from '../api/client'

const cache = new Map<number, ActivityStreams>()

/** Streams of the given activity, cached per id; null while loading or when absent. */
export function useStreams(activityId: Ref<number | null>) {
  const streams = ref<ActivityStreams | null>(null)
  const loading = ref(false)
  const missing = ref(false)
  const error = ref<string | null>(null)

  watch(
    activityId,
    async (id) => {
      streams.value = null
      missing.value = false
      error.value = null
      if (id === null) return
      const cached = cache.get(id)
      if (cached) {
        streams.value = cached
        return
      }
      loading.value = true
      try {
        const fetched = await api.streams(id)
        cache.set(id, fetched)
        if (activityId.value === id) streams.value = fetched
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          missing.value = true
        } else {
          error.value = err instanceof Error ? err.message : String(err)
        }
      } finally {
        loading.value = false
      }
    },
    { immediate: true },
  )

  return { streams, loading, missing, error }
}
