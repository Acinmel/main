import type { VoiceTuningOptions } from '../../integrations/ai/speech-ai.service';
import type { VoiceTuningRequest } from './voice-tuning.util';

export type CutMode = 'light' | 'standard' | 'strong';
export type RenderTaskStatus =
  | 'pending'
  | 'processing'
  | 'provider_running'
  | 'completed'
  | 'failed';

export interface CutDetectionConfig {
  silenceThreshold: number;
  minSilenceDuration: number;
  keepPause: number;
}

export interface CutPointDto {
  id: string;
  type: 'silence';
  startTime: number;
  endTime: number;
  duration: number;
  suggestCutStart: number;
  suggestCutEnd: number;
  cutDuration: number;
  keepDuration: number;
  enabled: boolean;
  confidence: number;
}

export interface CutSummaryDto {
  totalCount: number;
  totalCutDuration: number;
  originalDuration: number;
  estimatedDuration: number;
}

export interface HighlightRangeDto {
  start: number;
  end: number;
  color?: string;
  fontWeight?: number;
  fontSizeScale?: number;
}

export type VisualOverlayAnchor =
  | 'center'
  | 'top-center'
  | 'bottom-center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'left-center'
  | 'right-center';

export interface VisualOverlayLayoutDto {
  xPct: number;
  yPct: number;
  anchor?: VisualOverlayAnchor;
  safeAreaPct?: number;
  scale?: number;
  maxWidthPct?: number;
}

export interface SubtitleVisualStyleDto {
  layout?: VisualOverlayLayoutDto;
  normalColor?: string;
  highlightColor?: string;
  strokeColor?: string;
  backgroundColor?: string;
  fontSize?: number;
  strokeWidth?: number;
  fontWeight?: number;
  lineHeight?: number;
}

export interface ScriptHighlightDto {
  id?: string;
  start: number;
  end: number;
  text?: string;
  style?: {
    color?: string;
    fontSizeScale?: number;
    fontWeight?: number;
  };
}

export interface RenderSubtitleDto {
  id?: string;
  startTime: number;
  endTime: number;
  text: string;
  highlightRanges?: HighlightRangeDto[];
}

export interface DetectCutPointsBody {
  mode?: CutMode;
  config?: Partial<CutDetectionConfig>;
  avatarResourceId?: string;
  sourceVideoUrl?: string;
}

export interface RenderFinalBody extends VoiceTuningRequest {
  idempotencyKey?: string;
  forceRetry?: boolean;
  videoId?: string | number;
  script?: string;
  avatarResourceId?: string;
  voiceResourceId?: string;
  includeTitleAssets?: boolean;
  subtitleTemplateId?: string;
  highlights?: ScriptHighlightDto[];
  subtitles?: RenderSubtitleDto[];
  subtitleVisualStyle?: SubtitleVisualStyleDto;
  cutConfig?: {
    enabled?: boolean;
    mode?: CutMode;
    config?: Partial<CutDetectionConfig>;
    cutPoints?: Partial<CutPointDto>[];
  };
  backgroundMusic?: {
    enabled?: boolean;
    musicId?: string;
    volume?: number;
  };
  pipMaterials?: {
    enabled?: boolean;
    items?: unknown[];
  };
  renderOptions?: {
    resolution?: string;
    format?: 'mp4';
    burnSubtitles?: boolean;
    renderMode?: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
  };
  voiceTuning?: VoiceTuningOptions;
}

export interface CreateLipSyncTaskBody extends VoiceTuningRequest {
  idempotencyKey?: string;
  forceRetry?: boolean;
  regenerationKey?: string;
  digitalHumanId?: string;
  avatarResourceId?: string;
  audioAssetId?: string;
  voiceResourceId?: string;
  inputVoiceId?: string;
  inputAudioUrl?: string;
  inputAudioPath?: string;
  script?: string;
  renderMode?: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
}

export interface CreatePdEventTaskBody extends RenderFinalBody {
  digitalHumanId?: string;
  lipsyncTaskId?: string;
}

export interface PackageRenderTaskBody {
  idempotencyKey?: string;
  forceRetry?: boolean;
  videoId?: string | number;
  digitalHumanVideoAssetId?: string;
  audioAssetId?: string;
  subtitleTrackId?: string;
  subtitleTemplateId?: string;
  includeTitleAssets?: boolean;
  subtitleVisualStyle?: SubtitleVisualStyleDto;
  titleLayout?: VisualOverlayLayoutDto;
  renderOptions?: {
    burnSubtitles?: boolean;
    renderMode?: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
  };
}

export interface ProjectStageStateBody {
  scriptHash?: string | null;
  audioAssetId?: string | null;
  subtitleTrackId?: string | null;
  avatarResourceId?: string | null;
  renderMode?: '1080x1920' | 'adaptive' | 'preserveSourceAspect' | null;
  lipsyncTaskId?: string | null;
  digitalHumanVideoAssetId?: string | null;
  videoUrl?: string | null;
}

export interface CreateVideoProjectBody {
  name?: string;
}

export interface ListVideoProjectsQuery {
  scope?: 'active' | 'archived' | 'all';
  limit?: number | string;
  offset?: number | string;
}

export interface UpdateVideoProjectBody {
  name?: string;
}

export interface ArchiveVideoProjectBody {
  archived?: boolean;
}

export interface VideoProjectDto {
  projectId: string;
  name: string;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoProjectListDto {
  items: VideoProjectDto[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ProjectStageStateDto {
  projectId: string;
  scriptHash: string | null;
  audioAssetId: string | null;
  subtitleTrackId: string | null;
  avatarResourceId: string | null;
  renderMode: '1080x1920' | 'adaptive' | 'preserveSourceAspect' | null;
  lipsyncTaskId: string | null;
  digitalHumanVideoAssetId: string | null;
  videoUrl: string | null;
  updatedAt: string | null;
}

export interface ResolveLipSyncAssetQuery {
  audioAssetId: string;
  avatarResourceId: string;
  renderMode: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
}

export interface ResolvedLipSyncAssetDto {
  projectId: string;
  audioAssetId: string;
  avatarResourceId: string;
  renderMode: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
  digitalHumanVideoAssetId: string | null;
  videoUrl: string | null;
  duration: number | null;
  sourceTaskId: string | null;
  updatedAt: string | null;
}

export interface FinalRenderResult {
  videoUrl: string;
  duration: number;
  hint: string;
}

export interface RenderTaskDto {
  taskId: string;
  status: RenderTaskStatus;
  progress: number;
  errorMessage?: string;
  outputUrl?: string;
  duration?: number;
  hint?: string;
  error?: string;
  audioAssetId?: string;
  subtitleTrackId?: string;
  digitalHumanVideoAssetId?: string;
  provider?: Record<string, unknown>;
}

export const CUT_MODE_CONFIGS: Record<CutMode, CutDetectionConfig> = {
  light: {
    silenceThreshold: -35,
    minSilenceDuration: 0.5,
    keepPause: 0.25,
  },
  standard: {
    silenceThreshold: -35,
    minSilenceDuration: 0.35,
    keepPause: 0.18,
  },
  strong: {
    silenceThreshold: -32,
    minSilenceDuration: 0.25,
    keepPause: 0.08,
  },
};
