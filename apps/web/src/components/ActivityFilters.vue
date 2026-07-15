<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ActivityFilters } from '../stores/activities'

const props = defineProps<{
  filters: ActivityFilters
  sportTypes: string[]
}>()

const emit = defineEmits<{
  update: [patch: Partial<ActivityFilters>]
}>()

const SEARCH_DEBOUNCE_MS = 300

// Local echo of the search text so typing stays smooth while emits debounce.
const q = ref(props.filters.q)
watch(
  () => props.filters.q,
  (value) => {
    q.value = value
  },
)

let timer: ReturnType<typeof setTimeout> | undefined
function onSearchInput(event: Event): void {
  q.value = (event.target as HTMLInputElement).value
  clearTimeout(timer)
  timer = setTimeout(() => emit('update', { q: q.value }), SEARCH_DEBOUNCE_MS)
}
onBeforeUnmount(() => clearTimeout(timer))

function onDate(key: 'from' | 'to', event: Event): void {
  emit('update', { [key]: (event.target as HTMLInputElement).value })
}

function onSport(event: Event): void {
  emit('update', { sportType: (event.target as HTMLSelectElement).value })
}

const active = computed(
  () =>
    props.filters.q !== '' ||
    props.filters.from !== '' ||
    props.filters.to !== '' ||
    props.filters.sportType !== '',
)

function clear(): void {
  clearTimeout(timer)
  q.value = ''
  emit('update', { q: '', from: '', to: '', sportType: '' })
}
</script>

<template>
  <form class="filters" @submit.prevent>
    <input
      class="search"
      type="search"
      placeholder="Filter by name…"
      aria-label="filter by name"
      :value="q"
      @input="onSearchInput"
    />
    <div class="row">
      <input
        type="date"
        aria-label="from date"
        :value="filters.from"
        :max="filters.to || undefined"
        @change="onDate('from', $event)"
      />
      <input
        type="date"
        aria-label="to date"
        :value="filters.to"
        :min="filters.from || undefined"
        @change="onDate('to', $event)"
      />
    </div>
    <div class="row">
      <select aria-label="sport type" :value="filters.sportType" @change="onSport">
        <option value="">All sports</option>
        <option v-for="sport in sportTypes" :key="sport" :value="sport">{{ sport }}</option>
      </select>
      <button v-if="active" type="button" class="clear" @click="clear">Clear</button>
    </div>
  </form>
</template>

<style scoped>
.filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-bottom: 1px solid #e1e0d9;
}

.row {
  display: flex;
  gap: 6px;
}

input,
select {
  min-width: 0;
  flex: 1;
  padding: 5px 8px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  font: inherit;
  font-size: 0.8rem;
  background: white;
}

.clear {
  flex: 0 0 auto;
  padding: 5px 10px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  background: white;
  font: inherit;
  font-size: 0.8rem;
  color: #52514e;
  cursor: pointer;
}

.clear:hover {
  background: #f2f1ec;
}
</style>
