import type {
  ActivitiesPage,
  ActivityBadges,
  ActivityStreams,
  ActivitySummary,
  AuthStatus,
  Settings,
  SyncStatus,
} from '@stravaboard/shared'

export type ActivitySort = 'date' | 'ascentSpeed' | 'elevation'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    throw new ApiError(res.status, `${init?.method ?? 'GET'} ${url} → ${res.status}`)
  }
  return (await res.json()) as T
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface ActivityListParams {
  limit?: number
  before?: string
  sort?: ActivitySort
  q?: string
  from?: string
  to?: string
  sportType?: string
}

/** Badge rankings take the list's filter, without paging or sort. */
export type ActivityBadgeParams = Pick<ActivityListParams, 'q' | 'from' | 'to' | 'sportType'>

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  logout: () => request<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' }),
  activities: (params: ActivityListParams = {}) => {
    const q = new URLSearchParams()
    if (params.limit) q.set('limit', String(params.limit))
    if (params.before) q.set('before', params.before)
    if (params.sort && params.sort !== 'date') q.set('sort', params.sort)
    if (params.q) q.set('q', params.q)
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    if (params.sportType) q.set('sportType', params.sportType)
    const qs = q.toString()
    return request<ActivitiesPage>(`/api/activities${qs ? `?${qs}` : ''}`)
  },
  sportTypes: () => request<string[]>('/api/activities/sport-types'),
  badges: (params: ActivityBadgeParams = {}) => {
    const q = new URLSearchParams()
    if (params.q) q.set('q', params.q)
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    if (params.sportType) q.set('sportType', params.sportType)
    const qs = q.toString()
    return request<ActivityBadges>(`/api/activities/badges${qs ? `?${qs}` : ''}`)
  },
  refreshActivity: (activityId: number) =>
    request<ActivitySummary>(`/api/activities/${activityId}/refresh`, { method: 'POST' }),
  config: () => request<{ maptilerKey: string | null }>('/api/config'),
  streams: (activityId: number) =>
    request<ActivityStreams>(`/api/activities/${activityId}/streams`),
  settings: () => request<Settings>('/api/settings'),
  saveSettings: (settings: Settings) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings),
    }),
  startSync: () => request<{ started: boolean }>('/api/sync', { method: 'POST' }),
  syncStatus: () => request<SyncStatus>('/api/sync/status'),
}
