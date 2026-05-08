import { onBeforeUnmount, onMounted } from 'vue'

export function useDebouncedInfiniteScroll(
  target: () => HTMLElement | null,
  onLoadMore: () => void,
  opts: { distance?: number; delay?: number } = {},
) {
  const distance = opts.distance ?? 160
  const delay = opts.delay ?? 180
  let timer: ReturnType<typeof window.setTimeout> | null = null

  function clearTimer() {
    if (timer) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  function check() {
    clearTimer()
    timer = window.setTimeout(() => {
      const el = target()
      if (!el) return
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remaining <= distance) onLoadMore()
    }, delay)
  }

  onMounted(() => {
    target()?.addEventListener('scroll', check, { passive: true })
  })

  onBeforeUnmount(() => {
    target()?.removeEventListener('scroll', check)
    clearTimer()
  })

  return { check }
}
