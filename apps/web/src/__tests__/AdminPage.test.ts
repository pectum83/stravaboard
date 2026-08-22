import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { AllowedAthlete, ImportCandidate } from '@stravaboard/shared'
import AdminPage from '../pages/AdminPage.vue'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    authStatus: vi.fn(),
    allowlist: vi.fn(),
    allowAthlete: vi.fn(),
    disallowAthlete: vi.fn(),
    restartServer: vi.fn(),
    health: vi.fn(),
    adminAthletes: vi.fn(),
    importCandidates: vi.fn(),
    importActivity: vi.fn(),
  },
}))

const candidate = (id: number, over: Partial<ImportCandidate> = {}): ImportCandidate => ({
  id,
  name: `Activity ${id}`,
  sportType: 'Hike',
  startDate: '2026-08-18T07:16:56Z',
  distanceM: 7752.2,
  totalElevationGainM: 659,
  hasHeartrate: true,
  ...over,
})

const entry = (athleteId: number, over: Partial<AllowedAthlete> = {}): AllowedAthlete => ({
  athleteId,
  note: null,
  addedAt: '2026-08-22T10:00:00.000Z',
  name: null,
  connected: false,
  ...over,
})

describe('AdminPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(api.authStatus).mockResolvedValue({ connected: true, athleteId: 1, isAdmin: true })
    vi.mocked(api.allowlist).mockResolvedValue({
      athletes: [entry(1, { name: 'Chris', connected: true, note: 'owner' }), entry(4242)],
    })
    vi.mocked(api.adminAthletes).mockResolvedValue({
      athletes: [
        { id: 1, name: 'Chris', activityCount: 1454 },
        { id: 4242, name: 'Max', activityCount: 161 },
      ],
    })
    vi.mocked(api.importCandidates).mockResolvedValue({
      activities: [candidate(19790883454), candidate(42, { hasHeartrate: false })],
    })
  })

  it('lists the allowlist for the admin', async () => {
    const wrapper = mount(AdminPage)
    await flushPromises()
    const rows = wrapper.findAll('.allowlist tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Chris')
    expect(rows[0]!.text()).toContain('owner')
    expect(rows[1]!.text()).toContain('4242')
    expect(rows[1]!.text()).toContain('2026-08-22')
  })

  it('refuses a non-admin without calling the admin API', async () => {
    vi.mocked(api.authStatus).mockResolvedValue({ connected: true, athleteId: 9, isAdmin: false })
    const wrapper = mount(AdminPage)
    await flushPromises()
    expect(wrapper.find('.refused').exists()).toBe(true)
    expect(wrapper.find('.allowlist').exists()).toBe(false)
    expect(api.allowlist).not.toHaveBeenCalled()
  })

  it('adds an athlete and reloads the list', async () => {
    vi.mocked(api.allowAthlete).mockResolvedValue(entry(77, { note: 'cousin' }))
    const wrapper = mount(AdminPage)
    await flushPromises()

    await wrapper.find('.add-id').setValue('77')
    await wrapper.find('.add-note').setValue('cousin')
    await wrapper.find('form.add').trigger('submit')
    await flushPromises()

    expect(api.allowAthlete).toHaveBeenCalledWith(77, 'cousin')
    expect(api.allowlist).toHaveBeenCalledTimes(2)
    expect((wrapper.find('.add-id').element as HTMLInputElement).value).toBe('')
  })

  it('rejects a non-numeric id before calling the API', async () => {
    const wrapper = mount(AdminPage)
    await flushPromises()

    await wrapper.find('.add-id').setValue('not-an-id')
    await wrapper.find('form.add').trigger('submit')
    await flushPromises()

    expect(api.allowAthlete).not.toHaveBeenCalled()
    expect(wrapper.find('.error').text()).toContain('numeric')
  })

  it('surfaces a failed add and keeps the draft', async () => {
    vi.mocked(api.allowAthlete).mockRejectedValue(new Error('POST /api/admin/allowlist → 400'))
    const wrapper = mount(AdminPage)
    await flushPromises()

    await wrapper.find('.add-id').setValue('77')
    await wrapper.find('form.add').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.error').text()).toContain('400')
    expect((wrapper.find('.add-id').element as HTMLInputElement).value).toBe('77')
  })

  it('removes an athlete only after confirmation', async () => {
    vi.mocked(api.disallowAthlete).mockResolvedValue({ removed: true })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mount(AdminPage)
    await flushPromises()

    await wrapper.findAll('.remove')[1]!.trigger('click')
    await flushPromises()
    expect(api.disallowAthlete).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    await wrapper.findAll('.remove')[1]!.trigger('click')
    await flushPromises()
    expect(api.disallowAthlete).toHaveBeenCalledWith(4242)
    expect(api.allowlist).toHaveBeenCalledTimes(2)
    confirm.mockRestore()
  })

  it('restarts the server and waits for it to answer again', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(api.restartServer).mockResolvedValue({ restarting: true })
    vi.mocked(api.health)
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ status: 'ok' })
    vi.useFakeTimers()
    const wrapper = mount(AdminPage)
    await flushPromises()

    const restart = wrapper.find('.restart')
    await restart.trigger('click')
    await flushPromises()
    expect(api.restartServer).toHaveBeenCalled()
    expect(restart.text()).toContain('Restarting')

    // Two poll ticks: the first refusal, then the server back up.
    await vi.advanceTimersByTimeAsync(1200)
    await flushPromises()
    expect(api.health).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.restart').text()).toBe('Restart the server')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('activity import', () => {
    it('lists the other athletes activities, heart rate first-class', async () => {
      const wrapper = mount(AdminPage)
      await flushPromises()
      expect(api.importCandidates).toHaveBeenCalledWith(4242)
      const items = wrapper.findAll('.candidates li')
      expect(items).toHaveLength(2)
      expect(items[0]!.text()).toContain('2026-08-18')
      expect(items[0]!.text()).toContain('7.8 km')
      expect(items[1]!.classes()).toContain('unusable')
      expect(items[1]!.find('button').attributes('disabled')).toBeDefined()
    })

    it('imports the selected activity and links to the result', async () => {
      vi.mocked(api.importActivity).mockResolvedValue({
        activityId: 990001,
        url: 'https://www.strava.com/activities/990001',
        name: 'Activity 19790883454',
        averageHeartrate: 130,
        maxHeartrate: 149,
        alreadyExisted: false,
      })
      const wrapper = mount(AdminPage)
      await flushPromises()

      await wrapper.findAll('.candidates button')[0]!.trigger('click')
      await wrapper.find('.import').trigger('click')
      await flushPromises()

      expect(api.importActivity).toHaveBeenCalledWith({
        activityId: 19790883454,
        name: 'Activity 19790883454',
      })
      const link = wrapper.find('.imported a')
      expect(link.attributes('href')).toBe('https://www.strava.com/activities/990001')
      expect(wrapper.find('.imported').text()).toContain('130 bpm average')
    })

    it('shows why Strava refused the upload', async () => {
      vi.mocked(api.importActivity).mockRejectedValue(new Error('duplicate of activity 42'))
      const wrapper = mount(AdminPage)
      await flushPromises()
      await wrapper.findAll('.candidates button')[0]!.trigger('click')
      await wrapper.find('.import').trigger('click')
      await flushPromises()
      expect(wrapper.text()).toContain('duplicate of activity 42')
    })
  })
})
