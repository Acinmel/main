export type ResourceScope = "all" | "mine" | "recommended";

export type ResourceOwner = "mine" | "recommended";

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ResourceBase {
  id: string;
  name: string;
  owner: ResourceOwner;
  recommended: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
}

export interface AvatarResource extends ResourceBase {
  coverUrl: string;
  originalVideoUrl: string | null;
  styleId: string | null;
  videoCoverUrl?: string | null;
  videoDurationSeconds?: number | null;
  modelType?: string | null;
  assetStatus?: string | null;
  videoOssKey?: string | null;
  previewUrl?: string | null;
  metadataUrl?: string | null;
}

export interface AvatarUploadVideo {
  avatarId: string;
  avatarName: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  mtime: string;
  previewUrl: string;
  metadataUrl: string;
}

export interface AvatarVideoMetadata {
  fileSize: number;
  mimeType: string;
  mtime: string;
  previewUrl: string;
  metadataUrl: string;
}

export interface VoiceResource extends ResourceBase {
  audioUrl: string;
  sampleMissing?: boolean;
  cloneStatus: "ready" | "processing" | "failed" | null;
  renderMode?: "tts" | "sample-audio";
  canUseForRender?: boolean;
  renderUnavailableReason?: string | null;
  supportsDynamicTts?: boolean;
  provider: string | null;
  providerVoice: string | null;
  providerModel: string | null;
  sampleDurationMs: number | null;
  cloneError: string | null;
}

export interface SubtitleTemplateResource extends ResourceBase {
  coverUrl: string;
  thumbnailUrl?: string | null;
  previewThumbnailUrl?: string | null;
  coverThumbnailUrl?: string | null;
  previewCoverUrl: string;
  previewUrl?: string;
  styleJson: Record<string, unknown>;
  scope?: "public" | "recommended" | "user";
  editable?: boolean;
  baseTemplateId?: string | null;
  aspectRatio?: SubtitleTemplateAspectRatio;
  styleConfig?: SubtitleTemplateStyleConfig | null;
}

export interface ListResourcesParams {
  scope: ResourceScope;
  cursor?: string | null;
  limit?: number;
}

export interface CreateAvatarResourceBody {
  name: string;
  coverUrl?: string;
  originalVideoUrl?: string;
  styleId?: string;
}

export interface CreateDigitalHumanAssetBody {
  name: string;
  styleId?: string;
  coverUrl?: string;
  originalVideoUrl?: string;
  videoPath?: string;
  videoOssKey?: string;
  videoCoverUrl?: string;
  videoDurationSeconds?: number;
  modelType?: string;
  status?: string;
}

export interface CreateAvatarResourceDraft extends CreateAvatarResourceBody {
  uploadFile?: File;
  uploadCoverFile?: File;
  uploadVideoDurationSeconds?: number;
  modelType?: string;
}

export interface CreateVoiceResourceBody {
  name: string;
  audioUrl?: string;
}

export interface CreateVoiceResourceDraft extends CreateVoiceResourceBody {
  sampleFile?: File;
}

export interface CreateSubtitleTemplateBody {
  name: string;
  coverUrl?: string;
  previewCoverUrl?: string;
  previewUrl?: string;
  aspectRatio?: SubtitleTemplateAspectRatio;
  styleJson?: Record<string, unknown>;
  styleConfig?: SubtitleTemplateStyleConfig;
}

export type SubtitleTemplateAspectRatio = "9:16" | "16:9" | "1:1" | "4:5" | "3:4";

export type SubtitleTemplateTextAlign = "left" | "center" | "right";

export type SubtitleTemplateAnchor =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type SubtitleTemplateDurationMode = "full" | "custom";

export interface SubtitleTemplateShadowStyle {
  enabled?: boolean;
  color?: string;
  blur?: number;
  x?: number;
  y?: number;
}

export interface SubtitleTemplateBackgroundStyle {
  transparent?: boolean;
  color?: string;
  opacity?: number;
}

export interface SubtitleTemplateTextStyle {
  fontFamily?: string;
  fontSize?: number;
  flowerStyle?: string;
  textColor?: string;
  align?: SubtitleTemplateTextAlign;
  shadow?: SubtitleTemplateShadowStyle;
  background?: SubtitleTemplateBackgroundStyle;
  xPct?: number;
  yPct?: number;
  anchor?: SubtitleTemplateAnchor;
}

export interface SubtitleTemplateCoverConfig {
  line1?: string;
  line2?: string;
  durationMode?: SubtitleTemplateDurationMode;
  durationSeconds?: number;
  style?: SubtitleTemplateTextStyle;
}

export interface SubtitleTemplateStyleBlock {
  style?: SubtitleTemplateTextStyle;
}

export interface SubtitleTemplateStyleConfig {
  cover?: SubtitleTemplateCoverConfig;
  title?: SubtitleTemplateStyleBlock;
  subtitle?: SubtitleTemplateStyleBlock;
}
