import { onMounted, onUnmounted, ref, type Ref } from 'vue'

/** The only non-dashboard view; the app has no router, just this hash. */
export const ADMIN_ROUTE = '#/admin'

/** Current `location.hash`, kept in sync with browser navigation. */
export function useHashRoute(): Ref<string> {
  const hash = ref(window.location.hash)
  const sync = (): void => {
    hash.value = window.location.hash
  }
  onMounted(() => window.addEventListener('hashchange', sync))
  onUnmounted(() => window.removeEventListener('hashchange', sync))
  return hash
}
