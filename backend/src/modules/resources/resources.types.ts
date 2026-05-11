export type ResourceScope = 'all' | 'mine' | 'recommended';

export type ResourceKind = 'avatars' | 'voices' | 'subtitle-templates';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AvatarResourceDto {
  id: string;
  name: string;
  owner: 'mine' | 'recommended';
  recommended: boolean;
  coverUrl: string;
  originalVideoUrl: string | null;
  styleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceResourceDto {
  id: string;
  name: string;
  owner: 'mine' | 'recommended';
  recommended: boolean;
  audioUrl: string;
  cloneStatus: 'ready' | 'processing' | 'failed';
  provider: string | null;
  providerVoice: string | null;
  providerModel: string | null;
  sampleDurationMs: number | null;
  cloneError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubtitleTemplateResourceDto {
  id: string;
  name: string;
  owner: 'mine' | 'recommended';
  recommended: boolean;
  coverUrl: string;
  previewCoverUrl: string;
  styleJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceRow {
  id: string;
  user_id: string | null;
  name: string;
  is_recommended: number;
  cover_url?: string | null;
  preview_url?: string | null;
  source_video_url?: string | null;
  audio_url?: string | null;
  style_id?: string | null;
  clone_status?: string | null;
  provider?: string | null;
  provider_voice?: string | null;
  provider_model?: string | null;
  sample_duration_ms?: number | null;
  clone_error?: string | null;
  style_json?: string | null;
  created_at: string;
  updated_at: string;
}
