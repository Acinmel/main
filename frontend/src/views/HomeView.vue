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
import HomeHero from '@/components/home/HomeHero.vue'
import VideoLinkInput from '@/components/home/VideoLinkInput.vue'
import { listAvatarResources, listVoiceResources } from '@/api/resources'
import {
  createLipSyncPreview,
  downloadSourceVideoFile,
  fetchVideoMeta,
  getDyDownloaderCookieConfigured,
  getTranscribePipelineHealth,
  transcribeSavedVideo,
  transcribeUploadFile,
  transcribeFromUrl,
} from '@/api/task'
import { useTaskDraftStore } from '@/stores/taskDraft'
import { useTranscriptDraftStream } from '@/composables/useTranscriptDraftStream'
import { isDouyinNormalizedUrl, validateSourceVideoInput } from '@/utils/douyinShareUrl'
import { formatStatCount } from '@/utils/formatDisplay'
import {
  describeHttpOrNetworkError,
  describeHttpOrNetworkErrorMaybeBlob,
} from '@/utils/httpErrorMessage'
import axios from 'axios'

type SelectOption = { label: string; value: string }

type SegmentGenState = {
  progress: number
  processing: boolean
  statusLabel: string
  videoUrl: string | null
  hint: string
  optimizedScript: string
  error?: string
}

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

const VIDEO_SEGMENT_MAX = 6
const VIDEO_SEGMENT_MAX_CHARS = 60

const message = useMessage()
const route = useRoute()
const router = useRouter()
const draft = useTaskDraftStore()
const {
  applyTranscriptToEditableScript,
  cancelStream,
  interruptStreamWithFullText,
  isStreamingToScript,
} = useTranscriptDraftStream()

const loadingMeta = ref(false)
const douyinPipeline = ref(false)
const pipelinePhase = ref<'idle' | 'download' | 'transcribe'>('idle')
const pipelineProgress = ref(0)
const pipelineBarProcessing = ref(false)
const transcribeUploadLoading = ref(false)
const transcribeUrlLoading = ref(false)
const retranscribingLocal = ref(false)
const lastSavedVideoBasename = ref<string | null>(null)
const dyCookieConfigured = ref<boolean | null>(null)
const pipelineHealthError = ref('')

const renderResourceLoading = ref(false)
const avatarOptions = ref<SelectOption[]>([])
const voiceOptions = ref<SelectOption[]>([])
const selectedAvatarId = ref('')
const selectedVoiceId = ref('')
const requestedAvatarUnavailable = ref(false)

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
const pipelineStatusLabel = computed(() => {
  if (!douyinPipeline.value) return ''
  if (pipelinePhase.value === 'download') return '1/2 正在下载并保存抖音源视频…'
  if (pipelinePhase.value === 'transcribe') return '2/2 正在抽取音轨并转写文案…'
  return ''
})
const scriptBlockHint = computed(() =>
  isDouyinNormalizedUrl(draft.videoUrl)
    ? '抖音链接会先下载到服务端，再用 FFmpeg + ASR 回填到这里。'
    : '支持直接从上传音视频或当前链接中转写口播文案。',
)

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
      segmentGenStates.value[index].statusLabel = '正在准备文本和资源…'
    } else if (progress < 52) {
      segmentGenStates.value[index].statusLabel = '正在生成配音音轨…'
    } else if (progress < 82) {
      segmentGenStates.value[index].statusLabel = '正在驱动视频对口型…'
    } else {
      segmentGenStates.value[index].statusLabel = '正在等待成片返回…'
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
    message.warning('请先在上方口播文案中准备内容')
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
      message.warning('文案超过本批可容纳字数，末尾内容已暂时省略')
    } else {
      message.success('已按顺序自动拆分到各个片段')
    }
    return
  }

  for (let i = 0; i < count; i += 1) {
    videoScriptSegments.value[i] = (parts[i] ?? '').slice(0, VIDEO_SEGMENT_MAX_CHARS)
  }
  if (parts.length > count) {
    message.info(`检测到 ${parts.length} 行，仅载入前 ${count} 行`)
  } else {
    message.success('已按行载入口播片段')
  }
}

function onVideoSegmentInput(index: number, value: string | null) {
  videoScriptSegments.value[index] = (value ?? '').slice(0, VIDEO_SEGMENT_MAX_CHARS)
}

function estimateGenerateSeconds(scriptLength: number) {
  return Math.min(180, Math.max(18, Math.round(18 + scriptLength * 0.35)))
}

async function loadRenderResources() {
  renderResourceLoading.value = true
  try {
    const [avatars, voices] = await Promise.all([
      listAvatarResources({ scope: 'all', limit: 40 }),
      listVoiceResources({ scope: 'all', limit: 40 }),
    ])
    avatarOptions.value = avatars.items
      .filter((item) => Boolean(item.originalVideoUrl))
      .map((item) => ({ label: item.name, value: item.id }))
    voiceOptions.value = voices.items.map((item) => ({
      label: item.name,
      value: item.id,
    }))

    const routeAvatarId =
      typeof route.query.avatarId === 'string' ? route.query.avatarId.trim() : ''
    requestedAvatarUnavailable.value = false
    if (routeAvatarId && avatarOptions.value.some((item) => item.value === routeAvatarId)) {
      selectedAvatarId.value = routeAvatarId
    } else if (routeAvatarId) {
      requestedAvatarUnavailable.value = true
    } else if (!selectedAvatarId.value && avatarOptions.value.length) {
      selectedAvatarId.value = avatarOptions.value[0].value
    }

    if (!selectedVoiceId.value && voiceOptions.value.length) {
      selectedVoiceId.value = voiceOptions.value[0].value
    }
  } catch {
    avatarOptions.value = []
    voiceOptions.value = []
  } finally {
    renderResourceLoading.value = false
  }
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
      selectedAvatarId.value = next
    }
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
  try {
    const meta = await fetchVideoMeta({ sourceVideoUrl: link.normalizedUrl })
    draft.setVideoMeta(meta)
    if (!isDouyinNormalizedUrl(link.normalizedUrl)) {
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
    message.success('已获取视频信息')
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
      message.error('未能识别服务端保存的视频文件名')
      return
    }
    lastSavedVideoBasename.value = basename

    pipelinePhase.value = 'transcribe'
    pipelineProgress.value = 50
    const result = await transcribeSavedVideo({ fileName: basename })
    pipelineProgress.value = 100
    pipelineBarProcessing.value = false

    if (result.transcript) {
      applyTranscriptToEditableScript({
        fullText: result.transcript.fullText,
        segments: result.transcript.segments,
        transcriptId: result.transcript.transcriptId,
      })
      message.success('抖音视频已下载并完成文案转写')
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
  const text = draft.manualScriptDraft.trim()
  if (!text) {
    message.warning('请先在文案框中准备内容')
    return
  }
  draft.commitManualScriptToPipeline()
  message.success(`已同步 ${text.length} 字到后续创作流程`)
}

async function onRetranscribeFromLocal() {
  const name = lastSavedVideoBasename.value?.trim()
  if (!name) {
    message.warning('还没有可重转写的本地视频，请先完成一次抖音抓取')
    return
  }
  retranscribingLocal.value = true
  try {
    const result = await transcribeSavedVideo({ fileName: name })
    if (result.transcript) {
      applyTranscriptToEditableScript({
        fullText: result.transcript.fullText,
        segments: result.transcript.segments,
        transcriptId: result.transcript.transcriptId,
      })
      message.success('已从本地保存视频重新生成文案')
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
    applyTranscriptToEditableScript({
      fullText: data.fullText,
      segments: data.segments,
      transcriptId: data.transcriptId,
    })
    message.success('上传文件已完成转写')
  } catch (e: unknown) {
    message.error(describeHttpOrNetworkError(e))
  } finally {
    transcribeUploadLoading.value = false
  }
}

async function onTranscribeNonDouyinFromUrl() {
  const link = validateSourceVideoInput(draft.videoUrl)
  if (!link.ok || !link.normalizedUrl) {
    message.error(link.message ?? '请先填写可解析的视频链接')
    return
  }
  transcribeUrlLoading.value = true
  try {
    const data = await transcribeFromUrl({ sourceVideoUrl: link.normalizedUrl })
    applyTranscriptToEditableScript({
      fullText: data.fullText,
      segments: data.segments,
      transcriptId: data.transcriptId,
    })
    message.success('当前链接内容已完成转写')
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
    message.warning('请至少填写一条口播内容，或从上方文案一键载入')
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

  clearAllSegmentProgressTimers()
  generateQueueStopRequested.value = false
  const controller = new AbortController()
  generateBatchAbort.value = controller
  generateVideoLoading.value = true
  generateVideoEstimatedTotalSec.value = toRun.reduce(
    (total, { s }) => total + Math.min(600, estimateGenerateSeconds(s.length) + 90),
    0,
  )
  segmentGenStates.value = Array.from(
    { length: VIDEO_SEGMENT_MAX },
    emptySegmentGenState,
  )

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
        segmentGenStates.value[idx] = {
          progress: 100,
          processing: false,
          statusLabel: '本段已完成',
          videoUrl: result.videoUrl,
          hint: result.hint,
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
          ? `已生成 ${okCount} 条对口型视频，并停止了后续任务`
          : `已生成 ${okCount} 条对口型视频`,
      )
    } else if (stoppedByUser) {
      message.info('已取消，本次没有成功生成片段。')
    } else {
      message.warning('这一批片段都还没有成功出片，请查看错误后重试')
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

onMounted(() => {
  void loadRenderResources()
  void refreshDyCookieStatus()
  void refreshPipelineHealth()
})

onUnmounted(() => {
  cancelStream()
  clearAllSegmentProgressTimers()
})
</script>

<template>
  <div class="page">
    <HomeHero class="home-hero-slot" />

    <div class="page__content page__content--studio">
      <div class="studio-workspace">
        <section class="studio-panel studio-panel--source" aria-label="原视频与口播文案">
          <n-card title="原视频与文案提取" size="large" class="glass">
            <n-space vertical :size="18">
              <VideoLinkInput v-model="draft.videoUrl" :invalid="urlInvalid" />

              <n-space align="center" :size="12" style="flex-wrap: wrap">
                <n-button :disabled="!linkReady" :loading="loadingMeta || douyinPipeline" secondary @click="onFetchVideoMeta">
                  获取视频信息
                </n-button>
                <n-tag v-if="dyCookieConfigured === true" size="small" type="success" :bordered="false">
                  抖音 Cookie 已配置
                </n-tag>
                <n-tag v-else-if="dyCookieConfigured === false" size="small" type="warning" :bordered="false">
                  抖音 Cookie 未配置
                </n-tag>
                <n-text v-if="pipelineHealthError" depth="3" style="font-size: 12px">
                  {{ pipelineHealthError }}
                </n-text>
              </n-space>

              <div class="script-block">
                <n-text strong style="display: block; margin-bottom: 8px">口播文案</n-text>
                <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 10px">
                  {{ scriptBlockHint }}
                </n-text>

                <template v-if="douyinPipeline">
                  <n-progress
                    type="line"
                    :percentage="pipelineProgress"
                    :processing="pipelineBarProcessing"
                    indicator-placement="inside"
                    style="margin-bottom: 8px"
                  />
                  <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 10px">
                    {{ pipelineStatusLabel }}
                  </n-text>
                </template>

                <n-text
                  v-if="isStreamingToScript"
                  depth="3"
                  style="font-size: 11px; display: block; margin-bottom: 8px; color: var(--primary)"
                >
                  正在流式写入口播文案，点击输入框可立即补全。
                </n-text>

                <n-input
                  v-model:value="draft.manualScriptDraft"
                  type="textarea"
                  :rows="9"
                  placeholder="在这里整理、改写并确认你要驱动配音的视频文案…"
                  show-count
                  :maxlength="50000"
                  class="script-textarea"
                  @click="interruptStreamWithFullText"
                />

                <n-space align="center" :size="10" style="margin-top: 12px; flex-wrap: wrap">
                  <n-button type="primary" secondary @click="onUseScript">使用文案</n-button>
                  <n-upload
                    :show-file-list="false"
                    :default-upload="false"
                    accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.webm,.mov,.mkv"
                    @change="onTranscribeUpload"
                  >
                    <n-button :loading="transcribeUploadLoading" size="small" secondary>
                      上传音视频转写
                    </n-button>
                  </n-upload>
                  <n-button
                    v-if="canTranscribeNonDouyinUrl"
                    size="small"
                    secondary
                    :loading="transcribeUrlLoading"
                    @click="onTranscribeNonDouyinFromUrl"
                  >
                    从当前链接转写
                  </n-button>
                  <n-button
                    v-if="lastSavedVideoBasename"
                    size="small"
                    secondary
                    :loading="retranscribingLocal"
                    @click="onRetranscribeFromLocal"
                  >
                    从本地保存视频重转写
                  </n-button>
                </n-space>
              </div>

              <template v-if="draft.videoMeta">
                <n-alert v-if="draft.videoMeta.warnings.length" type="warning" :show-icon="false">
                  <div v-for="(warning, index) in draft.videoMeta.warnings" :key="index">
                    {{ warning }}
                  </div>
                </n-alert>

                <n-descriptions label-placement="left" bordered size="small" :column="1">
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
            </n-space>
          </n-card>
        </section>

        <section class="studio-panel studio-panel--output" aria-label="数字人生成">
          <n-card title="数字人对口型预览" size="large" class="glass step-generate-card">
            <n-space vertical :size="16" class="generate-card-stack">
              <div class="resource-pickers">
                <div>
                  <n-text strong style="display: block; margin-bottom: 8px">选择数字人视频</n-text>
                  <n-select
                    v-model:value="selectedAvatarId"
                    :options="avatarOptions"
                    :loading="renderResourceLoading"
                    placeholder="从数字人库中选择一个出镜视频"
                  />
                  <n-space size="small" style="margin-top: 10px">
                    <n-button text type="primary" @click="router.push({ name: 'resource-library', query: { tab: 'avatars' } })">
                      去数字人库添加视频
                    </n-button>
                  </n-space>
                </div>

                <div>
                  <n-text strong style="display: block; margin-bottom: 8px">选择配音音色</n-text>
                  <n-select
                    v-model:value="selectedVoiceId"
                    :options="voiceOptions"
                    :loading="renderResourceLoading"
                    placeholder="从音色库中选择一个克隆声音"
                  />
                  <n-space size="small" style="margin-top: 10px">
                    <n-button text type="primary" @click="router.push({ name: 'resource-library', query: { tab: 'voices' } })">
                      去音色库管理音色
                    </n-button>
                  </n-space>
                </div>
              </div>

              <div class="segment-count-bar">
                <n-text strong>本批生成条数</n-text>
                <n-input-number
                  v-model:value="videoSegmentCount"
                  :min="1"
                  :max="VIDEO_SEGMENT_MAX"
                  :disabled="generateVideoLoading"
                  size="small"
                />
                <n-text depth="3" style="font-size: 12px">支持 1 到 {{ VIDEO_SEGMENT_MAX }} 条</n-text>
              </div>

              <div class="segment-editor">
                <div class="segment-toolbar">
                  <n-text strong>口播片段</n-text>
                  <n-button size="small" secondary :disabled="generateVideoLoading" @click="importSegmentsFromManualDraft">
                    从上方文案载入
                  </n-button>
                </div>
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

              <n-space align="center" :size="12" style="flex-wrap: wrap">
                <n-button
                  type="primary"
                  size="large"
                  :disabled="!canGenerateVideoPreview || generateVideoLoading"
                  :loading="generateVideoLoading"
                  @click="onGenerateVideo"
                >
                  生成对口型视频（本批 {{ safeSegmentCount }} 条）
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

              <n-text v-if="generateVideoLoading || generateVideoEstimatedTotalSec > 0" depth="3" style="font-size: 12px">
                本批预计总耗时约 {{ generateVideoEstimatedTotalSec }} 秒，仅作参考。
              </n-text>

              <n-space v-if="showSegmentResultBlocks" vertical :size="16" style="width: 100%">
                <div
                  v-for="slot in safeSegmentCount"
                  :key="`segment-result-${slot}`"
                  class="video-segment-result"
                >
                  <n-text strong style="display: block; margin-bottom: 6px">第 {{ slot }} 段</n-text>
                  <n-progress
                    type="line"
                    :percentage="segmentGenStates[slot - 1]?.progress ?? 0"
                    :processing="segmentGenStates[slot - 1]?.processing ?? false"
                    indicator-placement="inside"
                  />
                  <n-text
                    v-if="segmentGenStates[slot - 1]?.statusLabel"
                    depth="3"
                    style="font-size: 12px; display: block; margin-top: 6px"
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
              </n-space>
            </n-space>
          </n-card>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  overflow: hidden;
  min-height: 100%;
  padding: 12px 24px 48px;
  box-sizing: border-box;
  color: inherit;
  background:
    radial-gradient(circle at 12% 4%, rgba(22, 242, 139, 0.12), transparent 28%),
    radial-gradient(circle at 86% 12%, rgba(0, 210, 106, 0.1), transparent 26%),
    linear-gradient(135deg, #000302 0%, var(--bg-main) 42%, #000000 100%);
}

.page::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.045) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.78), transparent 82%);
}

.page__content {
  position: relative;
  z-index: 1;
  max-width: min(1680px, 100%);
  margin: 0 auto;
  width: 100%;
}

.studio-workspace {
  display: grid;
  grid-template-columns: 1fr;
  gap: 22px;
  align-items: start;
}

@media (min-width: 1180px) {
  .studio-workspace {
    grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
    gap: 26px;
  }

  .studio-panel--output {
    position: sticky;
    top: 80px;
    align-self: start;
  }
}

.glass {
  border: 1px solid var(--border-soft);
  background: linear-gradient(180deg, rgba(8, 28, 21, 0.78), rgba(2, 10, 7, 0.86));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    var(--shadow-soft);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.glass :deep(.n-card-header__main),
.glass :deep(.n-card__content),
.glass :deep(.n-card-content),
.glass :deep(.n-descriptions-header),
.glass :deep(.n-descriptions-table-content),
.glass :deep(.n-descriptions-table-header) {
  color: var(--text-main);
}

.script-textarea :deep(.n-input),
.script-textarea :deep(.n-input-wrapper),
.video-segment-input :deep(.n-input),
.video-segment-input :deep(.n-input-wrapper) {
  background: rgba(255, 255, 255, 0.04);
}

.script-block,
.segment-editor,
.video-segment-result,
.resource-pickers > div {
  padding: 16px;
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.03);
}

.resource-pickers {
  display: grid;
  gap: 14px;
}

.segment-count-bar,
.segment-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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

.meta-readonly {
  white-space: pre-wrap;
  line-height: 1.7;
}

.video-preview-wrap {
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid var(--border-soft);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
}

.video-preview {
  display: block;
  width: 100%;
  max-height: 360px;
  background: #020b08;
}

@media (max-width: 900px) {
  .page {
    padding: 12px 16px 36px;
  }
}
</style>
