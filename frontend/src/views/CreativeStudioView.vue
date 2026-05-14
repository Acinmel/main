<script setup lang="ts">
import {
  NAlert,
  NButton,
  NInput,
  NProgress,
  NSelect,
  NSpace,
  NTag,
  NText,
  useMessage,
} from 'naive-ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import VideoLinkInput from '@/components/home/VideoLinkInput.vue'
import {
  cloneVoiceResource,
  cloneVoiceResourceUpload,
  createAvatarResource,
  listAvatarResources,
  listSubtitleTemplateResources,
  listVoiceResources,
  uploadAvatarResource,
} from '@/api/resources'
import {
  createSubtitleWorkflowPreview,
  createVoicePreview,
  downloadSourceVideoFile,
  fetchSavedVideoBlob,
  fetchVideoMeta,
  finalizeSubtitleWorkflow,
  getDyDownloaderCookieConfigured,
  optimizeOralScript,
  getTranscribePipelineHealth,
  learnDouyinHomepage,
  transcribeSavedVideo,
  transcribeFromUrl,
} from '@/api/task'
import type { DouyinHomepageLearnedPost, DouyinHomepageLearnedProfile } from '@/api/task'
import NewAvatarModal from '@/components/resources/NewAvatarModal.vue'
import VoiceCloneModal from '@/components/resources/VoiceCloneModal.vue'
import { useSingleAudioPlayer } from '@/composables/useSingleAudioPlayer'
import { useTranscriptDraftStream } from '@/composables/useTranscriptDraftStream'
import { useTaskDraftStore } from '@/stores/taskDraft'
import type {
  AvatarResource,
  CreateAvatarResourceDraft,
  CreateVoiceResourceDraft,
  SubtitleTemplateResource,
  VoiceResource,
} from '@/types/resources'
import type { VideoMetaPreview } from '@/types/domain'
import { isDouyinNormalizedUrl, validateSourceVideoInput } from '@/utils/douyinShareUrl'
import { formatStatCount } from '@/utils/formatDisplay'
import {
  describeHttpOrNetworkError,
  describeHttpOrNetworkErrorMaybeBlob,
} from '@/utils/httpErrorMessage'

type CreationStep = {
  no: number
  title: string
  desc: string
}

type SelectOption = { label: string; value: string }
type StudioSourceMode = 'homepage' | 'hotlink'
type VoiceSourceMode = 'tts' | 'local'
type RenderModelChoice = 'new' | 'classic'
type RenderResolutionChoice = '1080p' | '2k'

type RecentExtractionRecord = {
  id: string
  sourceUrl: string
  platform: string
  title: string
  summary: string
  coverUrl: string
  videoUrl: string
  extractedAt: string
}

const RECENT_EXTRACTION_STORAGE_KEY = 'creative-studio:recent-extractions:v1'

const hiddenRecommendedVoiceIds = new Set([
  'rec-voice-female',
  'rec-voice-male',
  'rec-voice-narration',
  'rec-voice-bright-young-female',
])

const voiceLanguageOptions = [
  { label: '汉语-简体', value: 'zh-CN' },
  { label: '汉语-粤语', value: 'zh-HK' },
  { label: '英文', value: 'en-US' },
]

const voiceEmotionOptions = [
  { label: '自然', value: '自然' },
  { label: '轻快', value: '轻快' },
  { label: '讲解', value: '讲解' },
  { label: '激励', value: '激励' },
]

type OralScriptPolishState = {
  hook3s: string
  hook10s: string
  optimizedScript: string
  strategyId: string
  strategyLabel: string
  llmUsed: boolean
}

const steps: CreationStep[] = [
  { no: 1, title: '搞定文案', desc: '抓链接、转文案、手动润稿' },
  { no: 2, title: '配音 & 数字人', desc: '挑选音色与出镜视频' },
  { no: 3, title: '一键成片', desc: '整段生成对口型视频' },
  { no: 4, title: '自动发布', desc: '预留发布账号与计划' },
]

const publishPlatforms = [
  { name: '抖音', icon: '抖', account: '0 个账号' },
  { name: '视频号', icon: '视', account: '0 个账号' },
  { name: '小红书', icon: '红', account: '0 个账号' },
  { name: '快手', icon: '快', account: '0 个账号' },
]

const apiBasePath = (() => {
  const raw =
    typeof import.meta.env.VITE_API_BASE_URL === 'string' &&
    import.meta.env.VITE_API_BASE_URL.length > 0
      ? import.meta.env.VITE_API_BASE_URL
      : '/api'
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
})()

const message = useMessage()
const route = useRoute()
const router = useRouter()
const draft = useTaskDraftStore()
const { playingId: audioPlayingId, toggle: toggleAudioPlayback } = useSingleAudioPlayer()
const {
  applyTranscriptToEditableScript,
  cancelStream,
  interruptStreamWithFullText,
  isStreamingToScript,
} = useTranscriptDraftStream()

const activeStep = ref(1)
const sourceMode = ref<StudioSourceMode>('homepage')
const publishCopy = ref('')
const publishCopyTouched = ref(false)
const benchmarkHomepageUrl = ref('')
const benchmarkLearning = ref(false)
const benchmarkLearningHint = ref('')
const benchmarkProfile = ref<DouyinHomepageLearnedProfile | null>(null)
const benchmarkSamples = ref<DouyinHomepageLearnedPost[]>([])
const benchmarkIdeaSuggestions = ref<string[]>([])

const loadingMeta = ref(false)
const recentExtractionRecords = ref<RecentExtractionRecord[]>([])
const douyinPipeline = ref(false)
const pipelinePhase = ref<'idle' | 'download' | 'transcribe'>('idle')
const pipelineProgress = ref(0)
const pipelineBarProcessing = ref(false)
const transcribeUrlLoading = ref(false)
const retranscribingLocal = ref(false)
const optimizingOralScript = ref(false)
const oralScriptPolish = ref<OralScriptPolishState | null>(null)
const lastSavedVideoBasename = ref<string | null>(null)
const dyCookieConfigured = ref<boolean | null>(null)
const pipelineHealthError = ref('')

const renderResourceLoading = ref(false)
const createAvatarOpen = ref(false)
const creatingAvatar = ref(false)
const cloneVoiceOpen = ref(false)
const cloningVoice = ref(false)
const avatarResourceItems = ref<AvatarResource[]>([])
const voiceResourceItems = ref<VoiceResource[]>([])
const avatarOptions = ref<SelectOption[]>([])
const voiceOptions = ref<SelectOption[]>([])
const subtitleTemplateOptions = ref<SelectOption[]>([])
const subtitleTemplateItems = ref<SubtitleTemplateResource[]>([])
const selectedAvatarId = ref('')
const selectedAvatarIds = ref<string[]>([])
const selectedVoiceId = ref('')
const selectedSubtitleTemplateId = ref('')
const voiceSourceMode = ref<VoiceSourceMode>('tts')
const selectedVoiceLanguage = ref('zh-CN')
const selectedVoiceEmotion = ref('自然')
const selectedVoicePower = ref(1.03)
const selectedVoiceRate = ref(1.13)
const selectedVoiceVolume = ref(1)
const renderModelChoice = ref<RenderModelChoice>('new')
const renderResolutionChoice = ref<RenderResolutionChoice>('1080p')
const voicePreviewLoading = ref(false)
const voicePreviewUrl = ref<string | null>(null)
const voicePreviewHint = ref('')
const voicePreviewMode = ref<'provider' | 'mock' | ''>('')
const voicePreviewDurationSeconds = ref(0)
const voicePreviewProgress = ref(0)
const voicePreviewProgressLabel = ref('准备生成音频')
let voicePreviewProgressTimer: number | null = null
const voiceShellRef = ref<HTMLElement | null>(null)
const requestedAvatarUnavailable = ref(false)
const consumedRouteAvatarId = ref('')
const generatedPreviewObjectUrls = ref<string[]>([])
const subtitleWorkflowPreviewLoading = ref(false)
const subtitleWorkflowFinalizeLoading = ref(false)
const subtitleWorkflowDraftId = ref('')
const subtitleWorkflowPreviewUrl = ref<string | null>(null)
const subtitleWorkflowFinalUrl = ref<string | null>(null)
const subtitleWorkflowHint = ref('')
const subtitleWorkflowTimelineSource = ref<'asr-fallback' | 'local-estimate' | ''>('')
const subtitleWorkflowJson = ref<{
  version: 1
  language: string
  durationMs: number
  generatedAt: string
  source: {
    script: string
    avatarResourceId: string
    voiceResourceId: string
    subtitleTemplateId: string
  }
  template: {
    id: string
    name: string
    styleJson: Record<string, unknown>
  }
  cues: Array<{
    id: string
    startMs: number
    endMs: number
    text: string
    lines: string[]
  }>
} | null>(null)
const avatarCoverVideoUrls = ref<Record<string, string>>({})
const pendingAvatarCoverIds = new Set<string>()

const urlInvalid = computed(() => {
  if (!draft.videoUrl?.trim()) return false
  return !validateSourceVideoInput(draft.videoUrl).ok
})

const linkReady = computed(() => validateSourceVideoInput(draft.videoUrl).ok)
const canTranscribeNonDouyinUrl = computed(
  () => linkReady.value && !isDouyinNormalizedUrl(draft.videoUrl),
)
const hasAvatarOptions = computed(() => avatarOptions.value.length > 0)
const hasVoiceOptions = computed(() => voiceOptions.value.length > 0)
const hasLearnedBenchmark = computed(() => Boolean(benchmarkProfile.value))
const selectedVoiceResource = computed(() =>
  voiceResourceItems.value.find((item) => item.id === selectedVoiceId.value) ?? null,
)
const voiceReadyForPreview = computed(
  () =>
    Boolean(currentWorkflowScript.value) &&
    Boolean(selectedVoiceId.value) &&
    selectedVoiceResource.value?.cloneStatus === 'ready',
)
const selectedAvatarCardItems = computed(() =>
  selectedAvatarIds.value
    .map((id) => avatarResourceItems.value.find((item) => item.id === id))
    .filter((item): item is AvatarResource => Boolean(item))
    .slice(0, 7),
)
const hasSelectedAvatarCards = computed(() => selectedAvatarCardItems.value.length > 0)
const progressText = computed(() => `${activeStep.value}/4`)
const progressPercent = computed(() => activeStep.value * 25)
const pipelineStatusLabel = computed(() => {
  if (!douyinPipeline.value) return ''
  if (pipelinePhase.value === 'download') return '1/2 正在下载并保存抖音源视频'
  if (pipelinePhase.value === 'transcribe') return '2/2 正在抽取音轨并转写文案'
  return ''
})
const scriptBlockHint = computed(() =>
  isDouyinNormalizedUrl(draft.videoUrl)
    ? '抖音链接会先落到服务端目录，再用 FFmpeg + ASR 回填这份文案。'
    : '支持直接从上传音视频或当前链接中转写口播文案。',
)
const selectedAvatarLabel = computed(
  () => avatarOptions.value.find((item) => item.value === selectedAvatarId.value)?.label ?? '未选择',
)
const selectedVoiceLabel = computed(
  () => voiceOptions.value.find((item) => item.value === selectedVoiceId.value)?.label ?? '未选择',
)
const selectedSubtitleTemplateLabel = computed(
  () =>
    subtitleTemplateOptions.value.find((item) => item.value === selectedSubtitleTemplateId.value)?.label ??
    '未选择',
)
const extractedScriptLines = computed(() => {
  const raw = sanitizeWorkflowScriptText(draft.manualScriptDraft.trim())
  if (raw) return splitScriptIntoSemanticSegments(raw)

  const fromSegments = draft.transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
  return splitScriptIntoSemanticSegments(fromSegments.join('\n'))
})
const oralScriptSourceText = computed(() => {
  const raw = sanitizeWorkflowScriptText(draft.manualScriptDraft.trim())
  if (raw) return raw

  const fromSegments = draft.transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  if (fromSegments) return fromSegments
  return draft.manualScriptDraft.trim()
})
function isInternalPipelineScriptLine(line: string) {
  const normalized = line.replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  return (
    normalized.includes('模拟口播原文稿') ||
    normalized.includes('原视频链接占位') ||
    normalized.includes('真实链路') ||
    (normalized.includes('FFmpeg') && normalized.includes('ASR') && normalized.includes('回填')) ||
    /^https?:\/\/\S+$/i.test(normalized)
  )
}

function sanitizeWorkflowScriptText(value: string) {
  return value
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line && !isInternalPipelineScriptLine(line))
    .join('\n')
    .trim()
}

function splitLongTextByLength(text: string, maxChars: number) {
  const result: string[] = []
  for (let i = 0; i < text.length; i += maxChars) {
    const chunk = text.slice(i, i + maxChars).trim()
    if (chunk) result.push(chunk)
  }
  return result
}

function splitSemanticSentence(sentence: string, maxChars: number) {
  const trimmed = sentence.trim()
  if (!trimmed) return []
  if (trimmed.length <= maxChars) return [trimmed]

  const commaPieces =
    trimmed.match(/[^，,、：:]+[，,、：:]*/g)?.map((item) => item.trim()).filter(Boolean) ?? [
      trimmed,
    ]
  const result: string[] = []
  let buffer = ''

  for (const piece of commaPieces) {
    if (piece.length > maxChars) {
      if (buffer) {
        result.push(buffer)
        buffer = ''
      }
      result.push(...splitLongTextByLength(piece, maxChars))
      continue
    }

    const next = buffer ? `${buffer}${piece}` : piece
    if (next.length > maxChars && buffer) {
      result.push(buffer)
      buffer = piece
    } else {
      buffer = next
    }
  }

  if (buffer) result.push(buffer)
  return result
}

function splitScriptIntoSemanticSegments(text: string, maxChars = 52) {
  const source = sanitizeWorkflowScriptText(text)
  if (!source) return []

  return source
    .split(/\r\n|\n|\r/)
    .flatMap((line) =>
      (line
        .replace(/\s+/g, ' ')
        .match(/[^。！？!?；;]+[。！？!?；;]*/g) ?? [line]
      ).flatMap((sentence) => splitSemanticSentence(sentence, maxChars)),
    )
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function trimRecordText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

function loadRecentExtractionRecords() {
  const rows = safeJsonParse<RecentExtractionRecord[]>(
    window.localStorage.getItem(RECENT_EXTRACTION_STORAGE_KEY),
    [],
  )
  recentExtractionRecords.value = rows
    .filter((item) => item?.sourceUrl && item?.title)
    .slice(0, 6)
}

function persistRecentExtractionRecords() {
  window.localStorage.setItem(
    RECENT_EXTRACTION_STORAGE_KEY,
    JSON.stringify(recentExtractionRecords.value.slice(0, 6)),
  )
}

function rememberRecentExtraction(meta: VideoMetaPreview, sourceUrl: string) {
  const summary = meta.content || meta.description || meta.title || '这条视频暂时没有解析到正文内容'
  const record: RecentExtractionRecord = {
    id: `${sourceUrl}-${Date.now()}`,
    sourceUrl,
    platform: meta.platform === 'douyin' ? '抖音' : '视频',
    title: trimRecordText(meta.title || summary, 72),
    summary: trimRecordText(summary, 120),
    coverUrl: meta.coverImageUrl || '',
    videoUrl: meta.videoUrl || '',
    extractedAt: new Date().toISOString(),
  }

  recentExtractionRecords.value = [
    record,
    ...recentExtractionRecords.value.filter((item) => item.sourceUrl !== sourceUrl),
  ].slice(0, 6)
  persistRecentExtractionRecords()
}

function formatRecentExtractionTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (sameDay) return `今天 ${clock}`
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clock}`
  return `${date.getMonth() + 1}/${date.getDate()} ${clock}`
}

async function copyRecentExtractionLink(record: RecentExtractionRecord) {
  try {
    await navigator.clipboard.writeText(record.sourceUrl)
    message.success('已复制该短视频链接。')
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = record.sourceUrl
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
    message.success('已复制该短视频链接。')
  }
}

function applySafeTranscriptToEditableScript(payload: {
  fullText: string
  segments: Parameters<typeof applyTranscriptToEditableScript>[0]['segments']
  transcriptId?: string
  rewriteSuggestion?: string
}) {
  const fullText = sanitizeWorkflowScriptText(payload.fullText)
  if (!fullText) {
    message.warning('转写没有返回有效口播文案，请检查 ASR 配置或重新转写。')
    return false
  }
  applyTranscriptToEditableScript({
    ...payload,
    fullText,
    segments: payload.segments.filter((segment) => !isInternalPipelineScriptLine(segment.text)),
  })
  return true
}

function clearInternalPipelineScriptDraft() {
  const raw = draft.manualScriptDraft.trim()
  if (!raw) return
  const clean = sanitizeWorkflowScriptText(raw)
  if (clean === raw) return
  draft.manualScriptDraft = clean
  if (!clean) {
    draft.setTranscriptFromApi('', [], {})
  }
}

const rawWorkflowScript = computed(() => draft.manualScriptDraft.trim())
const currentWorkflowScript = computed(() => sanitizeWorkflowScriptText(rawWorkflowScript.value))

function ensureStreamingScriptComplete() {
  if (isStreamingToScript.value) {
    interruptStreamWithFullText()
  }
}

const workflowProgressState = computed(() => {
  const prerequisitesReady = Boolean(
    currentWorkflowScript.value &&
      selectedAvatarId.value &&
      selectedVoiceId.value &&
      selectedSubtitleTemplateId.value,
  )

  if (subtitleWorkflowFinalUrl.value) {
    return {
      percent: 100,
      doneCount: 5,
      activeIndex: 4,
      status: '完整视频已生成',
      hint: '成片已经输出，可以直接预览结果。',
    }
  }
  if (subtitleWorkflowFinalizeLoading.value) {
    return {
      percent: 90,
      doneCount: 4,
      activeIndex: 4,
      status: '正在输出最终视频',
      hint: '正在把数字人口型、声音、字幕合成完整成片。',
    }
  }
  if (subtitleWorkflowPreviewUrl.value || subtitleWorkflowDraftId.value) {
    return {
      percent: 76,
      doneCount: 4,
      activeIndex: 3,
      status: '5 秒预览已生成',
      hint: '请检查声音、口型和字幕位置，确认后输出完整视频。',
    }
  }
  if (subtitleWorkflowPreviewLoading.value) {
    return {
      percent: 52,
      doneCount: 1,
      activeIndex: 2,
      status: '正在合成预览',
      hint: '系统正在生成音轨、整理字幕，并制作可检查的 5 秒预览。',
    }
  }
  if (prerequisitesReady) {
    return {
      percent: 12,
      doneCount: 0,
      activeIndex: 0,
      status: '素材已就绪',
      hint: '点击生成 5 秒预览，先看效果再输出完整视频。',
    }
  }
  return {
    percent: 0,
    doneCount: 0,
    activeIndex: 0,
    status: '等待补齐素材',
    hint: '先确认文案、数字人、音色和字幕模板。',
  }
})
const workflowProgressSteps = computed(() => {
  const steps = [
    { label: '生成音轨' },
    { label: '整理字幕' },
    { label: '合成预览' },
    { label: '对齐口型' },
    { label: '输出成片' },
  ]
  return steps.map((step, index) => ({
    ...step,
    status:
      index < workflowProgressState.value.doneCount
        ? 'done'
        : workflowProgressState.value.percent > 0 && index === workflowProgressState.value.activeIndex
          ? 'active'
          : 'idle',
  }))
})
const workflowSimpleSteps = computed(() => {
  const labels = ['生成音轨', '整理字幕', '合成预览', '对齐口型', '输出成片']
  return labels.map((label, index) => ({
    label,
    status: workflowProgressSteps.value[index]?.status ?? 'idle',
  }))
})

const firstReadyVideoUrl = computed(() => {
  if (subtitleWorkflowFinalUrl.value) return subtitleWorkflowFinalUrl.value
  if (subtitleWorkflowPreviewUrl.value) return subtitleWorkflowPreviewUrl.value
  return null
})
const generatedVideoCount = computed(() => {
  if (subtitleWorkflowFinalUrl.value || subtitleWorkflowPreviewUrl.value) return 1
  return 0
})
const publishReadyItems = computed(() => {
  if (subtitleWorkflowFinalUrl.value || subtitleWorkflowPreviewUrl.value) {
    return [
      {
        index: 1,
        videoUrl: subtitleWorkflowFinalUrl.value || subtitleWorkflowPreviewUrl.value,
        text: currentWorkflowScript.value || '已生成最终视频',
      },
    ]
  }
  return []
})
const footerNextLabel = computed(() => {
  if (activeStep.value === 1) return '下一步：配音 & 数字人'
  if (activeStep.value === 2) return '下一步：一键成片'
  if (activeStep.value === 3) return '下一步：自动发布'
  return '四步已完成'
})

function revokeGeneratedPreviewObjectUrls() {
  for (const url of generatedPreviewObjectUrls.value) {
    URL.revokeObjectURL(url)
  }
  generatedPreviewObjectUrls.value = []
}

function resolveProtectedMediaUrl(url: string) {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) return trimmed
  return `${apiBasePath}/${trimmed.replace(/^\/+/, '')}`
}

function isAvatarPlaceholderCover(url: string | null | undefined) {
  const trimmed = url?.trim()
  if (!trimmed) return true
  const normalized = (() => {
    try {
      return decodeURIComponent(trimmed).toLowerCase()
    } catch {
      return trimmed.toLowerCase()
    }
  })()
  return normalized.includes('placehold.co') && normalized.includes('text=avatar')
}

function resolveAvatarCoverImageUrl(item: AvatarResource) {
  if (isAvatarPlaceholderCover(item.coverUrl)) return ''
  return resolveProtectedMediaUrl(item.coverUrl)
}

function resolveAvatarCoverVideoUrl(item: AvatarResource) {
  return avatarCoverVideoUrls.value[item.id] ?? ''
}

function revokeAvatarCoverVideoUrl(id: string) {
  const url = avatarCoverVideoUrls.value[id]
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
  const next = { ...avatarCoverVideoUrls.value }
  delete next[id]
  avatarCoverVideoUrls.value = next
}

function clearAvatarCoverVideoUrls() {
  for (const id of Object.keys(avatarCoverVideoUrls.value)) {
    revokeAvatarCoverVideoUrl(id)
  }
}

async function ensureAvatarVideoCover(item: AvatarResource) {
  if (!isAvatarPlaceholderCover(item.coverUrl)) return
  const source = item.originalVideoUrl?.trim()
  if (!source || avatarCoverVideoUrls.value[item.id] || pendingAvatarCoverIds.has(item.id)) return

  pendingAvatarCoverIds.add(item.id)
  try {
    const nextUrl = /^(https?:|data:|blob:)/i.test(source)
      ? source
      : URL.createObjectURL(await fetchSavedVideoBlob(source))

    if (!selectedAvatarIds.value.includes(item.id)) {
      if (nextUrl.startsWith('blob:')) URL.revokeObjectURL(nextUrl)
      return
    }

    avatarCoverVideoUrls.value = {
      ...avatarCoverVideoUrls.value,
      [item.id]: nextUrl,
    }
  } catch {
    // 封面兜底失败不阻断创作流程，卡片会继续显示文字占位。
  } finally {
    pendingAvatarCoverIds.delete(item.id)
  }
}

function syncAvatarVideoCovers(items: AvatarResource[]) {
  const visibleIds = new Set(items.map((item) => item.id))
  for (const id of Object.keys(avatarCoverVideoUrls.value)) {
    if (!visibleIds.has(id)) revokeAvatarCoverVideoUrl(id)
  }
  for (const item of items) {
    void ensureAvatarVideoCover(item)
  }
}

async function resolveGeneratedPreviewVideoUrl(url: string | null) {
  const source = url?.trim()
  if (!source) return null
  if (/^(https?:|data:|blob:)/i.test(source)) return source

  const token = localStorage.getItem('kb_token')
  const response = await fetch(resolveProtectedMediaUrl(source), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) {
    throw new Error(`预览视频加载失败（${response.status}）`)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  generatedPreviewObjectUrls.value = [...generatedPreviewObjectUrls.value, objectUrl]
  return objectUrl
}

function syncPublishCopyFromScript(force = false) {
  if (publishCopyTouched.value && !force) return
  const next = draft.manualScriptDraft.trim().slice(0, 140)
  if (next) {
    publishCopy.value = next
  }
}

function addAvatarToCurrentCreation(id: string, options: { silent?: boolean } = {}) {
  const nextId = id.trim()
  if (!nextId) return false
  if (!avatarResourceItems.value.some((item) => item.id === nextId)) return false

  if (!selectedAvatarIds.value.includes(nextId) && selectedAvatarIds.value.length >= 7) {
    if (!options.silent) {
      message.warning('最多添加 7 位数字人，请先移除一个再添加。')
    }
    return false
  }

  selectedAvatarIds.value = [
    nextId,
    ...selectedAvatarIds.value.filter((itemId) => itemId !== nextId),
  ].slice(0, 7)
  selectedAvatarId.value = nextId
  return true
}

function selectAvatarForCurrentCreation(id: string) {
  if (!selectedAvatarIds.value.includes(id)) return
  selectedAvatarId.value = id
}

function removeAvatarFromCurrentCreation(id: string) {
  selectedAvatarIds.value = selectedAvatarIds.value.filter((itemId) => itemId !== id)
  if (selectedAvatarId.value === id) {
    selectedAvatarId.value = selectedAvatarIds.value[0] ?? ''
  }
  message.success('已从当前创作移除该数字人。')
}

async function loadRenderResources() {
  renderResourceLoading.value = true
  try {
    const [avatars, voices, subtitleTemplates] = await Promise.all([
      listAvatarResources({ scope: 'all', limit: 40 }),
      listVoiceResources({ scope: 'all', limit: 40 }),
      listSubtitleTemplateResources({ scope: 'all', limit: 40 }),
    ])
    avatarResourceItems.value = avatars.items.filter((item) => Boolean(item.originalVideoUrl))
    voiceResourceItems.value = voices.items.filter((item) => !hiddenRecommendedVoiceIds.has(item.id))
    avatarOptions.value = avatarResourceItems.value
      .map((item) => ({ label: item.name, value: item.id }))
    voiceOptions.value = voiceResourceItems.value.map((item) => ({
      label: item.name,
      value: item.id,
    }))
    subtitleTemplateItems.value = subtitleTemplates.items
    subtitleTemplateOptions.value = subtitleTemplates.items.map((item) => ({
      label: item.name,
      value: item.id,
    }))
    const avatarIds = new Set(avatarOptions.value.map((item) => item.value))
    const voiceIds = new Set(voiceOptions.value.map((item) => item.value))
    const subtitleTemplateIds = new Set(subtitleTemplateOptions.value.map((item) => item.value))

    const routeAvatarId =
      typeof route.query.avatarId === 'string' ? route.query.avatarId.trim() : ''
    requestedAvatarUnavailable.value = false
    selectedAvatarIds.value = selectedAvatarIds.value
      .filter((id) => avatarIds.has(id))
      .slice(0, 7)
    if (routeAvatarId && avatarIds.has(routeAvatarId)) {
      if (consumedRouteAvatarId.value !== routeAvatarId) {
        addAvatarToCurrentCreation(routeAvatarId, { silent: true })
        consumedRouteAvatarId.value = routeAvatarId
      }
    } else if (routeAvatarId) {
      requestedAvatarUnavailable.value = true
    }
    if (!selectedAvatarIds.value.includes(selectedAvatarId.value)) {
      selectedAvatarId.value = selectedAvatarIds.value[0] ?? ''
    }

    if (!voiceIds.has(selectedVoiceId.value)) {
      selectedVoiceId.value = voiceOptions.value[0]?.value ?? ''
    }
    if (!subtitleTemplateIds.has(selectedSubtitleTemplateId.value)) {
      selectedSubtitleTemplateId.value = subtitleTemplateOptions.value[0]?.value ?? ''
    }
  } catch {
    avatarResourceItems.value = []
    voiceResourceItems.value = []
    avatarOptions.value = []
    voiceOptions.value = []
    subtitleTemplateItems.value = []
    subtitleTemplateOptions.value = []
    selectedAvatarId.value = ''
    selectedAvatarIds.value = []
    selectedVoiceId.value = ''
    selectedSubtitleTemplateId.value = ''
  } finally {
    renderResourceLoading.value = false
  }
}

async function createAvatarFromStudio(body: CreateAvatarResourceDraft) {
  creatingAvatar.value = true
  try {
    const item = body.uploadFile
      ? await uploadAvatarResource(body)
      : await createAvatarResource(body)
    await loadRenderResources()
    if (!avatarResourceItems.value.some((resource) => resource.id === item.id)) {
      avatarResourceItems.value = [item, ...avatarResourceItems.value].slice(0, 40)
      avatarOptions.value = [
        { label: item.name, value: item.id },
        ...avatarOptions.value.filter((option) => option.value !== item.id),
      ]
    }
    addAvatarToCurrentCreation(item.id)
    createAvatarOpen.value = false
    message.success('数字人视频已加入当前创作，并自动选中。')
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    creatingAvatar.value = false
  }
}

async function cloneVoiceFromStudio(body: CreateVoiceResourceDraft) {
  cloningVoice.value = true
  try {
    const item = body.sampleFile
      ? await cloneVoiceResourceUpload(body)
      : await cloneVoiceResource(body)
    await loadRenderResources()
    selectedVoiceId.value = item.id
    cloneVoiceOpen.value = false
    if (item.provider === 'local-upload') {
      voiceSourceMode.value = 'local'
      message.warning('音频已加入当前创作；模型克隆未通过，已切换为本地语音模式。')
      return
    }
    message.success('克隆音频已加入当前创作，并自动选中。')
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    cloningVoice.value = false
  }
}

function resetVoicePreviewState() {
  clearVoicePreviewProgress()
  voicePreviewUrl.value = null
  voicePreviewHint.value = ''
  voicePreviewMode.value = ''
  voicePreviewDurationSeconds.value = 0
  voicePreviewProgress.value = 0
  voicePreviewProgressLabel.value = '准备生成音频'
}

function clearVoicePreviewProgress() {
  if (voicePreviewProgressTimer !== null) {
    window.clearInterval(voicePreviewProgressTimer)
    voicePreviewProgressTimer = null
  }
}

function scrollVoiceShellToOutput() {
  void nextTick(() => {
    const shell = voiceShellRef.value
    if (!shell) return
    shell.scrollTo({
      top: shell.scrollHeight,
      behavior: 'smooth',
    })
  })
}

function startVoicePreviewProgress() {
  clearVoicePreviewProgress()
  voicePreviewProgress.value = 8
  voicePreviewProgressLabel.value = '正在整理文案和音色参数'
  scrollVoiceShellToOutput()
  voicePreviewProgressTimer = window.setInterval(() => {
    const current = voicePreviewProgress.value
    if (current < 36) {
      voicePreviewProgress.value = Math.min(36, current + 7)
      voicePreviewProgressLabel.value = '正在整理文案和音色参数'
      return
    }
    if (current < 72) {
      voicePreviewProgress.value = Math.min(72, current + 5)
      voicePreviewProgressLabel.value = '正在请求语音生成接口'
      return
    }
    voicePreviewProgress.value = Math.min(92, current + 2)
    voicePreviewProgressLabel.value = '正在保存试听音频'
  }, 420)
}

function finishVoicePreviewProgress(ok: boolean) {
  clearVoicePreviewProgress()
  voicePreviewProgress.value = ok ? 100 : 0
  voicePreviewProgressLabel.value = ok ? '音频已生成，可以先试听效果' : '生成失败，请调整后重试'
  scrollVoiceShellToOutput()
}

function formatSecondsClock(value: number) {
  const total = Math.max(0, Math.round(value))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function nudgeVoicePower(delta: number) {
  const next = Number((selectedVoicePower.value + delta).toFixed(2))
  selectedVoicePower.value = Math.min(1.5, Math.max(0.6, next))
}

function buildVoiceTuningPayload() {
  return {
    voiceLanguage: selectedVoiceLanguage.value,
    voiceEmotion: selectedVoiceEmotion.value,
    voiceEmotionIntensity: selectedVoicePower.value,
    voiceRate: selectedVoiceRate.value,
    voiceVolume: selectedVoiceVolume.value,
  }
}

async function onGenerateVoicePreview() {
  ensureStreamingScriptComplete()
  const script = currentWorkflowScript.value
  if (!script) {
    message.warning('请先回到第一步锁定口播文案。')
    return
  }
  if (!selectedVoiceId.value) {
    message.warning('请先选择一个克隆音色。')
    return
  }
  if (selectedVoiceResource.value?.cloneStatus !== 'ready') {
    message.warning('当前音色还没准备好，暂时不能生成试听音频。')
    return
  }

  voicePreviewLoading.value = true
  resetVoicePreviewState()
  startVoicePreviewProgress()
  try {
    const data = await createVoicePreview({
      script,
      voiceResourceId: selectedVoiceId.value,
      ...buildVoiceTuningPayload(),
    })
    voicePreviewUrl.value = data.audioUrl
    voicePreviewHint.value = data.hint
    voicePreviewMode.value = data.ttsMode
    voicePreviewDurationSeconds.value = data.durationSeconds
    finishVoicePreviewProgress(true)
    message.success(
      data.ttsMode === 'provider'
        ? `已生成「${data.voiceLabel}」的可试听配音。`
        : '真实 TTS 暂未走通，已生成占位试听音频供流程验收。',
    )
  } catch (e: unknown) {
    finishVoicePreviewProgress(false)
    message.error(describeHttpOrNetworkError(e))
  } finally {
    voicePreviewLoading.value = false
  }
}

async function downloadProtectedFile(url: string, fallbackName: string) {
  const token = localStorage.getItem('kb_token')
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) {
    throw new Error(`下载失败（${response.status}）`)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fallbackName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

async function onDownloadVoicePreview() {
  if (!voicePreviewUrl.value) return
  try {
    const extension = voicePreviewMode.value === 'mock' ? 'wav' : 'mp3'
    await downloadProtectedFile(
      voicePreviewUrl.value,
      `voice-preview-${Date.now()}.${extension}`,
    )
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  }
}

function onProceedFromStepTwo() {
  if (!selectedAvatarId.value) {
    message.warning('请先选择一个数字人视频。')
    return
  }
  if (!selectedVoiceId.value) {
    message.warning('请先选择一个克隆声音。')
    return
  }
  activeStep.value = 3
  message.success('已带着当前数字人与声音配置进入一键成片。')
}

function goToResourceLibrary(tab: 'avatars' | 'voices' | 'subtitle-templates') {
  void router.push({ name: 'resource-library', query: { tab } })
}

async function refreshDyCookieStatus() {
  try {
    const { configured } = await getDyDownloaderCookieConfigured()
    dyCookieConfigured.value = configured
  } catch {
    dyCookieConfigured.value = null
  }
}

async function refreshPipelineHealth() {
  pipelineHealthError.value = ''
  try {
    await getTranscribePipelineHealth()
  } catch (e) {
    pipelineHealthError.value = describeHttpOrNetworkError(e)
  }
}

function buildBenchmarkIdeaDraft(mode: 'ai' | 'custom') {
  const profile = benchmarkProfile.value
  if (!profile) return ''

  const sampleLines = benchmarkSamples.value
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.title}`)

  if (mode === 'ai') {
    const suggestions = benchmarkIdeaSuggestions.value.length
      ? benchmarkIdeaSuggestions.value
      : ['围绕这个账号的高互动表达方式，整理 5 条你的口播选题']

    return [
      `对标账号：${profile.nickname}`,
      `账号定位：${profile.signature}`,
      `近期作品参考：`,
      ...sampleLines,
      '',
      '建议选题：',
      ...suggestions.map((item, index) => `${index + 1}. ${item}`),
    ].join('\n')
  }

  return [
    `对标账号：${profile.nickname}`,
    `你准备模仿的内容方向：${profile.signature}`,
    '',
    '请在下面手动整理你的口播文案：',
    '1. 开场钩子：',
    '2. 核心观点：',
    '3. 案例或步骤：',
    '4. 收尾行动：',
    '',
    '参考作品：',
    ...sampleLines,
  ].join('\n')
}

async function focusOutlineEditor() {
  await nextTick()
  const editor = document.querySelector<HTMLTextAreaElement>('.outline-editor textarea')
  editor?.focus()
}

function resetOralScriptPolish() {
  oralScriptPolish.value = null
}

async function applyBenchmarkIdeaDraft(mode: 'ai' | 'custom') {
  if (!benchmarkProfile.value) {
    message.warning('请先学习一个抖音主页，再生成选题。')
    return
  }
  resetOralScriptPolish()
  draft.manualScriptDraft = buildBenchmarkIdeaDraft(mode)
  syncPublishCopyFromScript(true)
  await focusOutlineEditor()
  message.success(mode === 'ai' ? '已生成对标选题草稿。' : '已切到自定义选题草稿。')
}

async function onLearnDouyinHomepage() {
  const homepageUrl = benchmarkHomepageUrl.value.trim()
  if (!homepageUrl) {
    message.warning('请先粘贴抖音主页链接。')
    return
  }

  benchmarkLearning.value = true
  benchmarkLearningHint.value = ''
  try {
    const data = await learnDouyinHomepage({ homepageUrl })
    benchmarkProfile.value = data.profile
    benchmarkSamples.value = data.samples
    benchmarkIdeaSuggestions.value = data.ideaSuggestions
    benchmarkLearningHint.value = data.hint
    message.success(`已学习 ${data.profile.nickname} 的主页内容。`)
  } catch (e: unknown) {
    benchmarkLearningHint.value = describeHttpOrNetworkError(e)
    message.error(benchmarkLearningHint.value)
  } finally {
    benchmarkLearning.value = false
  }
}

function commitScriptForNextStep() {
  ensureStreamingScriptComplete()
  const text = draft.manualScriptDraft.trim()
  if (!text) {
    message.warning('请先整理一份可用文案。')
    return false
  }
  draft.commitManualScriptToPipeline()
  syncPublishCopyFromScript()
  return true
}

async function onOptimizeOralScript() {
  const sourceText = oralScriptSourceText.value.trim()
  if (!sourceText) {
    message.warning('请先完成转写，或先在文案框里准备好原始内容。')
    return
  }

  optimizingOralScript.value = true
  cancelStream()
  try {
    const result = await optimizeOralScript({
      sourceText,
      sourceVideoUrl: draft.videoUrl.trim() || undefined,
    })
    oralScriptPolish.value = result
    draft.manualScriptDraft = result.optimizedScript.trim()
    syncPublishCopyFromScript(true)
    await focusOutlineEditor()
    message.success(
      `已生成带 3 秒钩子和 10 秒钩子的口播文案（方案：${result.strategyLabel}）${
        result.llmUsed ? '' : '，当前为回退结果'
      }。`,
    )
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    optimizingOralScript.value = false
  }
}

function goPrev() {
  activeStep.value = Math.max(1, activeStep.value - 1)
}

function goNext() {
  if (activeStep.value === 1) {
    ensureStreamingScriptComplete()
  }
  if (activeStep.value === 2) {
    if (!selectedAvatarId.value) {
      message.warning('请先选择一个数字人视频。')
      return
    }
    if (!selectedVoiceId.value) {
      message.warning('请先选择一个配音音色。')
      return
    }
  }
  if (activeStep.value === 3 && generatedVideoCount.value <= 0) {
    message.warning('请先生成整段对口型视频，再进入自动发布。')
    return
  }
  activeStep.value = Math.min(4, activeStep.value + 1)
}

function jumpToStep(stepNo: number) {
  if (stepNo <= activeStep.value) {
    activeStep.value = stepNo
    return
  }
  while (activeStep.value < stepNo) {
    const before = activeStep.value
    goNext()
    if (activeStep.value === before) return
  }
}

async function onFetchVideoMeta() {
  const link = validateSourceVideoInput(draft.videoUrl)
  if (!link.ok || !link.normalizedUrl) {
    message.error(link.message ?? '请先填写可识别的视频链接。')
    return
  }
  draft.videoUrl = link.normalizedUrl

  loadingMeta.value = true
  try {
    const meta = await fetchVideoMeta({ sourceVideoUrl: link.normalizedUrl })
    draft.setVideoMeta(meta)
    rememberRecentExtraction(meta, link.normalizedUrl)
    if (!isDouyinNormalizedUrl(link.normalizedUrl)) {
      resetOralScriptPolish()
      draft.prefillManualScriptFromMeta(meta)
    }
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
    return
  } finally {
    loadingMeta.value = false
  }

  await nextTick()
  if (!isDouyinNormalizedUrl(link.normalizedUrl)) {
    message.success('已获取视频信息。')
    return
  }

  douyinPipeline.value = true
  pipelinePhase.value = 'download'
  pipelineProgress.value = 8
  pipelineBarProcessing.value = true
  try {
    const saved = await downloadSourceVideoFile({
      sourceVideoUrl: link.normalizedUrl,
      transcribe: false,
    })
    const basename = saved.savedPath.split(/[/\\]/).pop()?.trim() || null
    if (!basename) {
      message.error('未能识别服务端保存的视频文件名。')
      return
    }
    lastSavedVideoBasename.value = basename

    pipelinePhase.value = 'transcribe'
    pipelineProgress.value = 50
    const result = await transcribeSavedVideo({ fileName: basename })
    pipelineProgress.value = 100
    pipelineBarProcessing.value = false

    if (result.transcript) {
      resetOralScriptPolish()
      const applied = applySafeTranscriptToEditableScript({
        fullText: result.transcript.fullText,
        segments: result.transcript.segments,
        transcriptId: result.transcript.transcriptId,
      })
      if (applied) message.success('抖音视频已下载并完成文案转写。')
    }
    if (result.transcriptionError) {
      message.warning(result.transcriptionError)
    }
  } catch (e: unknown) {
    lastSavedVideoBasename.value = null
    message.warning(
      `视频下载或转写失败：${await describeHttpOrNetworkErrorMaybeBlob(e)}`,
    )
  } finally {
    douyinPipeline.value = false
    pipelinePhase.value = 'idle'
    pipelineProgress.value = 0
    pipelineBarProcessing.value = false
    void refreshDyCookieStatus()
    void refreshPipelineHealth()
  }
}

function onUseScript() {
  if (!commitScriptForNextStep()) return
  message.success(`已同步 ${draft.manualScriptDraft.trim().length} 字到下一步。`)
}

function onUseScriptAndNext() {
  ensureStreamingScriptComplete()
  if (draft.manualScriptDraft.trim()) {
    draft.commitManualScriptToPipeline()
    syncPublishCopyFromScript()
  }
  activeStep.value = 2
}

async function onRetranscribeFromLocal() {
  const name = lastSavedVideoBasename.value?.trim()
  if (!name) {
    message.warning('还没有可重转写的本地视频，请先完成一次抖音抓取。')
    return
  }
  retranscribingLocal.value = true
  try {
    const result = await transcribeSavedVideo({ fileName: name })
    if (result.transcript) {
      resetOralScriptPolish()
      const applied = applySafeTranscriptToEditableScript({
        fullText: result.transcript.fullText,
        segments: result.transcript.segments,
        transcriptId: result.transcript.transcriptId,
      })
      if (applied) message.success('已从本地保存视频重新生成文案。')
    }
    if (result.transcriptionError) {
      message.warning(result.transcriptionError)
    }
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    retranscribingLocal.value = false
  }
}

async function onTranscribeNonDouyinFromUrl() {
  const link = validateSourceVideoInput(draft.videoUrl)
  if (!link.ok || !link.normalizedUrl) {
    message.error(link.message ?? '请先填写可解析的视频链接。')
    return
  }
  transcribeUrlLoading.value = true
  try {
    const data = await transcribeFromUrl({ sourceVideoUrl: link.normalizedUrl })
    resetOralScriptPolish()
    const applied = applySafeTranscriptToEditableScript({
      fullText: data.fullText,
      segments: data.segments,
      transcriptId: data.transcriptId,
    })
    if (applied) message.success('当前链接内容已完成转写。')
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    transcribeUrlLoading.value = false
  }
}

function formatCueTime(ms: number) {
  const total = Math.max(0, Math.round(ms))
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const centiseconds = Math.floor((total % 1000) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(
    centiseconds,
  ).padStart(2, '0')}`
}

function subtitleTimelineSourceLabel(source: '' | 'asr-fallback' | 'local-estimate') {
  if (source === 'asr-fallback') return 'ASR 回填时间轴'
  if (source === 'local-estimate') return '本地估时'
  return '待生成'
}

function formatBenchmarkSampleDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return '近期发布'
  if (/^\d{10,13}$/.test(trimmed)) {
    const ms = trimmed.length === 13 ? Number(trimmed) : Number(trimmed) * 1000
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime())) {
      return `${date.getMonth() + 1}/${date.getDate()}`
    }
  }
  return trimmed
}

async function onGenerateSubtitlePreview() {
  ensureStreamingScriptComplete()
  const script = currentWorkflowScript.value
  if (!script) {
    message.warning(
      rawWorkflowScript.value
        ? '当前内容是系统占位提示，请先转写或填写真实口播文案。'
        : '请先在第一步整理好口播文案',
    )
    return
  }
  if (!selectedAvatarId.value) {
    message.warning('请先选择一个数字人视频')
    return
  }
  if (!selectedVoiceId.value) {
    message.warning('请先选择一个配音音色')
    return
  }
  if (!selectedSubtitleTemplateId.value) {
    message.warning('请先选择一个字幕模板')
    return
  }

  subtitleWorkflowPreviewLoading.value = true
  subtitleWorkflowHint.value = ''
  subtitleWorkflowDraftId.value = ''
  subtitleWorkflowPreviewUrl.value = null
  subtitleWorkflowFinalUrl.value = null
  subtitleWorkflowJson.value = null
  subtitleWorkflowTimelineSource.value = ''
  revokeGeneratedPreviewObjectUrls()

  try {
    const data = await createSubtitleWorkflowPreview({
      script,
      avatarResourceId: selectedAvatarId.value,
      voiceResourceId: selectedVoiceId.value,
      subtitleTemplateId: selectedSubtitleTemplateId.value,
      previewSeconds: 5,
      ...buildVoiceTuningPayload(),
    })
    subtitleWorkflowDraftId.value = data.draftId
    subtitleWorkflowJson.value = data.subtitleJson
    subtitleWorkflowTimelineSource.value = data.timelineSource
    subtitleWorkflowHint.value = data.hint
    subtitleWorkflowPreviewUrl.value = await resolveGeneratedPreviewVideoUrl(data.previewUrl)
    message.success('5 秒字幕预览已经生成，可以先确认后再出最终成片')
  } catch (e: unknown) {
    subtitleWorkflowHint.value = describeHttpOrNetworkError(e)
    message.error(subtitleWorkflowHint.value)
  } finally {
    subtitleWorkflowPreviewLoading.value = false
  }
}

async function onFinalizeSubtitleWorkflow() {
  if (!subtitleWorkflowDraftId.value) {
    message.warning('请先生成 5 秒预览，再确认输出最终视频')
    return
  }

  subtitleWorkflowFinalizeLoading.value = true
  try {
    const data = await finalizeSubtitleWorkflow({ draftId: subtitleWorkflowDraftId.value })
    subtitleWorkflowJson.value = data.subtitleJson
    subtitleWorkflowHint.value = data.hint
    subtitleWorkflowFinalUrl.value = await resolveGeneratedPreviewVideoUrl(data.videoUrl)
    message.success(data.fallback ? '已输出可预览成片（当前走了回退链路）' : '最终视频已输出')
  } catch (e: unknown) {
    subtitleWorkflowHint.value = describeHttpOrNetworkError(e)
    message.error(subtitleWorkflowHint.value)
  } finally {
    subtitleWorkflowFinalizeLoading.value = false
  }
}

watch(
  () => route.query.avatarId,
  (value) => {
    const next = typeof value === 'string' ? value.trim() : ''
    if (next && avatarOptions.value.some((item) => item.value === next)) {
      addAvatarToCurrentCreation(next, { silent: true })
      consumedRouteAvatarId.value = next
      if (activeStep.value < 2) activeStep.value = 2
    }
  },
)

watch(selectedAvatarCardItems, (items) => syncAvatarVideoCovers(items), { immediate: true })

watch(
  () => draft.manualScriptDraft,
  () => syncPublishCopyFromScript(),
)

watch(
  [
    () => selectedVoiceId.value,
    () => currentWorkflowScript.value,
    () => voiceSourceMode.value,
    () => selectedVoiceLanguage.value,
    () => selectedVoiceEmotion.value,
    () => selectedVoicePower.value,
    () => selectedVoiceRate.value,
    () => selectedVoiceVolume.value,
  ],
  () => resetVoicePreviewState(),
)

onMounted(() => {
  loadRecentExtractionRecords()
  clearInternalPipelineScriptDraft()
  void loadRenderResources()
  void refreshDyCookieStatus()
  void refreshPipelineHealth()
  syncPublishCopyFromScript(true)
})

onUnmounted(() => {
  clearVoicePreviewProgress()
  cancelStream()
  revokeGeneratedPreviewObjectUrls()
  clearAvatarCoverVideoUrls()
})
</script>

<template>
  <main class="video-create">
    <header class="create-topbar">
      <RouterLink :to="{ name: 'landing' }" class="back-link">‹ 返回首页</RouterLink>
      <ol class="stepper" aria-label="视频创作步骤">
        <li
          v-for="step in steps"
          :key="step.no"
          :class="['stepper__item', { 'stepper__item--active': step.no === activeStep }]"
          @click="jumpToStep(step.no)"
        >
          <span>{{ step.no }}</span>
          <strong>{{ step.title }}</strong>
        </li>
      </ol>
      <div class="topbar-progress">
        <n-text depth="3">{{ steps[activeStep - 1]?.desc }}</n-text>
      </div>
    </header>

    <Transition name="step-switch" mode="out-in">
      <section v-if="activeStep === 1" key="step-1" class="create-layout">
        <div class="main-board">
          <h1>第一步：搞定文案</h1>

          <div class="workspace">
            <section class="panel panel--input panel--source">
              <div class="source-switch">
                <button
                  type="button"
                  class="source-switch__item"
                  :class="{ 'source-switch__item--active': sourceMode === 'homepage' }"
                  @click="sourceMode = 'homepage'"
                >
                  <span class="source-switch__icon">主</span>
                  <strong>抖音主页</strong>
                </button>
                <button
                  type="button"
                  class="source-switch__item"
                  :class="{ 'source-switch__item--active': sourceMode === 'hotlink' }"
                  @click="sourceMode = 'hotlink'"
                >
                  <span class="source-switch__icon">链</span>
                  <strong>爆款链接</strong>
                </button>
              </div>

              <div v-if="sourceMode === 'homepage'" class="benchmark-pane">
                <div class="benchmark-input-row">
                  <n-input
                    v-model:value="benchmarkHomepageUrl"
                    size="medium"
                    clearable
                    placeholder="粘贴抖音主页链接，例如 https://www.douyin.com/user/xxx"
                  />
                  <n-button
                    type="primary"
                    class="gradient-btn benchmark-submit"
                    :loading="benchmarkLearning"
                    @click="onLearnDouyinHomepage"
                  >
                    学习该对标
                  </n-button>
                </div>

                <div class="benchmark-note-row">
                  <n-text depth="3" class="helper-text helper-text--inline">
                    粘贴抖音主页链接并点击学习后，系统会自动解析账号内容并将对标对象显示在下方。
                  </n-text>
                  <n-tag
                    v-if="dyCookieConfigured === true"
                    size="small"
                    type="success"
                    :bordered="false"
                  >
                    Cookie 已配置
                  </n-tag>
                  <n-tag
                    v-else-if="dyCookieConfigured === false"
                    size="small"
                    type="warning"
                    :bordered="false"
                  >
                    Cookie 未配置
                  </n-tag>
                </div>

                <n-alert
                  v-if="benchmarkLearningHint"
                  type="info"
                  :show-icon="false"
                  style="margin-top: 14px"
                >
                  {{ benchmarkLearningHint }}
                </n-alert>

                <div v-if="hasLearnedBenchmark && benchmarkProfile" class="benchmark-result">
                  <div class="benchmark-result__label">
                    <span class="benchmark-result__dot"></span>
                    <strong>已学习的对标对象 (1)</strong>
                  </div>

                  <button type="button" class="benchmark-card">
                    <img
                      v-if="benchmarkProfile.avatarUrl"
                      :src="benchmarkProfile.avatarUrl"
                      :alt="benchmarkProfile.nickname"
                      class="benchmark-card__avatar"
                    />
                    <div v-else class="benchmark-card__avatar benchmark-card__avatar--fallback">
                      {{ benchmarkProfile.nickname.slice(0, 1) }}
                    </div>

                    <div class="benchmark-card__body">
                      <div class="benchmark-card__title">
                        <n-tag size="small" :bordered="false" type="primary">抖音</n-tag>
                        <strong>{{ benchmarkProfile.nickname }}</strong>
                      </div>
                      <div class="benchmark-card__stats">
                        <span>{{ formatStatCount(benchmarkProfile.awemeCount) }} 作品</span>
                        <span>{{ formatStatCount(benchmarkProfile.followerCount) }} 粉丝</span>
                        <span>{{ formatStatCount(benchmarkProfile.totalFavorited) }} 获赞</span>
                      </div>
                      <p>{{ benchmarkProfile.signature }}</p>
                    </div>

                    <div class="benchmark-card__check">✓</div>
                  </button>

                  <div v-if="benchmarkSamples.length" class="benchmark-post-grid">
                    <article
                      v-for="sample in benchmarkSamples.slice(0, 3)"
                      :key="sample.awemeId"
                      class="benchmark-post"
                    >
                      <div class="benchmark-post__meta">
                        <strong>{{ sample.diggCount > 0 ? `${formatStatCount(sample.diggCount)} 点赞` : '近期作品' }}</strong>
                        <span>{{ formatBenchmarkSampleDate(sample.createdAt) }}</span>
                      </div>
                      <p>{{ sample.title }}</p>
                    </article>
                  </div>

                  <div class="benchmark-action-row">
                    <button
                      type="button"
                      class="idea-action idea-action--primary"
                      @click="applyBenchmarkIdeaDraft('ai')"
                    >
                      大脑生成选题
                    </button>
                    <button
                      type="button"
                      class="idea-action"
                      @click="applyBenchmarkIdeaDraft('custom')"
                    >
                      自定义选题
                    </button>
                  </div>
                </div>

                <div v-else class="benchmark-empty">
                  <strong>先学习一个抖音主页</strong>
                  <p>学完后这里会展示账号卡片、近期作品线索和选题入口。</p>
                </div>
              </div>

              <div v-else class="hotlink-pane">
                <div class="panel-head panel-head--subtle">
                  <span>爆款链接输入</span>
                  <n-tag size="small" :bordered="false" type="info">保留原链路</n-tag>
                </div>

                <VideoLinkInput v-model="draft.videoUrl" :invalid="urlInvalid" />

                <n-space align="center" :size="12" style="flex-wrap: wrap; margin-top: 14px">
                  <n-button
                    :disabled="!linkReady"
                    :loading="loadingMeta || douyinPipeline"
                    type="primary"
                    class="gradient-btn"
                    @click="onFetchVideoMeta"
                  >
                    提取文案
                  </n-button>
                  <n-tag
                    v-if="dyCookieConfigured === true"
                    size="small"
                    type="success"
                    :bordered="false"
                  >
                    抖音 Cookie 已配置
                  </n-tag>
                  <n-tag
                    v-else-if="dyCookieConfigured === false"
                    size="small"
                    type="warning"
                    :bordered="false"
                  >
                    抖音 Cookie 未配置
                  </n-tag>
                </n-space>

                <section class="recent-extract">
                  <div class="recent-extract__head">
                    <div>
                      <span>最近提取记录</span>
                      <strong>点击左侧视频预览复制链接</strong>
                    </div>
                    <n-tag size="small" :bordered="false" type="info">
                      {{ recentExtractionRecords.length ? `${recentExtractionRecords.length} 条` : '暂无记录' }}
                    </n-tag>
                  </div>

                  <div v-if="recentExtractionRecords.length" class="recent-extract__list">
                    <article
                      v-for="record in recentExtractionRecords"
                      :key="record.id"
                      class="recent-extract-card"
                    >
                      <button
                        type="button"
                        class="recent-extract-card__preview"
                        title="点击复制短视频链接"
                        @click="copyRecentExtractionLink(record)"
                      >
                        <video
                          v-if="record.videoUrl"
                          :src="record.videoUrl"
                          :poster="record.coverUrl || undefined"
                          muted
                          playsinline
                          preload="metadata"
                        ></video>
                        <img
                          v-else-if="record.coverUrl"
                          :src="record.coverUrl"
                          :alt="record.title"
                          loading="lazy"
                        />
                        <span v-else class="recent-extract-card__fallback">视频</span>
                        <i>复制</i>
                      </button>

                      <div class="recent-extract-card__body">
                        <div class="recent-extract-card__title">
                          <n-tag size="small" round :bordered="false" type="default">
                            {{ record.platform }}
                          </n-tag>
                          <strong>{{ record.title }}</strong>
                        </div>
                        <p>{{ record.summary }}</p>
                        <small>{{ formatRecentExtractionTime(record.extractedAt) }}</small>
                      </div>
                    </article>
                  </div>

                  <div v-else class="recent-extract__empty">
                    提取一次爆款链接后，这里会自动保存最近记录。
                  </div>
                </section>

                <n-text v-if="pipelineHealthError" depth="3" class="helper-text">
                  {{ pipelineHealthError }}
                </n-text>

                <div class="input-actions input-actions--triple">
                  <n-button
                    v-if="canTranscribeNonDouyinUrl"
                    block
                    secondary
                    :loading="transcribeUrlLoading"
                    @click="onTranscribeNonDouyinFromUrl"
                  >
                    从当前链接转写
                  </n-button>
                  <n-button
                    v-if="lastSavedVideoBasename"
                    block
                    secondary
                    :loading="retranscribingLocal"
                    @click="onRetranscribeFromLocal"
                  >
                    从本地保存视频重转写
                  </n-button>
                </div>

                <template v-if="douyinPipeline">
                  <n-progress
                    type="line"
                    :percentage="pipelineProgress"
                    :processing="pipelineBarProcessing"
                    indicator-placement="inside"
                    style="margin-top: 18px"
                  />
                  <n-text depth="3" class="helper-text">{{ pipelineStatusLabel }}</n-text>
                </template>

                <template v-if="draft.videoMeta">
                  <n-alert
                    v-if="draft.videoMeta.warnings.length"
                    type="warning"
                    :show-icon="false"
                    style="margin-top: 18px"
                  >
                    <div v-for="(warning, index) in draft.videoMeta.warnings" :key="index">
                      {{ warning }}
                    </div>
                  </n-alert>

                  <div class="meta-board">
                    <div class="meta-board__header">
                      <div>
                        <span class="meta-board__eyebrow">获取信息</span>
                        <strong>视频基础内容</strong>
                      </div>
                      <n-tag size="small" round :bordered="false" type="success">已解析</n-tag>
                    </div>

                    <div class="meta-board__summary">
                      <div class="meta-chip meta-chip--title">
                        <span>标题</span>
                        <strong>{{ draft.videoMeta.title || '暂无标题' }}</strong>
                      </div>
                      <div class="meta-chip">
                        <span>点赞</span>
                        <strong>{{ formatStatCount(draft.videoMeta.likeCount) }}</strong>
                      </div>
                    </div>

                    <div class="meta-section">
                      <span>内容</span>
                      <p>{{ draft.videoMeta.content || draft.videoMeta.description || '暂无可解析内容' }}</p>
                    </div>

                    <div class="meta-section meta-section--tags">
                      <span>标签</span>
                      <div v-if="draft.videoMeta.tags?.length" class="meta-tag-list">
                        <n-tag
                          v-for="(tag, index) in (draft.videoMeta.tags ?? []).slice(0, 8)"
                          :key="`${tag}-${index}`"
                          size="small"
                          round
                          :bordered="false"
                        >
                          #{{ tag.replace(/^#/, '') }}
                        </n-tag>
                      </div>
                      <p v-else class="meta-empty">暂无标签</p>
                    </div>
                  </div>
                </template>
              </div>
            </section>

            <section class="panel panel--outline">
              <div class="panel-head panel-head--between">
                <span>文案工作区</span>
                <n-space :size="8">
                  <n-button text type="primary" size="small" @click="onUseScript">先保存文案</n-button>
                  <n-button text type="primary" size="small" @click="onUseScriptAndNext">
                    保存并进入下一步
                  </n-button>
                </n-space>
              </div>

              <n-text depth="3" class="helper-text helper-text--top">
                {{ scriptBlockHint }}
              </n-text>
              <n-text
                v-if="isStreamingToScript"
                depth="3"
                class="helper-text helper-text--accent"
              >
                正在流式写入口播文案，点一下输入框会立刻补全全文。
              </n-text>

              <div v-if="oralScriptPolish" class="hook-preview">
                <div class="hook-preview__item">
                  <span>3s 钩子</span>
                  <strong>{{ oralScriptPolish.hook3s }}</strong>
                </div>
                <div class="hook-preview__item">
                  <span>10s 钩子</span>
                  <strong>{{ oralScriptPolish.hook10s }}</strong>
                </div>
              </div>

              <n-input
                v-model:value="draft.manualScriptDraft"
                type="textarea"
                class="outline-editor"
                :autosize="{ minRows: 14 }"
                :maxlength="50000"
                show-count
                placeholder="在这里整理、改写并确认你要驱动配音的视频文案…"
                @click="interruptStreamWithFullText"
              />

              <div class="outline-footer">
                <n-text depth="3">READY TO CREATE</n-text>
                <n-space :size="12">
                  <n-button
                    class="blue-btn"
                    type="primary"
                    :loading="optimizingOralScript"
                    :disabled="!oralScriptSourceText"
                    @click="onOptimizeOralScript"
                  >
                    转写口播文案
                  </n-button>
                  <n-button class="gradient-btn" type="primary" @click="onUseScriptAndNext">
                    锁定文案
                  </n-button>
                </n-space>
              </div>
            </section>
          </div>
        </div>

        <aside class="script-side">
          <div class="script-side__head">
            <div>
              <n-text strong>文案生成结果</n-text>
              <p>按句意自动分段</p>
            </div>
            <n-space size="small">
              <n-tag size="small" :bordered="false" type="info">
                {{ extractedScriptLines.length ? `${extractedScriptLines.length} 段` : '等待转写' }}
              </n-tag>
            </n-space>
          </div>

          <ol v-if="extractedScriptLines.length" class="script-list">
            <li v-for="(line, idx) in extractedScriptLines" :key="`${idx}-${line}`">
              <span>{{ idx + 1 }}</span>
              <p>{{ line }}</p>
            </li>
          </ol>
          <div v-else class="empty-side">
            <strong>还没有可用文案</strong>
            <p>先抓取视频链接，或上传一段音视频来完成转写。</p>
          </div>
          <div v-if="oralScriptPolish" class="hook-side-card">
            <div class="hook-side-card__head">
              <strong>口播优化结果</strong>
              <n-space size="small">
                <n-tag size="small" :bordered="false" type="success">已生成</n-tag>
                <n-tag size="small" :bordered="false" :type="oralScriptPolish.llmUsed ? 'info' : 'warning'">
                  {{ oralScriptPolish.strategyLabel }}
                </n-tag>
              </n-space>
            </div>
            <div class="hook-side-card__block">
              <span>3s 钩子</span>
              <p>{{ oralScriptPolish.hook3s }}</p>
            </div>
            <div class="hook-side-card__block">
              <span>10s 钩子</span>
              <p>{{ oralScriptPolish.hook10s }}</p>
            </div>
          </div>
        </aside>
      </section>

      <section v-else-if="activeStep === 2" key="step-2" class="step-two-layout">
        <div class="step-two-head">
          <h1>第二步：数字人对口型</h1>
          <p>把文案、克隆声音、数字人视频放在同一屏确认，先试听再进入成片。</p>
        </div>

        <div class="step-two-workbench">
          <section class="panel step-two-script-panel">
            <div class="step-two-block-head">
              <div class="step-two-block-head__main">
                <span class="step-two-block-icon">T</span>
                <div>
                  <strong>口播文案</strong>
                  <p>可手动修改</p>
                </div>
              </div>
              <n-tag size="small" :bordered="false" type="info">
                {{ extractedScriptLines.length ? `${extractedScriptLines.length} 段` : '等待文案' }}
              </n-tag>
            </div>

            <div class="step-two-script-meta">
              <span>文案预览</span>
              <strong>{{ currentWorkflowScript.length }} / 50000</strong>
            </div>

            <div v-if="extractedScriptLines.length" class="step-two-script-frame">
              <div class="step-two-script-scroll">
                <ol class="step-two-script-list">
                <li
                  v-for="(line, idx) in extractedScriptLines"
                  :key="`${idx}-${line}`"
                  class="step-two-script-line"
                >
                  <span>{{ String(idx + 1).padStart(2, '0') }}</span>
                  <p>{{ line }}</p>
                </li>
                </ol>
              </div>
            </div>
            <div v-else class="step-two-script-frame step-two-script-frame--empty">
              <div class="empty-block empty-block--embedded">
              <strong>还没有可承接的文案</strong>
              <p>先回到第一步抓取或整理一份口播文案。</p>
              </div>
            </div>

            <div v-if="oralScriptPolish" class="step-two-hook-row">
              <article class="step-two-hook-card">
                <span>3s 钩子</span>
                <strong>{{ oralScriptPolish.hook3s }}</strong>
              </article>
              <article class="step-two-hook-card">
                <span>10s 钩子</span>
                <strong>{{ oralScriptPolish.hook10s }}</strong>
              </article>
            </div>

            <div class="step-two-footnote">
              <span>当前文案会直接用于 TTS、对口型和字幕时间轴。</span>
              <n-button text type="primary" @click="jumpToStep(1)">返回第一步修改</n-button>
            </div>
          </section>

          <section class="panel step-two-voice-panel">
            <div class="step-two-block-head">
              <div class="step-two-block-head__main">
                <span class="step-two-block-icon step-two-block-icon--voice">声</span>
                <div>
                  <strong>配音设置</strong>
                  <p>选择声音来源</p>
                </div>
              </div>
              <n-space size="small">
                <n-button secondary type="primary" size="small" @click="cloneVoiceOpen = true">
                  + 声音克隆
                </n-button>
                <n-button quaternary type="primary" size="small" @click="goToResourceLibrary('voices')">
                  音色库
                </n-button>
              </n-space>
            </div>

            <div class="voice-source-switch">
              <button
                type="button"
                class="voice-source-switch__item"
                :class="{ 'voice-source-switch__item--active': voiceSourceMode === 'tts' }"
                @click="voiceSourceMode = 'tts'"
              >
                文本转语音
              </button>
              <button
                type="button"
                class="voice-source-switch__item"
                :class="{ 'voice-source-switch__item--active': voiceSourceMode === 'local' }"
                @click="voiceSourceMode = 'local'"
              >
                本地语音
              </button>
            </div>

            <template v-if="voiceSourceMode === 'tts'">
              <div ref="voiceShellRef" class="step-two-voice-shell">
                <div class="step-two-control-grid">
                <article class="step-two-control-card">
                  <span>选择音色</span>
                  <div class="step-two-control-card__main">
                    <button
                      v-if="selectedVoiceResource?.audioUrl"
                      type="button"
                      class="voice-sample-play"
                      @click="
                        toggleAudioPlayback(
                          `voice-sample:${selectedVoiceResource?.id ?? ''}`,
                          resolveProtectedMediaUrl(selectedVoiceResource?.audioUrl ?? ''),
                        )
                      "
                    >
                      {{ audioPlayingId === `voice-sample:${selectedVoiceResource?.id ?? ''}` ? '停' : '播' }}
                    </button>
                    <n-select
                      v-model:value="selectedVoiceId"
                      :options="voiceOptions"
                      :loading="renderResourceLoading"
                      placeholder="选择一个克隆音色"
                    />
                  </div>
                  <small>{{ selectedVoiceResource?.owner === 'mine' ? '我的克隆音色' : '推荐音色' }}</small>
                </article>

                <article class="step-two-control-card">
                  <span>选择语言</span>
                  <div class="step-two-control-card__main">
                    <n-select
                      v-model:value="selectedVoiceLanguage"
                      :options="voiceLanguageOptions"
                      placeholder="选择语言"
                    />
                  </div>
                  <small>当前只影响配音配置，不会改动原文案。</small>
                </article>

                <article class="step-two-control-card">
                  <span>情绪</span>
                  <div class="step-two-control-card__main">
                    <n-select
                      v-model:value="selectedVoiceEmotion"
                      :options="voiceEmotionOptions"
                      placeholder="选择情绪"
                    />
                  </div>
                  <small>建议和数字人口型风格保持一致。</small>
                </article>

                <article class="step-two-control-card">
                  <span>强度</span>
                  <div class="voice-power-stepper">
                    <button type="button" @click="nudgeVoicePower(-0.03)">-</button>
                    <strong>{{ selectedVoicePower.toFixed(2) }}</strong>
                    <button type="button" @click="nudgeVoicePower(0.03)">+</button>
                  </div>
                  <small>更高的强度会让播报更有存在感。</small>
                </article>
              </div>

              <div class="step-two-slider-grid">
                <article class="step-two-slider-card">
                  <div class="step-two-slider-card__head">
                    <span>语速调节</span>
                    <strong>{{ selectedVoiceRate.toFixed(2) }}</strong>
                  </div>
                  <n-slider v-model:value="selectedVoiceRate" :min="0.8" :max="1.4" :step="0.01" />
                </article>
                <article class="step-two-slider-card">
                  <div class="step-two-slider-card__head">
                    <span>音量调节</span>
                    <strong>{{ selectedVoiceVolume.toFixed(2) }}</strong>
                  </div>
                  <n-slider v-model:value="selectedVoiceVolume" :min="0.6" :max="1.4" :step="0.01" />
                </article>
              </div>

              <n-alert
                v-if="!hasVoiceOptions"
                class="step-two-inline-alert"
                type="warning"
                :show-icon="false"
              >
                还没有可用的克隆音色，先上传一段样本音频，我会自动刷新当前列表。
              </n-alert>

              <n-alert
                v-else-if="selectedVoiceResource?.cloneStatus !== 'ready'"
                class="step-two-inline-alert"
                type="info"
                :show-icon="false"
              >
                当前音色还在处理中，准备好之后就能直接试听和生成。
              </n-alert>

              <button
                type="button"
                class="step-two-primary-btn"
                :disabled="!voiceReadyForPreview || voicePreviewLoading"
                @click="onGenerateVoicePreview"
              >
                {{ voicePreviewLoading ? '正在生成音频...' : '生成音频' }}
              </button>

              <Transition name="voice-progress">
                <article
                  v-if="voicePreviewLoading || voicePreviewProgress > 0"
                  class="voice-generate-progress"
                  :class="{ 'voice-generate-progress--done': voicePreviewProgress >= 100 }"
                >
                  <div class="voice-generate-progress__head">
                    <span>生成进度</span>
                    <strong>{{ Math.round(voicePreviewProgress) }}%</strong>
                  </div>
                  <div class="voice-generate-progress__bar">
                    <i :style="{ width: `${voicePreviewProgress}%` }"></i>
                  </div>
                  <p>{{ voicePreviewProgressLabel }}</p>
                </article>
              </Transition>

              <article
                v-if="voicePreviewUrl"
                class="voice-preview-card"
                :class="{ 'voice-preview-card--ready': Boolean(voicePreviewUrl) }"
              >
                <div class="voice-preview-card__head">
                  <div>
                    <strong>试听音频已生成</strong>
                    <p>
                      {{
                        voicePreviewHint ||
                        (voicePreviewMode === 'mock'
                          ? '当前返回的是联调用预览音频。'
                          : '可以先试听这段配音，确认声音后再进入对口型。')
                      }}
                    </p>
                  </div>
                  <n-tag
                    v-if="voicePreviewMode"
                    size="small"
                    :bordered="false"
                    :type="voicePreviewMode === 'provider' ? 'success' : 'warning'"
                  >
                    {{ voicePreviewMode === 'provider' ? 'RESULT' : 'MOCK' }}
                  </n-tag>
                </div>

                <div class="voice-preview-card__player">
                  <button
                    type="button"
                    class="voice-preview-card__play"
                    @click="toggleAudioPlayback('voice-preview', resolveProtectedMediaUrl(voicePreviewUrl))"
                  >
                    {{ audioPlayingId === 'voice-preview' ? '暂停' : '试听' }}
                  </button>
                  <div>
                    <strong>{{ selectedVoiceLabel }}</strong>
                    <p>{{ formatSecondsClock(voicePreviewDurationSeconds) }}</p>
                  </div>
                  <n-button quaternary size="small" type="primary" @click="onDownloadVoicePreview">
                    下载
                  </n-button>
                </div>
              </article>
              </div>
            </template>

            <div v-else class="voice-local-pane step-two-voice-shell">
              <n-alert type="info" :show-icon="false">
                本地语音模式用于直接管理你上传的克隆样本，选中的声音会继续参与后面的对口型生成。
              </n-alert>
              <div class="step-two-control-grid">
                <article class="step-two-control-card">
                  <span>当前克隆声音</span>
                  <div class="step-two-control-card__main">
                    <n-select
                      v-model:value="selectedVoiceId"
                      :options="voiceOptions"
                      :loading="renderResourceLoading"
                      placeholder="选择一个本地克隆声音"
                    />
                  </div>
                  <small>{{ selectedVoiceLabel }}</small>
                </article>
              </div>
              <div class="step-two-footnote">
                <span>如果样本还没上传，可以直接从这里继续补充。</span>
                <n-button text type="primary" @click="cloneVoiceOpen = true">添加克隆样本</n-button>
              </div>
            </div>
          </section>

          <section class="panel step-two-avatar-panel">
            <div class="step-two-block-head">
              <div class="step-two-block-head__main">
                <span class="step-two-block-icon step-two-block-icon--avatar">人</span>
                <div>
                  <strong>选数字人</strong>
                  <p>最多选 7 位</p>
                </div>
              </div>
              <n-space size="small">
                <n-button secondary type="primary" size="small" @click="createAvatarOpen = true">
                  + 新建数字人
                </n-button>
                <n-button quaternary type="primary" size="small" @click="onProceedFromStepTwo">
                  口型绑定
                </n-button>
              </n-space>
            </div>

            <div v-if="hasSelectedAvatarCards" class="avatar-strip avatar-strip--filled">
              <button type="button" class="avatar-add-card avatar-add-card--compact" @click="createAvatarOpen = true">
                <strong>+</strong>
                <span>添加</span>
              </button>

              <div
                v-for="item in selectedAvatarCardItems"
                :key="item.id"
                class="avatar-select-card"
                :class="{ 'avatar-select-card--active': selectedAvatarId === item.id }"
                role="button"
                tabindex="0"
                :aria-pressed="selectedAvatarId === item.id"
                @click="selectAvatarForCurrentCreation(item.id)"
                @keydown.enter.prevent="selectAvatarForCurrentCreation(item.id)"
                @keydown.space.prevent="selectAvatarForCurrentCreation(item.id)"
              >
                <button
                  type="button"
                  class="avatar-select-card__remove"
                  aria-label="移除数字人"
                  @click.stop="removeAvatarFromCurrentCreation(item.id)"
                >
                  ×
                </button>
                <img
                  v-if="resolveAvatarCoverImageUrl(item)"
                  class="avatar-select-card__image"
                  :src="resolveAvatarCoverImageUrl(item)"
                  :alt="item.name"
                />
                <video
                  v-else-if="resolveAvatarCoverVideoUrl(item)"
                  class="avatar-select-card__video"
                  :src="resolveAvatarCoverVideoUrl(item)"
                  muted
                  playsinline
                  preload="metadata"
                />
                <div v-else class="avatar-select-card__placeholder">{{ item.name.slice(0, 1) }}</div>
                <strong class="avatar-select-card__name">{{ item.name }}</strong>
              </div>
            </div>
            <div v-else class="avatar-empty-state">
              <button type="button" class="avatar-add-card avatar-add-card--empty" @click="createAvatarOpen = true">
                <strong>+</strong>
                <span>添加</span>
              </button>
              <p class="avatar-empty-state__hint">
                当前创作还没有添加数字人，点击添加可从服务器视频创建一条出镜素材。
              </p>
            </div>

            <n-alert
              v-if="false"
              class="step-two-inline-alert"
              type="warning"
              :show-icon="false"
            >
              当前还没有已上传的视频数字人，先直接在这里添加一条出镜视频即可。
            </n-alert>

            <n-alert
              v-if="requestedAvatarUnavailable && hasAvatarOptions"
              class="step-two-inline-alert"
              type="info"
              :show-icon="false"
            >
              你从资源库带过来的数字人暂时不可用，我先帮你落回了当前可用的视频素材。
            </n-alert>

            <article class="lip-sync-setup-card">
              <div class="lip-sync-setup-card__tabs">
                <button
                  type="button"
                  class="lip-sync-setup-card__tab"
                  :class="{ 'lip-sync-setup-card__tab--active': renderModelChoice === 'new' }"
                  @click="renderModelChoice = 'new'"
                >
                  <strong>新锐模型</strong>
                  <span>速度快 · 效果自然</span>
                </button>
                <button
                  type="button"
                  class="lip-sync-setup-card__tab"
                  :class="{ 'lip-sync-setup-card__tab--active': renderModelChoice === 'classic' }"
                  @click="renderModelChoice = 'classic'"
                >
                  <strong>经典模型</strong>
                  <span>画面细腻 · 稳定性佳</span>
                </button>
              </div>

              <div class="lip-sync-setup-card__resolution">
                <span>生成画质</span>
                <div>
                  <button
                    type="button"
                    class="resolution-chip"
                    :class="{ 'resolution-chip--active': renderResolutionChoice === '1080p' }"
                    @click="renderResolutionChoice = '1080p'"
                  >
                    1080P 极速·推荐
                  </button>
                  <button
                    type="button"
                    class="resolution-chip"
                    :class="{ 'resolution-chip--active': renderResolutionChoice === '2k' }"
                    @click="renderResolutionChoice = '2k'"
                  >
                    2k 超清
                  </button>
                </div>
              </div>

              <div class="lip-sync-setup-card__summary">
                <div class="summary-pill">
                  <span>已选数字人</span>
                  <strong>{{ selectedAvatarLabel }}</strong>
                </div>
                <div class="summary-pill">
                  <span>已选声音</span>
                  <strong>{{ selectedVoiceLabel }}</strong>
                </div>
                <div class="summary-pill">
                  <span>字幕模板</span>
                  <strong>{{ selectedSubtitleTemplateLabel }}</strong>
                </div>
              </div>

              <button
                type="button"
                class="step-two-primary-btn step-two-primary-btn--video"
                :disabled="!selectedAvatarId || !selectedVoiceId"
                @click="onProceedFromStepTwo"
              >
                立即生成口播视频
              </button>

              <button type="button" class="step-two-ghost-btn" @click="jumpToStep(3)">
                查看结果
              </button>
            </article>
          </section>
        </div>
      </section>

      <section v-else-if="activeStep === 3" key="step-3" class="edit-layout">
        <div class="edit-main">
          <h1>第三步：一键成片</h1>

          <section class="panel asset-card">
            <div class="section-title">
              <span class="title-icon">设</span>
              <div>
                <strong>生成参数</strong>
                <p>确认完整文案和素材来源</p>
              </div>
            </div>

            <div class="summary-stack step-three-summary">
              <div class="summary-pill">
                <span>数字人</span>
                <strong class="compact-label" :title="selectedAvatarLabel">{{ selectedAvatarLabel }}</strong>
              </div>
              <div class="summary-pill">
                <span>音色</span>
                <strong class="compact-label" :title="selectedVoiceLabel">{{ selectedVoiceLabel }}</strong>
              </div>
              <div class="summary-pill">
                <span>字幕模板</span>
                <strong>{{ selectedSubtitleTemplateLabel }}</strong>
              </div>
            </div>

            <div class="workflow-action-card">
              <div
                class="workflow-progress-card"
                :style="{ '--workflow-percent': `${workflowProgressState.percent}%` }"
                :class="{
                  'workflow-progress-card--running':
                    subtitleWorkflowPreviewLoading || subtitleWorkflowFinalizeLoading,
                  'workflow-progress-card--done': Boolean(subtitleWorkflowFinalUrl),
                }"
              >
                <div class="workflow-progress-card__head">
                  <div>
                    <span>成片进度</span>
                    <strong>{{ workflowProgressState.status }}</strong>
                    <p>{{ workflowProgressState.hint }}</p>
                  </div>
                  <b>{{ workflowProgressState.percent }}%</b>
                </div>
                <div class="workflow-progress-track">
                  <i :style="{ width: `${workflowProgressState.percent}%` }"></i>
                </div>
                <ol class="workflow-progress-steps">
                  <li
                    v-for="(step, index) in workflowSimpleSteps"
                    :key="step.label"
                    :class="`is-${step.status}`"
                  >
                    <b>{{ step.status === 'done' ? '✓' : index + 1 }}</b>
                    <div>
                      <strong>{{ step.label }}</strong>
                    </div>
                  </li>
                </ol>
              </div>
              <div class="segment-count-bar">
                <n-text depth="3">当前链路：TTS → subtitle.json → 5 秒预览 → 对口型 → 最终合成</n-text>
                <n-tag size="small" :bordered="false" type="info">
                  {{ subtitleTimelineSourceLabel(subtitleWorkflowTimelineSource) }}
                </n-tag>
              </div>
              <div class="input-actions input-actions--triple">
                <n-button block secondary @click="jumpToStep(2)">返回检查素材</n-button>
                <n-button
                  block
                  type="primary"
                  class="gradient-btn"
                  :disabled="
                    !currentWorkflowScript ||
                    !selectedAvatarId ||
                    !selectedVoiceId ||
                    !selectedSubtitleTemplateId ||
                    subtitleWorkflowPreviewLoading
                  "
                  :loading="subtitleWorkflowPreviewLoading"
                  @click="onGenerateSubtitlePreview"
                >
                  生成 5 秒预览
                </n-button>
                <n-button
                  block
                  secondary
                  type="primary"
                  :disabled="!subtitleWorkflowDraftId || subtitleWorkflowFinalizeLoading"
                  :loading="subtitleWorkflowFinalizeLoading"
                  @click="onFinalizeSubtitleWorkflow"
                >
                  确认并输出最终视频
                </n-button>
              </div>
              <n-text depth="3" class="helper-text workflow-helper-note">
                这条流程会先生成 TTS，再回填时间轴并生成 subtitle.json；确认 5 秒预览后再输出最终成片。
              </n-text>
            </div>
          </section>

          <section class="edit-options step-three-checks">
            <div
              class="switch-row switch-row--card status-check"
              :class="currentWorkflowScript ? 'status-check--ok' : 'status-check--fail'"
            >
              <span>文案</span>
              <b aria-label="文案就绪状态">{{ currentWorkflowScript ? '✓' : '×' }}</b>
            </div>
            <div class="switch-row switch-row--card status-check">
              <span>数字人视频</span>
              <b class="compact-label" :title="selectedAvatarLabel">{{ selectedAvatarLabel }}</b>
            </div>
            <div class="switch-row switch-row--card status-check">
              <span>音色驱动</span>
              <b class="compact-label" :title="selectedVoiceLabel">{{ selectedVoiceLabel }}</b>
            </div>
          </section>
        </div>

        <section class="panel subtitle-panel">
          <div class="section-title section-title--between">
            <div class="section-title__main">
              <span class="title-icon">文</span>
              <div>
                <strong>整段文案</strong>
                <p>直接使用第一步确认的完整口播稿</p>
              </div>
            </div>
            <n-tag size="small" :bordered="false">{{ currentWorkflowScript.length }} 字</n-tag>
          </div>

          <div class="full-script-preview" :class="{ 'full-script-preview--empty': !currentWorkflowScript }">
            <span>{{ currentWorkflowScript ? '当前整段口播' : '等待文案' }}</span>
            <p>
              {{ currentWorkflowScript || '请先在第一步抓取、转写或手动整理一份口播文案，这里会直接使用整段文案进入 TTS、字幕和对口型流程。' }}
            </p>
          </div>

          <div v-if="subtitleWorkflowJson" class="workflow-preview-stack">
            <div class="summary-card">
              <div>
                <strong>subtitle.json 已生成</strong>
                <p>{{ subtitleWorkflowJson.cues.length }} 条字幕 · {{ selectedSubtitleTemplateLabel }}</p>
              </div>
              <n-tag size="small" :bordered="false" type="success">
                {{ subtitleTimelineSourceLabel(subtitleWorkflowTimelineSource) }}
              </n-tag>
            </div>

            <div class="subtitle-table-head">
              <span>时间轴</span>
              <span>口播文案</span>
            </div>
            <ol class="subtitle-list subtitle-table">
              <li v-for="cue in subtitleWorkflowJson.cues" :key="cue.id">
                <span>{{ formatCueTime(cue.startMs) }} - {{ formatCueTime(cue.endMs) }}</span>
                <p>{{ cue.text }}</p>
              </li>
            </ol>

            <n-alert v-if="subtitleWorkflowHint" type="info" :show-icon="false">
              {{ subtitleWorkflowHint }}
            </n-alert>

            <div v-if="subtitleWorkflowPreviewUrl" class="video-preview-wrap">
              <video
                class="video-preview"
                controls
                playsinline
                preload="metadata"
                :src="subtitleWorkflowPreviewUrl ?? undefined"
              />
            </div>

            <div v-if="subtitleWorkflowFinalUrl" class="video-preview-wrap">
              <video
                class="video-preview"
                controls
                playsinline
                preload="metadata"
                :src="subtitleWorkflowFinalUrl ?? undefined"
              />
            </div>
          </div>
          <div v-else class="empty-block">
            <strong>先生成 5 秒字幕预览</strong>
            <p>这里会展示整段文案生成的 subtitle.json 断句和预览视频，确认后再输出最终成片。</p>
          </div>
        </section>

        <aside class="preview-side">
          <div class="preview-head">
            <n-text strong>生成预览</n-text>
            <n-tag size="small" :bordered="false" type="info">
              {{ generatedVideoCount ? '已生成' : '待生成' }}
            </n-tag>
          </div>
          <div class="phone-preview">
            <div v-if="firstReadyVideoUrl" class="phone-face phone-face--video">
              <video :src="firstReadyVideoUrl" controls playsinline preload="metadata" />
            </div>
            <div v-else class="phone-face">
              <span>生成后会在这里显示整段预览视频</span>
            </div>
          </div>
        </aside>
      </section>

      <section v-else key="step-4" class="publish-layout">
        <div class="publish-left">
          <section class="publish-hero">
            <h1>第四步：自动发布</h1>
            <p>先把四步流程排完整，发布账号与计划沿用对标页结构，便于后续继续接入。</p>
            <div class="publish-stats">
              <div><strong>{{ generatedVideoCount }}</strong><span>已生成成片</span></div>
              <div><strong>{{ publishPlatforms.length }}</strong><span>预设平台</span></div>
              <div><strong>0</strong><span>已连接账号</span></div>
            </div>
          </section>

          <section class="panel copy-card">
            <div class="section-title section-title--between">
              <div class="section-title__main">
                <span class="title-icon">文</span>
                <div>
                  <strong>发布文案</strong>
                  <p>可直接沿用第三步成片结果</p>
                </div>
              </div>
              <n-space size="small">
                <n-button text size="small" @click="syncPublishCopyFromScript(true)">同步文案</n-button>
                <n-button text size="small" @click="jumpToStep(3)">返回成片</n-button>
              </n-space>
            </div>
            <n-input
              v-model:value="publishCopy"
              type="textarea"
              :autosize="{ minRows: 5 }"
              class="publish-copy"
              @update:value="publishCopyTouched = true"
            />
            <div class="cover-row">
              <div class="cover-thumb">封面</div>
              <div>
                <strong>当前视频摘要</strong>
                <p>数字人：{{ selectedAvatarLabel }} · 音色：{{ selectedVoiceLabel }}</p>
              </div>
            </div>
            <div class="publish-result-list">
              <div v-for="item in publishReadyItems" :key="item.index" class="publish-result-item">
                <strong>整段成片</strong>
                <p>{{ item.text || '已生成可发布视频' }}</p>
              </div>
              <div v-if="!publishReadyItems.length" class="plan-empty">
                先回到第三步生成整段对口型视频。
              </div>
            </div>
          </section>
        </div>

        <div class="publish-center">
          <section class="panel platform-card">
            <div class="section-title section-title--between">
              <strong>发布平台</strong>
              <n-button text type="primary" size="small" disabled>+ 绑定账号</n-button>
            </div>
            <div class="platform-list">
              <div v-for="platform in publishPlatforms" :key="platform.name" class="platform-item">
                <span>{{ platform.icon }}</span>
                <div>
                  <strong>{{ platform.name }}</strong>
                  <p>{{ platform.account }} · 待接入发布账号</p>
                </div>
                <n-button size="tiny" disabled>待接入</n-button>
              </div>
            </div>
          </section>

          <section class="panel schedule-card">
            <div class="section-title">
              <span class="title-icon">时</span>
              <div>
                <strong>发布计划</strong>
                <p>这一层先保留对标页节奏，后续再接真正的账号发布能力</p>
              </div>
            </div>
            <div class="schedule-options">
              <button class="active" type="button">立即发布</button>
              <button type="button">定时发布</button>
            </div>
            <n-button block disabled class="publish-btn">
              立即发布至 0 个平台 / 0 个账号
            </n-button>
            <div class="plan-empty">发布账号模块待接入</div>
          </section>
        </div>

        <aside class="preview-side preview-side--publish">
          <div class="preview-head">
            <n-text strong>发布预览</n-text>
            <n-tag size="small" :bordered="false" type="success" v-if="firstReadyVideoUrl">
              可预览
            </n-tag>
          </div>
          <div class="phone-preview phone-preview--final">
            <div v-if="firstReadyVideoUrl" class="phone-face phone-face--video">
              <video :src="firstReadyVideoUrl" controls playsinline preload="metadata" />
            </div>
            <div v-else class="phone-face phone-face--poster">
              <strong>自动发布</strong>
              <span>等第三步先出片，这里就会承接最终结果。</span>
            </div>
          </div>
        </aside>
      </section>
    </Transition>

    <NewAvatarModal
      v-model:show="createAvatarOpen"
      :loading="creatingAvatar"
      @submit="createAvatarFromStudio"
    />
    <VoiceCloneModal
      v-model:show="cloneVoiceOpen"
      :loading="cloningVoice"
      @submit="cloneVoiceFromStudio"
    />

    <footer class="create-footer">
      <div class="footer-progress">
        <n-text depth="3">创作进度</n-text>
        <strong>{{ progressText }}</strong>
        <n-progress type="line" :percentage="progressPercent" :show-indicator="false" />
      </div>
      <n-space>
        <n-button v-if="activeStep > 1" size="large" quaternary @click="goPrev">上一步</n-button>
        <n-button
          class="next-btn"
          size="large"
          :disabled="activeStep >= 4"
          @click="goNext"
        >
          {{ footerNextLabel }}
        </n-button>
      </n-space>
    </footer>
  </main>
</template>

<style scoped>
.video-create {
  /* 创作流统一缩放：随视口变窄自动收紧，避免撑出右侧工作区 */
  --vc-pad-y: clamp(8px, 1.2vw, 14px);
  --vc-pad-x: clamp(12px, 1.6vw, 20px);
  --vc-gap: clamp(10px, 1.2vw, 15px);
  --vc-gap-lg: clamp(12px, 1.05vw, 18px);
  --vc-panel-pad: clamp(10px, 1.05vw, 14px);
  --vc-radius: clamp(12px, 0.95vw, 16px);
  --vc-h1: clamp(17px, 0.75vw + 14px, 20px);
  --vc-aside-w: min(100%, clamp(200px, 24vw, 252px));
  --vc-scrollbar-size: 8px;
  --vc-scrollbar-thumb: rgba(75, 107, 255, 0.28);
  --vc-scrollbar-thumb-hover: rgba(75, 107, 255, 0.48);
  --vc-scrollbar-track: rgba(226, 233, 248, 0.45);

  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: calc(120px + var(--app-safe-bottom));
  color: var(--text-main);
  overflow: hidden;
  overflow-x: clip;
  container-type: inline-size;
  background:
    radial-gradient(circle at 84% 20%, rgba(75, 107, 255, 0.12), transparent 26%),
    radial-gradient(circle at 34% 62%, rgba(75, 199, 187, 0.08), transparent 28%),
    linear-gradient(180deg, transparent, rgba(255, 255, 255, 0.18));
}

.script-side,
.preview-side,
.step-two-script-scroll,
.avatar-strip--filled,
.workspace > .panel,
.step-two-workbench > .panel,
.edit-main > .panel,
.edit-layout > .panel,
.publish-left > .panel,
.publish-center > .panel {
  scrollbar-width: thin;
  scrollbar-color: var(--vc-scrollbar-thumb) transparent;
}

.script-side::-webkit-scrollbar,
.preview-side::-webkit-scrollbar,
.step-two-script-scroll::-webkit-scrollbar,
.avatar-strip--filled::-webkit-scrollbar,
.workspace > .panel::-webkit-scrollbar,
.step-two-workbench > .panel::-webkit-scrollbar,
.edit-main > .panel::-webkit-scrollbar,
.edit-layout > .panel::-webkit-scrollbar,
.publish-left > .panel::-webkit-scrollbar,
.publish-center > .panel::-webkit-scrollbar {
  width: var(--vc-scrollbar-size);
  height: var(--vc-scrollbar-size);
}

.script-side::-webkit-scrollbar-track,
.preview-side::-webkit-scrollbar-track,
.step-two-script-scroll::-webkit-scrollbar-track,
.avatar-strip--filled::-webkit-scrollbar-track,
.workspace > .panel::-webkit-scrollbar-track,
.step-two-workbench > .panel::-webkit-scrollbar-track,
.edit-main > .panel::-webkit-scrollbar-track,
.edit-layout > .panel::-webkit-scrollbar-track,
.publish-left > .panel::-webkit-scrollbar-track,
.publish-center > .panel::-webkit-scrollbar-track {
  margin: 10px 2px;
  border-radius: 999px;
  background: transparent;
}

.avatar-strip--filled::-webkit-scrollbar-track {
  margin: 2px 10px;
}

.script-side::-webkit-scrollbar-thumb,
.preview-side::-webkit-scrollbar-thumb,
.step-two-script-scroll::-webkit-scrollbar-thumb,
.avatar-strip--filled::-webkit-scrollbar-thumb,
.workspace > .panel::-webkit-scrollbar-thumb,
.step-two-workbench > .panel::-webkit-scrollbar-thumb,
.edit-main > .panel::-webkit-scrollbar-thumb,
.edit-layout > .panel::-webkit-scrollbar-thumb,
.publish-left > .panel::-webkit-scrollbar-thumb,
.publish-center > .panel::-webkit-scrollbar-thumb {
  min-height: 42px;
  border: 2px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background:
    linear-gradient(180deg, var(--vc-scrollbar-thumb), rgba(75, 199, 187, 0.36))
    padding-box;
}

.script-side:hover,
.preview-side:hover,
.step-two-script-scroll:hover,
.avatar-strip--filled:hover,
.workspace > .panel:hover,
.step-two-workbench > .panel:hover,
.edit-main > .panel:hover,
.edit-layout > .panel:hover,
.publish-left > .panel:hover,
.publish-center > .panel:hover {
  scrollbar-color: var(--vc-scrollbar-thumb-hover) transparent;
}

.script-side:hover::-webkit-scrollbar-thumb,
.preview-side:hover::-webkit-scrollbar-thumb,
.step-two-script-scroll:hover::-webkit-scrollbar-thumb,
.avatar-strip--filled:hover::-webkit-scrollbar-thumb,
.workspace > .panel:hover::-webkit-scrollbar-thumb,
.step-two-workbench > .panel:hover::-webkit-scrollbar-thumb,
.edit-main > .panel:hover::-webkit-scrollbar-thumb,
.edit-layout > .panel:hover::-webkit-scrollbar-thumb,
.publish-left > .panel:hover::-webkit-scrollbar-thumb,
.publish-center > .panel:hover::-webkit-scrollbar-thumb {
  background:
    linear-gradient(180deg, var(--vc-scrollbar-thumb-hover), rgba(75, 199, 187, 0.52))
    padding-box;
}

.create-topbar {
  display: grid;
  grid-template-columns: minmax(120px, 180px) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--vc-gap-lg);
  min-height: clamp(52px, 6vw, 58px);
  padding: var(--vc-pad-y) var(--vc-pad-x);
  border-bottom: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 14px 32px rgba(64, 86, 122, 0.08);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.back-link {
  color: var(--text-sub);
  font-size: 13px;
  text-decoration: none;
}

.back-link:hover {
  color: var(--primary);
  text-shadow: 0 0 18px rgba(75, 107, 255, 0.16);
}

.topbar-progress {
  justify-self: end;
  text-align: right;
}

.stepper {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: clamp(14px, 1.6vw, 22px);
  padding: 0;
  margin: 0;
  list-style: none;
}

.stepper__item {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 8px;
  color: var(--text-light);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    transform var(--transition-smooth);
}

.stepper__item span {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: var(--text-sub);
  border-radius: 999px;
  border: 1px solid rgba(75, 107, 255, 0.18);
  background: rgba(75, 107, 255, 0.08);
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
}

.stepper__item--active {
  color: var(--primary);
  transform: translateY(-1px);
}

.stepper__item--active span {
  color: #ffffff;
  border-color: rgba(75, 107, 255, 0.3);
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: var(--shadow-glow);
}

.create-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(216px, var(--vc-aside-w));
  gap: clamp(12px, 1.05vw, 18px);
  min-height: 0;
  padding: clamp(8px, 1vw, 14px) clamp(10px, 1.45vw, 18px) 0;
  align-items: stretch;
}

.main-board {
  min-width: 0;
  min-height: 0;
}

.main-board h1,
.step-two-head h1,
.edit-main h1 {
  margin: 0 0 clamp(12px, 1.35vw, 18px);
  font-size: var(--vc-h1);
  line-height: 1.22;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(300px, 0.9fr) minmax(420px, 1.1fr);
  gap: clamp(12px, 1.1vw, 18px);
  min-height: 0;
  align-items: stretch;
}

.panel {
  min-height: 0;
  min-width: 0;
  padding: var(--vc-panel-pad);
  border: 1px solid rgba(255, 255, 255, 0.56);
  border-radius: var(--vc-radius);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(246, 249, 255, 0.82));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.94),
    var(--shadow-soft);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.panel:hover {
  border-color: var(--border-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    var(--shadow-panel);
  transform: translateY(-3px);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: var(--primary);
  font-weight: 700;
}

.panel-head--between {
  align-items: flex-start;
}

.panel-head--subtle {
  margin-bottom: 16px;
}

.panel-head--subtle span {
  color: var(--text-main);
}

.panel--source {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: clamp(12px, 1vw, 16px);
}

.panel--outline {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
}

.source-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 6px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(246, 249, 255, 0.92), rgba(236, 242, 254, 0.72));
  box-shadow: inset 0 1px 2px rgba(65, 83, 122, 0.06);
}

.source-switch__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: clamp(40px, 4vw, 46px);
  padding: 0 clamp(10px, 1vw, 14px);
  color: var(--text-sub);
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 17px;
  background: transparent;
  box-shadow: none;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.source-switch__item:hover,
.source-switch__item--active {
  color: var(--text-main);
  border-color: rgba(75, 107, 255, 0.18);
  background: rgba(255, 255, 255, 0.94);
  box-shadow:
    0 10px 20px rgba(75, 107, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.96);
  transform: translateY(-1px);
}

.source-switch__icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  color: var(--primary);
  border-radius: 999px;
  background: rgba(75, 107, 255, 0.08);
  font-size: 12px;
  font-weight: 700;
}

.benchmark-pane,
.hotlink-pane {
  display: grid;
  align-content: start;
  gap: clamp(10px, 0.9vw, 14px);
  min-height: 0;
}

.benchmark-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(118px, 0.24fr);
  gap: 10px;
  align-items: center;
}

.benchmark-submit {
  min-width: 0;
}

.benchmark-note-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.helper-text--inline {
  margin-top: 0;
}

.recent-extract {
  display: grid;
  gap: 12px;
  margin-top: 4px;
}

.recent-extract__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.recent-extract__head span {
  display: block;
  color: var(--text-main);
  font-size: 14px;
  font-weight: 800;
}

.recent-extract__head strong {
  display: block;
  margin-top: 3px;
  color: var(--text-sub);
  font-size: 12px;
  font-weight: 600;
}

.recent-extract__list {
  display: grid;
  gap: 10px;
  max-height: clamp(208px, 27vh, 330px);
  overflow-y: auto;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--vc-scrollbar-thumb) transparent;
}

.recent-extract__list::-webkit-scrollbar {
  width: var(--vc-scrollbar-size);
}

.recent-extract__list::-webkit-scrollbar-track {
  background: transparent;
}

.recent-extract__list::-webkit-scrollbar-thumb {
  border: 2px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background:
    linear-gradient(180deg, var(--vc-scrollbar-thumb), rgba(75, 199, 187, 0.34))
    padding-box;
}

.recent-extract-card {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 18px;
  background:
    radial-gradient(circle at 0% 0%, rgba(75, 107, 255, 0.07), transparent 34%),
    rgba(255, 255, 255, 0.88);
  box-shadow: 0 14px 30px rgba(64, 86, 122, 0.08);
  transition:
    transform var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.recent-extract-card:hover {
  transform: translateY(-2px);
  border-color: rgba(75, 107, 255, 0.24);
  box-shadow: 0 18px 38px rgba(75, 107, 255, 0.12);
}

.recent-extract-card__preview {
  position: relative;
  display: grid;
  place-items: center;
  width: 58px;
  height: 78px;
  padding: 0;
  overflow: hidden;
  color: #ffffff;
  cursor: pointer;
  border: 0;
  border-radius: 13px;
  background: linear-gradient(135deg, rgba(75, 107, 255, 0.86), rgba(69, 200, 194, 0.74));
  box-shadow: 0 12px 22px rgba(75, 107, 255, 0.16);
}

.recent-extract-card__preview img,
.recent-extract-card__preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.recent-extract-card__preview::before {
  position: absolute;
  inset: 0;
  content: '';
  background: linear-gradient(180deg, transparent 40%, rgba(8, 16, 35, 0.56));
  opacity: 0.85;
}

.recent-extract-card__preview i {
  position: absolute;
  left: 50%;
  bottom: 7px;
  z-index: 1;
  padding: 3px 7px;
  color: #ffffff;
  border-radius: 999px;
  background: rgba(12, 18, 34, 0.58);
  font-size: 10px;
  font-style: normal;
  font-weight: 800;
  transform: translateX(-50%);
}

.recent-extract-card__fallback {
  position: relative;
  z-index: 1;
  font-size: 12px;
  font-weight: 800;
}

.recent-extract-card__body {
  min-width: 0;
}

.recent-extract-card__title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.recent-extract-card__title strong {
  overflow: hidden;
  color: var(--text-main);
  font-size: 14px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-extract-card__body p {
  display: -webkit-box;
  margin: 5px 0 7px;
  overflow: hidden;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.recent-extract-card__body small {
  color: var(--text-light);
  font-size: 11px;
}

.recent-extract__empty {
  padding: 14px;
  color: var(--text-sub);
  text-align: center;
  border: 1px dashed rgba(121, 144, 184, 0.22);
  border-radius: 16px;
  background: rgba(250, 252, 255, 0.74);
  font-size: 12px;
}

.benchmark-result {
  display: grid;
  gap: clamp(10px, 0.9vw, 14px);
}

.benchmark-result__label {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--text-sub);
  font-size: 13px;
}

.benchmark-result__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
}

.benchmark-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 13px;
  width: 100%;
  padding: clamp(13px, 1.1vw, 16px);
  color: inherit;
  text-align: left;
  cursor: pointer;
  border: 1.5px solid rgba(75, 107, 255, 0.4);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    0 18px 34px rgba(75, 107, 255, 0.09);
  transition:
    transform var(--transition-smooth),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast);
}

.benchmark-card:hover {
  transform: translateY(-2px);
  border-color: rgba(75, 107, 255, 0.56);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    0 22px 40px rgba(75, 107, 255, 0.13);
}

.benchmark-card__avatar {
  width: clamp(46px, 4vw, 54px);
  height: clamp(46px, 4vw, 54px);
  object-fit: cover;
  border-radius: 999px;
  background: rgba(75, 107, 255, 0.08);
}

.benchmark-card__avatar--fallback {
  display: grid;
  place-items: center;
  color: var(--primary);
  font-size: 22px;
  font-weight: 700;
}

.benchmark-card__body {
  min-width: 0;
}

.benchmark-card__title,
.benchmark-card__stats {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.benchmark-card__title strong {
  font-size: clamp(16px, 1.2vw, 18px);
}

.benchmark-card__stats {
  margin-top: 6px;
  color: var(--text-main);
  font-size: 13px;
  font-weight: 600;
}

.benchmark-card__body p {
  display: -webkit-box;
  margin: 6px 0 0;
  overflow: hidden;
  color: var(--text-sub);
  font-size: 13px;
  line-height: 1.6;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.benchmark-card__check {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: #ffffff;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: 0 12px 22px rgba(75, 107, 255, 0.22);
  font-size: 16px;
  font-weight: 700;
}

.benchmark-post-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.benchmark-post {
  display: grid;
  gap: 8px;
  min-height: clamp(84px, 9vw, 104px);
  padding: 12px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 16px;
  background: rgba(248, 250, 255, 0.86);
}

.benchmark-post__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--text-sub);
  font-size: 11px;
}

.benchmark-post p {
  margin: 0;
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.65;
}

.benchmark-action-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.idea-action {
  min-height: clamp(46px, 4.2vw, 50px);
  padding: 0 16px;
  color: var(--text-main);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 12px 26px rgba(65, 83, 122, 0.08);
  transition:
    transform var(--transition-smooth),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast);
}

.idea-action:hover {
  transform: translateY(-2px);
  border-color: rgba(75, 107, 255, 0.24);
  box-shadow: 0 16px 30px rgba(75, 107, 255, 0.12);
}

.idea-action--primary {
  color: #ffffff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 16px 30px rgba(75, 107, 255, 0.24);
}

.benchmark-empty {
  display: grid;
  place-items: center;
  min-height: clamp(178px, 23vh, 228px);
  padding: 18px;
  text-align: center;
  border: 1px dashed rgba(121, 144, 184, 0.22);
  border-radius: 20px;
  background: rgba(250, 252, 255, 0.72);
}

.benchmark-empty p {
  margin: 8px 0 0;
  color: var(--text-sub);
  font-size: 13px;
}

.helper-text {
  display: block;
  margin-top: 10px;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.65;
}

.helper-text--top {
  margin-top: 0;
  margin-bottom: 10px;
}

.helper-text--accent {
  color: var(--primary);
}

.input-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 12px;
}

.input-actions--triple {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.meta-board {
  display: grid;
  gap: 12px;
  margin-top: 14px;
  padding: clamp(12px, 1vw, 14px);
  border: 1px solid rgba(75, 107, 255, 0.14);
  border-radius: 20px;
  background:
    radial-gradient(circle at 12% 0%, rgba(75, 107, 255, 0.1), transparent 32%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 251, 255, 0.88));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    0 16px 34px rgba(86, 104, 140, 0.1);
}

.meta-board__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.meta-board__header > div {
  display: grid;
  gap: 4px;
}

.meta-board__header strong {
  color: var(--text-main);
  font-size: 15px;
  line-height: 1.35;
}

.meta-board__eyebrow,
.meta-chip span,
.meta-section > span {
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.meta-board__summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(92px, 0.24fr);
  gap: 10px;
}

.meta-chip,
.meta-section {
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.74);
}

.meta-chip {
  display: grid;
  gap: 6px;
  min-height: 66px;
  padding: 11px 12px;
}

.meta-chip strong {
  color: var(--text-main);
  font-size: 16px;
  line-height: 1.35;
}

.meta-chip--title strong {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 15px;
}

.meta-section {
  display: grid;
  gap: 8px;
  padding: 12px;
}

.meta-section p {
  margin: 0;
  color: var(--text-sub);
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
}

.meta-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.meta-tag-list :deep(.n-tag) {
  color: var(--primary);
  background: rgba(75, 107, 255, 0.09);
}

.meta-empty {
  color: var(--text-muted);
}

.outline-editor :deep(.n-input),
.outline-editor :deep(.n-input-wrapper) {
  min-height: 100%;
  background: rgba(248, 250, 255, 0.94);
}

.outline-editor {
  min-height: 0;
}

.panel--outline .outline-editor {
  min-height: clamp(300px, 46vh, 520px);
}

.outline-editor :deep(textarea) {
  max-height: 100%;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--vc-scrollbar-thumb) transparent;
}

.outline-editor :deep(textarea::-webkit-scrollbar) {
  width: var(--vc-scrollbar-size);
}

.outline-editor :deep(textarea::-webkit-scrollbar-track) {
  border-radius: 999px;
  background: transparent;
}

.outline-editor :deep(textarea::-webkit-scrollbar-thumb) {
  border: 2px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background:
    linear-gradient(180deg, var(--vc-scrollbar-thumb), rgba(75, 199, 187, 0.36))
    padding-box;
}

.hook-preview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 14px 0 2px;
}

.hook-preview__item,
.hook-side-card__block {
  padding: 14px 16px;
  border: 1px solid rgba(75, 107, 255, 0.14);
  border-radius: 16px;
  background: linear-gradient(180deg, rgba(244, 248, 255, 0.94), rgba(237, 245, 255, 0.82));
  box-shadow: 0 16px 34px rgba(64, 86, 122, 0.08);
  transition:
    transform var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.hook-preview__item:hover,
.hook-side-card__block:hover {
  transform: translateY(-2px);
  border-color: rgba(75, 107, 255, 0.24);
  box-shadow: 0 18px 40px rgba(75, 107, 255, 0.12);
}

.hook-preview__item span,
.hook-side-card__block span {
  display: inline-flex;
  margin-bottom: 8px;
  color: var(--primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.hook-preview__item strong,
.hook-side-card__block p {
  margin: 0;
  color: var(--text-main);
  line-height: 1.6;
  word-break: break-word;
}

.outline-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 18px;
}

.gradient-btn,
.blue-btn,
.voice-generate,
.next-btn {
  color: #ffffff;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: var(--shadow-glow);
}

.script-side,
.preview-side {
  min-height: calc(100vh - 188px);
  min-width: 0;
  overflow-y: auto;
  padding: var(--vc-pad-y) var(--vc-gap-lg);
  border-left: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.44);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.script-side__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.script-side__head p {
  margin: 6px 0 0;
  color: var(--text-sub);
  font-size: 12px;
}

.hook-side-card {
  display: grid;
  gap: 10px;
  margin-top: 18px;
  padding: 14px;
  border: 1px solid rgba(75, 107, 255, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 18px 40px rgba(64, 86, 122, 0.08);
}

.hook-side-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.script-list,
.script-lines,
.subtitle-list {
  display: grid;
  gap: 13px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.script-list li,
.script-lines li,
.subtitle-list li {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
  line-height: 1.55;
}

.script-list span,
.script-lines span,
.subtitle-list span {
  color: var(--text-light);
}

.script-list p,
.script-lines p,
.subtitle-list p {
  margin: 0;
  word-break: break-word;
}

.subtitle-table-head,
.subtitle-table li {
  display: grid;
  grid-template-columns: minmax(116px, 0.34fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.subtitle-table-head {
  padding: 10px 14px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 14px;
  background: rgba(245, 248, 255, 0.82);
}

.subtitle-table li {
  padding: 12px 14px;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 10px 24px rgba(64, 86, 122, 0.06);
}

.subtitle-table span {
  display: inline-flex;
  align-items: center;
  width: max-content;
  max-width: 100%;
  padding: 6px 9px;
  color: var(--primary);
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
  border-radius: 999px;
  background: rgba(75, 107, 255, 0.09);
}

.subtitle-table p {
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
}

.empty-side,
.empty-block {
  display: grid;
  place-items: center;
  min-height: 180px;
  padding: 18px;
  text-align: center;
  border: 1px dashed rgba(121, 144, 184, 0.24);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.56);
}

.empty-side p,
.empty-block p {
  margin: 8px 0 0;
  color: var(--text-sub);
  font-size: 12px;
}

.step-two-layout,
.edit-layout,
.publish-layout {
  display: grid;
  gap: var(--vc-gap-lg);
  min-height: 0;
  padding: var(--vc-pad-y) var(--vc-pad-x) 0;
}

.step-two-layout {
  --step-two-gap: clamp(10px, 0.9vw, 15px);
  --step-two-panel-pad: clamp(12px, 1vw, 16px);

  gap: var(--step-two-gap);
  padding: clamp(8px, 1vw, 14px) clamp(10px, 1.45vw, 18px) 0;
}

.step-two-head {
  display: grid;
  gap: 4px;
  padding: 0 4px;
}

.step-two-head p {
  margin: 0;
  color: var(--text-sub);
  font-size: 13px;
}

.step-two-workbench {
  display: grid;
  grid-template-columns: minmax(280px, 0.86fr) minmax(340px, 1fr) minmax(320px, 0.9fr);
  gap: var(--step-two-gap);
  min-height: 0;
  align-items: stretch;
}

.step-two-workbench > .panel {
  display: grid;
  align-content: start;
  gap: clamp(10px, 0.85vw, 13px);
  min-height: 0;
  overflow: hidden;
  padding: var(--step-two-panel-pad);
}

.step-two-script-panel {
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
}

.step-two-voice-panel,
.step-two-avatar-panel {
  grid-template-rows: auto auto minmax(0, 1fr);
}

.step-two-block-head,
.step-two-block-head__main,
.step-two-script-meta,
.step-two-footnote,
.step-two-slider-card__head,
.voice-preview-card__head,
.voice-preview-card__player,
.lip-sync-setup-card__resolution,
.lip-sync-setup-card__tabs {
  display: flex;
  align-items: center;
  gap: 12px;
}

.step-two-block-head,
.step-two-script-meta,
.step-two-footnote,
.voice-preview-card__head,
.lip-sync-setup-card__resolution {
  justify-content: space-between;
}

.step-two-block-head {
  flex-wrap: wrap;
  row-gap: 8px;
  column-gap: 10px;
}

.step-two-block-head__main {
  min-width: min(100%, 176px);
  flex: 1 1 auto;
}

.step-two-block-head strong {
  display: block;
  font-size: clamp(14px, 0.35vw + 13px, 16px);
  line-height: 1.2;
}

.step-two-block-head p,
.step-two-script-meta span,
.step-two-footnote span,
.step-two-control-card small,
.voice-preview-card__head p,
.lip-sync-setup-card__tab span {
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.6;
}

.step-two-block-icon {
  display: grid;
  place-items: center;
  width: clamp(34px, 2.4vw + 26px, 40px);
  height: clamp(34px, 2.4vw + 26px, 40px);
  color: #fff;
  border-radius: clamp(12px, 1vw, 15px);
  background: linear-gradient(135deg, #7c4dff, #5a6dff);
  box-shadow: 0 20px 46px rgba(94, 86, 255, 0.22);
  font-size: clamp(16px, 1vw + 13px, 19px);
  font-weight: 800;
}

.step-two-block-icon--voice {
  background: linear-gradient(135deg, #6c44ff, #8f53ff);
}

.step-two-block-icon--avatar {
  background: linear-gradient(135deg, #5e56ff, #7a78ff);
}

.step-two-script-meta {
  padding: 0 2px;
  font-weight: 600;
}

.step-two-script-meta strong {
  color: var(--text-light);
  font-size: 12px;
}

.step-two-script-scroll {
  min-height: 0;
  overflow-y: auto;
  padding-right: 6px;
}

.step-two-script-list {
  display: grid;
  gap: 12px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.step-two-script-line {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  padding: 14px 16px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 248, 255, 0.84));
}

.step-two-script-line span {
  color: rgba(140, 151, 176, 0.88);
  font-size: 12px;
  font-weight: 700;
}

.step-two-script-line p,
.step-two-hook-card strong,
.voice-preview-card__empty p {
  margin: 0;
  line-height: 1.68;
  word-break: break-word;
}

.step-two-hook-row,
.step-two-control-grid,
.step-two-slider-grid,
.lip-sync-setup-card__summary {
  display: grid;
  gap: 12px;
}

.step-two-hook-row,
.step-two-slider-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.step-two-control-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.step-two-hook-card,
.step-two-control-card,
.step-two-slider-card,
.voice-preview-card,
.lip-sync-setup-card {
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(245, 248, 255, 0.84));
  box-shadow: 0 22px 46px rgba(64, 86, 122, 0.08);
}

.step-two-hook-card,
.step-two-control-card,
.step-two-slider-card {
  padding: 14px 16px;
}

.step-two-hook-card span,
.step-two-control-card > span,
.step-two-slider-card__head span {
  color: var(--text-light);
  font-size: 12px;
  font-weight: 700;
}

.step-two-control-card {
  display: grid;
  gap: 10px;
}

.step-two-control-card__main {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}

.step-two-control-card__main:has(.voice-sample-play) {
  grid-template-columns: auto minmax(0, 1fr);
}

.step-two-control-card__main :deep(.n-select) {
  min-width: 0;
  width: 100%;
}

.voice-sample-play,
.voice-preview-card__play {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  color: #6d42ff;
  border: 0;
  border-radius: 50%;
  background: rgba(118, 83, 255, 0.14);
  box-shadow: inset 0 0 0 1px rgba(118, 83, 255, 0.12);
  cursor: pointer;
  transition:
    transform var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
}

.voice-sample-play:hover,
.voice-preview-card__play:hover {
  transform: translateY(-1px) scale(1.02);
  background: rgba(118, 83, 255, 0.2);
  box-shadow: 0 18px 34px rgba(118, 83, 255, 0.18);
}

.voice-power-stepper {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 44px;
  align-items: center;
  overflow: hidden;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
}

.voice-power-stepper button {
  min-height: 46px;
  color: var(--text-main);
  border: 0;
  background: transparent;
  cursor: pointer;
}

.voice-power-stepper strong {
  text-align: center;
  font-size: 18px;
}

.step-two-slider-card {
  display: grid;
  gap: 12px;
}

.step-two-inline-alert {
  border-radius: 18px;
}

.step-two-primary-btn,
.step-two-ghost-btn,
.voice-source-switch__item,
.avatar-add-card,
.avatar-select-card,
.lip-sync-setup-card__tab,
.resolution-chip {
  transition:
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast);
}

.step-two-primary-btn {
  width: 100%;
  min-height: 56px;
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  border: 0;
  border-radius: 20px;
  background: linear-gradient(135deg, #6d42ff, #7f52ff 52%, #4ca5ff);
  box-shadow: 0 24px 44px rgba(90, 88, 255, 0.28);
  cursor: pointer;
}

.step-two-primary-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 28px 48px rgba(90, 88, 255, 0.32);
}

.step-two-primary-btn:disabled,
.step-two-ghost-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.step-two-primary-btn--video {
  margin-top: 6px;
}

.voice-generate-progress {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  overflow: hidden;
  border: 1px solid rgba(75, 107, 255, 0.16);
  border-radius: 18px;
  background:
    radial-gradient(circle at 0% 0%, rgba(75, 107, 255, 0.12), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(245, 249, 255, 0.88));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.94);
}

.voice-generate-progress__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.voice-generate-progress__head span {
  color: var(--primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.voice-generate-progress__head strong {
  color: var(--text-main);
  font-family: var(--font-display);
  font-size: 17px;
}

.voice-generate-progress__bar {
  position: relative;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(121, 144, 184, 0.18);
}

.voice-generate-progress__bar i {
  position: relative;
  display: block;
  width: 0;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4b6bff, #45c8c2);
  box-shadow: 0 0 18px rgba(75, 107, 255, 0.2);
  transition: width 0.38s ease;
}

.voice-generate-progress__bar i::after {
  position: absolute;
  inset: 0;
  content: '';
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent);
  animation: voice-progress-flow 1.15s linear infinite;
}

.voice-generate-progress--done {
  border-color: rgba(31, 184, 133, 0.22);
  background:
    radial-gradient(circle at 0% 0%, rgba(31, 184, 133, 0.13), transparent 36%),
    linear-gradient(180deg, rgba(250, 255, 253, 0.96), rgba(240, 253, 249, 0.9));
}

.voice-generate-progress--done .voice-generate-progress__bar i::after {
  animation: none;
}

.voice-generate-progress p {
  margin: 0;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.55;
}

.voice-progress-enter-active,
.voice-progress-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.voice-progress-enter-from,
.voice-progress-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@keyframes voice-progress-flow {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
}

.step-two-ghost-btn {
  width: 100%;
  min-height: 52px;
  color: #7a4eff;
  font-size: 15px;
  font-weight: 700;
  border: 1px solid rgba(122, 78, 255, 0.18);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.82);
  cursor: pointer;
}

.step-two-ghost-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--shadow-soft);
}

.voice-preview-card {
  display: grid;
  gap: 14px;
  padding: 18px;
}

.voice-preview-card--ready {
  border-color: rgba(108, 93, 255, 0.24);
  box-shadow: 0 24px 52px rgba(84, 105, 255, 0.14);
}

.voice-preview-card__head strong,
.voice-preview-card__player strong,
.voice-preview-card__empty strong {
  display: block;
}

.voice-preview-card__head p,
.voice-preview-card__player p {
  margin: 4px 0 0;
}

.voice-preview-card__player {
  justify-content: flex-start;
  padding: 14px;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
}

.voice-preview-card__player > div {
  flex: 1;
}

.voice-preview-card__empty {
  display: grid;
  gap: 6px;
}

.voice-local-pane {
  display: grid;
  gap: 14px;
}

.voice-source-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 4px;
  border-radius: 18px;
  background: rgba(232, 237, 247, 0.9);
}

.voice-source-switch__item {
  min-height: 46px;
  color: var(--text-sub);
  font-weight: 700;
  border: 0;
  border-radius: 14px;
  background: transparent;
  cursor: pointer;
}

.voice-source-switch__item--active {
  color: #6d42ff;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 14px 28px rgba(81, 100, 143, 0.1);
}

.avatar-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.avatar-add-card,
.avatar-select-card {
  position: relative;
  display: grid;
  gap: 10px;
  justify-items: center;
  align-content: start;
  min-height: clamp(168px, 22vw, 188px);
  padding: 14px;
  color: var(--text-main);
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 28px;
  background: rgba(255, 255, 255, 0.8);
  cursor: pointer;
}

.avatar-add-card {
  place-items: center;
  border-style: dashed;
  color: var(--text-sub);
}

.avatar-add-card strong {
  display: grid;
  place-items: center;
  width: clamp(58px, 4.5vw, 64px);
  height: clamp(58px, 4.5vw, 64px);
  color: #91a0bc;
  border-radius: clamp(18px, 1.5vw, 22px);
  background: rgba(246, 248, 255, 0.92);
  font-size: clamp(28px, 2vw + 22px, 32px);
}

.avatar-select-card:hover,
.avatar-add-card:hover,
.lip-sync-setup-card__tab:hover,
.resolution-chip:hover {
  transform: translateY(-2px);
  box-shadow: 0 22px 40px rgba(77, 101, 152, 0.14);
}

.avatar-select-card--active {
  border-color: rgba(127, 82, 255, 0.42);
  box-shadow: 0 22px 42px rgba(115, 92, 255, 0.18);
}

.avatar-select-card:focus-visible {
  outline: 3px solid rgba(86, 110, 255, 0.28);
  outline-offset: 3px;
}

.avatar-select-card__remove {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  color: #ffffff;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, #ff6a6a, #ef4444);
  box-shadow: 0 12px 26px rgba(239, 68, 68, 0.24);
  cursor: pointer;
  opacity: 0.92;
  transform: translateY(0);
  transition:
    opacity 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.avatar-select-card:hover .avatar-select-card__remove,
.avatar-select-card:focus-within .avatar-select-card__remove {
  opacity: 1;
  transform: scale(1.04);
}

.avatar-select-card__remove:hover {
  box-shadow: 0 16px 34px rgba(239, 68, 68, 0.32);
}

.avatar-select-card__image,
.avatar-select-card__video,
.avatar-select-card__placeholder {
  width: 100%;
  aspect-ratio: 0.73;
  border-radius: 22px;
}

.avatar-select-card__image,
.avatar-select-card__video {
  object-fit: cover;
  background: rgba(235, 240, 247, 0.84);
}

.avatar-select-card__video {
  pointer-events: none;
}

.avatar-select-card__placeholder {
  display: grid;
  place-items: center;
  color: #7787a8;
  background: linear-gradient(180deg, rgba(244, 247, 255, 0.94), rgba(232, 239, 252, 0.94));
  font-size: 34px;
  font-weight: 800;
}

.avatar-select-card__name {
  display: block;
  width: 100%;
  overflow: hidden;
  font-size: 13px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lip-sync-setup-card {
  display: grid;
  gap: 16px;
  padding: 18px;
}

.lip-sync-setup-card__tabs {
  align-items: stretch;
}

.lip-sync-setup-card__tab {
  flex: 1;
  display: grid;
  gap: 4px;
  padding: 16px 18px;
  text-align: left;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 18px;
  background: rgba(250, 252, 255, 0.76);
  cursor: pointer;
}

.lip-sync-setup-card__tab strong {
  font-size: 16px;
}

.lip-sync-setup-card__tab--active {
  border-color: rgba(122, 78, 255, 0.28);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(244, 242, 255, 0.94));
  box-shadow: 0 18px 34px rgba(116, 92, 255, 0.12);
}

.lip-sync-setup-card__resolution {
  flex-wrap: wrap;
}

.lip-sync-setup-card__resolution > span {
  color: var(--text-sub);
  font-size: 12px;
  font-weight: 700;
}

.lip-sync-setup-card__resolution > div {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.resolution-chip {
  min-height: 38px;
  padding: 0 14px;
  color: #6f7a92;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  cursor: pointer;
}

.resolution-chip--active {
  color: #6d42ff;
  border-color: rgba(122, 78, 255, 0.26);
  background: rgba(244, 240, 255, 0.92);
}

.subtitle-template-panel,
.workflow-action-card,
.workflow-preview-stack {
  display: grid;
  gap: 14px;
}

.workflow-action-card > .segment-count-bar {
  display: none;
}

.workflow-action-card .input-actions--triple {
  grid-template-columns: minmax(170px, 0.9fr) minmax(220px, 1.18fr) minmax(190px, 0.9fr);
  gap: clamp(14px, 2vw, 30px);
  align-items: center;
  margin-top: 20px;
}

.workflow-action-card .input-actions--triple :deep(.n-button) {
  min-height: 54px;
  border-radius: 18px;
  font-size: 15px;
  font-weight: 800;
  transition:
    transform var(--transition-fast),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast);
}

.workflow-action-card .input-actions--triple :deep(.n-button:not(.n-button--disabled):hover) {
  transform: translateY(-2px);
  box-shadow: 0 18px 34px rgba(75, 107, 255, 0.14);
}

.workflow-action-card .input-actions--triple .gradient-btn {
  min-height: 58px;
  font-size: 17px;
  box-shadow: 0 20px 42px rgba(75, 107, 255, 0.22);
}

.workflow-progress-card {
  display: grid;
  position: relative;
  grid-template-rows: auto minmax(74px, auto);
  gap: 22px;
  padding: 24px 26px 26px;
  overflow: hidden;
  border: 1px solid rgba(75, 107, 255, 0.16);
  border-radius: 26px;
  background:
    radial-gradient(circle at 92% 6%, rgba(75, 107, 255, 0.12), transparent 28%),
    radial-gradient(circle at 0% 100%, rgba(69, 200, 194, 0.1), transparent 30%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.97), rgba(246, 250, 255, 0.9));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.96),
    0 24px 58px rgba(61, 83, 128, 0.1);
}

.workflow-progress-card--done {
  border-color: rgba(31, 184, 133, 0.24);
  background:
    radial-gradient(circle at 12% 0%, rgba(31, 184, 133, 0.14), transparent 34%),
    linear-gradient(180deg, rgba(250, 255, 253, 0.98), rgba(241, 253, 249, 0.92));
}

.workflow-progress-card__head {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  justify-content: space-between;
}

.workflow-progress-card__head span {
  display: block;
  color: var(--primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.workflow-progress-card__head strong {
  display: block;
  margin-top: 4px;
  color: var(--text-main);
  font-size: clamp(20px, 1vw + 18px, 26px);
  line-height: 1.35;
}

.workflow-progress-card__head p {
  margin: 5px 0 0;
  color: var(--text-sub);
  font-size: 13px;
  line-height: 1.6;
}

.workflow-progress-card__head > b {
  position: relative;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  padding: 0;
  color: #3557ff;
  text-align: center;
  border: 6px solid rgba(230, 236, 248, 0.92);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow:
    inset 0 0 0 1px rgba(75, 107, 255, 0.08),
    0 14px 28px rgba(75, 107, 255, 0.12);
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 800;
}

.workflow-progress-card__head > b::after {
  position: absolute;
  inset: -6px;
  content: '';
  border-radius: inherit;
  background: conic-gradient(
    from 0deg,
    var(--primary) 0 var(--workflow-percent, 0%),
    var(--accent-teal) var(--workflow-percent, 0%) calc(var(--workflow-percent, 0%) + 6%),
    transparent calc(var(--workflow-percent, 0%) + 6%) 100%
  );
  mask: radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px));
  pointer-events: none;
}

.workflow-progress-track {
  position: relative;
  z-index: 0;
  grid-row: 2;
  grid-column: 1;
  align-self: center;
  height: 8px;
  margin: 0 clamp(48px, 5vw, 84px);
  overflow: hidden;
  border-radius: 999px;
  background: rgba(121, 144, 184, 0.2);
}

.workflow-progress-track i {
  position: relative;
  display: block;
  height: 100%;
  overflow: hidden;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--primary), var(--accent-teal));
  box-shadow: 0 0 22px rgba(75, 107, 255, 0.22);
  transition: width 0.35s ease;
}

.workflow-progress-card--running .workflow-progress-track i::after {
  position: absolute;
  inset: 0;
  content: '';
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.56), transparent);
  animation: workflow-progress-flow 1.2s linear infinite;
}

.workflow-progress-steps {
  position: relative;
  z-index: 1;
  display: grid;
  grid-row: 2;
  grid-column: 1;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: clamp(10px, 1vw, 18px);
  align-items: center;
  counter-reset: workflow-step;
  padding: 0;
  margin: 0;
  list-style: none;
}

.workflow-progress-steps li {
  counter-increment: workflow-step;
  display: grid;
  grid-template-columns: auto auto;
  gap: 10px;
  align-items: center;
  justify-self: center;
  min-width: 0;
  min-height: 54px;
  padding: 10px clamp(12px, 1vw, 18px);
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.98),
    0 14px 26px rgba(61, 83, 128, 0.08);
  transition:
    transform var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
}

.workflow-progress-steps li > b {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  color: #8190ad;
  font-size: 0;
  font-weight: 800;
  border-radius: 999px;
  background: linear-gradient(180deg, #f5f8ff, #e9eef8);
}

.workflow-progress-steps li > b::before {
  content: counter(workflow-step);
  font-size: 15px;
}

.workflow-progress-steps strong {
  display: block;
  color: var(--text-main);
  font-size: clamp(13px, 0.28vw + 12px, 15px);
  line-height: 1.35;
  white-space: nowrap;
}

.workflow-progress-steps span {
  display: none;
}

.workflow-progress-steps li.is-active {
  border-color: rgba(75, 107, 255, 0.32);
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: 0 16px 34px rgba(75, 107, 255, 0.2);
  transform: translateY(-2px);
}

.workflow-progress-steps li.is-active strong {
  color: #ffffff;
}

.workflow-progress-steps li.is-active > b {
  color: var(--primary);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 18px rgba(255, 255, 255, 0.24);
}

.workflow-progress-steps li.is-done {
  border-color: rgba(69, 200, 194, 0.24);
  background: rgba(239, 253, 248, 0.94);
}

.workflow-progress-steps li.is-done > b {
  color: #138f85;
  background: rgba(69, 200, 194, 0.14);
}

@keyframes workflow-progress-flow {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
}

.template-chip-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.template-chip {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  color: var(--text-main);
  text-align: left;
  cursor: pointer;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.template-chip span {
  color: var(--text-sub);
  font-size: 11px;
}

.template-chip:hover,
.template-chip--active {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-soft);
  transform: translateY(-2px);
}

.section-title,
.section-title__main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-title {
  margin-bottom: 18px;
}

.section-title--between {
  justify-content: space-between;
}

.section-title strong {
  display: block;
  font-size: 15px;
}

.section-title p {
  margin: 3px 0 0;
  color: var(--text-sub);
  font-size: 11px;
}

.title-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: #ffffff;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: 0 0 20px rgba(75, 107, 255, 0.18);
  font-size: 12px;
  font-weight: 800;
}

.title-icon--sound {
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
}

.summary-card,
.summary-pill,
.switch-row--card {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
}

.summary-card {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  margin-top: 14px;
}

.summary-card strong,
.summary-pill strong,
.publish-result-item strong,
.platform-item strong {
  word-break: break-word;
}

.summary-card p,
.summary-pill span,
.switch-row--card span {
  color: var(--text-sub);
  font-size: 11px;
}

.summary-card p {
  margin: 2px 0 0;
}

.full-script-preview {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 16px;
  border: 1px solid rgba(75, 107, 255, 0.16);
  border-radius: 18px;
  background:
    radial-gradient(circle at 100% 0%, rgba(75, 107, 255, 0.12), transparent 28%),
    rgba(255, 255, 255, 0.74);
}

.full-script-preview span {
  color: var(--primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.full-script-preview p {
  display: -webkit-box;
  max-height: 7.2em;
  margin: 0;
  overflow: hidden;
  color: var(--text-main);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.full-script-preview--empty {
  border-style: dashed;
  background: rgba(248, 250, 255, 0.72);
}

.full-script-preview--empty p {
  color: var(--text-sub);
}

.step-three-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

.step-three-summary .summary-pill {
  position: relative;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 14px;
  align-items: center;
  min-width: 0;
  min-height: 72px;
  padding: 14px 18px;
  border-color: rgba(121, 144, 184, 0.2);
  border-radius: 18px;
  background:
    radial-gradient(circle at 0% 0%, rgba(75, 107, 255, 0.08), transparent 38%),
    rgba(255, 255, 255, 0.84);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    0 14px 30px rgba(61, 83, 128, 0.08);
}

.step-three-summary .summary-pill::before {
  display: grid;
  place-items: center;
  grid-row: 1 / span 2;
  width: 42px;
  height: 42px;
  color: var(--primary);
  border-radius: 999px;
  background: rgba(75, 107, 255, 0.08);
  font-size: 20px;
  font-weight: 800;
}

.step-three-summary .summary-pill:nth-child(1)::before {
  content: '人';
}

.step-three-summary .summary-pill:nth-child(2)::before {
  content: '声';
  color: #139d9a;
  background: rgba(69, 200, 194, 0.12);
}

.step-three-summary .summary-pill:nth-child(3)::before {
  content: 'T';
  color: #7c4dff;
  background: rgba(124, 77, 255, 0.1);
}

.step-three-summary .summary-pill span,
.step-three-summary .summary-pill strong {
  grid-column: 2;
}

.workflow-helper-note {
  position: relative;
  display: block;
  padding-left: 30px;
  color: transparent;
  font-size: 0;
}

.workflow-helper-note::before {
  position: absolute;
  left: 0;
  top: 50%;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: #ffffff;
  content: 'i';
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  box-shadow: 0 8px 18px rgba(75, 107, 255, 0.18);
  font-size: 13px;
  font-weight: 800;
  transform: translateY(-50%);
}

.workflow-helper-note::after {
  color: var(--text-sub);
  content: '先生成音轨和字幕时间轴，再合成 5 秒预览；确认无误后输出完整成片。';
  font-size: 13px;
  line-height: 1.6;
}

.compact-label {
  display: inline-block;
  max-width: 6em;
  min-width: 4em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.step-three-checks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.status-check {
  grid-template-columns: auto auto;
  align-items: center;
  width: max-content;
  min-width: 0;
  padding: 9px 11px;
  border-radius: 999px;
  transition:
    transform var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    background var(--transition-fast);
}

.status-check:hover {
  transform: translateY(-1px);
  box-shadow: 0 16px 30px rgba(77, 101, 152, 0.12);
}

.status-check b {
  display: grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  color: var(--text-main);
  font-size: 13px;
  line-height: 1;
}

.status-check b.compact-label {
  display: block;
  height: auto;
  line-height: 1.2;
  place-items: initial;
}

.status-check--ok {
  border-color: rgba(31, 184, 133, 0.24);
  background: rgba(236, 253, 245, 0.88);
}

.status-check--ok b {
  color: #0f9f6e;
}

.status-check--ok b:not(.compact-label) {
  border-radius: 999px;
  background: rgba(31, 184, 133, 0.12);
}

.status-check--fail {
  border-color: rgba(239, 68, 68, 0.22);
  background: rgba(255, 241, 242, 0.88);
}

.status-check--fail b {
  color: #ef4444;
}

.status-check--fail b:not(.compact-label) {
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.1);
}

.avatar-empty {
  display: grid;
  place-items: center;
  min-height: 156px;
  margin-top: 14px;
  padding: 18px;
  text-align: center;
  border: 1px dashed rgba(121, 144, 184, 0.28);
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.54);
}

.avatar-empty--compact {
  min-height: 138px;
}

.avatar-empty__icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  margin-bottom: 8px;
  color: var(--primary);
  border-radius: 18px;
  background: rgba(75, 107, 255, 0.1);
  box-shadow: 0 0 22px rgba(75, 107, 255, 0.12);
}

.avatar-empty p {
  margin: 6px 0 0;
  color: var(--text-sub);
  font-size: 12px;
}

.edit-layout {
  grid-template-columns: minmax(0, 0.88fr) minmax(0, 1fr) minmax(0, min(240px, 26vw));
  align-items: stretch;
}

.publish-layout {
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 0.92fr) minmax(0, min(240px, 26vw));
  align-items: stretch;
}

.summary-stack,
.result-stack,
.publish-result-list,
.platform-list {
  display: grid;
  gap: 12px;
}

.segment-count-bar,
.segment-result__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.segment-editor {
  display: grid;
  gap: 12px;
}

.video-segment-row {
  display: grid;
  gap: 8px;
}

.video-segment-label {
  font-size: 12px;
}

.video-segment-input :deep(.n-input),
.video-segment-input :deep(.n-input-wrapper) {
  background: rgba(248, 250, 255, 0.94);
}

.video-segment-result {
  padding: 16px;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
}

.video-preview-wrap {
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 16px;
  background: rgba(236, 242, 255, 0.72);
}

.video-preview {
  display: block;
  width: 100%;
  max-height: 360px;
  background: #e8eef9;
}

.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.phone-preview {
  display: grid;
  place-items: center;
}

.phone-face {
  display: grid;
  place-items: center;
  width: min(210px, 100%);
  aspect-ratio: 9 / 16;
  color: #ffffff;
  border-radius: 24px;
  background:
    radial-gradient(circle at 50% 20%, rgba(75, 107, 255, 0.2), transparent 26%),
    linear-gradient(180deg, #2a3856, #152036);
  box-shadow:
    0 18px 42px rgba(64, 86, 122, 0.22),
    0 0 34px rgba(75, 107, 255, 0.12);
  overflow: hidden;
}

.phone-face--video {
  padding: 0;
  background: #0f172a;
}

.phone-face--video video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #0f172a;
}

.publish-left,
.publish-center {
  display: grid;
  gap: 18px;
  min-height: 0;
  align-content: start;
}

.publish-hero {
  padding: 22px;
  color: var(--text-main);
  border: 1px solid var(--border-strong);
  border-radius: 20px;
  background:
    radial-gradient(circle at 90% 0%, rgba(75, 107, 255, 0.22), transparent 32%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(236, 242, 255, 0.94) 54%, rgba(228, 236, 248, 0.96));
  box-shadow: 0 18px 44px rgba(75, 107, 255, 0.1);
}

.publish-hero h1 {
  margin: 0 0 6px;
}

.publish-hero p {
  margin: 0;
  opacity: 0.8;
}

.publish-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 18px;
}

.publish-stats div {
  padding: 12px;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
}

.publish-stats strong,
.publish-stats span {
  display: block;
}

.publish-stats span {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.72;
}

.publish-copy :deep(.n-input) {
  background: rgba(248, 250, 255, 0.94);
}

.cover-row {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  margin: 14px 0;
}

.cover-thumb {
  display: grid;
  place-items: center;
  width: 52px;
  height: 62px;
  color: #ffffff;
  border-radius: 12px;
  background: linear-gradient(145deg, var(--primary), var(--accent-teal));
  box-shadow: 0 0 24px rgba(75, 107, 255, 0.16);
  font-size: 12px;
}

.publish-result-item,
.platform-item {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.66);
}

.publish-result-item p {
  margin: 0;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.6;
}

.platform-item {
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-smooth);
}

.platform-item:hover {
  border-color: var(--border-strong);
  background: rgba(75, 107, 255, 0.08);
  transform: translateX(4px);
}

.platform-item > span {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  color: #ffffff;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  font-size: 12px;
}

.platform-item p {
  margin: 4px 0 0;
  color: var(--text-sub);
  font-size: 11px;
}

.schedule-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}

.schedule-options button {
  height: 38px;
  color: var(--text-sub);
  cursor: pointer;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.7);
}

.schedule-options button.active {
  color: #ffffff;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
}

.publish-btn {
  height: 44px;
  margin-bottom: 14px;
  border-radius: 12px;
}

.plan-empty {
  display: grid;
  place-items: center;
  min-height: 88px;
  color: var(--text-sub);
  border-radius: 14px;
  border: 1px dashed rgba(121, 144, 184, 0.22);
  background: rgba(255, 255, 255, 0.58);
  font-size: 13px;
  text-align: center;
}

.phone-face--poster {
  align-content: end;
  gap: 6px;
  padding: 26px 14px;
  text-align: center;
  background:
    linear-gradient(180deg, transparent 45%, rgba(16, 28, 48, 0.72)),
    radial-gradient(circle at 50% 18%, rgba(75, 107, 255, 0.42), transparent 22%),
    linear-gradient(180deg, #243453, #172235);
}

.phone-face--poster strong {
  color: #dce7ff;
  font-size: 19px;
}

.phone-face--poster span {
  font-size: 12px;
}

.meta-readonly {
  white-space: pre-wrap;
  line-height: 1.7;
}

.create-footer {
  position: fixed;
  right: var(--shell-pad, 18px);
  bottom: max(12px, var(--app-safe-bottom));
  left: calc(var(--shell-pad, 18px) + var(--shell-sidebar-width, 252px) + var(--shell-gap, 18px));
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--vc-gap-lg);
  height: clamp(56px, 7vw, 62px);
  padding: 0 clamp(16px, 2vw, 22px);
  border: 1px solid rgba(255, 255, 255, 0.58);
  border-radius: 22px;
  border-top: 1px solid var(--border-soft);
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 -10px 34px rgba(64, 86, 122, 0.1);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.footer-progress {
  width: min(240px, 40vw);
}

.footer-progress strong {
  display: block;
  margin: 2px 0 4px;
  color: var(--primary);
  font-size: 12px;
}

.next-btn {
  min-width: 150px;
  border-color: rgba(75, 107, 255, 0.32);
  border-radius: 14px;
}

@media (min-width: 1281px) {
  :global(body) {
    overflow: hidden;
  }

  :global(.shell) {
    height: 100dvh;
  }

  :global(.shell__content),
  :global(.shell__main) {
    height: 100%;
    min-height: 0;
  }

  :global(.shell__main) {
    overflow: hidden;
  }

  .video-create {
    height: 100%;
    min-height: 0;
  }

  .create-layout,
  .step-two-layout,
  .edit-layout,
  .publish-layout {
    overflow: hidden;
  }

  .main-board {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--vc-gap-lg);
  }

  .workspace > .panel,
  .step-two-workbench > .panel,
  .edit-main > .panel,
  .edit-layout > .panel,
  .publish-left > .panel,
  .publish-center > .panel,
  .script-side,
  .preview-side {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }

  .step-two-layout {
    grid-template-rows: auto minmax(0, 1fr);
  }

  .edit-main {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: var(--vc-gap-lg);
    min-height: 0;
  }

  .publish-left {
    grid-template-rows: auto minmax(0, 1fr);
    overflow: hidden;
  }

  .publish-center {
    grid-template-rows: minmax(0, 1fr) auto;
    overflow: hidden;
  }
}

.step-switch-enter-active,
.step-switch-leave-active {
  transition:
    opacity 0.24s ease,
    transform var(--transition-smooth),
    filter 0.24s ease;
}

.step-switch-enter-from {
  opacity: 0;
  filter: blur(8px);
  transform: translateY(12px) scale(0.992);
}

.step-switch-leave-to {
  opacity: 0;
  filter: blur(6px);
  transform: translateY(-8px) scale(0.992);
}

@media (max-width: 1280px) {
  .video-create {
    display: block;
    overflow: visible;
  }

  .create-topbar {
    grid-template-columns: 1fr;
  }

  .topbar-progress {
    justify-self: start;
    text-align: left;
  }

  .stepper {
    justify-content: flex-start;
    gap: 14px;
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 6px;
    scrollbar-width: none;
  }

  .stepper::-webkit-scrollbar {
    display: none;
  }

  .create-layout,
  .workspace,
  .step-two-workbench,
  .edit-layout,
  .publish-layout {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .script-side,
  .preview-side {
    min-height: 0;
    border-left: 0;
    border-top: 1px solid var(--border-soft);
  }

  .step-two-workbench > .panel {
    overflow: visible;
  }

  .step-two-hook-row,
  .step-two-slider-grid,
  .step-two-control-grid,
  .avatar-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .lip-sync-setup-card__tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1281px) and (max-width: 1540px) {
  .create-layout {
    grid-template-columns: 1fr;
  }

  .script-side {
    min-height: 0;
    border-left: 0;
    border-top: 1px solid var(--border-soft);
  }

  .step-two-workbench {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .step-two-avatar-panel {
    grid-column: 1 / -1;
  }

  .step-two-avatar-panel .avatar-strip {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .edit-layout {
    grid-template-columns: minmax(0, 1fr) 300px;
  }

  .edit-main,
  .subtitle-panel {
    grid-column: 1 / 2;
  }

  .preview-side {
    grid-column: 2 / 3;
    grid-row: 1 / span 2;
  }

  .publish-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .preview-side--publish {
    grid-column: 1 / -1;
    grid-row: auto;
    border-left: 0;
    border-top: 1px solid var(--border-soft);
  }
}

@media (max-width: 980px) {
  .panel-head,
  .panel-head--between,
  .section-title--between,
  .segment-count-bar,
  .segment-result__head,
  .outline-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .summary-card,
  .publish-stats {
    grid-template-columns: 1fr;
  }

  .workflow-progress-card__head {
    flex-direction: column;
  }

  .workflow-progress-card__head > b {
    align-self: flex-start;
  }

  .workflow-progress-card {
    grid-template-rows: auto auto;
    padding: 18px;
  }

  .workflow-progress-track {
    display: none;
  }

  .workflow-progress-steps {
    grid-template-columns: 1fr;
    grid-row: auto;
  }

  .workflow-progress-steps li {
    justify-self: stretch;
    justify-content: start;
  }

  .subtitle-table-head {
    display: none;
  }

  .subtitle-table li {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .hook-preview {
    grid-template-columns: 1fr;
  }

  .template-chip-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .benchmark-post-grid {
    grid-template-columns: 1fr;
  }

  .platform-item {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .platform-item :deep(.n-button) {
    grid-column: 2 / 3;
    justify-self: start;
  }

  .create-footer {
    height: auto;
    padding: 14px 16px calc(14px + var(--app-safe-bottom));
    flex-direction: column;
    align-items: stretch;
  }

  .footer-progress {
    width: 100%;
  }

  .create-footer :deep(.n-space) {
    justify-content: flex-end;
  }
}

@media (max-width: 860px) {
  .create-layout,
  .step-two-layout,
  .edit-layout,
  .publish-layout {
    padding-left: 14px;
    padding-right: 14px;
  }

  .input-actions,
  .outline-footer,
  .benchmark-input-row,
  .benchmark-action-row,
  .publish-stats,
  .schedule-options {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .create-footer {
    left: 14px;
    right: 14px;
    bottom: max(14px, var(--app-safe-bottom));
    padding-left: 14px;
    padding-right: 14px;
  }
}

@media (max-width: 760px) {
  .video-create {
    padding-bottom: calc(148px + var(--app-safe-bottom));
  }

  .create-topbar {
    gap: 12px;
    padding: 14px;
  }

  .script-side,
  .preview-side,
  .panel,
  .publish-hero {
    border-radius: 18px;
  }

  .source-switch {
    grid-template-columns: 1fr;
  }

  .phone-face {
    width: min(220px, 100%);
  }

  .cover-row {
    grid-template-columns: 48px minmax(0, 1fr);
    align-items: start;
  }

  .next-btn {
    width: 100%;
  }
}

@media (max-width: 560px) {
  .create-layout,
  .step-two-layout,
  .edit-layout,
  .publish-layout {
    gap: 16px;
  }

  .step-two-block-head,
  .step-two-script-meta,
  .step-two-footnote,
  .voice-preview-card__head,
  .voice-preview-card__player,
  .lip-sync-setup-card__resolution {
    align-items: flex-start;
    flex-direction: column;
  }

  .step-two-hook-row,
  .step-two-slider-grid,
  .step-two-control-grid,
  .meta-board__summary,
  .step-three-summary,
  .avatar-strip,
  .lip-sync-setup-card__tabs {
    grid-template-columns: 1fr;
  }

  .input-actions--triple {
    grid-template-columns: 1fr;
  }

  .template-chip-grid {
    grid-template-columns: 1fr;
  }

  .step-two-workbench,
  .workspace {
    gap: 16px;
  }

  .benchmark-card {
    grid-template-columns: 1fr;
    justify-items: start;
  }

  .benchmark-card__check {
    justify-self: end;
  }

  .source-switch__item,
  .idea-action {
    min-height: 52px;
  }

  .script-side,
  .preview-side {
    padding: 16px 14px;
  }

  .phone-face {
    width: min(100%, 240px);
  }
}

.step-two-script-frame {
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(247, 250, 255, 0.88));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.step-two-script-frame--empty {
  display: flex;
}

.step-two-script-frame--empty .empty-block--embedded {
  width: 100%;
  min-height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.step-two-script-scroll {
  padding: 8px 0;
  scrollbar-gutter: stable;
}

.step-two-script-list {
  gap: 0;
}

.step-two-script-line {
  padding: 14px 16px;
  border: 0;
  border-bottom: 1px solid rgba(121, 144, 184, 0.12);
  border-radius: 0;
  background: transparent;
}

.step-two-script-line:last-child {
  border-bottom: 0;
}

.step-two-script-line span {
  padding-top: 2px;
  font-size: 11px;
}

.step-two-script-line p {
  font-size: clamp(13px, 0.45vw + 12px, 14px);
  font-weight: 650;
}

.step-two-hook-row {
  gap: 10px;
}

.step-two-hook-card {
  padding: 12px 14px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(247, 242, 255, 0.96), rgba(245, 248, 255, 0.9));
  box-shadow: none;
}

.step-two-voice-shell {
  display: grid;
  gap: 10px;
  align-content: start;
  min-height: 0;
  max-height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px;
  padding-right: 12px;
  padding-bottom: 16px;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(248, 250, 255, 0.96), rgba(240, 245, 255, 0.9));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: rgba(75, 107, 255, 0.32) transparent;
}

.step-two-voice-shell::-webkit-scrollbar {
  width: 8px;
}

.step-two-voice-shell::-webkit-scrollbar-track {
  margin: 14px 0;
  border-radius: 999px;
  background: transparent;
}

.step-two-voice-shell::-webkit-scrollbar-thumb {
  min-height: 42px;
  border: 2px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(75, 107, 255, 0.34), rgba(75, 199, 187, 0.42))
    padding-box;
}

.step-two-voice-panel {
  overflow: hidden !important;
}

.step-two-voice-panel .step-two-slider-grid {
  display: none;
}

.step-two-control-grid,
.step-two-slider-grid {
  gap: 8px;
}

.step-two-control-card,
.step-two-slider-card,
.voice-preview-card {
  border-radius: 18px;
  box-shadow: none;
}

.step-two-control-card,
.step-two-slider-card {
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.86);
}

.step-two-control-card__main {
  gap: 12px;
}

.step-two-control-card :deep(.n-base-selection),
.step-two-control-card :deep(.n-base-selection-label),
.step-two-control-card :deep(.n-base-selection-tags),
.step-two-control-card :deep(.n-input-wrapper) {
  min-height: 44px;
  border-radius: 14px;
  background: rgba(247, 249, 255, 0.94);
}

.step-two-slider-card {
  gap: 8px;
}

.step-two-slider-card :deep(.n-slider-rail) {
  height: 6px;
  border-radius: 999px;
  background: rgba(191, 201, 223, 0.42);
}

.step-two-slider-card :deep(.n-slider-fill) {
  background: linear-gradient(90deg, #5d72ff, #7d47ff);
}

.step-two-slider-card :deep(.n-slider-handle) {
  box-shadow: 0 10px 22px rgba(106, 89, 255, 0.22);
}

.voice-power-stepper {
  border-radius: 16px;
  background: rgba(247, 249, 255, 0.94);
  box-shadow: none;
}

.voice-power-stepper button {
  min-height: 44px;
  font-size: 18px;
}

.step-two-inline-alert {
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
}

.step-two-primary-btn {
  min-height: 48px;
  flex-shrink: 0;
  border-radius: 16px;
  font-size: 15px;
}

.voice-generate-progress {
  flex-shrink: 0;
  width: 100%;
}

.voice-preview-card {
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.86);
}

.voice-preview-card__player {
  padding: 12px 14px;
  border-radius: 16px;
}

.voice-source-switch {
  padding: 5px;
  border-radius: 20px;
}

.voice-source-switch__item {
  min-height: 44px;
}

.step-two-avatar-panel {
  align-content: start;
}

.step-two-block-head :deep(.n-button) {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  background: rgba(245, 242, 255, 0.92);
}

.avatar-strip--filled {
  grid-template-columns: none;
  grid-auto-flow: column;
  grid-auto-columns: min(100%, clamp(104px, 9.8vw, 122px));
  align-items: start;
  overflow-x: auto;
  padding-bottom: 8px;
  scrollbar-color: rgba(75, 107, 255, 0.2) transparent;
}

.avatar-empty-state {
  display: grid;
  gap: 10px;
  align-content: start;
}

.avatar-empty-state__hint {
  margin: 0;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.7;
}

.avatar-add-card,
.avatar-select-card {
  min-height: clamp(150px, 17vw, 172px);
  padding: 10px 10px 8px;
  border-radius: clamp(18px, 1.6vw, 22px);
}

.avatar-add-card--compact {
  width: min(100%, clamp(104px, 9.8vw, 122px));
}

.avatar-add-card--empty {
  width: min(136px, 100%);
  min-height: clamp(154px, 18vw, 176px);
  justify-self: start;
  align-content: center;
}

.avatar-select-card__image,
.avatar-select-card__video,
.avatar-select-card__placeholder {
  aspect-ratio: 9 / 13;
  border-radius: clamp(15px, 1.35vw, 18px);
}

.avatar-select-card__name {
  text-align: center;
  font-size: 11px;
  color: var(--text-light);
}

.lip-sync-setup-card {
  gap: 11px;
  padding: 12px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 249, 255, 0.9));
}

.lip-sync-setup-card__tabs {
  gap: 8px;
}

.lip-sync-setup-card__tab {
  padding: 11px 12px;
  border-radius: 14px;
}

.lip-sync-setup-card__tab strong {
  font-size: 14px;
}

.lip-sync-setup-card__summary {
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.lip-sync-setup-card__summary .summary-pill {
  padding: 8px 10px;
  border-radius: 14px;
  background: rgba(248, 250, 255, 0.92);
  min-width: 0;
}

.lip-sync-setup-card__summary .summary-pill strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (min-width: 1281px) and (max-width: 1540px) {
  .step-two-workbench {
    grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  }

  .step-two-avatar-panel {
    grid-column: 1 / -1;
  }

  .avatar-strip--filled {
    grid-auto-columns: min(100%, clamp(104px, 11vw, 124px));
  }
}

@media (max-width: 980px) {
  .step-two-control-grid,
  .step-two-slider-grid,
  .lip-sync-setup-card__summary {
    grid-template-columns: 1fr;
  }

  .avatar-strip--filled {
    grid-auto-flow: row;
    grid-auto-columns: initial;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    overflow-x: visible;
  }
}

@media (max-width: 560px) {
  .avatar-strip--filled {
    grid-template-columns: 1fr;
  }

  .avatar-add-card--compact,
  .avatar-add-card--empty {
    width: 100%;
  }
}
</style>
