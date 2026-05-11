export type ResourceScope = 'all' | 'mine' | 'recommended'

export type ResourceOwner = 'mine' | 'recommended'

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export interface ResourceBase {
  id: string
  name: string
  owner: ResourceOwner
  recommended: boolean
  createdAt: string
  updatedAt: string
}

export interface AvatarResource extends ResourceBase {
  coverUrl: string
  originalVideoUrl: string | null
  styleId: string | null
}

export interface VoiceResource extends ResourceBase {
  audioUrl: string
  cloneStatus: 'ready' | 'processing' | 'failed'
  provider: string | null
  providerVoice: string | null
  providerModel: string | null
  sampleDurationMs: number | null
  cloneError: string | null
}

export interface SubtitleTemplateResource extends ResourceBase {
  coverUrl: string
  previewCoverUrl: string
  styleJson: Record<string, unknown>
}

export interface ListResourcesParams {
  scope: ResourceScope
  cursor?: string | null
  limit?: number
}

export interface CreateAvatarResourceBody {
  name: string
  coverUrl?: string
  originalVideoUrl?: string
  styleId?: string
}

export interface CreateAvatarResourceDraft extends CreateAvatarResourceBody {
  uploadFile?: File
}

export interface CreateVoiceResourceBody {
  name: string
  audioUrl?: string
}

export interface CreateVoiceResourceDraft extends CreateVoiceResourceBody {
  sampleFile?: File
}

export interface CreateSubtitleTemplateBody {
  name: string
  coverUrl?: string
  previewCoverUrl?: string
  styleJson?: Record<string, unknown>
}
