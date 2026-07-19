<script setup lang="ts">
import { computed, ref } from 'vue'
import { type ActivityBadges, type ActivitySummary, STRAVA_SPORT_TYPES } from '@stravaboard/shared'
import type { ActivitySort } from '../api/client'
import { useActivitiesStore } from '../stores/activities'

const props = defineProps<{
  activities: ActivitySummary[]
  selectedId: number | null
  hasMore: boolean
  loading: boolean
  badges: ActivityBadges
  /** Active sort — drives which secondary metric the meta line surfaces. */
  sort: ActivitySort
}>()

const emit = defineEmits<{
  select: [id: number]
  loadMore: []
}>()

const store = useActivitiesStore()

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const MEDALS = ['🥇', '🥈', '🥉']

/** Inline rename / re-type state — one row at a time. */
const editingId = ref<number | null>(null)
const draftName = ref('')
const draftSport = ref('')
const saving = ref(false)
const editError = ref<string | null>(null)

// Function refs fire on every re-render; focus + select only the first time
// the field appears for a given edit, or each keystroke would re-select all
// text and overwrite what was typed.
let focusedFor: number | null = null
function focusNameInput(el: unknown): void {
  if (el instanceof HTMLInputElement && focusedFor !== editingId.value) {
    focusedFor = editingId.value
    el.focus()
    el.select()
  }
}

/** Options for the picker: the standard set plus the current value if legacy. */
const sportOptions = computed(() =>
  STRAVA_SPORT_TYPES.includes(draftSport.value as never)
    ? [...STRAVA_SPORT_TYPES]
    : [draftSport.value, ...STRAVA_SPORT_TYPES],
)

function startEdit(activity: ActivitySummary): void {
  editingId.value = activity.id
  draftName.value = activity.name
  draftSport.value = activity.sportType
  editError.value = null
}

function cancelEdit(): void {
  editingId.value = null
  editError.value = null
  focusedFor = null
}

async function saveEdit(activity: ActivitySummary): Promise<void> {
  if (saving.value) return
  const name = draftName.value.trim()
  if (name === '') {
    editError.value = 'Name cannot be empty'
    return
  }
  // Only send fields that actually changed.
  const patch: { name?: string; sportType?: string } = {}
  if (name !== activity.name) patch.name = name
  if (draftSport.value !== activity.sportType) patch.sportType = draftSport.value
  if (patch.name === undefined && patch.sportType === undefined) {
    cancelEdit()
    return
  }
  saving.value = true
  editError.value = null
  try {
    await store.editActivity(activity.id, patch)
    editingId.value = null
    focusedFor = null
  } catch (err) {
    editError.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}

/**
 * Per activity id: the medals it holds, each tagged with its ranking's icon
 * (⚡ ascent speed, ⬆️ elevation, 💪 effort) so the podiums are told apart at
 * a glance, plus a human title for the tooltip.
 */
const badgeMap = computed(() => {
  const map = new Map<number, { medal: string; icon: string; title: string }[]>()
  const add = (ids: number[], icon: string, label: string) => {
    ids.forEach((id, i) => {
      const list = map.get(id) ?? []
      list.push({ medal: MEDALS[i]!, icon, title: `#${i + 1} ${label}` })
      map.set(id, list)
    })
  }
  add(props.badges.ascentSpeed, '⚡', 'ascent speed')
  add(props.badges.elevation, '⬆️', 'elevation')
  add(props.badges.effort, '💪', 'effort')
  return map
})

function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

function km(m: number): string {
  return `${(m / 1000).toFixed(1)} km`
}

/**
 * Km-effort score, mirroring the server's ranking formula
 * (distanceKm + D+/100 × Vspeed/400); null until metrics are computed.
 */
function effortKm(a: ActivitySummary): number | null {
  if (a.ascentGainM == null) return null
  return a.distanceM / 1000 + (a.ascentGainM * (a.ascentMeanVSpeed ?? 0)) / 40000
}
</script>

<template>
  <div class="activity-list">
    <ul>
      <li v-for="activity in activities" :key="activity.id" class="row">
        <form
          v-if="editingId === activity.id"
          class="edit"
          @submit.prevent="saveEdit(activity)"
          @keydown.esc="cancelEdit"
        >
          <input
            :ref="focusNameInput"
            v-model="draftName"
            class="edit-name"
            type="text"
            maxlength="255"
            aria-label="Activity name"
          />
          <select v-model="draftSport" class="edit-sport" aria-label="Sport type">
            <option v-for="type in sportOptions" :key="type" :value="type">{{ type }}</option>
          </select>
          <div class="edit-actions">
            <button type="submit" class="save" :disabled="saving">
              {{ saving ? 'Saving…' : 'Save' }}
            </button>
            <button type="button" class="cancel" :disabled="saving" @click="cancelEdit">
              Cancel
            </button>
          </div>
          <p v-if="editError" class="edit-error">{{ editError }}</p>
        </form>
        <template v-else>
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
                  >{{ b.medal }}<span class="medal-kind">{{ b.icon }}</span></span
                >
              </span>
              {{ activity.name }}
            </span>
            <span class="meta">
              {{ formatDate(activity.startDate) }} · {{ activity.sportType }}
            </span>
            <span class="meta">
              {{ km(activity.distanceM) }} · D+ {{ Math.round(activity.ascentGainM ?? 0) }} m
              <template v-if="sort === 'descent'">
                · D- {{ Math.round(activity.descentLossM ?? 0) }} m
              </template>
              <template v-else-if="sort === 'effort' && effortKm(activity) !== null">
                · 💪 {{ effortKm(activity)!.toFixed(1) }} km-eff
              </template>
              <template v-else-if="activity.ascentMeanVSpeed">
                · ↑ {{ Math.round(activity.ascentMeanVSpeed) }} m/h
              </template>
              <em v-if="activity.streamsStatus === 'none'" class="badge">no elevation data</em>
              <em v-else-if="activity.streamsStatus === 'pending'" class="badge">syncing…</em>
            </span>
          </button>
          <button
            type="button"
            class="edit-toggle"
            title="Rename / change sport type (writes to Strava)"
            aria-label="Edit activity"
            @click="startEdit(activity)"
          >
            ✎
          </button>
        </template>
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

.row {
  position: relative;
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

/* Pencil affordance: hidden until the row is hovered or already selected, so
   the list stays clean but editing is one click away. */
.edit-toggle {
  position: absolute;
  top: 8px;
  right: 8px;
  display: none;
  padding: 2px 6px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  background: #fcfcfb;
  cursor: pointer;
  font-size: 0.8rem;
  line-height: 1.2;
  color: #52514e;
}

.row:hover .edit-toggle,
.item.selected + .edit-toggle {
  display: block;
}

.edit-toggle:hover {
  background: #f0efec;
}

.edit {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid #e1e0d9;
  background: #e3edfa;
}

.edit-name,
.edit-sport {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  background: white;
  font: inherit;
  font-size: 0.85rem;
}

.edit-actions {
  display: flex;
  gap: 8px;
}

.edit-actions .save,
.edit-actions .cancel {
  padding: 4px 12px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
}

.edit-actions .save {
  background: #fc5200; /* Strava brand orange */
  border-color: #fc5200;
  color: white;
  font-weight: 600;
}

.edit-actions .save:disabled {
  opacity: 0.6;
  cursor: default;
}

.edit-actions .cancel {
  background: white;
  color: #52514e;
}

.edit-error {
  margin: 0;
  color: #d03b3b;
  font-size: 0.8rem;
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

/* Ranking icon riding the medal: small and raised so it reads as a tag. */
.medal-kind {
  font-size: 0.6rem;
  vertical-align: super;
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
