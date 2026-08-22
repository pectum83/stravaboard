import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '../api/client'

/** Who is logged in — shared by the dashboard and the admin page. */
export const useAuthStore = defineStore('auth', () => {
  /** null while the first status call is in flight. */
  const connected = ref<boolean | null>(null)
  const athleteId = ref<number | null>(null)
  const name = ref<string | null>(null)
  const isAdmin = ref(false)

  async function load(): Promise<void> {
    const status = await api.authStatus()
    connected.value = status.connected
    athleteId.value = status.athleteId ?? null
    name.value = status.name ?? null
    isAdmin.value = status.isAdmin === true
  }

  return { connected, athleteId, name, isAdmin, load }
})
