import { http } from '@/api/http'
import type {
  AvatarResource,
  CreateAvatarResourceBody,
  CreateAvatarResourceDraft,
  CreateSubtitleTemplateBody,
  CreateVoiceResourceBody,
  CreateVoiceResourceDraft,
  CursorPage,
  ListResourcesParams,
  SubtitleTemplateResource,
  VoiceResource,
} from '@/types/resources'

type ResourcePath = 'avatars' | 'voices' | 'subtitle-templates'

function listParams(params: ListResourcesParams) {
  return {
    scope: params.scope,
    cursor: params.cursor || undefined,
    limit: params.limit,
  }
}

export async function listAvatarResources(params: ListResourcesParams) {
  const { data } = await http.get<CursorPage<AvatarResource>>('v1/resources/avatars', {
    params: listParams(params),
  })
  return data
}

export async function createAvatarResource(body: CreateAvatarResourceBody) {
  const { data } = await http.post<AvatarResource>('v1/resources/avatars', body)
  return data
}

export async function uploadAvatarResource(body: CreateAvatarResourceDraft) {
  if (!body.uploadFile) {
    throw new Error('缺少上传视频文件')
  }
  const form = new FormData()
  form.append('file', body.uploadFile)
  form.append('name', body.name)
  if (body.coverUrl) form.append('coverUrl', body.coverUrl)
  if (body.styleId) form.append('styleId', body.styleId)
  const { data } = await http.post<AvatarResource>('v1/resources/avatars/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 600_000,
  })
  return data
}

export async function listVoiceResources(params: ListResourcesParams) {
  const { data } = await http.get<CursorPage<VoiceResource>>('v1/resources/voices', {
    params: listParams(params),
  })
  return data
}

export async function cloneVoiceResource(body: CreateVoiceResourceBody) {
  const { data } = await http.post<VoiceResource>('v1/resources/voices/clone', body)
  return data
}

export async function cloneVoiceResourceUpload(body: CreateVoiceResourceDraft) {
  if (!body.sampleFile) {
    throw new Error('缺少音频样本文件')
  }
  const form = new FormData()
  form.append('file', body.sampleFile)
  form.append('name', body.name)
  const { data } = await http.post<VoiceResource>('v1/resources/voices/clone-upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 180_000,
  })
  return data
}

export async function listSubtitleTemplateResources(params: ListResourcesParams) {
  const { data } = await http.get<CursorPage<SubtitleTemplateResource>>(
    'v1/resources/subtitle-templates',
    { params: listParams(params) },
  )
  return data
}

export async function createSubtitleTemplateResource(body: CreateSubtitleTemplateBody) {
  const { data } = await http.post<SubtitleTemplateResource>(
    'v1/resources/subtitle-templates',
    body,
  )
  return data
}

export async function updateSubtitleTemplateResource(id: string, body: CreateSubtitleTemplateBody) {
  const { data } = await http.patch<SubtitleTemplateResource>(
    `v1/resources/subtitle-templates/${encodeURIComponent(id)}`,
    body,
  )
  return data
}

export async function copySubtitleTemplateResource(id: string) {
  const { data } = await http.post<SubtitleTemplateResource>(
    `v1/resources/subtitle-templates/${encodeURIComponent(id)}/copy`,
  )
  return data
}

export async function renameResource(path: ResourcePath, id: string, name: string) {
  const { data } = await http.patch<{ id: string; name: string; updatedAt: string }>(
    `v1/resources/${path}/${encodeURIComponent(id)}`,
    { name },
  )
  return data
}

export async function deleteResource(path: ResourcePath, id: string) {
  const { data } = await http.delete<{ deletedIds: string[] }>(
    `v1/resources/${path}/${encodeURIComponent(id)}`,
  )
  return data
}

export async function batchDeleteResources(path: ResourcePath, ids: string[]) {
  const { data } = await http.post<{ deletedIds: string[] }>(
    `v1/resources/${path}/batch-delete`,
    { ids },
  )
  return data
}
