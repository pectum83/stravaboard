import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** Reactive CSS media-query match (false until mounted / when unsupported). */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false)
  let mql: MediaQueryList | null = null
  const update = () => {
    matches.value = mql?.matches ?? false
  }
  onMounted(() => {
    if (typeof window.matchMedia !== 'function') return
    mql = window.matchMedia(query)
    update()
    mql.addEventListener('change', update)
  })
  onBeforeUnmount(() => mql?.removeEventListener('change', update))
  return matches
}

/** Breakpoint below which the dashboard stacks vertically (phones/small tablets). */
export const COMPACT_MEDIA_QUERY = '(max-width: 900px)'
