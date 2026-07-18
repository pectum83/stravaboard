<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { api } from '../api/client'
import { useActivitiesStore } from '../stores/activities'
import { useSettingsStore } from '../stores/settings'
import { useStreams } from '../composables/useStreams'
import ActivityFilters from '../components/ActivityFilters.vue'
import ActivityList from '../components/ActivityList.vue'
import ActivityStats from '../components/ActivityStats.vue'
import MapPanel from '../components/MapPanel.vue'
import SettingsPanel from '../components/SettingsPanel.vue'
import SyncStatusBar from '../components/SyncStatusBar.vue'
import VerticalSpeedChart from '../components/VerticalSpeedChart.vue'
import { computeVSpeedModel } from '../chart/computeVSpeed'

const activitiesStore = useActivitiesStore()
const settingsStore = useSettingsStore()
const { activities, selectedId, hasMore, loading } = storeToRefs(activitiesStore)
const { settings } = storeToRefs(settingsStore)

// A metric-affecting settings change makes the server recompute the stored
// ranking metrics; reload the list, badges and totals so they match the chart
// (which already reacts to `settings` via the computed model below).
watch(
  () => settingsStore.metricsRecomputedAt,
  () => {
    void activitiesStore.reloadRankings()
  },
)

const connected = ref<boolean | null>(null)
const userName = ref<string | null>(null)

/** Athlete id shown after a login attempt outside the family allowlist. */
const deniedAthleteId = new URLSearchParams(window.location.search).get('denied')

async function logout(): Promise<void> {
  await api.logout()
  // Full reload: clears every store and lands on the sign-in page.
  window.location.href = '/'
}

const {
  streams,
  loading: streamsLoading,
  missing,
  error: streamsError,
  reload: reloadStreams,
} = useStreams(selectedId)

const selectedActivity = computed(
  () => activities.value.find((a) => a.id === selectedId.value) ?? null,
)
const hasAltitude = computed(() => (streams.value?.altitude?.length ?? 0) > 0)

/** "142 activities · D+ 214 300 m" — totals over the whole current filter. */
const listSummary = computed(() => {
  const { count, totalAscentGainM } = activitiesStore.aggregate
  const label = count === 1 ? 'activity' : 'activities'
  return `${count.toLocaleString()} ${label} · D+ ${Math.round(totalAscentGainM).toLocaleString()} m`
})

const model = computed(() =>
  streams.value && hasAltitude.value ? computeVSpeedModel(streams.value, settings.value) : null,
)

/** Stream index under the chart cursor (drives the map marker). */
const hoverIndex = ref<number | null>(null)

const maptilerKey = ref<string | null>(null)

const reloading = ref(false)
const reloadError = ref<string | null>(null)

/** Re-fetch the selected activity from Strava (after editing it there). */
async function reloadActivity(): Promise<void> {
  if (selectedId.value === null || reloading.value) return
  reloading.value = true
  reloadError.value = null
  try {
    await activitiesStore.refreshActivity(selectedId.value)
    await reloadStreams()
  } catch (err) {
    reloadError.value = err instanceof Error ? err.message : String(err)
  } finally {
    reloading.value = false
  }
}

onMounted(async () => {
  const status = await api.authStatus()
  connected.value = status.connected
  userName.value = status.name ?? null
  if (status.connected) {
    await Promise.all([
      settingsStore.load(),
      activitiesStore.loadFirstPage(),
      api.config().then((c) => {
        maptilerKey.value = c.maptilerKey
      }),
    ])
  }
})
</script>

<template>
  <div class="dashboard">
    <template v-if="connected === false">
      <main class="connect">
        <h1>stravaBoard</h1>
        <p v-if="deniedAthleteId" class="denied">
          This Strava account (athlete id <strong>{{ deniedAthleteId }}</strong
          >) is not on the family list yet. Ask the administrator to add this id, then sign in
          again.
        </p>
        <p>Sign in with your Strava account to import and analyse your activities.</p>
        <a class="connect-button" href="/api/auth/strava/login">Connect with Strava</a>
      </main>
    </template>

    <template v-else-if="connected">
      <SyncStatusBar @synced="activitiesStore.loadFirstPage()">
        <span v-if="userName" class="user">{{ userName }}</span>
        <button type="button" class="logout" @click="logout">Log out</button>
      </SyncStatusBar>
      <div class="panes">
        <aside>
          <ActivityFilters
            :filters="activitiesStore.filters"
            :sport-types="activitiesStore.sportTypes"
            :sort="activitiesStore.sort"
            @update="activitiesStore.setFilters"
            @update:sort="activitiesStore.setSort"
          />
          <p class="list-summary">{{ listSummary }}</p>
          <div class="list-wrap">
            <ActivityList
              :activities="activities"
              :selected-id="selectedId"
              :has-more="hasMore"
              :loading="loading"
              :badges="activitiesStore.badges"
              :sort="activitiesStore.sort"
              @select="activitiesStore.select"
              @load-more="activitiesStore.loadMore"
            />
          </div>
        </aside>
        <main>
          <div class="controls">
            <SettingsPanel />
            <button
              v-if="selectedId !== null"
              class="reload"
              type="button"
              :disabled="reloading"
              title="Re-fetch this activity's data and streams from Strava (use after editing or cropping it on strava.com)"
              @click="reloadActivity"
            >
              {{ reloading ? 'Reloading…' : '↻ Reload from Strava' }}
            </button>
            <span v-if="reloadError" class="reload-error">{{ reloadError }}</span>
            <ActivityStats
              v-if="model && selectedActivity"
              :distance-m="selectedActivity.distanceM"
              :elapsed-s="selectedActivity.elapsedTimeS"
              :moving-time-s="selectedActivity.movingTimeS"
              :paused-s="model.pausedS"
              :ascent="model.ascentStats"
              :descent="model.descentStats"
            />
          </div>
          <div class="visuals">
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
            <section v-if="streams" class="map-area">
              <MapPanel
                :key="selectedId ?? 'none'"
                :latlng="streams.latlng"
                :hover-index="hoverIndex"
                :maptiler-key="maptilerKey"
              />
            </section>
          </div>
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
  /* iOS Safari: track the dynamic toolbar and notch/Dynamic Island. */
  height: 100dvh;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
    env(safe-area-inset-left);
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

.denied {
  max-width: 420px;
  margin: 0 auto 16px;
  padding: 10px 14px;
  border: 1px solid #eda100;
  border-radius: 8px;
  background: #fdf6e3;
  color: #52514e;
}

.user {
  color: #52514e;
  font-weight: 600;
  white-space: nowrap;
}

.logout {
  padding: 5px 12px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 0.85rem;
  color: #52514e;
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

.list-summary {
  margin: 0;
  padding: 6px 12px;
  border-bottom: 1px solid #e1e0d9;
  font-size: 0.78rem;
  color: #898781;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  gap: 16px;
}

.controls .stats {
  margin-left: auto;
}

.reload {
  padding: 6px 12px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  background: white;
  font: inherit;
  font-size: 0.8rem;
  color: #52514e;
  cursor: pointer;
  white-space: nowrap;
}

.reload:hover:not(:disabled) {
  background: #f2f1ec;
}

.reload:disabled {
  opacity: 0.6;
  cursor: default;
}

.reload-error {
  color: #d03b3b;
  font-size: 0.8rem;
}

.visuals {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 0;
}

.chart-area {
  flex: 2;
  min-width: 0;
  min-height: 0;
  background: #fcfcfb;
  border: 1px solid #e1e0d9;
  border-radius: 8px;
  padding: 8px;
  display: flex;
}

.map-area {
  flex: 1;
  min-width: 280px;
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

/* Phones and small tablets: stack everything vertically and let the page
   scroll; the activity list keeps its own bounded scroll area. */
@media (max-width: 900px) {
  .dashboard {
    height: auto;
    min-height: 100dvh;
  }

  .panes {
    flex-direction: column;
    flex: none;
  }

  aside {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid #e1e0d9;
  }

  .list-wrap {
    max-height: 38vh;
    overflow-y: auto;
  }

  main {
    padding: 8px;
  }

  .controls {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  .controls .stats {
    margin-left: 0;
  }

  .visuals {
    flex-direction: column;
  }

  .chart-area {
    flex: none;
    height: 380px;
  }

  .map-area {
    flex: none;
    height: 320px;
    min-width: 0;
  }
}
</style>
