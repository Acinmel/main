<script setup lang="ts">
import {
  NAlert,
  NButton,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NInputNumber,
  NProgress,
  NSelect,
  NSpace,
  NTag,
  NText,
  NUpload,
  useMessage,
} from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
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
  createLipSyncPreview,
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
  transcribeUploadFile,
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
import { isDouyinNormalizedUrl, validateSourceVideoInput } from '@/utils/douyinShareUrl'
import { formatStatCount } from '@/utils/formatDisplay'
import {
  describeHttpOrNetworkError,
  describeHttpOrNetworkErrorMaybeBlob,
} from '@/utils/httpErrorMessage'
import axios from 'axios'

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

type SegmentGenState = {
  progress: number
  processing: boolean
  statusLabel: string
  videoUrl: string | null
  hint: string
  optimizedScript: string
  error?: string
}

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
  { no: 3, title: '一键成片', desc: '分段生成对口型视频' },
  { no: 4, title: '自动发布', desc: '预留发布账号与计划' },
]

const publishPlatforms = [
  { name: '抖音', icon: '抖', account: '0 个账号' },
  { name: '视频号', icon: '视', account: '0 个账号' },
  { name: '小红书', icon: '红', account: '0 个账号' },
  { name: '快手', icon: '快', account: '0 个账号' },
]

const VIDEO_SEGMENT_MAX = 6
const VIDEO_SEGMENT_MAX_CHARS = 60
const apiBasePath = (() => {
  const raw =
    typeof import.meta.env.VITE_API_BASE_URL === 'string' &&
    import.meta.env.VITE_API_BASE_URL.length > 0
      ? import.meta.env.VITE_API_BASE_URL
      : '/api'
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
})()

function isRequestCanceled(e: unknown): boolean {
  if (axios.isCancel(e)) return true
  if (e && typeof e === 'object') {
    if ('code' in e && (e as { code: string }).code === 'ERR_CANCELED') return true
    if ('name' in e) {
      const name = (e as { name: string }).name
      if (name === 'CanceledError' || name === 'AbortError') return true
    }
  }
  return false
}

function emptySegmentGenState(): SegmentGenState {
  return {
    progress: 0,
    processing: false,
    statusLabel: '',
    videoUrl: null,
    hint: '',
    optimizedScript: '',
    error: undefined,
  }
}

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
const douyinPipeline = ref(false)
const pipelinePhase = ref<'idle' | 'download' | 'transcribe'>('idle')
const pipelineProgress = ref(0)
const pipelineBarProcessing = ref(false)
const transcribeUploadLoading = ref(false)
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

const videoSegmentCount = ref<number | null>(3)
const videoScriptSegments = ref<string[]>(
  Array.from({ length: VIDEO_SEGMENT_MAX }, () => ''),
)
const generateVideoLoading = ref(false)
const generateVideoEstimatedTotalSec = ref(0)
const generateBatchAbort = ref<AbortController | null>(null)
const generateQueueStopRequested = ref(false)
const segmentGenStates = ref<SegmentGenState[]>(
  Array.from({ length: VIDEO_SEGMENT_MAX }, emptySegmentGenState),
)
const segmentProgressTimers = ref<Array<ReturnType<typeof setInterval> | null>>(
  Array(VIDEO_SEGMENT_MAX).fill(null),
)

const urlInvalid = computed(() => {
  if (!draft.videoUrl?.trim()) return false
  return !validateSourceVideoInput(draft.videoUrl).ok
})

const linkReady = computed(() => validateSourceVideoInput(draft.videoUrl).ok)
const canTranscribeNonDouyinUrl = computed(
  () => linkReady.value && !isDouyinNormalizedUrl(draft.videoUrl),
)
const safeSegmentCount = computed(() => {
  const value = videoSegmentCount.value
  if (value == null || Number.isNaN(Number(value))) return 3
  return Math.min(VIDEO_SEGMENT_MAX, Math.max(1, Math.round(Number(value))))
})
const canGenerateVideoPreview = computed(() => {
  const segments = videoScriptSegments.value.slice(0, safeSegmentCount.value)
  return (
    segments.some((segment) => segment.trim().length >= 2) &&
    Boolean(selectedAvatarId.value) &&
    Boolean(selectedVoiceId.value)
  )
})
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
const showSegmentResultBlocks = computed(
  () =>
    generateVideoLoading.value ||
    segmentGenStates.value.some(
      (state) =>
        state.statusLabel ||
        state.videoUrl ||
        state.error ||
        state.progress > 0 ||
        state.processing,
    ),
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
  const fromSegments = draft.transcriptSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
  if (fromSegments.length) return fromSegments

  const raw = draft.manualScriptDraft.trim()
  if (!raw) return []
  const lines = raw
    .split(/\r\n|\n|\r/)
    .map((segment) => segment.trim())
    .filter(Boolean)
  if (lines.length > 1) return lines

  const chunks = raw.match(/.{1,26}/g)
  return chunks?.map((segment) => segment.trim()).filter(Boolean) ?? [raw]
})
const oralScriptSourceText = computed(() => {
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

const rawWorkflowScript = computed(() => draft.manualScriptDraft.trim())
const currentWorkflowScript = computed(() => sanitizeWorkflowScriptText(rawWorkflowScript.value))
const firstReadyVideoUrl = computed(() => {
  if (subtitleWorkflowFinalUrl.value) return subtitleWorkflowFinalUrl.value
  if (subtitleWorkflowPreviewUrl.value) return subtitleWorkflowPreviewUrl.value
  return segmentGenStates.value.find((state) => state.videoUrl)?.videoUrl ?? null
})
const generatedVideoCount = computed(() => {
  if (subtitleWorkflowFinalUrl.value || subtitleWorkflowPreviewUrl.value) return 1
  return segmentGenStates.value.filter((state) => state.videoUrl).length
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
  return segmentGenStates.value
    .map((state, index) => ({
      index: index + 1,
      videoUrl: state.videoUrl,
      text: state.optimizedScript || videoScriptSegments.value[index] || '',
    }))
    .filter((item) => item.videoUrl)
})
const footerNextLabel = computed(() => {
  if (activeStep.value === 1) return '下一步：配音 & 数字人'
  if (activeStep.value === 2) return '下一步：一键成片'
  if (activeStep.value === 3) return '下一步：自动发布'
  return '四步已完成'
})

function segmentInputPlaceholder(index1Based: number) {
  return `第 ${index1Based} 段口播（最多 ${VIDEO_SEGMENT_MAX_CHARS} 字）`
}

function clearSegmentProgressTimer(index: number) {
  const timer = segmentProgressTimers.value[index]
  if (timer) {
    clearInterval(timer)
    segmentProgressTimers.value[index] = null
  }
}

function clearAllSegmentProgressTimers() {
  for (let i = 0; i < VIDEO_SEGMENT_MAX; i += 1) clearSegmentProgressTimer(i)
}

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

function startFakeProgressForSegment(index: number, estimatedSec: number) {
  clearSegmentProgressTimer(index)
  const startedAt = Date.now()
  const targetMs = Math.max(8000, estimatedSec * 920)
  segmentGenStates.value[index].processing = true
  segmentGenStates.value[index].progress = 0
  segmentProgressTimers.value[index] = setInterval(() => {
    const elapsed = Date.now() - startedAt
    const progress = Math.min(92, Math.floor((elapsed / targetMs) * 92))
    segmentGenStates.value[index].progress = progress
    if (progress < 24) {
      segmentGenStates.value[index].statusLabel = '正在准备文案和素材'
    } else if (progress < 52) {
      segmentGenStates.value[index].statusLabel = '正在生成配音音轨'
    } else if (progress < 82) {
      segmentGenStates.value[index].statusLabel = '正在驱动视频对口型'
    } else {
      segmentGenStates.value[index].statusLabel = '正在等待成片返回'
    }
  }, 280)
}

function markGenerateSlotsCancelledFrom(
  toRun: { s: string; idx: number }[],
  fromIndex: number,
  firstWasAbortedRequest: boolean,
) {
  for (let i = fromIndex; i < toRun.length; i += 1) {
    const slot = toRun[i].idx
    clearSegmentProgressTimer(slot)
    segmentGenStates.value[slot] = {
      ...emptySegmentGenState(),
      statusLabel:
        i === fromIndex && firstWasAbortedRequest
          ? '已取消（当前请求已中断）'
          : '已取消（后续未继续发起）',
    }
  }
}

function importSegmentsFromManualDraft() {
  const raw = draft.manualScriptDraft.trim()
  if (!raw) {
    message.warning('请先在上一步准备好文案。')
    return
  }
  const parts = raw
    .split(/\r\n|\n|\r/)
    .map((segment) => segment.trim())
    .filter(Boolean)
  const count = safeSegmentCount.value

  for (let i = 0; i < VIDEO_SEGMENT_MAX; i += 1) {
    videoScriptSegments.value[i] = ''
  }

  if (parts.length <= 1) {
    let cursor = 0
    for (let i = 0; i < count; i += 1) {
      videoScriptSegments.value[i] = raw.slice(
        cursor,
        cursor + VIDEO_SEGMENT_MAX_CHARS,
      )
      cursor += VIDEO_SEGMENT_MAX_CHARS
    }
    if (cursor < raw.length) {
      message.warning('文案超过本批可容纳字数，末尾内容已暂时省略。')
    } else {
      message.success('已按顺序自动拆分到各个片段。')
    }
    return
  }

  for (let i = 0; i < count; i += 1) {
    videoScriptSegments.value[i] = (parts[i] ?? '').slice(0, VIDEO_SEGMENT_MAX_CHARS)
  }
  if (parts.length > count) {
    message.info(`检测到 ${parts.length} 行，仅载入前 ${count} 行。`)
  } else {
    message.success('已按行载入口播片段。')
  }
}

function onVideoSegmentInput(index: number, value: string | null) {
  videoScriptSegments.value[index] = (value ?? '').slice(0, VIDEO_SEGMENT_MAX_CHARS)
}

function estimateGenerateSeconds(scriptLength: number) {
  return Math.min(180, Math.max(18, Math.round(18 + scriptLength * 0.35)))
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
    voiceResourceItems.value = voices.items
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
    message.success('克隆音频已加入当前创作，并自动选中。')
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    cloningVoice.value = false
  }
}

function resetVoicePreviewState() {
  voicePreviewUrl.value = null
  voicePreviewHint.value = ''
  voicePreviewMode.value = ''
  voicePreviewDurationSeconds.value = 0
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

async function onGenerateVoicePreview() {
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
  try {
    const data = await createVoicePreview({
      script,
      voiceResourceId: selectedVoiceId.value,
    })
    voicePreviewUrl.value = data.audioUrl
    voicePreviewHint.value = data.hint
    voicePreviewMode.value = data.ttsMode
    voicePreviewDurationSeconds.value = data.durationSeconds
    message.success(
      data.ttsMode === 'provider'
        ? `已生成「${data.voiceLabel}」的可试听配音。`
        : '真实 TTS 暂未走通，已生成占位试听音频供流程验收。',
    )
  } catch (e: unknown) {
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
    message.warning('请先至少生成一条对口型视频，再进入自动发布。')
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
      applyTranscriptToEditableScript({
        fullText: result.transcript.fullText,
        segments: result.transcript.segments,
        transcriptId: result.transcript.transcriptId,
      })
      message.success('抖音视频已下载并完成文案转写。')
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
      applyTranscriptToEditableScript({
        fullText: result.transcript.fullText,
        segments: result.transcript.segments,
        transcriptId: result.transcript.transcriptId,
      })
      message.success('已从本地保存视频重新生成文案。')
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

async function onTranscribeUpload(options: { fileList: UploadFileInfo[] }) {
  const raw = options.fileList[0]?.file
  const file = raw instanceof File ? raw : null
  if (!file?.size) return
  transcribeUploadLoading.value = true
  try {
    const data = await transcribeUploadFile(file)
    resetOralScriptPolish()
    applyTranscriptToEditableScript({
      fullText: data.fullText,
      segments: data.segments,
      transcriptId: data.transcriptId,
    })
    message.success('上传文件已完成转写。')
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    transcribeUploadLoading.value = false
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
    applyTranscriptToEditableScript({
      fullText: data.fullText,
      segments: data.segments,
      transcriptId: data.transcriptId,
    })
    message.success('当前链接内容已完成转写。')
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    transcribeUrlLoading.value = false
  }
}

function cancelGenerateQueue() {
  if (!generateVideoLoading.value) return
  generateQueueStopRequested.value = true
  generateBatchAbort.value?.abort()
}

async function onGenerateVideo() {
  const count = safeSegmentCount.value
  const segments = videoScriptSegments.value.slice(0, count).map((segment) => segment.trim())
  const toRun = segments
    .map((segment, index) => ({ s: segment, idx: index }))
    .filter(({ s }) => s.length >= 2)

  if (toRun.length === 0) {
    message.warning('请至少填写一条口播内容，或从上一步文案载入。')
    return
  }
  if (!selectedAvatarId.value) {
    message.warning('请先选择一个数字人视频。')
    return
  }
  if (!selectedVoiceId.value) {
    message.warning('请先选择一个配音音色。')
    return
  }

  clearAllSegmentProgressTimers()
  revokeGeneratedPreviewObjectUrls()
  generateQueueStopRequested.value = false
  const controller = new AbortController()
  generateBatchAbort.value = controller
  generateVideoLoading.value = true
  generateVideoEstimatedTotalSec.value = toRun.reduce(
    (total, { s }) => total + Math.min(600, estimateGenerateSeconds(s.length) + 90),
    0,
  )
  segmentGenStates.value = Array.from({ length: VIDEO_SEGMENT_MAX }, emptySegmentGenState)

  for (let i = 0; i < count; i += 1) {
    if (segments[i].length < 2) {
      segmentGenStates.value[i] = {
        ...emptySegmentGenState(),
        statusLabel: '未填写，已跳过',
      }
    }
  }

  toRun.forEach(({ idx }, index) => {
    segmentGenStates.value[idx] = {
      ...emptySegmentGenState(),
      statusLabel: `排队中（${index + 1}/${toRun.length}）`,
    }
  })

  let stoppedByUser = false

  try {
    for (let i = 0; i < toRun.length; i += 1) {
      if (generateQueueStopRequested.value) {
        stoppedByUser = true
        markGenerateSlotsCancelledFrom(toRun, i, false)
        break
      }

      const { s: script, idx } = toRun[i]
      const estimatedSec = Math.min(600, estimateGenerateSeconds(script.length) + 90)
      startFakeProgressForSegment(idx, estimatedSec)

      try {
        const result = await createLipSyncPreview(
          {
            script,
            avatarResourceId: selectedAvatarId.value,
            voiceResourceId: selectedVoiceId.value,
          },
          { signal: controller.signal },
        )
        clearSegmentProgressTimer(idx)
        let previewVideoUrl: string | null = null
        let previewHint = result.hint
        let previewLoadFailed = false
        if (result.videoUrl) {
          try {
            previewVideoUrl = await resolveGeneratedPreviewVideoUrl(result.videoUrl)
          } catch (previewError: unknown) {
            previewLoadFailed = true
            previewHint = `${result.hint} 预览视频加载失败：${describeHttpOrNetworkError(
              previewError,
            )}`
          }
        }
        segmentGenStates.value[idx] = {
          progress: 100,
          processing: false,
          statusLabel: previewLoadFailed ? '本段已完成（预览待重试）' : '本段已完成',
          videoUrl: previewVideoUrl,
          hint: previewHint,
          optimizedScript: result.optimizedScript,
        }
      } catch (e: unknown) {
        clearSegmentProgressTimer(idx)
        if (isRequestCanceled(e) || generateQueueStopRequested.value) {
          stoppedByUser = true
          markGenerateSlotsCancelledFrom(toRun, i, true)
          break
        }
        segmentGenStates.value[idx] = {
          progress: 100,
          processing: false,
          statusLabel: '本段失败',
          videoUrl: null,
          hint: '',
          optimizedScript: '',
          error: describeHttpOrNetworkError(e),
        }
      }
    }

    const okCount = segmentGenStates.value.slice(0, count).filter((item) => item.videoUrl).length
    if (okCount > 0) {
      message.success(
        stoppedByUser
          ? `已生成 ${okCount} 条对口型视频，并停止了后续任务。`
          : `已生成 ${okCount} 条对口型视频。`,
      )
    } else if (stoppedByUser) {
      message.info('已取消，本次没有成功生成片段。')
    } else {
      message.warning('这一批片段都还没有成功出片，请检查错误后重试。')
    }
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    clearAllSegmentProgressTimers()
    generateBatchAbort.value = null
    generateQueueStopRequested.value = false
    generateVideoLoading.value = false
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

watch(videoSegmentCount, (value) => {
  if (value == null || Number.isNaN(Number(value))) {
    videoSegmentCount.value = 3
    return
  }
  const next = Math.min(VIDEO_SEGMENT_MAX, Math.max(1, Math.round(Number(value))))
  if (next !== value) videoSegmentCount.value = next
})

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
  void loadRenderResources()
  void refreshDyCookieStatus()
  void refreshPipelineHealth()
  syncPublishCopyFromScript(true)
})

onUnmounted(() => {
  cancelStream()
  clearAllSegmentProgressTimers()
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
                    获取视频信息
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

                <n-text v-if="pipelineHealthError" depth="3" class="helper-text">
                  {{ pipelineHealthError }}
                </n-text>

                <div class="input-actions input-actions--triple">
                  <n-upload
                    :show-file-list="false"
                    :default-upload="false"
                    accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.webm,.mov,.mkv"
                    @change="onTranscribeUpload"
                  >
                    <n-button :loading="transcribeUploadLoading" block secondary>
                      上传音视频转写
                    </n-button>
                  </n-upload>
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

                  <n-descriptions
                    label-placement="left"
                    bordered
                    size="small"
                    :column="1"
                    class="meta-board"
                  >
                    <n-descriptions-item label="标题">
                      {{ draft.videoMeta.title || '暂无' }}
                    </n-descriptions-item>
                    <n-descriptions-item label="点赞">
                      {{ formatStatCount(draft.videoMeta.likeCount) }}
                    </n-descriptions-item>
                    <n-descriptions-item label="播放">
                      {{ formatStatCount(draft.videoMeta.playCount) }}
                    </n-descriptions-item>
                    <n-descriptions-item label="内容">
                      <div class="meta-readonly">
                        {{ draft.videoMeta.content || draft.videoMeta.description || '暂无可解析内容' }}
                      </div>
                    </n-descriptions-item>
                  </n-descriptions>
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
              <p>提取的文案</p>
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
              <div class="step-two-voice-shell">
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
                {{ voicePreviewLoading ? '正在生成试听音频...' : '生成音频' }}
              </button>

              <article
                class="voice-preview-card"
                :class="{ 'voice-preview-card--ready': Boolean(voicePreviewUrl) }"
              >
                <div class="voice-preview-card__head">
                  <div>
                    <strong>成品配音已就绪</strong>
                    <p>
                      {{
                        voicePreviewHint ||
                        (voicePreviewMode === 'mock'
                          ? '当前返回的是联调用预览音频。'
                          : '生成后可直接试听，确认声音再进入对口型。')
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

                <div v-if="voicePreviewUrl" class="voice-preview-card__player">
                  <button
                    type="button"
                    class="voice-preview-card__play"
                    @click="toggleAudioPlayback('voice-preview', resolveProtectedMediaUrl(voicePreviewUrl))"
                  >
                    {{ audioPlayingId === 'voice-preview' ? '暂停' : '播放' }}
                  </button>
                  <div>
                    <strong>{{ selectedVoiceLabel }}</strong>
                    <p>{{ formatSecondsClock(voicePreviewDurationSeconds) }}</p>
                  </div>
                  <n-button quaternary size="small" type="primary" @click="onDownloadVoicePreview">
                    下载
                  </n-button>
                </div>
                <div v-else class="voice-preview-card__empty">
                  <strong>点击上方按钮生成试听。</strong>
                  <p>生成结果会落到受保护地址，便于你直接验证克隆声音是否合适。</p>
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
                <p>确认本批分段数量和素材来源</p>
              </div>
            </div>

            <div class="summary-stack">
              <div class="summary-pill">
                <span>数字人视频</span>
                <strong>{{ selectedAvatarLabel }}</strong>
              </div>
              <div class="summary-pill">
                <span>配音音色</span>
                <strong>{{ selectedVoiceLabel }}</strong>
              </div>
              <div class="summary-pill">
                <span>本批生成条数</span>
                <strong>{{ selectedSubtitleTemplateLabel }}</strong>
              </div>
            </div>

            <div class="workflow-action-card">
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
              <n-text depth="3" class="helper-text">
                这条流程会先生成 TTS，再回填时间轴并生成 subtitle.json；确认 5 秒预览后再输出最终成片。
              </n-text>
            </div>

            <div class="segment-count-bar">
              <n-text depth="3">支持 1 到 {{ VIDEO_SEGMENT_MAX }} 条</n-text>
              <n-input-number
                v-model:value="videoSegmentCount"
                :min="1"
                :max="VIDEO_SEGMENT_MAX"
                :disabled="generateVideoLoading"
                size="small"
              />
            </div>

            <div class="input-actions">
              <n-button block secondary :disabled="generateVideoLoading" @click="importSegmentsFromManualDraft">
                从第一步文案载入
              </n-button>
              <n-button
                block
                type="primary"
                class="gradient-btn"
                :disabled="!canGenerateVideoPreview || generateVideoLoading"
                :loading="generateVideoLoading"
                @click="onGenerateVideo"
              >
                立即生成对口型视频
              </n-button>
            </div>

            <n-button
              v-if="generateVideoLoading"
              block
              secondary
              type="error"
              style="margin-top: 10px"
              @click="cancelGenerateQueue"
            >
              停止当前批次
            </n-button>

            <n-text
              v-if="generateVideoLoading || generateVideoEstimatedTotalSec > 0"
              depth="3"
              class="helper-text"
            >
              本批预计总耗时约 {{ generateVideoEstimatedTotalSec }} 秒，仅作参考。
            </n-text>
          </section>

          <section class="edit-options">
            <div class="switch-row switch-row--card">
              <span>文案已就绪</span>
              <b>{{ draft.manualScriptDraft.trim() ? '是' : '否' }}</b>
            </div>
            <div class="switch-row switch-row--card">
              <span>数字人视频</span>
              <b>{{ selectedAvatarLabel }}</b>
            </div>
            <div class="switch-row switch-row--card">
              <span>音色驱动</span>
              <b>{{ selectedVoiceLabel }}</b>
            </div>
          </section>
        </div>

        <section class="panel subtitle-panel">
          <div class="section-title section-title--between">
            <div class="section-title__main">
              <span class="title-icon">段</span>
              <div>
                <strong>口播片段</strong>
                <p>每段最多 {{ VIDEO_SEGMENT_MAX_CHARS }} 字</p>
              </div>
            </div>
            <n-tag size="small" :bordered="false">{{ safeSegmentCount }} 条</n-tag>
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

            <ol class="subtitle-list">
              <li v-for="cue in subtitleWorkflowJson.cues.slice(0, 6)" :key="cue.id">
                <span>{{ formatCueTime(cue.startMs) }}</span>
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
            <p>这里会先展示 subtitle.json 的断句和预览视频，确认后再输出最终成片。</p>
          </div>

          <div class="segment-editor">
            <div v-for="index in safeSegmentCount" :key="index" class="video-segment-row">
              <n-text class="video-segment-label" depth="3">第 {{ index }} 段</n-text>
              <n-input
                :value="videoScriptSegments[index - 1] ?? ''"
                :placeholder="segmentInputPlaceholder(index)"
                clearable
                :maxlength="VIDEO_SEGMENT_MAX_CHARS"
                show-count
                :disabled="generateVideoLoading"
                class="video-segment-input"
                @update:value="(value) => onVideoSegmentInput(index - 1, value)"
              />
            </div>
          </div>

          <div v-if="showSegmentResultBlocks" class="result-stack">
            <div
              v-for="slot in safeSegmentCount"
              :key="`segment-result-${slot}`"
              class="video-segment-result"
            >
              <div class="segment-result__head">
                <n-text strong>第 {{ slot }} 段</n-text>
                <n-tag
                  v-if="segmentGenStates[slot - 1]?.videoUrl"
                  size="small"
                  :bordered="false"
                  type="success"
                >
                  已出片
                </n-tag>
              </div>
              <n-progress
                type="line"
                :percentage="segmentGenStates[slot - 1]?.progress ?? 0"
                :processing="segmentGenStates[slot - 1]?.processing ?? false"
                indicator-placement="inside"
              />
              <n-text
                v-if="segmentGenStates[slot - 1]?.statusLabel"
                depth="3"
                class="helper-text"
              >
                {{ segmentGenStates[slot - 1]?.statusLabel }}
              </n-text>
              <n-alert
                v-if="segmentGenStates[slot - 1]?.error"
                type="error"
                :show-icon="false"
                style="margin-top: 8px"
              >
                {{ segmentGenStates[slot - 1]?.error }}
              </n-alert>
              <n-alert
                v-else-if="segmentGenStates[slot - 1]?.hint"
                type="info"
                :show-icon="false"
                style="margin-top: 8px"
              >
                {{ segmentGenStates[slot - 1]?.hint }}
              </n-alert>
              <div v-if="segmentGenStates[slot - 1]?.videoUrl" class="video-preview-wrap">
                <video
                  class="video-preview"
                  controls
                  playsinline
                  preload="metadata"
                  :src="segmentGenStates[slot - 1]?.videoUrl ?? undefined"
                />
              </div>
            </div>
          </div>
        </section>

        <aside class="preview-side">
          <div class="preview-head">
            <n-text strong>生成预览</n-text>
            <n-tag size="small" :bordered="false" type="info">{{ generatedVideoCount }} 条成片</n-tag>
          </div>
          <div class="phone-preview">
            <div v-if="firstReadyVideoUrl" class="phone-face phone-face--video">
              <video :src="firstReadyVideoUrl" controls playsinline preload="metadata" />
            </div>
            <div v-else class="phone-face">
              <span>生成后会在这里显示首条预览视频</span>
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
              <div><strong>{{ generatedVideoCount }}</strong><span>已生成片段</span></div>
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
                <strong>第 {{ item.index }} 条</strong>
                <p>{{ item.text || '已生成可发布视频' }}</p>
              </div>
              <div v-if="!publishReadyItems.length" class="plan-empty">
                先回到第三步至少生成一条对口型视频。
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
  --vc-gap-lg: clamp(12px, 1.4vw, 18px);
  --vc-panel-pad: clamp(10px, 1.05vw, 14px);
  --vc-radius: clamp(12px, 0.95vw, 16px);
  --vc-h1: clamp(17px, 0.75vw + 14px, 20px);
  --vc-aside-w: min(100%, clamp(200px, 24vw, 252px));

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
  grid-template-columns: minmax(0, 1fr) minmax(0, var(--vc-aside-w));
  gap: var(--vc-gap-lg);
  min-height: 0;
  padding: var(--vc-pad-y) var(--vc-pad-x) 0;
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
  grid-template-columns: minmax(0, 1.02fr) minmax(0, 1fr);
  gap: var(--vc-gap-lg);
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
  gap: var(--vc-gap-lg);
}

.panel--outline {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
}

.source-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.source-switch__item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: clamp(48px, 5vw, 56px);
  padding: 0 clamp(12px, 1.2vw, 16px);
  color: var(--text-sub);
  cursor: pointer;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 18px;
  background: rgba(247, 249, 255, 0.92);
  box-shadow: 0 10px 24px rgba(65, 83, 122, 0.06);
  transition:
    border-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.source-switch__item:hover,
.source-switch__item--active {
  color: var(--text-main);
  border-color: rgba(75, 107, 255, 0.24);
  box-shadow: 0 14px 30px rgba(75, 107, 255, 0.12);
  transform: translateY(-2px);
}

.source-switch__icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--primary);
  border-radius: 999px;
  background: rgba(75, 107, 255, 0.08);
  font-size: 13px;
  font-weight: 700;
}

.benchmark-pane,
.hotlink-pane {
  display: grid;
  gap: 14px;
}

.benchmark-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}

.benchmark-submit {
  min-width: 148px;
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

.benchmark-result {
  display: grid;
  gap: 16px;
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
  gap: 16px;
  width: 100%;
  padding: 18px 20px;
  color: inherit;
  text-align: left;
  cursor: pointer;
  border: 1.5px solid rgba(75, 107, 255, 0.4);
  border-radius: 24px;
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
  width: 58px;
  height: 58px;
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
  font-size: 20px;
}

.benchmark-card__stats {
  margin-top: 8px;
  color: var(--text-main);
  font-size: 14px;
  font-weight: 600;
}

.benchmark-card__body p {
  margin: 8px 0 0;
  color: var(--text-sub);
  font-size: 13px;
  line-height: 1.6;
}

.benchmark-card__check {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
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
  gap: 10px;
}

.benchmark-post {
  display: grid;
  gap: 10px;
  min-height: 112px;
  padding: 14px;
  border: 1px solid rgba(121, 144, 184, 0.16);
  border-radius: 18px;
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
  gap: 12px;
}

.idea-action {
  min-height: 54px;
  padding: 0 18px;
  color: var(--text-main);
  font-size: 16px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid rgba(121, 144, 184, 0.18);
  border-radius: 18px;
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
  min-height: 260px;
  padding: 20px;
  text-align: center;
  border: 1px dashed rgba(121, 144, 184, 0.22);
  border-radius: 24px;
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
  margin-top: 16px;
}

.input-actions--triple {
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
}

.meta-board {
  margin-top: 18px;
}

.outline-editor :deep(.n-input),
.outline-editor :deep(.n-input-wrapper) {
  min-height: 100%;
  background: rgba(248, 250, 255, 0.94);
}

.outline-editor {
  min-height: 0;
}

.outline-editor :deep(textarea) {
  max-height: 100%;
  overflow-y: auto;
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

.step-two-head p {
  margin: 0;
  color: var(--text-sub);
  font-size: 13px;
}

.step-two-workbench {
  display: grid;
  grid-template-columns: minmax(0, 1.04fr) minmax(0, 1fr) minmax(0, 0.98fr);
  gap: var(--vc-gap-lg);
  min-height: 0;
  align-items: stretch;
}

.step-two-workbench > .panel {
  display: grid;
  gap: var(--vc-gap);
  min-height: 0;
  overflow: hidden;
}

.step-two-script-panel {
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
}

.step-two-voice-panel,
.step-two-avatar-panel {
  grid-template-rows: auto auto minmax(0, auto);
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
  row-gap: 10px;
  column-gap: 12px;
}

.step-two-block-head__main {
  min-width: min(100%, 220px);
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
  width: clamp(38px, 3.2vw + 30px, 44px);
  height: clamp(38px, 3.2vw + 30px, 44px);
  color: #fff;
  border-radius: clamp(14px, 1.1vw, 17px);
  background: linear-gradient(135deg, #7c4dff, #5a6dff);
  box-shadow: 0 20px 46px rgba(94, 86, 255, 0.22);
  font-size: clamp(18px, 1.2vw + 14px, 21px);
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
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: center;
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
  border-radius: 28px;
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
  padding: 18px 20px;
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
  font-size: clamp(14px, 0.5vw + 13px, 15px);
  font-weight: 700;
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
  gap: 14px;
  padding: 14px;
  border: 1px solid rgba(121, 144, 184, 0.14);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(248, 250, 255, 0.96), rgba(240, 245, 255, 0.9));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.step-two-control-grid,
.step-two-slider-grid {
  gap: 10px;
}

.step-two-control-card,
.step-two-slider-card,
.voice-preview-card {
  border-radius: 18px;
  box-shadow: none;
}

.step-two-control-card,
.step-two-slider-card {
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.86);
}

.step-two-control-card__main {
  gap: 12px;
}

.step-two-control-card :deep(.n-base-selection),
.step-two-control-card :deep(.n-base-selection-label),
.step-two-control-card :deep(.n-base-selection-tags),
.step-two-control-card :deep(.n-input-wrapper) {
  min-height: 52px;
  border-radius: 16px;
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
  min-height: 52px;
  font-size: 20px;
}

.step-two-inline-alert {
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.78);
}

.step-two-primary-btn {
  min-height: 50px;
  border-radius: 18px;
  font-size: 15px;
}

.voice-preview-card {
  padding: 14px 16px;
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
  min-height: 52px;
}

.step-two-avatar-panel {
  align-content: start;
}

.step-two-block-head :deep(.n-button) {
  height: 42px;
  padding: 0 18px;
  border-radius: 999px;
  background: rgba(245, 242, 255, 0.92);
}

.avatar-strip--filled {
  grid-template-columns: none;
  grid-auto-flow: column;
  grid-auto-columns: min(100%, clamp(124px, 12vw, 142px));
  align-items: start;
  overflow-x: auto;
  padding-bottom: 8px;
  scrollbar-width: none;
}

.avatar-strip--filled::-webkit-scrollbar {
  display: none;
}

.avatar-empty-state {
  display: grid;
  gap: 14px;
  align-content: start;
}

.avatar-empty-state__hint {
  margin: 0;
  color: var(--text-sub);
  font-size: 14px;
  line-height: 1.7;
}

.avatar-add-card,
.avatar-select-card {
  min-height: clamp(188px, 24vw, 208px);
  padding: 12px 12px 10px;
  border-radius: clamp(22px, 2vw, 28px);
}

.avatar-add-card--compact {
  width: min(100%, clamp(124px, 12vw, 142px));
}

.avatar-add-card--empty {
  width: min(158px, 100%);
  min-height: clamp(200px, 26vw, 220px);
  justify-self: start;
  align-content: center;
}

.avatar-select-card__image,
.avatar-select-card__video,
.avatar-select-card__placeholder {
  aspect-ratio: 9 / 13;
  border-radius: clamp(18px, 1.6vw, 22px);
}

.avatar-select-card__name {
  text-align: center;
  font-size: 12px;
  color: var(--text-light);
}

.lip-sync-setup-card {
  gap: 14px;
  padding: 16px;
  border-radius: 26px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 249, 255, 0.9));
}

.lip-sync-setup-card__tabs {
  gap: 12px;
}

.lip-sync-setup-card__tab {
  padding: 14px 16px;
  border-radius: 16px;
}

.lip-sync-setup-card__tab strong {
  font-size: 15px;
}

.lip-sync-setup-card__summary {
  gap: 10px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
}

.lip-sync-setup-card__summary .summary-pill {
  padding: 10px 12px;
  border-radius: 16px;
  background: rgba(248, 250, 255, 0.92);
  min-width: 0;
}

.lip-sync-setup-card__summary .summary-pill strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1540px) {
  .step-two-workbench {
    grid-template-columns: 1fr;
  }

  .avatar-strip--filled {
    grid-auto-columns: min(100%, clamp(118px, 14vw, 136px));
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
