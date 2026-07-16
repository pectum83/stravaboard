import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ActivitySummary } from '@stravaboard/shared'
import { api } from '../api/client'

const PAGE_SIZE = 50

export interface ActivityFilters {
  /** Name substring. */
  q: string
  /** Inclusive date range, YYYY-MM-DD ('' = unbounded). */
  from: string
  to: string
  /** Sport type ('' = all). */
  sportType: string
}

export const EMPTY_FILTERS: ActivityFilters = { q: '', from: '', to: '', sportType: '' }

export const useActivitiesStore = defineStore('activities', () => {
  const activities = ref<ActivitySummary[]>([])
  const selectedId = ref<number | null>(null)
  const nextBefore = ref<string | undefined>(undefined)
  const hasMore = ref(true)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const filters = ref<ActivityFilters>({ ...EMPTY_FILTERS })
  const sportTypes = ref<string[]>([])

  async function loadFirstPage(): Promise<void> {
    activities.value = []
    nextBefore.value = undefined
    hasMore.value = true
    await Promise.all([loadMore(), loadSportTypes()])
  }

  /** Merge a filter change and reload the list from the first page. */
  async function setFilters(patch: Partial<ActivityFilters>): Promise<void> {
    filters.value = { ...filters.value, ...patch }
    activities.value = []
    nextBefore.value = undefined
    hasMore.value = true
    await loadMore()
  }

  async function loadMore(): Promise<void> {
    if (loading.value || !hasMore.value) return
    loading.value = true
    error.value = null
    const f = filters.value
    try {
      const page = await api.activities({
        limit: PAGE_SIZE,
        before: nextBefore.value,
        ...(f.q.trim() !== '' ? { q: f.q.trim() } : {}),
        ...(f.from !== '' ? { from: f.from } : {}),
        ...(f.to !== '' ? { to: f.to } : {}),
        ...(f.sportType !== '' ? { sportType: f.sportType } : {}),
      })
      activities.value = [...activities.value, ...page.activities]
      nextBefore.value = page.nextBefore
      hasMore.value = page.nextBefore !== undefined
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  async function loadSportTypes(): Promise<void> {
    try {
      sportTypes.value = await api.sportTypes()
    } catch {
      // Filter dropdown degrades to "all sports"; not worth surfacing.
    }
  }

  function select(id: number): void {
    selectedId.value = id
  }

  /** Re-fetch one activity from Strava (after it was edited there). Throws on failure. */
  async function refreshActivity(id: number): Promise<void> {
    const updated = await api.refreshActivity(id)
    activities.value = activities.value.map((a) => (a.id === id ? updated : a))
  }

  return {
    activities,
    selectedId,
    hasMore,
    loading,
    error,
    filters,
    sportTypes,
    loadFirstPage,
    loadMore,
    setFilters,
    select,
    refreshActivity,
  }
})
