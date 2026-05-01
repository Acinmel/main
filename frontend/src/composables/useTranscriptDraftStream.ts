import { ref } from 'vue'
import type { TranscriptSegment } from '@/types/domain'
import { useTaskDraftStore } from '@/stores/taskDraft'

/**
 * ASR 转写结果写入「口播文案」可编辑框：打字机式逐段输出（非模型 token 流式，便于用户感知进度）。
 */
export function useTranscriptDraftStream() {
  const draft = useTaskDraftStore()
  const isStreamingToScript = ref(false)
  /** 当前正在流式写入的完整目标文本（用于用户点击中断时一次性补全） */
  let streamingTargetText = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

  function cancelStream() {
    cancelled = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    isStreamingToScript.value = false
    streamingTargetText = ''
  }

  /** 用户点击口播框时中断动画并写入全文，避免与流式 tick 冲突 */
  function interruptStreamWithFullText() {
    if (!isStreamingToScript.value || !streamingTargetText) return
    const full = streamingTargetText
    cancelStream()
    draft.manualScriptDraft = full
  }

  /**
   * 先写入 store 中的 transcript/分段（供后续任务流），再向 manualScriptDraft 流式填充。
   */
  function applyTranscriptToEditableScript(payload: {
    fullText: string
    segments: TranscriptSegment[]
    transcriptId?: string
    rewriteSuggestion?: string
  }) {
    cancelStream()
    const fullText = (payload.fullText ?? '').trim()
    draft.setTranscriptFromApi(fullText, payload.segments, {
      transcriptId: payload.transcriptId,
      rewriteSuggestion: payload.rewriteSuggestion,
    })
    if (!fullText) {
      draft.manualScriptDraft = ''
      return
    }

    cancelled = false
    streamingTargetText = fullText
    isStreamingToScript.value = true
    draft.manualScriptDraft = ''

    const len = fullText.length
    /** 目标总时长约 0.5s～6s */
    const targetMs = Math.min(6000, Math.max(500, len * 1.8))
    const approxTicks = Math.min(200, Math.max(24, Math.ceil(len / 6)))
    const delayMs = Math.max(8, Math.floor(targetMs / approxTicks))
    const step = Math.max(2, Math.ceil(len / approxTicks))

    let i = 0
    const tick = () => {
      if (cancelled) {
        isStreamingToScript.value = false
        return
      }
      i = Math.min(i + step, len)
      draft.manualScriptDraft = fullText.slice(0, i)
      if (i < len) {
        timer = setTimeout(tick, delayMs)
      } else {
        timer = null
        isStreamingToScript.value = false
        streamingTargetText = ''
      }
    }
    tick()
  }

  return {
    isStreamingToScript,
    applyTranscriptToEditableScript,
    cancelStream,
    interruptStreamWithFullText,
  }
}
