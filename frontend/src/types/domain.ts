/**
 * 领域类型：与后端实体 / 任务状态对齐，便于联调
 */

/** 任务生命周期状态（与 PRD 一致） */
export type TaskStatus =
  | 'pending'
  | 'parsing'
  | 'transcribing'
  | 'rewriting'
  | 'voice_generating'
  | 'avatar_generating'
  | 'rendering'
  | 'success'
  | 'failed'

/** 视频生成模式（MVP 三种） */
export type RenderMode = 'virtual_bg' | 'reuse_source_bg' | 'subtitle_fast'

/** 文案改写风格 */
export type RewriteStyle = 'conservative' | 'viral' | 'commerce' | 'knowledge'

/** 视频比例 */
export type AspectRatio = '9:16' | '16:9'

export interface UserProfile {
  id: string
  email: string
  displayName?: string
  /** 后端 auth/me；非管理员为 user */
  role?: 'user' | 'admin'
  /** pending=待审核 active=已开通 disabled=停用 */
  accountStatus?: 'pending' | 'active' | 'disabled'
}

export interface TaskFlags {
  hasPhoto: boolean
  transcriptAvailable: boolean
  rewriteSaved: boolean
  renderStarted: boolean
  outputReady: boolean
}

export interface TaskDetail {
  id: string
  userId: string
  status: TaskStatus
  sourceVideoUrl: string
  createdAt: string
  updatedAt: string
  failReason?: string
  photo: {
    originalName: string
    mimeType: string
    byteLength: number
  } | null
  flags: TaskFlags
  transcriptPreview?: { fullText: string; language: string }
  rewrite: { text: string; style: RewriteStyle } | null
  renderConfig: {
    mode: RenderMode
    aspect: AspectRatio
    voiceStyleId: string
    subtitleStyleId: string
  } | null
  output: {
    mp4Url: string | null
    subtitleUrl: string | null
    scriptUrl: string | null
  }
}

export interface TranscriptSegment {
  startMs: number
  endMs: number
  text: string
}

export interface Transcript {
  taskId: string
  language: string
  fullText: string
  segments: TranscriptSegment[]
}

export interface TaskResultPayload {
  taskId: string
  mp4Url: string | null
  subtitleUrl: string | null
  scriptUrl: string | null
}

/** 我的作品列表项（与后端 TaskSummaryDto 对齐） */
export interface WorkItem {
  id: string
  status: TaskStatus
  title: string
  sourceVideoUrl: string
  createdAt: string
  updatedAt: string
}

/** 视频页元信息（与后端 VideoMetaDto 对齐，来自 HTML 抓取而非 AI） */
export type VideoPlatform = 'douyin' | 'unknown'

export interface VideoMetaPreview {
  platform: VideoPlatform
  canonicalUrl: string
  resolvedUrl: string
  title: string | null
  description: string | null
  /** 展示用正文（OG 或内嵌 desc） */
  content: string | null
  likeCount: number | null
  /** 播放量（抖音页 HTML 解析，解析不到为 null） */
  playCount: number | null
  /** 话题/标签 */
  tags: string[]
  /** 页面是否疑似包含可解析的视频资源 */
  videoAssetDetected: boolean
  /** 后端是否已配置 DY_DOWNLOADER_COOKIE */
  dyCookieConfigured: boolean
  /** 源视频下载条件说明 */
  sourceDownloadHint: string
  coverImageUrl: string | null
  videoUrl: string | null
  fetchedAt: string
  warnings: string[]
  hasUsefulMeta: boolean
}
