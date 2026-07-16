<script setup lang="ts">
import { computed } from 'vue'
import type { Settings } from '@stravaboard/shared'
import { useSettingsStore } from '../stores/settings'

const store = useSettingsStore()

interface Field {
  key: keyof Settings
  label: string
  unit: string
  min: number
  max: number
}

const fields: Field[] = [
  { key: 'instantWindowS', label: 'Instant window', unit: 's', min: 1, max: 600 },
  { key: 'shortWindowS', label: 'Short-term window', unit: 's', min: 1, max: 3600 },
  { key: 'longWindowS', label: 'Long-term window', unit: 's', min: 1, max: 7200 },
  {
    key: 'ascentMinGainM',
    label: 'Segment min gain (ascent & descent)',
    unit: 'm',
    min: 1,
    max: 1000,
  },
  {
    key: 'ascentDescentToleranceM',
    label: 'Segment tolerance (ascent & descent)',
    unit: 'm',
    min: 0,
    max: 500,
  },
  { key: 'pauseThresholdS', label: 'Pause threshold', unit: 's', min: 5, max: 600 },
  { key: 'slopeWindowM', label: 'Slope window', unit: 'm', min: 10, max: 2000 },
]

const values = computed(() => store.settings)

function onInput(field: Field, event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  const clamped = Math.min(field.max, Math.max(field.min, raw))
  store.update({ [field.key]: clamped })
}
</script>

<template>
  <details class="settings">
    <summary>Settings</summary>
    <div class="fields">
      <label v-for="field in fields" :key="field.key">
        <span>{{ field.label }} ({{ field.unit }})</span>
        <input
          type="number"
          :min="field.min"
          :max="field.max"
          :value="values[field.key]"
          @input="onInput(field, $event)"
        />
      </label>
    </div>
    <p v-if="store.saveError" class="error">Saving failed: {{ store.saveError }}</p>
  </details>
</template>

<style scoped>
.settings {
  border: 1px solid #e1e0d9;
  border-radius: 8px;
  padding: 8px 14px;
  background: #fcfcfb;
}

summary {
  cursor: pointer;
  font-weight: 600;
}

.fields {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 0;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: #52514e;
}

input {
  width: 110px;
  padding: 6px 8px;
  border: 1px solid #c3c2b7;
  border-radius: 6px;
  font: inherit;
}

.error {
  color: #d03b3b;
  font-size: 0.8rem;
}
</style>
