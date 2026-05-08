import { computed, ref, shallowRef } from 'vue'
import type { CursorPage } from '@/types/resources'

export function useCursorList<T>(loader: (cursor: string | null) => Promise<CursorPage<T>>) {
  const items = shallowRef<T[]>([])
  const cursor = ref<string | null>(null)
  const hasMore = ref(true)
  const loading = ref(false)
  const loadingMore = ref(false)
  const error = ref('')

  const empty = computed(() => !loading.value && !error.value && items.value.length === 0)

  async function refresh() {
    loading.value = true
    error.value = ''
    try {
      const page = await loader(null)
      items.value = page.items
      cursor.value = page.nextCursor
      hasMore.value = page.hasMore
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载失败'
      items.value = []
      cursor.value = null
      hasMore.value = false
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    error.value = ''
    try {
      const page = await loader(cursor.value)
      items.value = [...items.value, ...page.items]
      cursor.value = page.nextCursor
      hasMore.value = page.hasMore
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载失败'
    } finally {
      loadingMore.value = false
    }
  }

  function removeItems(ids: string[]) {
    const set = new Set(ids)
    items.value = items.value.filter((item) => {
      return !(item && typeof item === 'object' && 'id' in item && set.has(String(item.id)))
    })
  }

  function updateItem(id: string, patch: Partial<T>) {
    items.value = items.value.map((item) => {
      if (item && typeof item === 'object' && 'id' in item && String(item.id) === id) {
        return { ...item, ...patch }
      }
      return item
    })
  }

  function prepend(item: T) {
    items.value = [item, ...items.value]
  }

  return {
    items,
    cursor,
    hasMore,
    loading,
    loadingMore,
    error,
    empty,
    refresh,
    loadMore,
    removeItems,
    updateItem,
    prepend,
  }
}
