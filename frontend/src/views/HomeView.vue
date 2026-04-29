<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NInput,
  NInputNumber,
  NProgress,
  NRadio,
  NRadioGroup,
  NSpace,
  NTag,
  NText,
  useDialog,
  useMessage,
} from 'naive-ui'
import type { UploadFileInfo } from 'naive-ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import HomeHero from '@/components/home/HomeHero.vue'
import PhotoUploader from '@/components/home/PhotoUploader.vue'
import VideoLinkInput from '@/components/home/VideoLinkInput.vue'
import { useDigitalHumanStore } from '@/stores/digitalHuman'
import { useTaskDraftStore } from '@/stores/taskDraft'
import {
  downloadSourceVideoFile,
  fetchDigitalHumanImageBlob,
  fetchVideoMeta,
  generateVideoPreview,
  getDyDownloaderCookieConfigured,
  getTranscribePipelineHealth,
  transcribeSavedVideo,
  transcribeWithWhisper,
  transcribeWithWhisperFromUrl,
} from '@/api/task'
import { useWhisperTranscriptStream } from '@/composables/useWhisperTranscriptStream'
import { isDouyinNormalizedUrl, validateSourceVideoInput } from '@/utils/douyinShareUrl'
import { formatStatCount } from '@/utils/formatDisplay'
import {
  describeHttpOrNetworkError,
  describeHttpOrNetworkErrorMaybeBlob,
} from '@/utils/httpErrorMessage'
import axios from 'axios'

function isRequestCanceled(e: unknown): boolean {
  if (axios.isCancel(e)) return true
  if (e && typeof e === 'object') {
    if ('code' in e && (e as { code: string }).code === 'ERR_CANCELED') return true
    if ('name' in e) {
      const n = (e as { name: string }).name
      if (n === 'CanceledError' || n === 'AbortError') return true
    }
  }
  return false
}

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const draft = useTaskDraftStore()
const dhStore = useDigitalHumanStore()

const studioLocked = computed(() => dhStore.ready && !dhStore.hasTemplate)

/** 第二步口播照片：默认拉取专属数字人图；可切换为自行上传 */
const portraitSyncing = ref(false)

async function syncPortraitFromDigitalHuman() {
  if (draft.portraitMode !== 'digital_human') return
  if (!dhStore.hasTemplate) return
  portraitSyncing.value = true
  try {
    /**
     * 优先复用「专属数字人」同步阶段已拉取的预览图（blob: URL），避免二次请求 /api 与鉴权竞态。
     * 预览 blob 失效或为空时再回退到带鉴权的 GET。
     */
    let blob: Blob | null = null
    if (dhStore.previewBlobUrl) {
      try {
        const res = await fetch(dhStore.previewBlobUrl)
        if (res.ok) {
          const b = await res.blob()
          if (b.size) blob = b
        }
      } catch {
        /* 预览 URL 可能已 revoke，走下方接口 */
      }
    }
    if (!blob) {
      blob = await fetchDigitalHumanImageBlob()
    }
    if (!blob.size) throw new Error('empty blob')
    /* 拉取可能较慢：完成前用户若已切到「自行上传」，不得覆盖其照片 */
    if (draft.portraitMode !== 'digital_human') return
    const ext = blob.type.includes('png') ? 'png' : 'jpg'
    const mime = blob.type || (ext === 'png' ? 'image/png' : 'image/jpeg')
    const file = new File([blob], `digital-human-portrait.${ext}`, { type: mime })
    draft.setPhotoFromDigitalHuman(file)
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e)
    console.warn('[syncPortraitFromDigitalHuman]', detail)
    message.warning(
      '无法加载数字人形象，请改用「自行上传」或稍后再试（若未登录请先登录后再试）。',
    )
    draft.portraitMode = 'custom'
    draft.setPhotoFromUserUpload(null)
  } finally {
    portraitSyncing.value = false
  }
}

watch(
  () => [draft.portraitMode, dhStore.ready, dhStore.hasTemplate] as const,
  async (newVal, oldVal) => {
    const [mode, ready, hasT] = newVal
    if (!ready) return
    if (mode === 'digital_human' && hasT) {
      await syncPortraitFromDigitalHuman()
    }
    if (mode === 'custom' && oldVal && oldVal[0] === 'digital_human') {
      draft.setPhotoFromUserUpload(null)
    }
  },
  { immediate: true },
)

watch(
  () => dhStore.hasTemplate,
  (hasT) => {
    if (!dhStore.ready) return
    if (!hasT && draft.portraitMode === 'digital_human') {
      draft.portraitMode = 'custom'
      draft.setPhotoFromUserUpload(null)
    }
  },
)

function goCreateDigitalHuman() {
  void router.push({ name: 'home' })
}

function confirmDeleteStudioDh() {
  dialog.warning({
    title: '删除数字人形象',
    content:
      '删除后口播制作、创建任务与作品等功能将不可用，需先在「专属数字人」页面重新上传并生成形象。确定删除吗？',
    positiveText: '确定删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await dhStore.remove()
        message.warning('已删除数字人形象。请前往「专属数字人」页面重新创建后再使用口播制作。')
      } catch (e: unknown) {
        message.error(describeHttpOrNetworkError(e))
      }
    },
  })
}
const { applyWhisperToEditableScript, isStreamingToScript, cancelStream, interruptStreamWithFullText } =
  useWhisperTranscriptStream()

/** ① 拉取 HTML 元信息（先出「视频信息」卡片） */
const loadingMeta = ref(false)
/** ② 抖音：保存视频 + FFmpeg + Whisper（再填入「口播文案」） */
const douyinPipeline = ref(false)
const fetchBusy = computed(() => loadingMeta.value || douyinPipeline.value)

/** 抖音：分阶段（下载 → Whisper） */
const pipelinePhase = ref<'idle' | 'download' | 'transcribe'>('idle')
const pipelineProgress = ref(0)
const pipelineBarProcessing = ref(false)
const pipelineStatusLabel = computed(() => {
  if (!douyinPipeline.value) return ''
  if (pipelinePhase.value === 'download')
    return '① 正在将源视频下载到服务端保存目录…'
  if (pipelinePhase.value === 'transcribe') return '② 正在抽取音轨并由 Whisper 转写口播（耗时因时长而异，请稍候）…'
  return ''
})

/** 最近一次成功保存到服务端的视频文件名（仅文件名），用于「从本地文件转写口播」 */
const lastSavedVideoBasename = ref<string | null>(null)
const retranscribingLocal = ref(false)
/** 本地上传 → POST transcribe-whisper */
const whisperLocalLoading = ref(false)
/** 非抖音链接 → POST transcribe-whisper-url */
const whisperUrlLoading = ref(false)
/** 服务端 Cookie 检测：loading 仅表示请求中；error 表示连不上或接口异常 */
type DyCookieUi = 'loading' | 'yes' | 'no' | 'error'
const dyCookieUi = ref<DyCookieUi>('loading')

/** 口播链路：FFmpeg + Whisper + 保存目录（下载成功后转写依赖） */
const pipelineLoading = ref(false)
const pipelineHealth = ref<Awaited<ReturnType<typeof getTranscribePipelineHealth>> | null>(null)
/** 请求链路接口失败时（后端未起、代理、超时等），非子项 Whisper/FFmpeg 未就绪 */
const pipelineHealthError = ref('')

async function refreshPipelineHealth() {
  pipelineLoading.value = true
  pipelineHealthError.value = ''
  try {
    pipelineHealth.value = await getTranscribePipelineHealth()
  } catch (e) {
    pipelineHealth.value = null
    pipelineHealthError.value = describeHttpOrNetworkError(e)
    message.warning(pipelineHealthError.value)
  } finally {
    pipelineLoading.value = false
  }
}

async function refreshDyCookieStatus() {
  dyCookieUi.value = 'loading'
  try {
    const { configured } = await getDyDownloaderCookieConfigured()
    dyCookieUi.value = configured ? 'yes' : 'no'
  } catch {
    dyCookieUi.value = 'error'
  }
}

onMounted(() => {
  void dhStore.refresh()
  void refreshDyCookieStatus()
  void refreshPipelineHealth()
})

onUnmounted(() => {
  cancelStream()
  clearAllSegmentProgressTimers()
})

const urlInvalid = computed(() => {
  if (!draft.videoUrl?.trim()) return false
  return !validateSourceVideoInput(draft.videoUrl).ok
})

const linkReady = computed(() => validateSourceVideoInput(draft.videoUrl).ok)

/**
 * 第二步「生成视频」是否可点：不要求原视频链接已校验通过（与后端 sourceVideoUrl 可选一致）；
 * 本批至少一格有口播、且口播照片就绪（数字人形象或自定义上传）。
 */
const canGenerateVideoPreview = computed(() => {
  const n = safeSegmentCount.value
  const segs = videoScriptSegments.value.slice(0, n)
  if (!segs.some((s) => s.trim().length >= 2)) return false
  if (draft.portraitMode === 'digital_human' && !dhStore.hasTemplate) return false
  if (draft.portraitMode === 'custom' && !draft.photoFile) return false
  return true
})

/** 非抖音：可用链接直拉媒体后转写（与抖音「下载到本地再转写」不同） */
const canTranscribeNonDouyinUrl = computed(
  () => linkReady.value && !isDouyinNormalizedUrl(draft.videoUrl),
)

const scriptBlockHint = computed(() =>
  isDouyinNormalizedUrl(draft.videoUrl)
    ? '抖音：服务端保存视频后从本地文件抽音轨并转写填入本框；若未出字可点「从本地文件转写口播」重试。'
    : '默认同步自上方「内容」；点「使用文案」写入任务流水线。',
)

/**
 * 非抖音：用页面「内容」预填口播框。
 * 抖音：口播以保存视频后 Whisper 转写为准（见 onFetchVideoMeta），避免 HTML 占位文案覆盖转写结果。
 */
watch(
  () => draft.videoMeta,
  (m) => {
    if (!m) return
    if (isDouyinNormalizedUrl(draft.videoUrl)) return
    draft.prefillManualScriptFromMeta(m)
  },
)

async function onFetchVideoMeta() {
  const link = validateSourceVideoInput(draft.videoUrl)
  if (!link.ok || !link.normalizedUrl) {
    message.error(link.message ?? '请先填写可识别的视频链接')
    return
  }
  draft.videoUrl = link.normalizedUrl

  loadingMeta.value = true
  let meta: Awaited<ReturnType<typeof fetchVideoMeta>>
  try {
    meta = await fetchVideoMeta({ sourceVideoUrl: link.normalizedUrl })
    draft.setVideoMeta(meta)
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
    return
  } finally {
    loadingMeta.value = false
  }

  // 先让「视频信息」等区域完成一次渲染，再进入抖音长耗时下载/转写
  await nextTick()

  const douyin = isDouyinNormalizedUrl(link.normalizedUrl)

  if (!douyin) {
    if (meta.hasUsefulMeta) {
      message.success('已获取视频页信息')
    } else {
      message.warning('未解析到完整元信息，请查看下方提示')
    }
    void refreshDyCookieStatus()
    void refreshPipelineHealth()
    return
  }

  douyinPipeline.value = true
  pipelinePhase.value = 'download'
  pipelineProgress.value = 6
  pipelineBarProcessing.value = true
  try {
    const saved = await downloadSourceVideoFile({
      sourceVideoUrl: link.normalizedUrl,
      transcribe: false,
    })
    const basename = saved.savedPath.split(/[/\\]/).pop()?.trim() || null
    if (!basename) {
      message.error('未能解析保存文件名')
      return
    }
    lastSavedVideoBasename.value = basename

    pipelineProgress.value = 42
    pipelineBarProcessing.value = false
    pipelinePhase.value = 'transcribe'

    pipelineProgress.value = 48
    pipelineBarProcessing.value = true
    message.info('服务端已保存视频文件，开始 Whisper 转写…')

    const r = await transcribeSavedVideo({ fileName: basename })

    pipelineProgress.value = 100
    pipelineBarProcessing.value = false

    if (r.transcript) {
      applyWhisperToEditableScript({
        fullText: r.transcript.fullText,
        segments: r.transcript.segments,
        transcriptId: r.transcript.transcriptId,
      })
    }

    const parts: string[] = [
      meta.hasUsefulMeta ? '已获取视频信息。' : '元信息不完整，但源视频已保存。',
      saved.message,
    ]
    if (r.transcript) {
      parts.push('已用 Whisper 从口播音轨填入下方口播文案。')
    }
    message.success(parts.join(''))
    if (r.transcriptionError) {
      message.warning(
        `视频已保存到服务端目录；口播转写未完成：${r.transcriptionError}`,
      )
    }
  } catch (de: unknown) {
    lastSavedVideoBasename.value = null
    if (meta.hasUsefulMeta) {
      message.success('已获取视频页信息')
    } else {
      message.warning('未解析到完整元信息，请查看下方提示')
    }
    message.warning(`源视频下载/转写失败：${await describeHttpOrNetworkErrorMaybeBlob(de)}`)
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
  const t = draft.manualScriptDraft.trim()
  if (!t) {
    message.warning('请先在文案框中填写内容')
    return
  }
  draft.commitManualScriptToPipeline()
  message.success(`已写入后续流程（${t.length} 字）`)
}

/** 不重新下载，仅根据保存目录里已有文件做 FFmpeg + Whisper，写入口播框 */
async function onRetranscribeFromLocal() {
  const name = lastSavedVideoBasename.value?.trim()
  if (!name) {
    message.warning('暂无已保存的视频文件名，请先点击「获取视频信息」完成下载')
    return
  }
  retranscribingLocal.value = true
  try {
    const r = await transcribeSavedVideo({ fileName: name })
    if (r.transcript) {
      applyWhisperToEditableScript({
        fullText: r.transcript.fullText,
        segments: r.transcript.segments,
        transcriptId: r.transcript.transcriptId,
      })
      message.success('已根据本地保存的视频生成口播文案')
    }
    if (r.transcriptionError) {
      message.warning(r.transcriptionError)
    }
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    retranscribingLocal.value = false
  }
}

async function onWhisperUploadTranscribe(options: { fileList: UploadFileInfo[] }) {
  const raw = options.fileList[0]?.file
  const file = raw instanceof File ? raw : null
  if (!file?.size) return
  whisperLocalLoading.value = true
  try {
    const data = await transcribeWithWhisper(file)
    applyWhisperToEditableScript({
      fullText: data.fullText,
      segments: data.segments,
      transcriptId: data.transcriptId,
    })
    message.success('已转写并流式填入下方口播文案。')
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    whisperLocalLoading.value = false
  }
}

async function onTranscribeNonDouyinFromUrl() {
  const link = validateSourceVideoInput(draft.videoUrl)
  if (!link.ok || !link.normalizedUrl) {
    message.error(link.message ?? '请先填写可解析的视频链接')
    return
  }
  whisperUrlLoading.value = true
  try {
    const data = await transcribeWithWhisperFromUrl({ sourceVideoUrl: link.normalizedUrl })
    applyWhisperToEditableScript({
      fullText: data.fullText,
      segments: data.segments,
      transcriptId: data.transcriptId,
    })
    message.success('已转写并流式填入下方口播文案。')
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    whisperUrlLoading.value = false
  }
}

/** 单批最多支持的分段/成片条数（与 UI、缓冲数组一致） */
const VIDEO_SEGMENT_MAX = 6
/** 本批实际生成条数，默认 6；用户可在 1～VIDEO_SEGMENT_MAX 间调整（输入框可短暂为 null） */
const videoSegmentCount = ref<number | null>(6)
/**
 * 与 NInputNumber 配合：v-for 绝不能直接用可能为 null 的 ref，否则整页可能无法渲染
 */
const safeSegmentCount = computed(() => {
  const v = videoSegmentCount.value
  if (v == null || Number.isNaN(Number(v))) return 6
  return Math.min(VIDEO_SEGMENT_MAX, Math.max(1, Math.round(Number(v))))
})

watch(videoSegmentCount, (v) => {
  if (v == null || Number.isNaN(Number(v))) {
    videoSegmentCount.value = 6
    return
  }
  const c = Math.min(VIDEO_SEGMENT_MAX, Math.max(1, Math.round(Number(v))))
  if (c !== v) videoSegmentCount.value = c
})

/** 每段输入上限（与模板展示、占位文案共用，勿仅在模板内写反引号插值，易被编译成 undefined） */
const VIDEO_SEGMENT_MAX_CHARS = 40

function segmentInputPlaceholder(index1Based: number): string {
  return `第 ${index1Based} 段口播（最多 ${VIDEO_SEGMENT_MAX_CHARS} 字）`
}

/** 受控输入，保证值为 string，避免 undefined 导致占位层与内容叠显 */
function onVideoSegmentInput(index: number, v: string | null) {
  videoScriptSegments.value[index] = (v ?? '').slice(0, VIDEO_SEGMENT_MAX_CHARS)
}

function estimateGenerateSeconds(scriptLen: number): number {
  return Math.min(180, Math.max(15, Math.round(12 + scriptLen * 0.02)))
}

/** 口播分多段，由用户根据上方文案自行拆分；数组长度为上限，仅前 videoSegmentCount 格参与本批 */
const videoScriptSegments = ref<string[]>(Array.from({ length: VIDEO_SEGMENT_MAX }, () => ''))

type SegmentGenState = {
  progress: number
  processing: boolean
  statusLabel: string
  videoUrl: string | null
  hint: string
  optimizedScript: string
  error?: string
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

const segmentGenStates = ref<SegmentGenState[]>(
  Array.from({ length: VIDEO_SEGMENT_MAX }, emptySegmentGenState),
)

const segmentProgressTimers = ref<Array<ReturnType<typeof setInterval> | null>>(
  Array(VIDEO_SEGMENT_MAX).fill(null),
)

function clearSegmentProgressTimer(i: number) {
  const t = segmentProgressTimers.value[i]
  if (t) {
    clearInterval(t)
    segmentProgressTimers.value[i] = null
  }
}

function clearAllSegmentProgressTimers() {
  for (let i = 0; i < VIDEO_SEGMENT_MAX; i++) clearSegmentProgressTimer(i)
}

/**
 * 从上方口播载入本步分段：
 * - 有换行：每行对一段，按顺序依次填入；行数多于本批 N 条则只取前 N 行
 * - 无换行（整段）：按每段最大字数从前往后**依次切分**到 N 格，不会只塞在第一格
 */
function importSegmentsFromManualDraft() {
  const raw = draft.manualScriptDraft.trim()
  if (!raw) {
    message.warning('请先在上方「口播文案」中填写内容')
    return
  }
  const n = safeSegmentCount.value
  const parts = raw
    .split(/\r\n|\n|\r/)
    .map((s) => s.trim())
    .filter(Boolean)

  for (let i = n; i < VIDEO_SEGMENT_MAX; i++) {
    videoScriptSegments.value[i] = ''
  }

  /** 仅一段（无换行或整段一句）：从首字起按每段上限依次装入第 1～N 格 */
  if (parts.length < 2) {
    const t = parts[0] ?? ''
    let pos = 0
    for (let i = 0; i < n; i++) {
      if (pos >= t.length) {
        videoScriptSegments.value[i] = ''
      } else {
        videoScriptSegments.value[i] = t.slice(pos, pos + VIDEO_SEGMENT_MAX_CHARS)
        pos += VIDEO_SEGMENT_MAX_CHARS
      }
    }
    if (pos < t.length) {
      message.warning(
        `口播总字数超过本批 ${n} 段可装容量（每段最多 ${VIDEO_SEGMENT_MAX_CHARS} 字），未装入的尾部已略去。可增大本批条数后再次载入。`,
      )
    } else {
      message.success(
        t.length > 0
          ? '已将口播从前往后依次拆入各段（整段无换行时按每段最多字数自动切段）'
          : '已载入',
      )
    }
    return
  }

  /** 多行：第 1 行→第 1 格，依次对应；行数多于 N 则只取前 N 行 */
  for (let i = 0; i < n; i++) {
    videoScriptSegments.value[i] = (parts[i] ?? '').slice(0, VIDEO_SEGMENT_MAX_CHARS)
  }
  if (parts.length > n) {
    message.info(
      `检测到 ${parts.length} 行，已按顺序填入前 ${n} 行；其余请增加本批条数后再载入，或自行复制。`,
    )
  } else {
    message.success('已从上方口播按行依次载入各段')
  }
}

const generateVideoLoading = ref(false)
/** 当前批次里的 AbortController，用于「停止」时取消正在进行的单条 http 请求 */
const generateBatchAbort = ref<AbortController | null>(null)
/** 为 true 时：不再发起后续片段请求（队列在循环首检查与 abort  catch 中结算） */
const generateQueueStopRequested = ref(false)
/** 整批预估总秒数（仅参考） */
const generateVideoEstimatedTotalSec = ref(0)

function cancelGenerateQueue() {
  if (!generateVideoLoading.value) return
  generateQueueStopRequested.value = true
  try {
    generateBatchAbort.value?.abort()
  } catch {
    /* ignore */
  }
}

const showSegmentResultBlocks = computed(
  () =>
    generateVideoLoading.value ||
    segmentGenStates.value.some(
      (s) => s.statusLabel || s.videoUrl || s.error || s.progress > 0 || s.processing,
    ),
)

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(new Error('读取图片失败'))
    r.readAsDataURL(blob)
  })
}

function startFakeProgressForSegment(i: number, estimatedSec: number) {
  clearSegmentProgressTimer(i)
  const started = Date.now()
  const targetMs = Math.max(8_000, estimatedSec * 1000 * 0.92)
  segmentGenStates.value[i].processing = true
  segmentGenStates.value[i].progress = 0
  segmentProgressTimers.value[i] = setInterval(() => {
    const elapsed = Date.now() - started
    const p = Math.min(92, Math.floor((elapsed / targetMs) * 92))
    segmentGenStates.value[i].progress = p
    if (p < 22) {
      segmentGenStates.value[i].statusLabel = '① 提交口播文案…'
    } else if (p < 48) {
      segmentGenStates.value[i].statusLabel = '② 大模型优化口播稿中…'
    } else if (p < 78) {
      segmentGenStates.value[i].statusLabel = '③ 提交火山方舟图生视频…'
    } else {
      segmentGenStates.value[i].statusLabel = '④ 等待成片生成（轮询中）…'
    }
  }, 280)
}

/** 从 toRun[fromQi] 起标记为已取消；首条在请求中 abort 时传 firstWasAbortedRequest = true */
function markGenerateSlotsCancelledFrom(
  toRun: { s: string; idx: number }[],
  fromQi: number,
  firstWasAbortedRequest: boolean,
) {
  for (let r = fromQi; r < toRun.length; r++) {
    const j = toRun[r].idx
    clearSegmentProgressTimer(j)
    const isFirst = r === fromQi
    const statusLabel =
      isFirst && firstWasAbortedRequest
        ? '已取消（请求已中断）'
        : '已取消（未向服务器请求）'
    segmentGenStates.value[j] = {
      ...emptySegmentGenState(),
      progress: 0,
      processing: false,
      statusLabel,
      videoUrl: null,
      hint: '',
      optimizedScript: '',
      error: undefined,
    }
  }
}

async function onGenerateVideo() {
  const link = validateSourceVideoInput(draft.videoUrl)
  const sourceVideoUrl =
    link.ok && link.normalizedUrl ? link.normalizedUrl : undefined
  if (link.ok && link.normalizedUrl) {
    draft.videoUrl = link.normalizedUrl
  }
  const n = safeSegmentCount.value
  const segments = videoScriptSegments.value.slice(0, n).map((s) => s.trim())
  const toRun = segments
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => s.length >= 2)
  if (toRun.length === 0) {
    message.warning('请至少填写一条口播内容（不少于 2 个字），或点击「从上方口播载入」')
    return
  }
  if (draft.portraitMode === 'digital_human' && !dhStore.hasTemplate) {
    message.warning('请先创建专属数字人形象；预览成片需用数字人图作为图生视频参考图。')
    return
  }
  if (draft.portraitMode === 'custom' && !draft.photoFile) {
    message.warning('请先在「口播形象照片」中上传照片，或改选「使用专属数字人形象」。')
    return
  }

  clearAllSegmentProgressTimers()
  generateQueueStopRequested.value = false
  const ac = new AbortController()
  generateBatchAbort.value = ac
  generateVideoLoading.value = true
  segmentGenStates.value = Array.from({ length: VIDEO_SEGMENT_MAX }, emptySegmentGenState)

  const totalEst = toRun.reduce((acc, { s }) => acc + Math.min(600, estimateGenerateSeconds(s.length) + 90), 0)
  generateVideoEstimatedTotalSec.value = totalEst

  let llmUsedAny = false
  const optimizedPieces: string[] = Array.from({ length: n }, () => '')

  for (let slot = 0; slot < n; slot++) {
    if (segments[slot].length < 2) {
      segmentGenStates.value[slot] = {
        ...emptySegmentGenState(),
        statusLabel: '未填写，已跳过',
        progress: 0,
      }
    }
  }
  toRun.forEach(({ idx }, i) => {
    segmentGenStates.value[idx] = {
      ...emptySegmentGenState(),
      statusLabel: `排队中（${i + 1}/${toRun.length}）`,
      progress: 0,
    }
  })

  let stoppedByUser = false

  try {
    const imageDataUrl =
      draft.portraitMode === 'custom' && draft.photoFile
        ? await blobToDataUrl(draft.photoFile)
        : await blobToDataUrl(await fetchDigitalHumanImageBlob())

    if (generateQueueStopRequested.value) {
      stoppedByUser = true
      markGenerateSlotsCancelledFrom(toRun, 0, false)
      message.info('已停止生成，未发起任一出片请求。')
      return
    }

    for (let qi = 0; qi < toRun.length; qi++) {
      if (generateQueueStopRequested.value) {
        markGenerateSlotsCancelledFrom(toRun, qi, false)
        stoppedByUser = true
        message.info('已停止生成，后续片段不会请求接口。')
        break
      }

      const { s: script, idx } = toRun[qi]
      const est = Math.min(600, estimateGenerateSeconds(script.length) + 90)
      startFakeProgressForSegment(idx, est)

      try {
        const res = await generateVideoPreview(
          {
            script,
            ...(sourceVideoUrl ? { sourceVideoUrl } : {}),
            imageDataUrl,
          },
          { signal: ac.signal },
        )
        clearSegmentProgressTimer(idx)
        optimizedPieces[idx] = res.optimizedScript
        if (res.llmUsed) llmUsedAny = true
        segmentGenStates.value[idx] = {
          progress: 100,
          processing: false,
          statusLabel: '本段已完成',
          videoUrl: res.videoUrl,
          hint: res.hint,
          optimizedScript: res.optimizedScript,
        }
      } catch (e: unknown) {
        clearSegmentProgressTimer(idx)
        if (isRequestCanceled(e) || generateQueueStopRequested.value) {
          stoppedByUser = true
          markGenerateSlotsCancelledFrom(toRun, qi, true)
          message.info('已停止：本条请求已中断，后续片段未请求。')
          break
        }
        const errMsg = describeHttpOrNetworkError(e)
        segmentGenStates.value[idx] = {
          progress: 100,
          processing: false,
          statusLabel: '本段失败',
          videoUrl: null,
          hint: '',
          optimizedScript: '',
          error: errMsg,
        }
      }
    }

    const merged = optimizedPieces
      .map((o) => o.trim())
      .filter(Boolean)
      .join('\n\n')
    if (merged) {
      draft.manualScriptDraft = merged
      draft.commitManualScriptToPipeline()
    }

    const okCount = segmentGenStates.value.slice(0, n).filter((st) => st.videoUrl).length
    if (okCount > 0) {
      if (stoppedByUser) {
        message.success(
          llmUsedAny
            ? `已生成 ${okCount} 条预览成片并停止后续任务（含大模型优化口播稿）`
            : `已生成 ${okCount} 条预览成片并停止后续任务（未配置 LLM 时保留原文）`,
        )
      } else {
        message.success(
          llmUsedAny
            ? `已生成 ${okCount} 条预览成片（含大模型优化口播稿）`
            : `已生成 ${okCount} 条预览成片（未配置 LLM 时保留原文）`,
        )
      }
    } else if (toRun.length > 0 && !stoppedByUser) {
      message.warning('本批分段均未成功出片，请查看各段错误说明后重试')
    } else if (stoppedByUser && okCount === 0) {
      message.info('已取消，未成功生成任一条。')
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
</script>

<template>
  <div class="page">
    <n-alert
      v-if="dhStore.ready && !dhStore.hasTemplate"
      type="warning"
      :show-icon="false"
      class="studio-lock-banner studio-wide-canvas"
    >
      <n-space vertical :size="12">
        <n-text strong style="font-size: 16px">口播制作已锁定</n-text>
        <n-text depth="3" style="font-size: 14px; line-height: 1.7">
          您尚未创建专属数字人，或已删除数字人形象。请先返回「专属数字人」页面上传自拍照并生成形象；创建前本页所有操作不可用。
        </n-text>
        <div>
          <n-button type="primary" size="medium" @click="goCreateDigitalHuman">
            前往专属数字人
          </n-button>
        </div>
      </n-space>
    </n-alert>

    <n-card
      v-if="dhStore.hasTemplate && dhStore.previewBlobUrl"
      title="当前数字人形象"
      size="large"
      class="glass studio-dh-strip studio-wide-canvas"
    >
      <n-space align="center" style="flex-wrap: wrap" :size="16">
        <img class="studio-dh-thumb" :src="dhStore.previewBlobUrl" alt="当前数字人形象" />
        <n-space vertical :size="6">
          <n-text v-if="dhStore.styleLabel">风格：{{ dhStore.styleLabel }}</n-text>
          <n-text depth="3" style="font-size: 12px">以下口播制作将使用该形象作为你的数字人参考。</n-text>
          <n-button type="error" secondary size="small" @click="confirmDeleteStudioDh">
            删除数字人形象
          </n-button>
        </n-space>
      </n-space>
    </n-card>

    <n-text
      v-if="!dhStore.ready"
      depth="3"
      style="display: block; text-align: center; padding: 20px 16px 8px"
    >
      正在同步数字人状态…
    </n-text>

    <div class="studio-body" :class="{ 'studio-body--locked': studioLocked }">
      <HomeHero class="home-hero-slot" />

      <div class="page__content page__content--studio">
        <div class="studio-workspace">
      <section class="studio-panel studio-panel--source" aria-label="原视频与口播文案">
      <n-card title="原视频" size="large" class="glass">
        <n-space vertical :size="18">
          <VideoLinkInput v-model="draft.videoUrl" :invalid="urlInvalid" />
          <n-space align="center" :size="12" style="flex-wrap: wrap">
            <n-button
              :disabled="!linkReady"
              :loading="fetchBusy"
              secondary
              @click="onFetchVideoMeta"
            >
              获取视频信息
            </n-button>
            <n-text depth="3" style="font-size: 12px">
              先解析 HTML 渲染资料；抖音链接会在展示完成后继续：拉取源视频→提取音轨→Whisper
              填入「口播文案」。文件保存在后端服务器（Docker 内多为
              /data/download-video 卷；本地开发 Windows 常为 C:\downloadVideo），不会出现在你电脑的下载文件夹。
            </n-text>
            <n-space align="center" :size="8" style="flex-wrap: wrap">
              <n-text depth="3" style="font-size: 12px">服务端 Cookie：</n-text>
              <n-tag v-if="dyCookieUi === 'yes'" size="small" type="success" :bordered="false">
                已配置
              </n-tag>
              <n-tag v-else-if="dyCookieUi === 'no'" size="small" type="warning" :bordered="false">
                未配置
              </n-tag>
              <n-tag v-else-if="dyCookieUi === 'error'" size="small" type="error" :bordered="false">
                检测失败（请确认后端已启动且可访问 /api）
              </n-tag>
              <n-text v-else depth="3" style="font-size: 12px">检测中…</n-text>
              <n-button size="tiny" quaternary :loading="dyCookieUi === 'loading'" @click="refreshDyCookieStatus">
                刷新
              </n-button>
            </n-space>
            <n-space align="center" :size="8" style="flex-wrap: wrap; margin-top: 4px">
              <n-text depth="3" style="font-size: 12px">口播转写（服务端下载落盘→FFmpeg 抽音轨→Whisper）：</n-text>
              <n-tag v-if="pipelineLoading" size="small" :bordered="false">检测中…</n-tag>
              <template v-else-if="pipelineHealth">
                <n-tag
                  size="small"
                  :bordered="false"
                  :type="pipelineHealth.videoSaveDir.writable ? 'success' : 'error'"
                >
                  保存目录{{ pipelineHealth.videoSaveDir.writable ? '可写' : '不可写' }}
                </n-tag>
                <n-tag size="small" :bordered="false" :type="pipelineHealth.ffmpeg.ok ? 'success' : 'error'">
                  FFmpeg {{ pipelineHealth.ffmpeg.ok ? '可用' : '不可用' }}
                </n-tag>
                <n-tag size="small" :bordered="false" :type="pipelineHealth.whisper.ok ? 'success' : 'warning'">
                  Whisper {{ pipelineHealth.whisper.ok ? '已连接' : '未就绪' }}
                </n-tag>
                <n-tag
                  size="small"
                  :bordered="false"
                  :type="pipelineHealth.dyCookieConfigured ? 'success' : 'default'"
                >
                  抖音 Cookie
                </n-tag>
              </template>
              <n-tag v-else size="small" type="error" :bordered="false">链路检测失败</n-tag>
              <n-button size="tiny" quaternary :loading="pipelineLoading" @click="refreshPipelineHealth">
                刷新转写环境
              </n-button>
            </n-space>
            <n-text
              v-if="!pipelineLoading && pipelineHealthError"
              depth="3"
              style="font-size: 11px; display: block; margin-top: 4px"
            >
              {{ pipelineHealthError }}（请确认：1）在 <code>backend</code> 目录执行
              <code>npm run start:dev</code>；2）浏览器通过 Vite 访问（如 http://localhost:5173 ）以便 /api 代理到
              3000；3）若用独立前端域名，请配置 <code>VITE_API_BASE_URL</code>）
            </n-text>
            <n-text
              v-if="pipelineHealth && !pipelineHealth.whisper.transcribeUrlConfigured"
              depth="3"
              style="font-size: 11px; display: block; margin-top: 4px"
            >
              请在 backend/.env 配置 WHISPER_HTTP_URL（如 http://127.0.0.1:8010/transcribe），并启动
              <code>backend/whisper-python-service</code>（仓库根目录 <code>npm run whisper:dev</code>）。
            </n-text>
            <n-text
              v-else-if="
                pipelineHealth &&
                pipelineHealth.whisper.transcribeUrlConfigured &&
                !pipelineHealth.whisper.ok
              "
              depth="3"
              style="font-size: 11px; display: block; margin-top: 4px"
            >
              Whisper 健康检查未通过：{{ pipelineHealth.whisper.error || '未知原因' }}
              <template v-if="pipelineHealth.whisper.healthUrl">
                （探测 {{ pipelineHealth.whisper.healthUrl }}）
              </template>
              。请在 <code>backend/whisper-python-service</code> 目录执行
              <code>python -m uvicorn server:app --host 127.0.0.1 --port 8010</code>
              或仓库根目录 <code>npm run whisper:dev</code>，端口需与 WHISPER_HTTP_URL 一致。
            </n-text>
            <n-text
              v-if="pipelineHealth && !pipelineHealth.ffmpeg.ok"
              depth="3"
              style="font-size: 11px; display: block; margin-top: 2px"
            >
              请安装 FFmpeg 或放入 backend/ffmpeg/bin/ffmpeg.exe，或设置 FFMPEG_BIN。
            </n-text>
          </n-space>

          <div class="script-block">
            <n-text strong style="display: block; margin-bottom: 8px">口播文案（可编辑）</n-text>
            <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 8px">
              {{ scriptBlockHint }}
            </n-text>
            <template v-if="douyinPipeline">
              <n-progress
                type="line"
                :percentage="pipelineProgress"
                :processing="pipelineBarProcessing"
                :show-indicator="true"
                style="margin-bottom: 8px; max-width: 520px"
              />
              <n-text
                depth="3"
                style="font-size: 12px; display: block; margin-bottom: 8px; color: var(--n-primary-color)"
              >
                {{ pipelineStatusLabel }}
              </n-text>
            </template>
            <n-text
              v-if="isStreamingToScript"
              depth="3"
              style="font-size: 11px; display: block; margin-bottom: 6px; color: var(--n-primary-color)"
            >
              正在流式写入口播文案（点击输入框可立即补全文案并停止动画）…
            </n-text>
            <n-input
              v-model:value="draft.manualScriptDraft"
              type="textarea"
              :rows="8"
              placeholder="在此编辑口播文案…"
              show-count
              :maxlength="50000"
              class="script-textarea"
              @click="interruptStreamWithFullText"
            />
            <n-space align="center" style="margin-top: 12px; flex-wrap: wrap">
              <n-button type="primary" secondary @click="onUseScript">使用文案</n-button>
              <n-upload
                :show-file-list="false"
                :default-upload="false"
                accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.webm,.mov,.mkv"
                @change="onWhisperUploadTranscribe"
              >
                <n-button :loading="whisperLocalLoading" size="small" secondary>
                  上传音视频转写
                </n-button>
              </n-upload>
              <n-button
                v-if="canTranscribeNonDouyinUrl"
                size="small"
                secondary
                :loading="whisperUrlLoading"
                @click="onTranscribeNonDouyinFromUrl"
              >
                从当前链接转写（非抖音）
              </n-button>
              <n-button
                v-if="lastSavedVideoBasename"
                secondary
                size="small"
                :loading="retranscribingLocal"
                @click="onRetranscribeFromLocal"
              >
                从本地文件转写口播
              </n-button>
              <n-text v-if="draft.scriptPipelineCommittedAt" depth="3" style="font-size: 12px">
                已同步 · {{ new Date(draft.scriptPipelineCommittedAt).toLocaleString('zh-CN') }}
              </n-text>
            </n-space>
          </div>

          <template v-if="draft.videoMeta">
            <n-alert v-if="draft.videoMeta.warnings.length" type="warning" :show-icon="false">
              <div v-for="(w, i) in draft.videoMeta.warnings" :key="i">{{ w }}</div>
            </n-alert>

            <n-card title="视频信息" size="small" class="meta-feature-card" :bordered="true">
              <n-space vertical :size="14">
                <n-alert type="info" :show-icon="false">
                  <div class="meta-hint-line">
                    <n-text strong>源视频下载条件：</n-text>
                    <n-text>{{ draft.videoMeta.sourceDownloadHint || '—' }}</n-text>
                  </div>
                  <n-space v-if="draft.videoMeta.platform === 'douyin'" :size="8" style="margin-top: 8px; flex-wrap: wrap">
                    <n-tag size="small" :bordered="false" :type="draft.videoMeta.videoAssetDetected ? 'success' : 'default'">
                      页面视频线索：{{ draft.videoMeta.videoAssetDetected ? '已检测' : '未检测' }}
                    </n-tag>
                    <n-tag size="small" :bordered="false" :type="draft.videoMeta.dyCookieConfigured ? 'success' : 'warning'">
                      服务端 Cookie：{{ draft.videoMeta.dyCookieConfigured ? '已配置' : '未配置' }}
                    </n-tag>
                  </n-space>
                </n-alert>

                <n-descriptions
                  label-placement="left"
                  bordered
                  size="small"
                  :column="1"
                >
                  <n-descriptions-item label="标题">
                    {{ draft.videoMeta.title || '—' }}
                  </n-descriptions-item>
                  <n-descriptions-item label="标签">
                    <n-space v-if="(draft.videoMeta.tags?.length ?? 0) > 0" size="small" style="flex-wrap: wrap">
                      <n-tag v-for="(t, ti) in draft.videoMeta.tags" :key="ti" size="small" round>
                        #{{ t }}
                      </n-tag>
                    </n-space>
                    <n-text v-else depth="3">—</n-text>
                  </n-descriptions-item>
                  <n-descriptions-item label="获赞数">
                    {{ formatStatCount(draft.videoMeta.likeCount) }}
                  </n-descriptions-item>
                </n-descriptions>
              </n-space>
            </n-card>

            <div class="meta-layout">
              <img
                v-if="draft.videoMeta.coverImageUrl"
                class="meta-cover"
                :src="draft.videoMeta.coverImageUrl"
                alt="封面"
                referrerpolicy="no-referrer"
                loading="lazy"
              />
              <n-descriptions
                label-placement="left"
                bordered
                size="small"
                :column="1"
                style="flex: 1; min-width: 0"
              >
                <n-descriptions-item label="内容">
                  <div class="meta-readonly">
                    {{ draft.videoMeta.content || '—' }}
                  </div>
                </n-descriptions-item>
                <n-descriptions-item label="播放量">
                  {{ formatStatCount(draft.videoMeta.playCount) }}
                </n-descriptions-item>
              </n-descriptions>
            </div>
          </template>
        </n-space>
      </n-card>
      </section>

      <section class="studio-panel studio-panel--output" aria-label="生成视频">
      <n-card title="第二步：生成视频" size="large" class="glass step-generate-card">
        <n-space vertical :size="14">
          <n-text depth="3" style="font-size: 12px">
            请根据自己需要生成多少条视频，选择<strong>本批生成条数</strong>，再在各格中填写或载入口播内容；<strong>每格生成一条</strong>演示成片，单批至少 1 条、最多
            {{ VIDEO_SEGMENT_MAX }} 条。
          </n-text>
          <n-space align="center" style="flex-wrap: wrap" :size="12">
            <n-text strong>本批生成条数</n-text>
            <n-input-number
              v-model:value="videoSegmentCount"
              :min="1"
              :max="VIDEO_SEGMENT_MAX"
              :disabled="generateVideoLoading"
              size="small"
            />
            <n-text depth="3" style="font-size: 12px">（1～{{ VIDEO_SEGMENT_MAX }} 条）</n-text>
          </n-space>
          <n-space vertical :size="10" style="width: 100%">
            <n-space align="center" style="flex-wrap: wrap" :size="12">
              <n-text strong>口播分段（{{ safeSegmentCount }} 格）</n-text>
              <n-button size="small" secondary :disabled="generateVideoLoading" @click="importSegmentsFromManualDraft">
                从上方口播载入
              </n-button>
            </n-space>
            <n-alert type="default" :show-icon="false" style="background: rgba(30, 41, 59, 0.65); font-size: 12px">
              每段最多 {{ VIDEO_SEGMENT_MAX_CHARS }} 字；可按句号或意群拆分整段口播，便于单条成片节奏。
            </n-alert>
            <div
              v-for="idx in safeSegmentCount"
              :key="idx"
              class="video-segment-row"
            >
              <n-text class="video-segment-label" depth="3">第 {{ idx }} 段</n-text>
              <n-input
                :value="videoScriptSegments[idx - 1] ?? ''"
                type="text"
                :placeholder="segmentInputPlaceholder(idx)"
                clearable
                :maxlength="VIDEO_SEGMENT_MAX_CHARS"
                show-count
                :disabled="generateVideoLoading"
                class="video-segment-input"
                @update:value="(v) => onVideoSegmentInput(idx - 1, v)"
              />
            </div>
          </n-space>
          <div>
            <n-text strong style="display: block; margin-bottom: 8px">口播形象照片</n-text>
            <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 10px">
              默认使用你在「专属数字人」中保存的形象作为本步口播照片；也可改用本机其他照片。
            </n-text>
            <n-radio-group
              v-model:value="draft.portraitMode"
              name="portrait-mode"
              :disabled="portraitSyncing || !dhStore.hasTemplate"
            >
              <n-space vertical :size="8">
                <n-radio value="digital_human">使用专属数字人形象（默认）</n-radio>
                <n-radio value="custom">自行上传其他照片</n-radio>
              </n-space>
            </n-radio-group>
            <div
              v-if="draft.portraitMode === 'digital_human' && dhStore.hasTemplate"
              class="dh-portrait-block"
            >
              <n-text depth="3" style="font-size: 12px; display: block; margin-top: 12px">
                {{
                  portraitSyncing
                    ? '正在同步数字人形象…'
                    : '已选用当前保存的数字人形象，创建任务时将作为口播照片提交。'
                }}
              </n-text>
              <div v-if="!portraitSyncing && draft.photoPreviewUrl" class="dh-portrait-preview">
                <img :src="draft.photoPreviewUrl" alt="口播形象预览" />
              </div>
            </div>
            <PhotoUploader
              v-else
              v-model:preview-url="draft.photoPreviewUrl"
              :show-header="false"
              @update:file="draft.setPhotoFromUserUpload"
            />
          </div>

          <n-space align="center" style="flex-wrap: wrap" :size="12">
            <n-button
              type="primary"
              size="large"
              :disabled="!canGenerateVideoPreview || generateVideoLoading"
              :loading="generateVideoLoading"
              @click="onGenerateVideo"
            >
              生成视频（本批 {{ safeSegmentCount }} 条，逐条请求）
            </n-button>
            <n-button
              v-if="generateVideoLoading"
              size="large"
              secondary
              type="error"
              @click="cancelGenerateQueue"
            >
              停止生成
            </n-button>
          </n-space>
          <n-text
            v-if="canGenerateVideoPreview && !linkReady"
            depth="3"
            style="font-size: 12px; display: block; margin-top: 4px; color: var(--n-text-color-2)"
          >
            未填「原视频」有效链接时也可生成；填写并校验通过后，大模型会多一层原片上下文。获取视频信息、抖音转写仍需要上方有效链接。
          </n-text>
          <n-text v-if="generateVideoLoading" depth="3" style="font-size: 12px; display: block; margin-top: 6px">
            当前为<strong>串行队列</strong>：上一条完成后再请求下一条；点「停止生成」会中断当前请求并跳过余下片段，不浪费接口。
          </n-text>
          <n-text v-if="generateVideoLoading || generateVideoEstimatedTotalSec > 0" depth="3" style="font-size: 12px">
            本批合计预估约 <n-text tag="span" strong>{{ generateVideoEstimatedTotalSec }}</n-text> 秒（本批各段累加，仅供参考）
          </n-text>
          <n-text v-if="showSegmentResultBlocks" strong style="display: block; margin-top: 12px">分段预览结果</n-text>
          <n-space v-if="showSegmentResultBlocks" vertical :size="16" style="width: 100%; margin-top: 8px">
            <div
              v-for="slot in safeSegmentCount"
              :key="`seg-out-${slot}`"
              class="video-segment-result"
            >
              <n-text strong style="display: block; margin-bottom: 6px">第 {{ slot }} 段</n-text>
              <n-progress
                type="line"
                :percentage="segmentGenStates[slot - 1]?.progress ?? 0"
                :processing="segmentGenStates[slot - 1]?.processing ?? false"
                :show-indicator="true"
                style="max-width: 100%"
              />
              <n-text
                v-if="segmentGenStates[slot - 1]?.statusLabel"
                depth="3"
                style="font-size: 12px; margin-top: 4px; display: block"
              >
                {{ segmentGenStates[slot - 1].statusLabel }}
              </n-text>
              <n-alert
                v-if="segmentGenStates[slot - 1]?.error"
                type="error"
                :show-icon="false"
                style="margin-top: 6px; font-size: 12px"
              >
                {{ segmentGenStates[slot - 1].error }}
              </n-alert>
              <n-alert
                v-if="segmentGenStates[slot - 1]?.hint && !segmentGenStates[slot - 1]?.error"
                type="info"
                :show-icon="false"
                style="margin-top: 6px; font-size: 12px"
              >
                {{ segmentGenStates[slot - 1].hint }}
              </n-alert>
              <div v-if="segmentGenStates[slot - 1]?.videoUrl" class="video-preview-wrap">
                <video
                  class="video-preview"
                  controls
                  playsinline
                  preload="metadata"
                  :src="segmentGenStates[slot - 1].videoUrl ?? undefined"
                />
              </div>
            </div>
          </n-space>
        </n-space>
      </n-card>
      </section>
        </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 12px 24px 40px;
  min-height: 100%;
  box-sizing: border-box;
  color: inherit;
}

/* 与下方双栏同宽，避免头尾窄、内容宽的割裂感 */
.studio-wide-canvas {
  max-width: min(1680px, 100%);
  margin-left: auto;
  margin-right: auto;
}

.studio-lock-banner {
  font-size: 15px;
  padding: 5px;
  margin: 0 auto 18px;
}

.studio-dh-strip {
  margin: 0 auto 18px;
}

.studio-dh-thumb {
  width: 120px;
  height: 120px;
  max-width: 100%;
  object-fit: cover;
  border-radius: 14px;
  border: 1px solid rgba(148, 163, 184, 0.4);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}

/* 未创建数字人时整区不可点；略提亮度避免在部分屏幕上像「白屏/内容消失」 */
.studio-body--locked {
  pointer-events: none;
  user-select: none;
  opacity: 0.78;
  filter: grayscale(0.12);
}

.page__content {
  max-width: 1080px;
  margin: 0 auto;
}

/* 口播制作：宽屏双栏，左源视频+文案、右生成；窄屏仍单列 */
.page__content--studio {
  max-width: min(1680px, 100%);
  margin: 0 auto;
  width: 100%;
}

.studio-workspace {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
  align-items: start;
  width: 100%;
}

@media (min-width: 1180px) {
  .studio-workspace {
    grid-template-columns: minmax(0, 1.12fr) minmax(0, 0.88fr);
    gap: 24px;
  }

  /* 仅做轻微吸顶，避免 max-height+overflow 在部分环境下造成布局/滚动异常；双栏已减少纵向长度 */
  .studio-panel--output {
    position: sticky;
    top: 80px;
    align-self: start;
  }
}

.studio-panel--source .n-card,
.studio-panel--output .n-card {
  min-width: 0;
}

/* 与 grid gap 二选一，避免右栏与上栏再叠出一段空白 */
.page__content--studio .step-generate-card {
  margin-top: 0;
}

/* Hero 在宽屏时压缩纵向占位 */
.home-hero-slot {
  max-width: min(1680px, 100%);
  margin: 0 auto;
}

.video-segment-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.video-segment-label {
  flex: 0 0 52px;
  font-size: 12px;
}

.video-segment-input {
  flex: 1;
  min-width: 0;
}

.video-segment-result {
  padding: 10px 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.video-segment-result:last-child {
  border-bottom: none;
}

.dh-portrait-block {
  margin-top: 4px;
}

.dh-portrait-preview {
  margin-top: 10px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.35);
  max-width: 280px;
}

.dh-portrait-preview img {
  display: block;
  width: 100%;
  height: auto;
}

.video-preview-wrap {
  margin-top: 8px;
}

.video-preview {
  width: 100%;
  max-width: 420px;
  border-radius: 10px;
  background: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.35);
}

.meta-feature-card {
  margin-top: 4px;
}

.meta-hint-line {
  line-height: 1.6;
}

.meta-layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
}

.meta-cover {
  width: 200px;
  max-width: 100%;
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  object-fit: cover;
  aspect-ratio: 3 / 4;
  background: #0f172a;
}

.meta-readonly {
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  color: #cbd5f5;
  max-height: 220px;
  overflow-y: auto;
}

.script-block {
  margin-top: 4px;
  padding-top: 16px;
  border-top: 1px solid rgba(148, 163, 184, 0.25);
}

.script-textarea {
  font-size: 14px;
}

.glass {
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.72));
  border: 1px solid rgba(148, 163, 184, 0.35);
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.75);
}

@media (max-width: 900px) {
  .page {
    padding: 10px 16px 32px;
    padding-left: max(16px, var(--app-safe-left, 0px));
    padding-right: max(16px, var(--app-safe-right, 0px));
    padding-bottom: max(32px, var(--app-safe-bottom, 0px));
  }

  .studio-lock-banner {
    margin-left: 0;
    margin-right: 0;
  }
}

@media (max-width: 640px) {
  .page {
    padding: 8px 12px 28px;
    padding-left: max(12px, var(--app-safe-left, 0px));
    padding-right: max(12px, var(--app-safe-right, 0px));
    padding-bottom: max(28px, var(--app-safe-bottom, 0px));
  }

  .studio-dh-thumb {
    width: 100px;
    height: 100px;
  }

  .video-segment-row {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }

  .video-segment-label {
    flex: 0 0 auto;
  }

  .meta-layout {
    flex-direction: column;
  }

  .meta-cover {
    width: 100%;
    max-width: 240px;
    margin: 0 auto;
  }

  .meta-readonly {
    max-height: 180px;
  }

  .script-textarea {
    font-size: 16px; /* 减轻 iOS 自动放大 */
  }
}

/* 单栏时取消右栏吸顶，避免与顶栏/安全区叠层 */
@media (max-width: 1179px) {
  .studio-panel--output {
    position: static;
    top: auto;
  }
}
</style>
