/**
 * 任务域 DTO / 枚举：与前端 `src/api/task.ts` 类型保持一致，便于联调与后续代码生成
 */

export type TaskStatus =
  | 'pending'
  | 'parsing'
  | 'transcribing'
  | 'rewriting'
  | 'voice_generating'
  | 'avatar_generating'
  | 'rendering'
  | 'success'
  | 'failed';

export type RewriteStyle = 'conservative' | 'viral' | 'commerce' | 'knowledge';

export type RenderMode = 'virtual_bg' | 'reuse_source_bg' | 'subtitle_fast';

export type AspectRatio = '9:16' | '16:9';

export interface TranscriptSegmentDto {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptDto {
  taskId: string;
  language: string;
  fullText: string;
  segments: TranscriptSegmentDto[];
}

export interface RewritePayloadDto {
  text: string;
  style: RewriteStyle;
}

export interface RenderOptionsDto {
  mode: RenderMode;
  aspect: AspectRatio;
  voiceStyleId: string;
  subtitleStyleId: string;
}

export interface TaskFlagsDto {
  hasPhoto: boolean;
  transcriptAvailable: boolean;
  rewriteSaved: boolean;
  renderStarted: boolean;
  outputReady: boolean;
}

export interface TaskDetailDto {
  id: string;
  userId: string;
  status: TaskStatus;
  sourceVideoUrl: string;
  createdAt: string;
  updatedAt: string;
  failReason?: string;
  photo: {
    originalName: string;
    mimeType: string;
    byteLength: number;
  } | null;
  flags: TaskFlagsDto;
  /** GET /transcript 的轻量摘要，便于列表/轮询页展示 */
  transcriptPreview?: { fullText: string; language: string };
  rewrite: RewritePayloadDto | null;
  renderConfig: RenderOptionsDto | null;
  output: {
    mp4Url: string | null;
    subtitleUrl: string | null;
    scriptUrl: string | null;
  };
}

export interface TaskSummaryDto {
  id: string;
  status: TaskStatus;
  sourceVideoUrl: string;
  createdAt: string;
  updatedAt: string;
  title: string;
}

/** 服务端任务内存态（与 DB JSON 快照一致） */
export interface TaskInternal {
  id: string;
  userId: string;
  status: TaskStatus;
  sourceVideoUrl: string;
  createdAt: string;
  updatedAt: string;
  failReason?: string;
  photo?: {
    originalName: string;
    mimeType: string;
    byteLength: number;
  };
  transcript?: TranscriptDto;
  rewrite?: RewritePayloadDto;
  renderConfig?: RenderOptionsDto;
  output?: {
    mp4Url: string | null;
    subtitleUrl: string | null;
    scriptUrl: string | null;
  };
  extractStarted: boolean;
  renderStarted: boolean;
  prefilledTranscript?: string;
  /** 作品标题（可选；默认由源视频 URL 推导） */
  title?: string;
  /** 备注 / 说明 */
  content?: string;
}
