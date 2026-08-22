import type {
  ActivitiesPage,
  AdminAthlete,
  AllowedAthlete,
  ActivityAggregate,
  ActivityBadges,
  ActivityStreams,
  ActivitySummary,
  AuthStatus,
  ImportCandidate,
  ImportedActivity,
  Settings,
  SyncStatus,
} from '@stravaboard/shared'

export type ActivitySort = 'date' | 'ascentSpeed' | 'elevation' | 'descent' | 'effort'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res, url, init))
  }
  return (await res.json()) as T
}

/**
 * Prefer the server's own explanation ("duplicate of activity 42") over the
 * bare status line: several admin actions have failures worth reading.
 */
async function errorMessage(res: Response, url: string, init?: RequestInit): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string' && body.error.length > 0) return body.error
  } catch {
    // Not a JSON error payload; fall back to the status line.
  }
  return `${init?.method ?? 'GET'} ${url} → ${res.status}`
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
  stats: (params: ActivityBadgeParams = {}) => {
    const q = new URLSearchParams()
    if (params.q) q.set('q', params.q)
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    if (params.sportType) q.set('sportType', params.sportType)
    const qs = q.toString()
    return request<ActivityAggregate>(`/api/activities/stats${qs ? `?${qs}` : ''}`)
  },
  refreshActivity: (activityId: number) =>
    request<ActivitySummary>(`/api/activities/${activityId}/refresh`, { method: 'POST' }),
  updateActivity: (activityId: number, patch: { name?: string; sportType?: string }) =>
    request<ActivitySummary>(`/api/activities/${activityId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
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
  /** Admin only (403 otherwise) — the sign-in allowlist. */
  allowlist: () => request<{ athletes: AllowedAthlete[] }>('/api/admin/allowlist'),
  allowAthlete: (athleteId: number, note: string) =>
    request<AllowedAthlete>('/api/admin/allowlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(note ? { athleteId, note } : { athleteId }),
    }),
  disallowAthlete: (athleteId: number) =>
    request<{ removed: boolean }>(`/api/admin/allowlist/${athleteId}`, { method: 'DELETE' }),
  /** Admin only — athletes whose activities can be copied onto my account. */
  adminAthletes: () => request<{ athletes: AdminAthlete[] }>('/api/admin/athletes'),
  importCandidates: (athleteId: number) =>
    request<{ activities: ImportCandidate[] }>(
      `/api/admin/import-candidates?athleteId=${athleteId}`,
    ),
  importActivity: (body: {
    activityId: number
    sourceAthleteId?: number
    name?: string
    description?: string
  }) =>
    request<ImportedActivity>('/api/admin/import-activity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  restartServer: () => request<{ restarting: boolean }>('/api/admin/restart', { method: 'POST' }),
  health: () => request<{ status: string }>('/api/health'),
}
