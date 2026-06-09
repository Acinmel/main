import { http } from "@/api/http";
import axios from "axios";
import type {
  AvatarResource,
  AvatarUploadVideo,
  AvatarVideoMetadata,
  CreateAvatarResourceBody,
  CreateAvatarResourceDraft,
  CreateDigitalHumanAssetBody,
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

type SignedUploadPurpose =
  | "source-video"
  | "cover"
  | "audio"
  | "result"
  | "title-asset";

type SignedUploadRequest = {
  purpose: SignedUploadPurpose;
  fileName: string;
  contentType: string;
  fileSize: number;
};

type SignedUploadResponse = {
  uploadUrl: string;
  objectKey?: string;
  publicUrl?: string;
  accessUrl?: string;
  headers?: Record<string, string>;
  requiredHeaders?: Record<string, string>;
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

function resourceSessionCacheKey() {
  const token =
    typeof localStorage === "undefined"
      ? ""
      : localStorage.getItem("kb_token") || "";
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  }
  return `${token.length}:${hash.toString(36)}`;
}

function cacheKey(path: ResourcePath, params: ListResourcesParams) {
  return `${resourceSessionCacheKey()}:${path}:${params.scope}:${params.cursor || ""}:${params.limit || ""}`;
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
    if (!path || key.startsWith(`${path}:`) || key.includes(`:${path}:`)) {
      resourceListCache.delete(key);
    }
  }
}

export function clearResourceListCache() {
  invalidateResourceListCache();
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
    return {
      ...data,
      items: data.items.map((item) => ({
        ...item,
        previewUrl: normalizeAvatarPreviewUrl(item.previewUrl, item.originalVideoUrl),
        metadataUrl: normalizeAvatarMetadataUrl(item.metadataUrl, item.originalVideoUrl),
      })),
    };
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
    previewUrl: normalizeAvatarPreviewUrl(item.previewUrl, item.fileName),
    metadataUrl: normalizeAvatarMetadataUrl(item.metadataUrl, item.fileName),
  }));
}

export async function getAvatarUploadVideoMetadata(
  fileName: string,
  opts?: { signal?: AbortSignal },
) {
  const { data } = await http.get<AvatarVideoMetadata>(
    `v1/resources/avatar-video-files/${encodeURIComponent(fileName)}/metadata`,
    {
      timeout: 15_000,
      signal: opts?.signal,
    },
  );
  return {
    ...data,
    previewUrl: normalizeAvatarPreviewUrl(data.previewUrl, fileName),
    metadataUrl: data.metadataUrl?.trim()
      ? normalizeApiMediaUrl(data.metadataUrl)
      : buildAvatarMetadataUrl(fileName),
  };
}

export function avatarVideoStreamUrl(fileName: string) {
  return http.getUri({
    url: `v1/resources/avatar-video-files/${encodeURIComponent(fileName)}/stream`,
  });
}

function buildAvatarMetadataUrl(fileName: string) {
  return http.getUri({
    url: `v1/resources/avatar-video-files/${encodeURIComponent(fileName)}/metadata`,
  });
}

function normalizeApiMediaUrl(url: string) {
  const trimmed = url.trim();
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  const apiRelative = trimmed.replace(/^\/+api\/+/, "");
  return http.getUri({ url: apiRelative.replace(/^\/+/, "") });
}

function isAvatarProtectedStreamUrl(url: string) {
  if (!url) return false;
  const normalized = url.toLowerCase();
  return (
    normalized.includes("/avatar-video-files/") &&
    normalized.includes("/stream") &&
    !normalized.includes("/preview-stream") &&
    !/[?&](token|expires)=/i.test(url)
  );
}

function normalizeAvatarPreviewUrl(
  previewUrl: string | null | undefined,
  _fallbackFileName: string | null | undefined,
) {
  const trimmed = previewUrl?.trim() ?? "";
  if (trimmed) {
    const normalized = normalizeApiMediaUrl(trimmed);
    return isAvatarProtectedStreamUrl(normalized) ? "" : normalized;
  }
  return "";
}

function normalizeAvatarMetadataUrl(
  metadataUrl: string | null | undefined,
  fallbackFileName: string | null | undefined,
) {
  const trimmed = metadataUrl?.trim() ?? "";
  if (trimmed) return normalizeApiMediaUrl(trimmed);
  const fileName = fallbackFileName?.trim();
  if (!fileName || /^(https?:|data:|blob:)/i.test(fileName)) return "";
  return buildAvatarMetadataUrl(fileName);
}

export async function createAvatarResource(body: CreateAvatarResourceBody) {
  const { data } = await http.post<AvatarResource>(
    "v1/resources/avatars",
    body,
  );
  invalidateResourceListCache("avatars");
  return data;
}

export async function createDigitalHumanAsset(
  body: CreateDigitalHumanAssetBody,
) {
  const { data } = await http.post<AvatarResource>(
    "v1/resources/digital-humans",
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

const SIGNED_UPLOAD_ENDPOINTS = [
  "v1/resources/uploads/signed-url",
  "v1/resources/storage/signed-url",
  "v1/storage/signed-url",
];

function firstNonEmptyString(
  ...values: Array<string | null | undefined>
): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  return value as Record<string, unknown>;
}

function normalizeSignedUploadResponse(payload: unknown): SignedUploadResponse {
  const root = asRecord(payload) ?? {};
  const data = asRecord(root.data) ?? root;
  const uploadUrl = firstNonEmptyString(
    typeof data.uploadUrl === "string" ? data.uploadUrl : undefined,
    typeof data.signedUrl === "string" ? data.signedUrl : undefined,
    typeof data.putUrl === "string" ? data.putUrl : undefined,
    typeof data.url === "string" ? data.url : undefined,
  );
  if (!uploadUrl) {
    throw new Error("signed upload response missing uploadUrl");
  }
  const normalizeHeaders = (source: unknown) => {
    const record = asRecord(source) ?? {};
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string") {
        normalized[key] = value;
        continue;
      }
      if (typeof value === "number" || typeof value === "boolean") {
        normalized[key] = String(value);
      }
    }
    return normalized;
  };
  const normalizedHeaders = normalizeHeaders(data.headers);
  const normalizedRequiredHeaders = normalizeHeaders(data.requiredHeaders);
  for (const [key, value] of Object.entries(normalizedRequiredHeaders)) {
    if (normalizedHeaders[key]) continue;
    normalizedHeaders[key] = value;
  }
  return {
    uploadUrl,
    objectKey: firstNonEmptyString(
      typeof data.objectKey === "string" ? data.objectKey : undefined,
      typeof data.key === "string" ? data.key : undefined,
      typeof data.path === "string" ? data.path : undefined,
    ),
    publicUrl: firstNonEmptyString(
      typeof data.publicUrl === "string" ? data.publicUrl : undefined,
      typeof data.fileUrl === "string" ? data.fileUrl : undefined,
      typeof data.resourceUrl === "string" ? data.resourceUrl : undefined,
    ),
    accessUrl: firstNonEmptyString(
      typeof data.accessUrl === "string" ? data.accessUrl : undefined,
      typeof data.objectUrl === "string" ? data.objectUrl : undefined,
      typeof data.cdnUrl === "string" ? data.cdnUrl : undefined,
    ),
    headers: normalizedHeaders,
    requiredHeaders: normalizedRequiredHeaders,
  };
}

async function requestSignedUploadUrl(body: SignedUploadRequest) {
  let lastError: unknown = null;
  for (const endpoint of SIGNED_UPLOAD_ENDPOINTS) {
    try {
      const { data } = await http.post(endpoint, body, { timeout: 30_000 });
      return normalizeSignedUploadResponse(data);
    } catch (error: unknown) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 404 || error.response?.status === 405)
      ) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  if (lastError) throw lastError;
  throw new Error("no signed upload endpoint available");
}

async function putFileToSignedUrl(
  signed: SignedUploadResponse,
  file: File,
  opts?: UploadProgressOptions,
) {
  // Preserve existing progress UI even in direct-upload mode.
  opts?.onUploadProgress?.(5);
  const headers = new Headers({
    ...(signed.headers || {}),
    ...(signed.requiredHeaders || {}),
  });
  if (!headers.has("Content-Type") && file.type) {
    headers.set("Content-Type", file.type);
  }
  const response = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers,
    body: file,
  });
  if (!response.ok) {
    throw new Error(`signed upload failed: ${response.status}`);
  }
  opts?.onUploadProgress?.(100);
}

function buildAvatarAssetPublicPath(signed: SignedUploadResponse) {
  return firstNonEmptyString(
    signed.publicUrl,
    signed.accessUrl,
  );
}

export async function uploadAvatarResourceDirect(
  body: CreateAvatarResourceDraft,
  opts?: UploadProgressOptions,
) {
  if (!body.uploadFile) {
    throw new Error("missing upload file");
  }
  const videoSigned = await requestSignedUploadUrl({
    purpose: "source-video",
    fileName: body.uploadFile.name,
    contentType: body.uploadFile.type || "video/mp4",
    fileSize: body.uploadFile.size,
  });
  await putFileToSignedUrl(videoSigned, body.uploadFile, opts);
  const videoPath = buildAvatarAssetPublicPath(videoSigned);
  if (!videoPath) {
    throw new Error("missing uploaded video public url");
  }

  let coverPath = body.coverUrl?.trim() || "";
  if (body.uploadCoverFile) {
    const coverSigned = await requestSignedUploadUrl({
      purpose: "cover",
      fileName: body.uploadCoverFile.name,
      contentType: body.uploadCoverFile.type || "image/jpeg",
      fileSize: body.uploadCoverFile.size,
    });
    await putFileToSignedUrl(coverSigned, body.uploadCoverFile);
    const nextCoverPath = buildAvatarAssetPublicPath(coverSigned);
    if (nextCoverPath) coverPath = nextCoverPath;
  }

  const created = await createDigitalHumanAsset({
    name: body.name,
    styleId: body.styleId || "uploaded-video",
    modelType: body.modelType || "default",
    status: "COMPLETED",
    coverUrl: coverPath || undefined,
    videoCoverUrl: coverPath || undefined,
    videoDurationSeconds:
      typeof body.uploadVideoDurationSeconds === "number" &&
      Number.isFinite(body.uploadVideoDurationSeconds) &&
      body.uploadVideoDurationSeconds > 0
        ? body.uploadVideoDurationSeconds
        : undefined,
    videoPath: videoPath,
    originalVideoUrl: videoPath,
    videoOssKey: videoSigned.objectKey || undefined,
  });
  return created;
}

function isDirectUploadFeatureDisabled() {
  const raw =
    typeof import.meta.env.VITE_OSS_DIRECT_UPLOAD_ENABLED === "string"
      ? import.meta.env.VITE_OSS_DIRECT_UPLOAD_ENABLED.trim().toLowerCase()
      : "";
  return raw === "0" || raw === "false" || raw === "off";
}

function shouldFallbackToMultipart(error: unknown) {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 404 || status === 405;
}

export async function uploadAvatarResourceWithFallback(
  body: CreateAvatarResourceDraft,
  opts?: UploadProgressOptions,
) {
  if (isDirectUploadFeatureDisabled()) {
    return uploadAvatarResource(body, opts);
  }
  try {
    return await uploadAvatarResourceDirect(body, opts);
  } catch (error: unknown) {
    if (!shouldFallbackToMultipart(error)) {
      throw error;
    }
    return uploadAvatarResource(body, opts);
  }
}

type ListVoiceResourcesOptions = {
  noCache?: boolean;
};

export async function listVoiceResources(
  params: ListResourcesParams,
  options?: ListVoiceResourcesOptions,
) {
  const loader = async () => {
    const { data } = await http.get<CursorPage<VoiceResource>>(
      "v1/resources/voices",
      {
        params: listParams(params),
      },
    );
    return data;
  };
  if (options?.noCache) return loader();
  return cachedList("voices", params, loader);
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
  body: Partial<CreateSubtitleTemplateBody>,
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

export async function copySubtitleTemplateResourceWithName(
  id: string,
  name?: string,
) {
  const { data } = await http.post<SubtitleTemplateResource>(
    `v1/resources/subtitle-templates/${encodeURIComponent(id)}/copy`,
    name?.trim() ? { name: name.trim() } : {},
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
