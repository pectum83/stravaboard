import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ActivitySummary } from '@stravaboard/shared'
import { api } from '../api/client'

const PAGE_SIZE = 50

export const useActivitiesStore = defineStore('activities', () => {
  const activities = ref<ActivitySummary[]>([])
  const selectedId = ref<number | null>(null)
  const nextBefore = ref<string | undefined>(undefined)
  const hasMore = ref(true)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadFirstPage(): Promise<void> {
    activities.value = []
    nextBefore.value = undefined
    hasMore.value = true
    await loadMore()
  }

  async function loadMore(): Promise<void> {
    if (loading.value || !hasMore.value) return
    loading.value = true
    error.value = null
    try {
      const page = await api.activities({ limit: PAGE_SIZE, before: nextBefore.value })
      activities.value = [...activities.value, ...page.activities]
      nextBefore.value = page.nextBefore
      hasMore.value = page.nextBefore !== undefined
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function select(id: number): void {
    selectedId.value = id
  }

  return { activities, selectedId, hasMore, loading, error, loadFirstPage, loadMore, select }
})
