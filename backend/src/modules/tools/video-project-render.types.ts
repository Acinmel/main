import type { VoiceTuningOptions } from '../../integrations/ai/speech-ai.service';

export type CutMode = 'light' | 'standard' | 'strong';
export type RenderTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

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
}

export interface RenderSubtitleDto {
  id: string;
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

export interface RenderFinalBody {
  script?: string;
  avatarResourceId?: string;
  voiceResourceId?: string;
  subtitleTemplateId?: string;
  subtitles?: RenderSubtitleDto[];
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
  };
  voiceTuning?: VoiceTuningOptions;
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
  outputUrl?: string;
  duration?: number;
  error?: string;
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
