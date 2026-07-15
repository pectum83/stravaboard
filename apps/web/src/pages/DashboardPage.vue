<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { api } from '../api/client'
import { useActivitiesStore } from '../stores/activities'
import { useSettingsStore } from '../stores/settings'
import { useStreams } from '../composables/useStreams'
import ActivityFilters from '../components/ActivityFilters.vue'
import ActivityList from '../components/ActivityList.vue'
import ActivityStats from '../components/ActivityStats.vue'
import SettingsPanel from '../components/SettingsPanel.vue'
import SyncStatusBar from '../components/SyncStatusBar.vue'
import VerticalSpeedChart from '../components/VerticalSpeedChart.vue'
import { computeVSpeedModel } from '../chart/computeVSpeed'

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

const model = computed(() =>
  streams.value && hasAltitude.value ? computeVSpeedModel(streams.value, settings.value) : null,
)

/** Stream index under the chart cursor (drives the map marker). */
const hoverIndex = ref<number | null>(null)

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
          <ActivityFilters
            :filters="activitiesStore.filters"
            :sport-types="activitiesStore.sportTypes"
            @update="activitiesStore.setFilters"
          />
          <div class="list-wrap">
            <ActivityList
              :activities="activities"
              :selected-id="selectedId"
              :has-more="hasMore"
              :loading="loading"
              @select="activitiesStore.select"
              @load-more="activitiesStore.loadMore"
            />
          </div>
        </aside>
        <main>
          <div class="controls">
            <SettingsPanel />
            <ActivityStats v-if="model" :ascent="model.ascentStats" :descent="model.descentStats" />
          </div>
          <section class="chart-area">
            <p v-if="selectedId === null" class="placeholder">
              Select an activity to see its vertical speed profile.
            </p>
            <p v-else-if="streamsLoading" class="placeholder">Loading streams…</p>
            <p v-else-if="missing || (streams && !hasAltitude)" class="placeholder">
              <strong>{{ selectedActivity?.name }}</strong> has no elevation data.
            </p>
            <p v-else-if="streamsError" class="placeholder error">{{ streamsError }}</p>
            <VerticalSpeedChart
              v-else-if="model"
              :model="model"
              :settings="settings"
              @hover-index="hoverIndex = $event"
            />
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
  display: flex;
  flex-direction: column;
}

.list-wrap {
  flex: 1;
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

.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
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
