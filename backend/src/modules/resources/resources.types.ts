export type ResourceScope = 'all' | 'mine' | 'recommended';

export type ResourceKind = 'avatars' | 'voices' | 'subtitle-templates';
export type UploadPurpose =
  | 'source-video'
  | 'cover'
  | 'audio'
  | 'result'
  | 'title-asset';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface SignedUploadUrlDto {
  uploadId: string;
  purpose: UploadPurpose;
  objectKey: string;
  uploadUrl: string;
  method: 'PUT';
  requiredHeaders: Record<string, string>;
  expiresAt: string;
}

export interface AvatarResourceDto {
  id: string;
  name: string;
  owner: 'mine' | 'recommended';
  recommended: boolean;
  coverUrl: string;
  originalVideoUrl: string | null;
  previewUrl: string | null;
  metadataUrl: string | null;
  renderMode: 'source-video';
  canUseForRender: boolean;
  renderUnavailableReason: string | null;
  styleId: string | null;
  videoCoverUrl: string | null;
  videoDurationSeconds: number | null;
  modelType: string | null;
  assetStatus: string | null;
  videoOssKey: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AvatarSavedVideoDto {
  avatarId: string;
  avatarName: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  mtime: string;
  previewUrl: string;
  metadataUrl: string;
}

export interface VoiceResourceDto {
  id: string;
  name: string;
  owner: 'mine' | 'recommended';
  recommended: boolean;
  audioUrl: string;
  sampleMissing: boolean;
  cloneStatus: 'ready' | 'processing' | 'failed';
  renderMode: 'tts' | 'sample-audio';
  canUseForRender: boolean;
  renderUnavailableReason: string | null;
  supportsDynamicTts: boolean;
  provider: string | null;
  providerVoice: string | null;
  providerModel: string | null;
  sampleDurationMs: number | null;
  cloneError: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubtitleTemplateResourceDto {
  id: string;
  name: string;
  owner: 'mine' | 'recommended';
  recommended: boolean;
  editable: boolean;
  baseTemplateId: string | null;
  coverUrl: string;
  previewCoverUrl: string;
  styleJson: Record<string, unknown>;
  styleConfig: Record<string, unknown>;
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
  video_cover_url?: string | null;
  video_duration_seconds?: number | null;
  model_type?: string | null;
  asset_status?: string | null;
  video_oss_key?: string | null;
  clone_status?: string | null;
  provider?: string | null;
  provider_voice?: string | null;
  provider_model?: string | null;
  sample_duration_ms?: number | null;
  clone_error?: string | null;
  expires_at?: string | null;
  style_json?: string | null;
  style_config_json?: string | null;
  base_template_id?: string | null;
  created_at: string;
  updated_at: string;
}
