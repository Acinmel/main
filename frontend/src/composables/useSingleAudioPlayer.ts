import { onBeforeUnmount, ref } from 'vue'

export function useSingleAudioPlayer() {
  const playingId = ref<string | null>(null)
  let audio: HTMLAudioElement | null = null
  let objectUrl: string | null = null

  function revokeObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrl = null
    }
  }

  function stop() {
    if (audio) {
      audio.pause()
      audio.src = ''
      audio = null
    }
    revokeObjectUrl()
    playingId.value = null
  }

  async function resolveAudioSource(url: string) {
    if (/^(https?:|data:|blob:)/i.test(url)) return url
    // Signed or provider-stream URLs should be played directly to avoid full blob download.
    if (/[?&](token|expires)=/i.test(url) || /\/provider-stream(\?|$)/i.test(url)) {
      return url
    }
    const token = localStorage.getItem('kb_token')
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) {
      throw new Error(`audio fetch failed: ${res.status}`)
    }
    const blob = await res.blob()
    objectUrl = URL.createObjectURL(blob)
    return objectUrl
  }

  async function toggle(id: string, url: string) {
    if (playingId.value === id) {
      stop()
      return
    }
    stop()
    try {
      const src = await resolveAudioSource(url)
      audio = new Audio(src)
      playingId.value = id
      audio.addEventListener('ended', stop, { once: true })
      audio.addEventListener('error', stop, { once: true })
      await audio.play()
    } catch {
      stop()
    }
  }

  onBeforeUnmount(stop)

  return { playingId, toggle, stop }
}
