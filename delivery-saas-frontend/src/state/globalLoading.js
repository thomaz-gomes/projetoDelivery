import { ref, watch, onScopeDispose } from 'vue'

export const globalLoading = ref(false)

// Track multiple page-local loading refs. globalLoading is true if any bound loading is true.
const _loadingMap = new Map();
let _nextId = 1;

function _recompute() {
  for (const v of _loadingMap.values()) {
    if (v) {
      globalLoading.value = true
      return
    }
  }
  globalLoading.value = false
}

// bind a page-local loading ref so that globalLoading follows the aggregate of all bound refs
export function bindLoading(localRef) {
  if (!localRef || typeof localRef !== 'object') return
  const id = _nextId++
  // set initial
  _loadingMap.set(id, !!localRef.value)
  _recompute()

  const stop = watch(localRef, (v) => {
    _loadingMap.set(id, !!v)
    _recompute()
  }, { immediate: true })

  // when the component using bindLoading is unmounted, remove its entry and stop watching
  onScopeDispose(() => {
    stop()
    _loadingMap.delete(id)
    _recompute()
  })
}
