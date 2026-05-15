import { http } from '@/api/http'
import type {
  AspectRatio,
  RenderMode,
  RewriteStyle,
  TaskDetail,
  TaskResultPayload,
  Transcript,
  TranscriptSegment,
  VideoMetaPreview,
} from '@/types/domain'

/** 创建任务 */
export interface CreateTaskBody {
  sourceVideoUrl: string
  /** 首页解析并编辑后的口播文案；有值时后端抽取阶段优先采用 */
  initialTranscript?: string
}

export async function createTask(body: CreateTaskBody) {
  const { data } = await http.post<TaskDetail>('v1/tasks', body)
  return data
}

/** 仅根据音视频 URL 预览口播文案（不创建任务；后端统一调用千问 ASR） */
export async function previewTranscript(body: { sourceVideoUrl: string }) {
  const { data } = await http.post<{ fullText: string; language: string }>(
    'v1/tools/transcript-preview',
    body,
  )
  return data
}

/** 第三步：探测千问 ASR（转写 HTTP）是否配置 */
export interface OptimizeOralScriptResponse {
  hook3s: string
  hook10s: string
  optimizedScript: string
  strategyId: string
  strategyLabel: string
  llmUsed: boolean
}

export async function optimizeOralScript(body: {
  sourceText: string
  sourceVideoUrl?: string
}) {
  const { data } = await http.post<OptimizeOralScriptResponse>(
    'v1/tools/optimize-oral-script',
    body,
    { timeout: 120_000 },
  )
  return data
}

export interface AsrHealthResponse {
  ok: boolean
  transcribeUrlConfigured: boolean
  healthUrl: string
  latencyMs: number
  error?: string
}

export async function checkAsrHealth() {
  const { data } = await http.get<AsrHealthResponse>('v1/tools/asr-health', {
    timeout: 15_000,
  })
  return data
}

/** 口播转写链路：保存目录 + FFmpeg + ASR（与 /transcribe-pipeline-health 对齐） */
export interface TranscribePipelineHealth {
  videoSaveDir: { path: string; writable: boolean; error?: string }
  ffmpeg: { ok: boolean; path: string; versionHint?: string; error?: string }
  asr: AsrHealthResponse
  dyCookieConfigured: boolean
}

export async function getTranscribePipelineHealth() {
  const { data } = await http.get<TranscribePipelineHealth>('v1/tools/transcribe-pipeline-health', {
    /** 后端会串行探测目录、FFmpeg、ASR；略放宽避免慢机误判 */
    timeout: 30_000,
  })
  return data
}

/** 第二步「生成视频」：大模型优化口播 + 演示成片预览 */
export interface GenerateVideoPreviewResponse {
  optimizedScript: string
  llmUsed: boolean
  estimatedTotalSeconds: number
  videoUrl: string | null
  hint: string
}

export async function generateVideoPreview(
  body: {
    script: string
    sourceVideoUrl?: string
    /** 数字人参考图 data URL（配置 ARK 时推荐） */
    imageDataUrl?: string
    imageUrl?: string
  },
  opts?: { signal?: AbortSignal },
) {
  const { data } = await http.post<GenerateVideoPreviewResponse>(
    'v1/tools/generate-video-preview',
    body,
    /** 含方舟轮询，适当放宽；可配合 AbortController 取消当前条 */
    { timeout: 600_000, signal: opts?.signal },
  )
  return data
}

/** 火山方舟图生视频：创建异步任务（需后端配置 ARK_API_KEY） */
export async function createArkI2vTask(body: {
  prompt: string
  imageUrl: string
  model?: string
}) {
  const { data } = await http.post<{ status: number; data: unknown }>(
    'v1/tools/ark-i2v-task',
    body,
    { timeout: 120_000 },
  )
  return data
}

export interface AliLipSyncResponse {
  videoUrl: string | null
  providerResponse: unknown
  hint?: string
}

export interface LipSyncPreviewResponse {
  optimizedScript: string
  llmUsed: boolean
  estimatedTotalSeconds: number
  videoUrl: string | null
  hint: string
  providerResponse?: unknown
  fallback?: boolean
  lipSyncApplied?: boolean
}

export interface VoicePreviewResponse {
  audioUrl: string
  hint: string
  ttsMode: 'provider' | 'mock'
  voiceLabel: string
  durationSeconds: number
}

export interface SubtitleCue {
  id: string
  startMs: number
  endMs: number
  text: string
  lines: string[]
}

export interface SubtitleWorkflowJson {
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
  cues: SubtitleCue[]
}

export interface SubtitleWorkflowPreviewResponse {
  draftId: string
  previewUrl: string
  subtitleJson: SubtitleWorkflowJson
  hint: string
  ttsMode: 'provider' | 'mock'
  timelineSource: 'asr-fallback' | 'local-estimate'
  lipSyncApplied?: boolean
  providerResponse?: unknown
}

export interface SubtitleWorkflowFinalizeResponse {
  draftId: string
  videoUrl: string
  subtitleJson: SubtitleWorkflowJson
  hint: string
  fallback: boolean
  providerResponse?: unknown
}

export interface DouyinHomepageLearnedProfile {
  secUserId: string
  uid: string
  nickname: string
  handle: string
  signature: string
  avatarUrl: string
  awemeCount: number
  followerCount: number
  followingCount: number
  totalFavorited: number
  city: string
  liveStatus: number
}

export interface DouyinHomepageLearnedPost {
  awemeId: string
  title: string
  coverUrl: string
  diggCount: number
  commentCount: number
  shareCount: number
  createdAt: string
}

export interface DouyinHomepageLearnResponse {
  sourceUrl: string
  learnedAt: string
  hint: string
  profile: DouyinHomepageLearnedProfile
  samples: DouyinHomepageLearnedPost[]
  ideaSuggestions: string[]
}

/** 视频对口型：上传不超过 5 分钟的视频，后端代理调用阿里接口并返回成片地址 */
export async function createAliLipSyncVideo(body: {
  file: File
  durationSeconds?: number
}) {
  const form = new FormData()
  form.append('video', body.file)
  if (body.durationSeconds !== undefined) {
    form.append('durationSeconds', String(body.durationSeconds))
  }
  const { data } = await http.post<AliLipSyncResponse>('v1/tools/ali-lip-sync', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 900_000,
  })
  return data
}

export async function createLipSyncPreview(body: {
  script: string
  avatarResourceId: string
  voiceResourceId: string
}, opts?: { signal?: AbortSignal }) {
  const { data } = await http.post<LipSyncPreviewResponse>('v1/tools/lip-sync-preview', body, {
    timeout: 900_000,
    signal: opts?.signal,
  })
  return data
}

export type VoiceTuningRequest = {
  voiceLanguage?: string
  voiceEmotion?: string
  voiceEmotionIntensity?: number
  voiceRate?: number
  voiceVolume?: number
  voicePitch?: number
}

export async function createVoicePreview(body: {
  script: string
  voiceResourceId: string
} & VoiceTuningRequest) {
  const { data } = await http.post<VoicePreviewResponse>('v1/tools/voice-preview', body, {
    timeout: 180_000,
  })
  return data
}

export async function learnDouyinHomepage(body: { homepageUrl: string }) {
  const { data } = await http.post<DouyinHomepageLearnResponse>(
    'v1/tools/douyin-homepage-learn',
    body,
    { timeout: 120_000 },
  )
  return data
}

export async function createSubtitleWorkflowPreview(
  body: {
    script: string
    avatarResourceId: string
    voiceResourceId: string
    subtitleTemplateId?: string
    subtitlesEnabled?: boolean
    previewSeconds?: number
  } & VoiceTuningRequest,
  opts?: { signal?: AbortSignal },
) {
  const { data } = await http.post<SubtitleWorkflowPreviewResponse>(
    'v1/tools/subtitle-workflow-preview',
    body,
    {
      timeout: 900_000,
      signal: opts?.signal,
    },
  )
  return data
}

export async function finalizeSubtitleWorkflow(body: { draftId: string }, opts?: { signal?: AbortSignal }) {
  const { data } = await http.post<SubtitleWorkflowFinalizeResponse>(
    'v1/tools/subtitle-workflow-finalize',
    body,
    {
      timeout: 900_000,
      signal: opts?.signal,
    },
  )
  return data
}

/** 数字人：风格列表 */
export type SmartClipCutMode = 'light' | 'standard' | 'strong'
export type SmartClipRenderStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface SmartClipCutConfig {
  silenceThreshold: number
  minSilenceDuration: number
  keepPause: number
}

export interface SmartClipCutPoint {
  id: string
  type: 'silence'
  startTime: number
  endTime: number
  duration: number
  suggestCutStart: number
  suggestCutEnd: number
  cutDuration: number
  keepDuration: number
  enabled: boolean
  confidence: number
}

export interface SmartClipCutSummary {
  totalCount: number
  totalCutDuration: number
  originalDuration: number
  estimatedDuration: number
}

export interface SmartClipHighlightRange {
  start: number
  end: number
  color?: string
  fontWeight?: number
}

export interface SmartClipSubtitle {
  id: string
  startTime: number
  endTime: number
  text: string
  highlightRanges?: SmartClipHighlightRange[]
}

export interface SmartClipRenderTask {
  taskId: string
  status: SmartClipRenderStatus
  progress: number
  outputUrl?: string
  duration?: number
  error?: string
}

export async function detectSmartClipCutPoints(
  projectId: string,
  body: {
    mode: SmartClipCutMode
    config: SmartClipCutConfig
    avatarResourceId?: string
    sourceVideoUrl?: string
  },
) {
  const { data } = await http.post<{
    cutPoints: SmartClipCutPoint[]
    summary: SmartClipCutSummary
  }>(`v1/video-projects/${encodeURIComponent(projectId)}/detect-cut-points`, body, {
    timeout: 300_000,
  })
  return data
}

export async function renderSmartClipFinal(
  projectId: string,
  body: {
    script: string
    avatarResourceId: string
    voiceResourceId: string
    subtitleTemplateId: string
    subtitles: SmartClipSubtitle[]
    cutConfig: {
      enabled: boolean
      mode: SmartClipCutMode
      config: SmartClipCutConfig
      cutPoints: SmartClipCutPoint[]
    }
    backgroundMusic: {
      enabled: boolean
      musicId: string
      volume: number
    }
    pipMaterials: {
      enabled: boolean
      items: unknown[]
    }
    renderOptions: {
      resolution: string
      format: 'mp4'
      burnSubtitles: boolean
    }
  } & VoiceTuningRequest,
) {
  const {
    voiceLanguage,
    voiceEmotion,
    voiceEmotionIntensity,
    voiceRate,
    voiceVolume,
    voicePitch,
    ...payload
  } = body
  const { data } = await http.post<SmartClipRenderTask>(
    `v1/video-projects/${encodeURIComponent(projectId)}/render-final`,
    {
      ...payload,
      voiceTuning: {
        language: voiceLanguage,
        emotion: voiceEmotion,
        emotionIntensity: voiceEmotionIntensity,
        speechRate: voiceRate,
        volume: voiceVolume,
        pitch: voicePitch,
      },
    },
    { timeout: 120_000 },
  )
  return data
}

export async function getSmartClipRenderTask(taskId: string) {
  const { data } = await http.get<SmartClipRenderTask>(
    `v1/render-tasks/${encodeURIComponent(taskId)}`,
    { timeout: 30_000 },
  )
  return data
}

export async function getDigitalHumanStyles() {
  const { data } = await http.get<{ styles: { id: string; label: string }[] }>(
    'v1/tools/digital-human-styles',
  )
  return data.styles
}

/** 自拍照 + 风格 → 大模型接口（服务端拼接 content） */
export interface DigitalHumanGenerateResponse {
  imageUrl: string | null
  styleId: string
  styleLabel: string
  contentUsed: string
  mode: 'seedream' | 'ark' | 'remote' | 'mock'
  hint?: string
  persisted?: {
    saved: boolean
    /** 相对 baseURL，需带 Authorization；展示请用 blob GET */
    imageFetchPath: string
  }
}

export async function generateDigitalHumanImage(body: { file: File; styleId: string }) {
  const form = new FormData()
  form.append('selfie', body.file)
  form.append('styleId', body.styleId)
  const { data } = await http.post<DigitalHumanGenerateResponse>(
    'v1/tools/digital-human-generate',
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120_000,
    },
  )
  return data
}

/** 是否已有保存的数字人模板（每人最多 1 个） */
export async function getDigitalHumanTemplate() {
  const { data } = await http.get<
    | { hasTemplate: false }
    | {
        hasTemplate: true
        styleId: string
        createdAt: string
        updatedAt: string
        imageFetchPath: string
      }
  >('v1/tools/digital-human-template')
  return data
}

/** 拉取已保存的数字人图（需鉴权，返回 Blob） */
export async function fetchDigitalHumanImageBlob() {
  const res = await http.get('v1/tools/digital-human-image', {
    responseType: 'blob',
    timeout: 60_000,
  })
  return res.data as Blob
}

/** 删除当前用户的数字人模板与文件（每人仅 1 个） */
export async function deleteDigitalHumanTemplate() {
  const { data } = await http.delete<{ ok: true; deleted: boolean }>('v1/tools/digital-human-template')
  return data
}

/** 主后端内存中已保存的转写（GET transcripts/:id） */
export interface SavedTranscriptResponse {
  transcriptId: string
  createdAt: string
  fullText: string
  language: string
  segments: TranscriptSegment[]
  sourceFilename?: string
}

export async function getSavedTranscript(transcriptId: string) {
  const { data } = await http.get<SavedTranscriptResponse>(
    `v1/tools/transcripts/${encodeURIComponent(transcriptId)}`,
  )
  return data
}

/** multipart 字段名 `file`：服务端 FFmpeg 预处理后调用 ASR，返回 transcriptId */
export interface TranscribeApiResponse {
  transcriptId: string
  fullText: string
  language: string
  segments: TranscriptSegment[]
  provider: 'asr-api'
}

export async function transcribeUploadFile(file: File) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await http.post<TranscribeApiResponse>('v1/tools/transcribe', form, { timeout: 300_000 })
  return data
}

/** 作品页链接 → 后端拉取媒体 → ASR（需配置 ASR / OpenAI 等） */
export async function transcribeFromUrl(body: { sourceVideoUrl: string }) {
  const { data } = await http.post<TranscribeApiResponse>('v1/tools/transcribe-url', body, { timeout: 600_000 })
  return data
}

/** 抖音：dy-downloader 下载 → ASR → 返回文案并生成改写建议（与任务改写同源） */
export interface DouyinTranscribeRewriteResponse extends TranscribeApiResponse {
  rewriteSuggestion: string
  rewriteStyle: RewriteStyle
}

export async function douyinTranscribeRewrite(body: {
  sourceVideoUrl: string
  rewriteStyle?: RewriteStyle
}) {
  const { data } = await http.post<DouyinTranscribeRewriteResponse>(
    'v1/tools/douyin-transcribe-rewrite',
    body,
    { timeout: 600_000 },
  )
  return data
}

/** 抓取视频页元信息（HTML/Open Graph，不调用 AI）；外链抓取可能较慢，勿用默认 30s */
export async function fetchVideoMeta(body: { sourceVideoUrl: string }) {
  const { data } = await http.post<VideoMetaPreview>('v1/tools/video-meta', body, {
    timeout: 120_000,
  })
  return data
}

/** 抖音 dy-downloader：是否已配置 DY_DOWNLOADER_COOKIE（不返回 Cookie 内容） */
export async function getDyDownloaderCookieConfigured() {
  const { data } = await http.get<{ configured?: boolean }>('v1/tools/dy-downloader-cookie', {
    timeout: 12_000,
  })
  return { configured: Boolean(data?.configured) }
}

export interface SourceVideoFileResponse {
  ok: true
  savedPath: string
  message: string
  /** 与下载同源媒体经 ASR 转写的口播全文；未配置转写 API 或失败时为 null */
  transcript: TranscribeApiResponse | null
  transcriptionError?: string
}

/**
 * 下载源视频并由服务端保存到项目内资源目录（默认 backend/data/download-video，见后端 VIDEO_SAVE_DIR）。
 * `transcribe: false` 时仅落盘，不调用 ASR（首页抖音流程会先下载再单独调 transcribe-saved-video 以展示进度）。
 * 默认 `transcribe: true` 时与旧行为一致：保存后同一次请求内完成转写。
 */
export async function downloadSourceVideoFile(
  body: { sourceVideoUrl: string; transcribe?: boolean },
): Promise<SourceVideoFileResponse> {
  const { data } = await http.post<SourceVideoFileResponse>('v1/tools/source-video-file', body, {
    timeout: 600_000,
  })
  return data
}

/** 保存目录（VIDEO_SAVE_DIR）下的文件名列表 */
export async function listSavedVideos() {
  const { data } = await http.get<{
    directory: string
    files: { name: string; size: number; mtime: string }[]
  }>('v1/tools/saved-videos', { timeout: 15_000 })
  return data
}

export async function fetchSavedVideoBlob(fileName: string) {
  const res = await http.get(`v1/tools/saved-videos/${encodeURIComponent(fileName)}/stream`, {
    responseType: 'blob',
    timeout: 120_000,
  })
  return res.data as Blob
}

/** 对已保存到本地的视频文件做 FFmpeg + ASR，生成口播（不重新下载） */
export async function transcribeSavedVideo(body: { fileName: string }) {
  const { data } = await http.post<{
    transcript: TranscribeApiResponse | null
    transcriptionError?: string
  }>('v1/tools/transcribe-saved-video', body, { timeout: 600_000 })
  return data
}

export async function getTask(taskId: string) {
  const { data } = await http.get<TaskDetail>(`v1/tasks/${taskId}`)
  return data
}

/** multipart：字段名 file */
export async function uploadTaskPhoto(taskId: string, file: File) {
  const form = new FormData()
  form.append('file', file)
  /** 不手动设置 Content-Type，由浏览器自动带 multipart boundary */
  const { data } = await http.post<{ photo: TaskDetail['photo'] }>(`v1/tasks/${taskId}/photo`, form)
  return data
}

/** 启动解析 + 模拟转写流水线 */
export async function startExtract(taskId: string) {
  const { data } = await http.post<{ accepted: true }>(`v1/tasks/${taskId}/extract`)
  return data
}

export async function getTranscript(taskId: string) {
  const { data } = await http.get<Transcript>(`v1/tasks/${taskId}/transcript`)
  return data
}

export async function suggestRewrite(taskId: string, style: RewriteStyle) {
  const { data } = await http.post<{ text: string }>(`v1/tasks/${taskId}/rewrite/suggest`, { style })
  return data
}

export async function submitRewrite(taskId: string, payload: { text: string; style: RewriteStyle }) {
  const { data } = await http.post<{ ok: true }>(`v1/tasks/${taskId}/rewrite`, payload)
  return data
}

export async function submitRender(
  taskId: string,
  payload: {
    mode: RenderMode
    aspect: AspectRatio
    voiceStyleId: string
    subtitleStyleId: string
  },
) {
  const { data } = await http.post<{ ok: true; jobId: string }>(`v1/tasks/${taskId}/render`, payload)
  return data
}

export async function getTaskResult(taskId: string) {
  const { data } = await http.get<TaskResultPayload>(`v1/tasks/${taskId}/result`)
  return data
}

/** 使用 Axios 下载需鉴权的静态资源（字幕 / 文案） */
export async function downloadTaskAsset(taskId: string, kind: 'subtitle' | 'script', filename: string) {
  const path =
    kind === 'subtitle' ? `v1/tasks/${taskId}/download/subtitle` : `v1/tasks/${taskId}/download/script`
  const res = await http.get(path, { responseType: 'blob' })
  const blob = new Blob([res.data])
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
