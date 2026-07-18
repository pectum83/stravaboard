<script setup lang="ts">
import { reactive, watch } from 'vue'
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
  { key: 'pauseRadiusM', label: 'Pause radius', unit: 'm', min: 2, max: 15 },
  { key: 'slopeWindowM', label: 'Slope window', unit: 'm', min: 10, max: 2000 },
  { key: 'liftMaxVSpeed', label: 'Lift/artefact cap', unit: 'm/h', min: 500, max: 6000 },
]

// Local draft text per field, so typing (clearing, retyping) never fights a
// controlled value. Nothing is clamped or saved until the field is committed
// (blur or Enter). Kept in sync when the store changes elsewhere (load, reset).
const drafts = reactive<Record<string, string>>({})
watch(
  () => store.settings,
  (settings) => {
    for (const field of fields) drafts[field.key] = String(settings[field.key])
  },
  { immediate: true, deep: true },
)

/** Clamp, persist, and normalise the field's text on blur or Enter. */
function commit(field: Field): void {
  // v-model coerces a valid number input to a number, but leaves an empty or
  // half-typed field as a string — handle both.
  const text = String(drafts[field.key] ?? '').trim()
  const raw = Number(text)
  if (text === '' || !Number.isFinite(raw)) {
    drafts[field.key] = String(store.settings[field.key]) // revert empty/garbage
    return
  }
  const clamped = Math.min(field.max, Math.max(field.min, raw))
  drafts[field.key] = String(clamped)
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
          v-model="drafts[field.key]"
          type="number"
          :min="field.min"
          :max="field.max"
          @change="commit(field)"
          @keydown.enter="commit(field)"
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
