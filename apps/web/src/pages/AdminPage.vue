<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import type { AllowedAthlete } from '@stravaboard/shared'
import { api } from '../api/client'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()
const { connected, isAdmin } = storeToRefs(authStore)

const athletes = ref<AllowedAthlete[]>([])
const loading = ref(true)
const listError = ref<string | null>(null)

const draftId = ref('')
const draftNote = ref('')
const saving = ref(false)
const addError = ref<string | null>(null)

const restarting = ref(false)
const restartError = ref<string | null>(null)

/** null while the auth status is in flight, so the refusal never flashes. */
const allowed = computed(() => (connected.value === null ? null : connected.value && isAdmin.value))

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function loadAllowlist(): Promise<void> {
  loading.value = true
  listError.value = null
  try {
    athletes.value = (await api.allowlist()).athletes
  } catch (err) {
    listError.value = message(err)
  } finally {
    loading.value = false
  }
}

async function addAthlete(): Promise<void> {
  if (saving.value) return
  const athleteId = Number(draftId.value.trim())
  if (!Number.isInteger(athleteId) || athleteId <= 0) {
    addError.value = 'Enter a numeric Strava athlete id.'
    return
  }
  saving.value = true
  addError.value = null
  try {
    await api.allowAthlete(athleteId, draftNote.value.trim())
    draftId.value = ''
    draftNote.value = ''
    await loadAllowlist()
  } catch (err) {
    addError.value = message(err)
  } finally {
    saving.value = false
  }
}

async function removeAthlete(athlete: AllowedAthlete): Promise<void> {
  const label = athlete.name ?? athlete.note ?? String(athlete.athleteId)
  if (!window.confirm(`Remove ${label} from the allowlist?`)) return
  listError.value = null
  try {
    await api.disallowAthlete(athlete.athleteId)
    await loadAllowlist()
  } catch (err) {
    listError.value = message(err)
  }
}

/** Poll /api/health until the restarted process answers again. */
async function waitForServer(attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    try {
      await api.health()
      return
    } catch {
      // still down — keep polling
    }
  }
  throw new Error('the server did not come back; check the systemd unit')
}

async function restartServer(): Promise<void> {
  if (restarting.value) return
  if (!window.confirm('Restart the stravaBoard server? Syncs in progress will stop.')) return
  restarting.value = true
  restartError.value = null
  try {
    await api.restartServer()
    await waitForServer()
    await loadAllowlist()
  } catch (err) {
    restartError.value = message(err)
  } finally {
    restarting.value = false
  }
}

onMounted(async () => {
  await authStore.load()
  if (allowed.value) await loadAllowlist()
  else loading.value = false
})
</script>

<template>
  <div class="admin">
    <header>
      <h1>Administration</h1>
      <a class="back" href="#">← Back to the dashboard</a>
    </header>

    <p v-if="allowed === null" class="muted">Loading…</p>

    <p v-else-if="!allowed" class="refused">
      This page is reserved for the app owner. Sign in with the administrator's Strava account.
    </p>

    <template v-else>
      <section class="panel">
        <h2>Who may sign in</h2>
        <p class="muted">
          Only these Strava athlete ids can connect. An empty list would let anyone in.
        </p>

        <p v-if="listError" class="error">{{ listError }}</p>
        <p v-else-if="loading" class="muted">Loading…</p>
        <table v-else class="allowlist">
          <thead>
            <tr>
              <th>Athlete id</th>
              <th>Name</th>
              <th>Note</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="athlete in athletes" :key="athlete.athleteId">
              <td>{{ athlete.athleteId }}</td>
              <td>{{ athlete.name ?? '—' }}</td>
              <td>{{ athlete.note ?? '—' }}</td>
              <td>{{ athlete.addedAt.slice(0, 10) }}</td>
              <td>
                <button type="button" class="remove" @click="removeAthlete(athlete)">Remove</button>
              </td>
            </tr>
            <tr v-if="athletes.length === 0">
              <td colspan="5" class="muted">Nobody yet — anyone can sign in.</td>
            </tr>
          </tbody>
        </table>

        <form class="add" @submit.prevent="addAthlete">
          <input
            v-model="draftId"
            class="add-id"
            type="text"
            inputmode="numeric"
            placeholder="Athlete id"
            aria-label="Strava athlete id"
          />
          <input
            v-model="draftNote"
            class="add-note"
            type="text"
            maxlength="100"
            placeholder="Note (optional)"
            aria-label="Note"
          />
          <button type="submit" class="save" :disabled="saving">
            {{ saving ? 'Adding…' : 'Add' }}
          </button>
        </form>
        <p v-if="addError" class="error">{{ addError }}</p>
      </section>

      <section class="panel">
        <h2>Server</h2>
        <p class="muted">
          Allowlist changes apply immediately. Restart only after editing the server's .env file.
        </p>
        <button type="button" class="restart" :disabled="restarting" @click="restartServer">
          {{ restarting ? 'Restarting…' : 'Restart the server' }}
        </button>
        <p v-if="restartError" class="error">{{ restartError }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.admin {
  max-width: 760px;
  margin: 0 auto;
  padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 20px;
}

header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

h1 {
  margin: 0;
  font-size: 1.4rem;
}

h2 {
  margin: 0 0 4px;
  font-size: 1rem;
}

.back {
  color: #52514e;
  text-decoration: none;
  font-size: 0.85rem;
}

.panel {
  border: 1px solid #e1e0d9;
  border-radius: 8px;
  background: #fcfcfb;
  padding: 16px;
}

.muted {
  margin: 0 0 12px;
  color: #898781;
  font-size: 0.85rem;
}

.error {
  margin: 8px 0 0;
  color: #d03b3b;
  font-size: 0.85rem;
}

.refused {
  padding: 12px 16px;
  border: 1px solid #eda100;
  border-radius: 8px;
  background: #fdf6e3;
  color: #52514e;
}

.allowlist {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.allowlist th {
  text-align: left;
  color: #898781;
  font-weight: 600;
  border-bottom: 1px solid #e1e0d9;
  padding: 4px 8px 4px 0;
}

.allowlist td {
  padding: 6px 8px 6px 0;
  border-bottom: 1px solid #f0efec;
}

.add {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.add input {
  padding: 5px 8px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  font: inherit;
  font-size: 0.8rem;
  background: white;
}

.add-id {
  width: 120px;
}

.add-note {
  flex: 1;
  min-width: 140px;
}

button {
  padding: 5px 12px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  color: #52514e;
}

button:disabled {
  cursor: default;
  opacity: 0.6;
}

.remove:hover:not(:disabled) {
  border-color: #d03b3b;
  color: #d03b3b;
}

@media (max-width: 900px) {
  .admin {
    padding: 16px 12px;
  }

  .add-id,
  .add-note {
    width: 100%;
    flex: none;
  }
}
</style>
