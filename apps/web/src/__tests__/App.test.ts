import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '../App.vue'

vi.mock('../pages/DashboardPage.vue', () => ({
  default: { name: 'DashboardPage', template: '<div class="stub-dashboard" />' },
}))
vi.mock('../pages/AdminPage.vue', () => ({
  default: { name: 'AdminPage', template: '<div class="stub-admin" />' },
}))

function mountAt(hash: string) {
  window.location.hash = hash
  setActivePinia(createPinia())
  return mount(App)
}

describe('App routing', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('shows the dashboard by default', () => {
    expect(mountAt('').find('.stub-dashboard').exists()).toBe(true)
  })

  it('shows the admin page on #/admin', () => {
    expect(mountAt('#/admin').find('.stub-admin').exists()).toBe(true)
  })

  it('follows hash navigation', async () => {
    const wrapper = mountAt('')
    window.location.hash = '#/admin'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.stub-admin').exists()).toBe(true)
  })
})
