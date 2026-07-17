<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { SyncStatus } from '@stravaboard/shared'
import { api } from '../api/client'

const POLL_MS = 2000

const emit = defineEmits<{
  /** Fired when a running sync settles back to idle — refresh the list. */
  synced: []
}>()

const status = ref<SyncStatus | null>(null)
const starting = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
let wasActive = false

async function poll(): Promise<void> {
  try {
    const next = await api.syncStatus()
    const active = next.state === 'syncing' || next.state === 'waiting_rate_limit'
    if (wasActive && !active) emit('synced')
    wasActive = active
    status.value = next
  } catch {
    // Server briefly unavailable (restart) — keep the last known status.
  }
}

async function startSync(): Promise<void> {
  starting.value = true
  try {
    await api.startSync()
    await poll()
  } finally {
    starting.value = false
  }
}

onMounted(() => {
  void poll()
  timer = setInterval(() => void poll(), POLL_MS)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

function resumeTime(iso: string): string {
  return new Date(iso).toLocaleTimeString()
}
</script>

<template>
  <div class="sync-bar">
    <span v-if="status === null" class="state">…</span>
    <template v-else>
      <span v-if="status.state === 'syncing'" class="state active">
        Syncing — {{ status.fetchedActivities }} fetched, {{ status.pendingStreams }} streams
        pending
      </span>
      <span v-else-if="status.state === 'waiting_rate_limit'" class="state active">
        Strava rate limit reached — resuming at
        {{ status.rateLimitResumeAt ? resumeTime(status.rateLimitResumeAt) : 'soon' }}
        ({{ status.pendingStreams }} streams pending)
      </span>
      <span v-else-if="status.state === 'error'" class="state error">
        Sync failed: {{ status.error }}
      </span>
      <span v-else class="state">Up to date</span>
    </template>
    <span class="grow" />
    <button
      type="button"
      :disabled="starting || status?.state === 'syncing' || status?.state === 'waiting_rate_limit'"
      @click="startSync"
    >
      Sync now
    </button>
    <!-- Right side: the logged-in user chip (provided by the page). -->
    <slot />
  </div>
</template>

<style scoped>
.sync-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid #e1e0d9;
  background: #fcfcfb;
  font-size: 0.85rem;
}

.grow {
  flex: 1;
}

.state {
  color: #52514e;
}

.state.active {
  color: #2a78d6;
}

.state.error {
  color: #d03b3b;
}

button {
  padding: 5px 12px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
}

button:disabled {
  color: #898781;
  cursor: default;
}
</style>
