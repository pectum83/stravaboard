<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { api } from '../api/client'
import { useActivitiesStore } from '../stores/activities'
import { useSettingsStore } from '../stores/settings'
import { useStreams } from '../composables/useStreams'
import ActivityList from '../components/ActivityList.vue'
import SettingsPanel from '../components/SettingsPanel.vue'
import SyncStatusBar from '../components/SyncStatusBar.vue'
import VerticalSpeedChart from '../components/VerticalSpeedChart.vue'

const activitiesStore = useActivitiesStore()
const settingsStore = useSettingsStore()
const { activities, selectedId, hasMore, loading } = storeToRefs(activitiesStore)
const { settings } = storeToRefs(settingsStore)

const connected = ref<boolean | null>(null)

const { streams, loading: streamsLoading, missing, error: streamsError } = useStreams(selectedId)

const selectedActivity = computed(
  () => activities.value.find((a) => a.id === selectedId.value) ?? null,
)
const hasAltitude = computed(() => (streams.value?.altitude?.length ?? 0) > 0)

onMounted(async () => {
  const status = await api.authStatus()
  connected.value = status.connected
  if (status.connected) {
    await Promise.all([settingsStore.load(), activitiesStore.loadFirstPage()])
  }
})
</script>

<template>
  <div class="dashboard">
    <template v-if="connected === false">
      <main class="connect">
        <h1>stravaBoard</h1>
        <p>Connect your Strava account to import and analyse your activities.</p>
        <a class="connect-button" href="/api/auth/strava/login">Connect with Strava</a>
      </main>
    </template>

    <template v-else-if="connected">
      <SyncStatusBar @synced="activitiesStore.loadFirstPage()" />
      <div class="panes">
        <aside>
          <ActivityList
            :activities="activities"
            :selected-id="selectedId"
            :has-more="hasMore"
            :loading="loading"
            @select="activitiesStore.select"
            @load-more="activitiesStore.loadMore"
          />
        </aside>
        <main>
          <SettingsPanel />
          <section class="chart-area">
            <p v-if="selectedId === null" class="placeholder">
              Select an activity to see its vertical speed profile.
            </p>
            <p v-else-if="streamsLoading" class="placeholder">Loading streams…</p>
            <p v-else-if="missing || (streams && !hasAltitude)" class="placeholder">
              <strong>{{ selectedActivity?.name }}</strong> has no elevation data.
            </p>
            <p v-else-if="streamsError" class="placeholder error">{{ streamsError }}</p>
            <VerticalSpeedChart v-else-if="streams" :streams="streams" :settings="settings" />
          </section>
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.connect {
  margin: auto;
  text-align: center;
}

.connect-button {
  display: inline-block;
  padding: 10px 24px;
  border-radius: 8px;
  background: #fc5200; /* Strava brand orange */
  color: white;
  text-decoration: none;
  font-weight: 600;
}

.panes {
  display: flex;
  flex: 1;
  min-height: 0;
}

aside {
  width: 320px;
  flex-shrink: 0;
  border-right: 1px solid #e1e0d9;
  background: #fcfcfb;
  min-height: 0;
}

main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-width: 0;
}

.chart-area {
  flex: 1;
  min-height: 0;
  background: #fcfcfb;
  border: 1px solid #e1e0d9;
  border-radius: 8px;
  padding: 8px;
  display: flex;
}

.placeholder {
  margin: auto;
  color: #898781;
}

.placeholder.error {
  color: #d03b3b;
}
</style>
