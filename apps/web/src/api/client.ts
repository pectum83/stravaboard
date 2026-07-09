import type {
  ActivitiesPage,
  ActivityStreams,
  AuthStatus,
  Settings,
  SyncStatus,
} from '@stravaboard/shared'

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

export const api = {
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  activities: (params: { limit?: number; before?: string } = {}) => {
    const q = new URLSearchParams()
    if (params.limit) q.set('limit', String(params.limit))
    if (params.before) q.set('before', params.before)
    const qs = q.toString()
    return request<ActivitiesPage>(`/api/activities${qs ? `?${qs}` : ''}`)
  },
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
