import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  deleteDigitalHumanTemplate,
  fetchDigitalHumanImageBlob,
  getDigitalHumanTemplate,
} from '@/api/task'

/** 风格 id → 展示名（与后端预设一致） */
const STYLE_LABELS: Record<string, string> = {
  suit: '西装版',
  ancient: '古风版',
  casual: '休闲版',
  taoist: '道士版',
  fashion: '时尚版',
}

export const useDigitalHumanStore = defineStore('digitalHuman', () => {
  const hasTemplate = ref(false)
  const styleId = ref<string | null>(null)
  /** 已保存数字人输出图的 blob URL */
  const previewBlobUrl = ref<string | null>(null)
  const loading = ref(false)
  /** 是否已完成至少一次与服务端的同步（用于避免首屏误显示「已锁定」） */
  const ready = ref(false)

  const styleLabel = computed(() => {
    const id = styleId.value
    return id ? STYLE_LABELS[id] ?? id : ''
  })

  function revokePreview() {
    if (previewBlobUrl.value) {
      URL.revokeObjectURL(previewBlobUrl.value)
      previewBlobUrl.value = null
    }
  }

  async function refresh() {
    loading.value = true
    try {
      const t = await getDigitalHumanTemplate()
      revokePreview()
      if (t.hasTemplate) {
        hasTemplate.value = true
        styleId.value = t.styleId
        const blob = await fetchDigitalHumanImageBlob()
        previewBlobUrl.value = URL.createObjectURL(blob)
      } else {
        hasTemplate.value = false
        styleId.value = null
      }
      ready.value = true
    } catch {
      hasTemplate.value = false
      styleId.value = null
      revokePreview()
      ready.value = true
    } finally {
      loading.value = false
    }
  }

  async function remove() {
    await deleteDigitalHumanTemplate()
    hasTemplate.value = false
    styleId.value = null
    revokePreview()
  }

  /**
   * 网络长时间无响应时由路由守卫调用，避免 isReady 永久挂起导致整站白屏
   */
  function markReadyFromTimeout() {
    loading.value = false
    if (!ready.value) {
      hasTemplate.value = false
      styleId.value = null
      ready.value = true
    }
  }

  return {
    hasTemplate,
    styleId,
    styleLabel,
    previewBlobUrl,
    loading,
    ready,
    refresh,
    remove,
    revokePreview,
    markReadyFromTimeout,
  }
})
