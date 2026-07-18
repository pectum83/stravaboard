<script setup lang="ts">
import { computed } from 'vue'
import type { ActivityBadges, ActivitySummary } from '@stravaboard/shared'

const props = defineProps<{
  activities: ActivitySummary[]
  selectedId: number | null
  hasMore: boolean
  loading: boolean
  badges: ActivityBadges
}>()

const emit = defineEmits<{
  select: [id: number]
  loadMore: []
}>()

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const MEDALS = ['🥇', '🥈', '🥉']

/** Per activity id: the medals it holds, with a human title for the tooltip. */
const badgeMap = computed(() => {
  const map = new Map<number, { medal: string; title: string }[]>()
  const add = (ids: number[], label: string) => {
    ids.forEach((id, i) => {
      const list = map.get(id) ?? []
      list.push({ medal: MEDALS[i]!, title: `#${i + 1} ${label}` })
      map.set(id, list)
    })
  }
  add(props.badges.ascentSpeed, 'ascent speed')
  add(props.badges.elevation, 'elevation')
  return map
})

function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

function km(m: number): string {
  return `${(m / 1000).toFixed(1)} km`
}
</script>

<template>
  <div class="activity-list">
    <ul>
      <li v-for="activity in activities" :key="activity.id">
        <button
          type="button"
          class="item"
          :class="{
            selected: activity.id === selectedId,
            'no-streams': activity.streamsStatus !== 'done',
          }"
          @click="emit('select', activity.id)"
        >
          <span class="name">
            <span v-if="badgeMap.get(activity.id)" class="medals">
              <span
                v-for="b in badgeMap.get(activity.id)"
                :key="b.title"
                class="medal"
                :title="b.title"
                >{{ b.medal }}</span
              >
            </span>
            {{ activity.name }}
          </span>
          <span class="meta">
            {{ formatDate(activity.startDate) }} · {{ activity.sportType }}
          </span>
          <span class="meta">
            {{ km(activity.distanceM) }} · D+ {{ Math.round(activity.totalElevationGainM) }} m
            <template v-if="activity.ascentMeanVSpeed">
              · ↑ {{ Math.round(activity.ascentMeanVSpeed) }} m/h
            </template>
            <em v-if="activity.streamsStatus === 'none'" class="badge">no elevation data</em>
            <em v-else-if="activity.streamsStatus === 'pending'" class="badge">syncing…</em>
          </span>
        </button>
      </li>
    </ul>
    <p v-if="!loading && activities.length === 0" class="empty">No activities yet.</p>
    <button
      v-if="hasMore"
      type="button"
      class="load-more"
      :disabled="loading"
      @click="emit('loadMore')"
    >
      {{ loading ? 'Loading…' : 'Load more' }}
    </button>
  </div>
</template>

<style scoped>
.activity-list {
  overflow-y: auto;
  height: 100%;
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-bottom: 1px solid #e1e0d9;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.item:hover {
  background: #f0efec;
}

.item.selected {
  background: #e3edfa;
}

.item.no-streams .name {
  color: #898781;
}

.name {
  font-weight: 600;
}

.medals {
  margin-right: 2px;
}

.medal {
  font-size: 0.85rem;
}

.meta {
  font-size: 0.8rem;
  color: #52514e;
}

.badge {
  font-style: normal;
  color: #898781;
  border: 1px solid #e1e0d9;
  border-radius: 8px;
  padding: 0 6px;
  margin-left: 4px;
  font-size: 0.7rem;
}

.empty {
  padding: 14px;
  color: #898781;
}

.load-more {
  display: block;
  width: calc(100% - 28px);
  margin: 10px 14px;
  padding: 8px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.load-more:disabled {
  color: #898781;
  cursor: default;
}
</style>
