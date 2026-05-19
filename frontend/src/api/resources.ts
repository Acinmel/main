import { http } from "@/api/http";
import type {
  AvatarResource,
  AvatarUploadVideo,
  CreateAvatarResourceBody,
  CreateAvatarResourceDraft,
  CreateSubtitleTemplateBody,
  CreateVoiceResourceBody,
  CreateVoiceResourceDraft,
  CursorPage,
  ListResourcesParams,
  SubtitleTemplateResource,
  VoiceResource,
} from "@/types/resources";

type ResourcePath = "avatars" | "voices" | "subtitle-templates";
type UploadProgressOptions = {
  onUploadProgress?: (percentage: number) => void;
};

const RESOURCE_LIST_CACHE_TTL_MS = 60_000;
const resourceListCache = new Map<
  string,
  { expiresAt: number; data: CursorPage<unknown> }
>();

function listParams(params: ListResourcesParams) {
  return {
    scope: params.scope,
    cursor: params.cursor || undefined,
    limit: params.limit,
  };
}

function cacheKey(path: ResourcePath, params: ListResourcesParams) {
  return `${path}:${params.scope}:${params.cursor || ""}:${params.limit || ""}`;
}

async function cachedList<T>(
  path: ResourcePath,
  params: ListResourcesParams,
  loader: () => Promise<CursorPage<T>>,
) {
  const key = cacheKey(path, params);
  const cached = resourceListCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data as CursorPage<T>;
  }
  const data = await loader();
  resourceListCache.set(key, {
    data: data as CursorPage<unknown>,
    expiresAt: Date.now() + RESOURCE_LIST_CACHE_TTL_MS,
  });
  return data;
}

function invalidateResourceListCache(path?: ResourcePath) {
  for (const key of resourceListCache.keys()) {
    if (!path || key.startsWith(`${path}:`)) {
      resourceListCache.delete(key);
    }
  }
}

function createUploadProgressHandler(handler?: (percentage: number) => void) {
  if (!handler) return undefined;
  return (event: { loaded: number; total?: number }) => {
    if (!event.total || event.total <= 0) return;
    handler(Math.min(100, Math.round((event.loaded / event.total) * 100)));
  };
}

export async function listAvatarResources(params: ListResourcesParams) {
  return cachedList("avatars", params, async () => {
    const { data } = await http.get<CursorPage<AvatarResource>>(
      "v1/resources/avatars",
      {
        params: listParams(params),
      },
    );
    return data;
  });
}

export async function listAvatarUploadVideos(opts?: {
  limit?: number;
  signal?: AbortSignal;
}) {
  const { data } = await http.get<AvatarUploadVideo[]>(
    "v1/resources/avatars/upload-videos",
    {
      params: { limit: opts?.limit },
      timeout: 15_000,
      signal: opts?.signal,
    },
  );
  return data.map((item) => ({
    ...item,
    previewUrl: item.previewUrl?.trim()
      ? normalizeApiMediaUrl(item.previewUrl)
      : avatarVideoStreamUrl(item.fileName),
  }));
}

export function avatarVideoStreamUrl(fileName: string) {
  return http.getUri({
    url: `v1/resources/avatar-video-files/${encodeURIComponent(fileName)}/stream`,
  });
}

function normalizeApiMediaUrl(url: string) {
  const trimmed = url.trim();
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  const apiRelative = trimmed.replace(/^\/+api\/+/, "");
  return http.getUri({ url: apiRelative.replace(/^\/+/, "") });
}

export async function createAvatarResource(body: CreateAvatarResourceBody) {
  const { data } = await http.post<AvatarResource>(
    "v1/resources/avatars",
    body,
  );
  invalidateResourceListCache("avatars");
  return data;
}

export async function uploadAvatarResource(
  body: CreateAvatarResourceDraft,
  opts?: UploadProgressOptions,
) {
  if (!body.uploadFile) {
    throw new Error("缺少上传视频文件");
  }
  const form = new FormData();
  form.append("file", body.uploadFile);
  form.append("name", body.name);
  if (body.coverUrl) form.append("coverUrl", body.coverUrl);
  if (body.styleId) form.append("styleId", body.styleId);
  const { data } = await http.post<AvatarResource>(
    "v1/resources/avatars/upload",
    form,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 600_000,
      onUploadProgress: createUploadProgressHandler(opts?.onUploadProgress),
    },
  );
  invalidateResourceListCache("avatars");
  return data;
}

export async function listVoiceResources(params: ListResourcesParams) {
  return cachedList("voices", params, async () => {
    const { data } = await http.get<CursorPage<VoiceResource>>(
      "v1/resources/voices",
      {
        params: listParams(params),
      },
    );
    return data;
  });
}

export async function cloneVoiceResource(body: CreateVoiceResourceBody) {
  const { data } = await http.post<VoiceResource>(
    "v1/resources/voices/clone",
    body,
    {
      timeout: 600_000,
    },
  );
  invalidateResourceListCache("voices");
  return data;
}

export async function cloneVoiceResourceUpload(
  body: CreateVoiceResourceDraft,
  opts?: UploadProgressOptions,
) {
  if (!body.sampleFile) {
    throw new Error("缺少音频样本文件");
  }
  const form = new FormData();
  form.append("file", body.sampleFile);
  form.append("name", body.name);
  const { data } = await http.post<VoiceResource>(
    "v1/resources/voices/clone-upload",
    form,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 600_000,
      onUploadProgress: createUploadProgressHandler(opts?.onUploadProgress),
    },
  );
  invalidateResourceListCache("voices");
  return data;
}

export async function listSubtitleTemplateResources(
  params: ListResourcesParams,
) {
  return cachedList("subtitle-templates", params, async () => {
    const { data } = await http.get<CursorPage<SubtitleTemplateResource>>(
      "v1/resources/subtitle-templates",
      { params: listParams(params) },
    );
    return data;
  });
}

export async function createSubtitleTemplateResource(
  body: CreateSubtitleTemplateBody,
) {
  const { data } = await http.post<SubtitleTemplateResource>(
    "v1/resources/subtitle-templates",
    body,
  );
  invalidateResourceListCache("subtitle-templates");
  return data;
}

export async function updateSubtitleTemplateResource(
  id: string,
  body: CreateSubtitleTemplateBody,
) {
  const { data } = await http.patch<SubtitleTemplateResource>(
    `v1/resources/subtitle-templates/${encodeURIComponent(id)}`,
    body,
  );
  invalidateResourceListCache("subtitle-templates");
  return data;
}

export async function copySubtitleTemplateResource(id: string) {
  const { data } = await http.post<SubtitleTemplateResource>(
    `v1/resources/subtitle-templates/${encodeURIComponent(id)}/copy`,
  );
  invalidateResourceListCache("subtitle-templates");
  return data;
}

export async function renameResource(
  path: ResourcePath,
  id: string,
  name: string,
) {
  const { data } = await http.patch<{
    id: string;
    name: string;
    updatedAt: string;
  }>(`v1/resources/${path}/${encodeURIComponent(id)}`, { name });
  invalidateResourceListCache(path);
  return data;
}

export async function deleteResource(path: ResourcePath, id: string) {
  const { data } = await http.delete<{ deletedIds: string[] }>(
    `v1/resources/${path}/${encodeURIComponent(id)}`,
  );
  invalidateResourceListCache(path);
  return data;
}

export async function batchDeleteResources(path: ResourcePath, ids: string[]) {
  const { data } = await http.post<{ deletedIds: string[] }>(
    `v1/resources/${path}/batch-delete`,
    { ids },
  );
  invalidateResourceListCache(path);
  return data;
}
