import { onBeforeUnmount, ref } from 'vue'

export function useSingleAudioPlayer() {
  const playingId = ref<string | null>(null)
  let audio: HTMLAudioElement | null = null

  function stop() {
    if (audio) {
      audio.pause()
      audio.src = ''
      audio = null
    }
    playingId.value = null
  }

  function toggle(id: string, url: string) {
    if (playingId.value === id) {
      stop()
      return
    }
    stop()
    audio = new Audio(url)
    playingId.value = id
    audio.addEventListener('ended', stop, { once: true })
    audio.addEventListener('error', stop, { once: true })
    void audio.play().catch(stop)
  }

  onBeforeUnmount(stop)

  return { playingId, toggle, stop }
}
