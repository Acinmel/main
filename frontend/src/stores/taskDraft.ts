import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  AspectRatio,
  RenderMode,
  RewriteStyle,
  TranscriptSegment,
  VideoMetaPreview,
} from '@/types/domain'

/** 下一功能直接读取的口播数据（与首页「口播文案」输入框、`setTranscriptFromApi` 同步） */
export type ScriptSnapshotForNext = {
  fullText: string
  segments: TranscriptSegment[]
  transcriptId: string | null
  sourceVideoUrl: string
}

/** 首页草稿 → 任务流；`transcriptDraft` 为口播正文出口（与 ASR 转写 /「使用文案」共用） */
export const useTaskDraftStore = defineStore('taskDraft', () => {
  const videoUrl = ref('')
  /** 用户选中的原始照片文件（不上传到 store 持久化，仅存内存） */
  const photoFile = ref<File | null>(null)
  const photoPreviewUrl = ref<string | null>(null)
  /**
   * 第二步「口播形象照片」来源：默认使用专属数字人；可改为自行上传。
   */
  const portraitMode = ref<'digital_human' | 'custom'>('digital_human')

  const rewriteStyle = ref<RewriteStyle>('conservative')
  const renderMode = ref<RenderMode>('virtual_bg')
  const aspectRatio = ref<AspectRatio>('9:16')
  const voiceStyleId = ref<string>('neutral_female')
  const subtitleStyleId = ref<string>('minimal_white')

  /** 首页「解析文案」后展示/编辑的口播正文，会随创建任务提交为 initialTranscript */
  const transcriptDraft = ref('')

  const manualScriptDraft = ref('')
  const scriptPipelineCommittedAt = ref<number | null>(null)

  /** ASR 转写分段（毫秒时间轴），供首页展示 */
  const transcriptSegments = ref<TranscriptSegment[]>([])

  /** 最近一次 POST /v1/tools/transcribe 在主后端保存的 ID（内存，重启丢失） */
  const lastTranscriptId = ref<string | null>(null)

  /** 抖音流水线返回的改写建议（可编辑；创建任务后可在改写页继续调整） */
  const rewriteSuggestionDraft = ref('')

  /** 首页「获取视频信息」结果（HTML/Open Graph 解析，非 AI） */
  const videoMeta = ref<VideoMetaPreview | null>(null)

  function revokePhotoPreview() {
    if (photoPreviewUrl.value) {
      URL.revokeObjectURL(photoPreviewUrl.value)
      photoPreviewUrl.value = null
    }
  }

  /** 由首页拉取数字人形象后写入（与 portraitMode === digital_human 对应） */
  function setPhotoFromDigitalHuman(file: File) {
    revokePhotoPreview()
    portraitMode.value = 'digital_human'
    photoFile.value = file
    photoPreviewUrl.value = URL.createObjectURL(file)
  }

  /** 用户在 PhotoUploader 中选择本地文件 */
  function setPhotoFromUserUpload(file: File | null) {
    if (!file) {
      revokePhotoPreview()
      photoFile.value = null
      return
    }
    revokePhotoPreview()
    portraitMode.value = 'custom'
    photoFile.value = file
    photoPreviewUrl.value = URL.createObjectURL(file)
  }

  /** 兼容旧用法：清空或覆盖（如 reset） */
  function setPhoto(file: File | null) {
    revokePhotoPreview()
    photoFile.value = null
    if (file) {
      photoPreviewUrl.value = URL.createObjectURL(file)
      portraitMode.value = 'custom'
    }
  }

  function setVideoMeta(meta: VideoMetaPreview) {
    videoMeta.value = meta
  }

  /** 由 `videoMeta` 更新时预填文案编辑框（见 HomeView watch） */
  function prefillManualScriptFromMeta(meta: VideoMetaPreview) {
    const text =
      (meta.content && meta.content.trim()) ||
      (meta.description && meta.description.trim()) ||
      ''
    manualScriptDraft.value = text
  }

  function commitManualScriptToPipeline() {
    transcriptDraft.value = manualScriptDraft.value.trim()
    scriptPipelineCommittedAt.value = Date.now()
  }

  function setTranscriptFromApi(
    fullText: string,
    segments: TranscriptSegment[],
    opts?: { transcriptId?: string; rewriteSuggestion?: string },
  ) {
    transcriptDraft.value = fullText
    transcriptSegments.value = segments
    lastTranscriptId.value = opts?.transcriptId ?? null
    rewriteSuggestionDraft.value = opts?.rewriteSuggestion ?? ''
  }

  function reset() {
    videoUrl.value = ''
    transcriptDraft.value = ''
    manualScriptDraft.value = ''
    scriptPipelineCommittedAt.value = null
    transcriptSegments.value = []
    lastTranscriptId.value = null
    rewriteSuggestionDraft.value = ''
    videoMeta.value = null
    portraitMode.value = 'digital_human'
    revokePhotoPreview()
    photoFile.value = null
  }

  /** 供后续功能调用：口播正文 = 当前输入框内容；分段 / transcriptId / 链接为同源快照 */
  const scriptSnapshotForNext = computed<ScriptSnapshotForNext>(() => ({
    fullText: manualScriptDraft.value.trim(),
    segments: transcriptSegments.value,
    transcriptId: lastTranscriptId.value,
    sourceVideoUrl: videoUrl.value.trim(),
  }))

  return {
    videoUrl,
    photoFile,
    photoPreviewUrl,
    portraitMode,
    transcriptDraft,
    manualScriptDraft,
    scriptPipelineCommittedAt,
    transcriptSegments,
    lastTranscriptId,
    rewriteSuggestionDraft,
    videoMeta,
    rewriteStyle,
    renderMode,
    aspectRatio,
    voiceStyleId,
    subtitleStyleId,
    setPhoto,
    setPhotoFromDigitalHuman,
    setPhotoFromUserUpload,
    setVideoMeta,
    prefillManualScriptFromMeta,
    commitManualScriptToPipeline,
    setTranscriptFromApi,
    reset,
    scriptSnapshotForNext,
  }
})
