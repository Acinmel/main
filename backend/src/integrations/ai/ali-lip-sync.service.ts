import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveConfiguredDir } from '../../common/resource-paths.util';

export interface AliLipSyncResult {
  videoUrl: string | null;
  providerResponse: unknown;
  hint?: string;
}

export type LipSyncProvider = 'aliyun-videoretalk' | 'generic-form';

export interface LipSyncReadiness {
  provider: LipSyncProvider;
  configured: boolean;
  reasons: string[];
  apiKeyConfigured: boolean;
  apiUrl: string;
  apiUrlConfigured: boolean;
  taskBaseUrl: string;
  model: string;
  publicBaseUrl: string;
  publicBaseUrlUsable: boolean;
  tempUploadEnabled: boolean;
  uploadsUrl: string;
}

type MediaPayload = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

type ResolvedLipSyncConfig = {
  provider: LipSyncProvider;
  apiUrl: string;
  taskBaseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  pollMaxMs: number;
  pollIntervalMs: number;
  publicBaseUrl: string;
  allowPrivatePublicUrl: boolean;
  tempUploadEnabled: boolean;
  uploadsUrl: string;
  videoFieldName: string;
  durationFieldName: string;
  videoExtension: boolean;
  queryFaceThreshold?: number;
};

type DashScopeUploadPolicy = {
  policy: string;
  signature: string;
  upload_dir: string;
  upload_host: string;
  oss_access_key_id: string;
  x_oss_object_acl: string;
  x_oss_forbid_overwrite: string;
  max_file_size_mb?: number;
};

function getVideoSaveDir(config: ConfigService): string {
  return resolveConfiguredDir(config.get<string>('VIDEO_SAVE_DIR'), 'download-video');
}

function getLipSyncPublicDir(config: ConfigService, kind: 'videos' | 'audios'): string {
  const root = resolveConfiguredDir(
    config.get<string>('LIP_SYNC_PUBLIC_MEDIA_DIR'),
    'lip-sync-public',
  );
  return path.join(root, kind);
}

function safeExtFromMedia(media: MediaPayload, fallback: string): string {
  const ext = path.extname(media.filename || '').toLowerCase();
  if (/^\.[a-z0-9]{2,6}$/i.test(ext)) return ext;
  if (media.mimeType === 'video/mp4') return '.mp4';
  if (media.mimeType === 'video/quicktime') return '.mov';
  if (media.mimeType === 'video/x-msvideo') return '.avi';
  if (media.mimeType === 'audio/wav') return '.wav';
  if (media.mimeType === 'audio/aac') return '.aac';
  if (media.mimeType === 'audio/mpeg') return '.mp3';
  return fallback;
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function readNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class AliLipSyncService {
  private readonly logger = new Logger(AliLipSyncService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return this.getReadiness().configured;
  }

  getReadiness(): LipSyncReadiness {
    const cfg = this.resolveConfig();
    const reasons: string[] = [];
    const publicBaseUrlUsable = Boolean(
      cfg.publicBaseUrl &&
        this.isUsablePublicBaseUrl(cfg.publicBaseUrl, cfg.allowPrivatePublicUrl),
    );

    if (cfg.provider === 'aliyun-videoretalk') {
      if (!cfg.apiKey) reasons.push('缺少 DASHSCOPE_API_KEY/LIP_SYNC_API_KEY');
      if (!cfg.tempUploadEnabled && !cfg.publicBaseUrl) {
        reasons.push('缺少 PUBLIC_BASE_URL 或 LIP_SYNC_PUBLIC_BASE_URL，云端无法拉取视频和音频');
      } else if (!cfg.tempUploadEnabled && !publicBaseUrlUsable) {
        reasons.push('PUBLIC_BASE_URL 必须是公网 HTTP(S) 域名，不能是 localhost/内网地址');
      }
    } else {
      if (!cfg.apiUrl) reasons.push('缺少 LIP_SYNC_API_URL/ALI_LIP_SYNC_API_URL');
      if (!cfg.apiKey) reasons.push('缺少 LIP_SYNC_API_KEY/ALI_LIP_SYNC_API_KEY/DASHSCOPE_API_KEY');
    }

    return {
      provider: cfg.provider,
      configured: reasons.length === 0,
      reasons,
      apiKeyConfigured: Boolean(cfg.apiKey),
      apiUrl: cfg.apiUrl,
      apiUrlConfigured: Boolean(cfg.apiUrl),
      taskBaseUrl: cfg.taskBaseUrl,
      model: cfg.model,
      publicBaseUrl: cfg.publicBaseUrl,
      publicBaseUrlUsable,
      tempUploadEnabled: cfg.tempUploadEnabled,
      uploadsUrl: cfg.uploadsUrl,
    };
  }

  ensureConfigured(): LipSyncReadiness {
    const readiness = this.getReadiness();
    if (readiness.configured) return readiness;
    throw new BadRequestException(
      `VideoReTalk 未就绪：${readiness.reasons.join('；')}。默认会使用 DashScope 临时 OSS 上传；如关闭临时上传，则需要配置公网后端地址，例如 PUBLIC_BASE_URL=https://api.your-domain.com`,
    );
  }

  async submitVideo(params: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
    durationSeconds?: number;
  }): Promise<AliLipSyncResult> {
    return this.submitLipSync({
      video: {
        buffer: params.buffer,
        filename: params.filename,
        mimeType: params.mimeType,
      },
      durationSeconds: params.durationSeconds,
    });
  }

  async submitLipSync(params: {
    video: MediaPayload;
    audio?: MediaPayload;
    refImageUrl?: string | null;
    durationSeconds?: number;
    videoExtension?: boolean;
  }): Promise<AliLipSyncResult> {
    const cfg = this.resolveConfig();
    if (cfg.provider === 'aliyun-videoretalk') {
      return this.submitAliyunVideoRetalk(cfg, params);
    }
    return this.submitGenericForm(cfg, {
      buffer: params.video.buffer,
      filename: params.video.filename,
      mimeType: params.video.mimeType,
      durationSeconds: params.durationSeconds,
    });
  }

  private async submitAliyunVideoRetalk(
    cfg: ResolvedLipSyncConfig,
    params: {
      video: MediaPayload;
      audio?: MediaPayload;
      refImageUrl?: string | null;
      videoExtension?: boolean;
    },
  ): Promise<AliLipSyncResult> {
    if (!cfg.apiKey) {
      throw new BadRequestException('DASHSCOPE_API_KEY is required for Aliyun VideoRetalk');
    }
    if (!params.audio?.buffer?.length) {
      throw new BadRequestException('Aliyun VideoRetalk requires both video and audio inputs');
    }
    if (!cfg.tempUploadEnabled && !cfg.publicBaseUrl) {
      throw new BadRequestException(
        'PUBLIC_BASE_URL or LIP_SYNC_PUBLIC_BASE_URL is required so Aliyun can fetch media files',
      );
    }
    if (
      !cfg.tempUploadEnabled &&
      !this.isUsablePublicBaseUrl(cfg.publicBaseUrl, cfg.allowPrivatePublicUrl)
    ) {
      throw new BadRequestException(
        'PUBLIC_BASE_URL must be a public HTTP(S) domain, not localhost or a private LAN address',
      );
    }

    const { videoUrl, audioUrl, inputMode } = await this.prepareAliyunInputUrls(cfg, {
      video: params.video,
      audio: params.audio,
    });
    const payload = {
      model: cfg.model,
      input: {
        video_url: videoUrl,
        audio_url: audioUrl,
        ref_image_url: params.refImageUrl?.trim() || '',
      },
      parameters: {
        video_extension: params.videoExtension ?? cfg.videoExtension,
        ...(cfg.queryFaceThreshold ? { query_face_threshold: cfg.queryFaceThreshold } : {}),
      },
    };

    const submitResponse = await this.fetchJson(cfg.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
        ...(inputMode === 'dashscope-temp-upload'
          ? { 'X-DashScope-OssResourceResolve': 'enable' }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });

    const submitOutput =
      submitResponse.output && typeof submitResponse.output === 'object'
        ? (submitResponse.output as Record<string, unknown>)
        : {};
    const taskId = this.readString(submitOutput.task_id) || this.readString(submitResponse.task_id);
    if (!taskId) {
      throw new Error('Aliyun VideoRetalk did not return output.task_id');
    }

    const resultResponse = await this.pollAliyunTask(cfg, taskId);
    const videoResultUrl = this.pickVideoUrl(resultResponse as Record<string, unknown>);
    if (!videoResultUrl) {
      throw new Error('Aliyun VideoRetalk succeeded but did not return output.video_url');
    }

    return {
      videoUrl: videoResultUrl,
      providerResponse: {
        provider: 'aliyun-videoretalk',
        taskId,
        input: { videoUrl, audioUrl, inputMode },
        submitResponse,
        resultResponse,
      },
      hint: 'Aliyun VideoRetalk lip-sync completed.',
    };
  }

  private async submitGenericForm(
    cfg: ResolvedLipSyncConfig,
    params: {
      buffer: Buffer;
      filename: string;
      mimeType: string;
      durationSeconds?: number;
    },
  ): Promise<AliLipSyncResult> {
    if (!cfg.apiUrl) {
      throw new BadRequestException('LIP_SYNC_API_URL / ALI_LIP_SYNC_API_URL is not configured');
    }
    if (!cfg.apiKey) {
      throw new BadRequestException('LIP_SYNC_API_KEY / ALI_LIP_SYNC_API_KEY / DASHSCOPE_API_KEY is not configured');
    }

    const videoBytes = new Uint8Array(params.buffer.byteLength);
    videoBytes.set(params.buffer);

    const form = new FormData();
    form.append(
      cfg.videoFieldName,
      new Blob([videoBytes], { type: params.mimeType || 'video/mp4' }),
      params.filename || 'input.mp4',
    );
    if (params.durationSeconds !== undefined) {
      form.append(cfg.durationFieldName, String(Math.round(params.durationSeconds * 100) / 100));
    }

    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: form,
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });

    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text.slice(0, 800)}`);
    }

    if (contentType.startsWith('video/') || contentType === 'application/octet-stream') {
      const arr = await res.arrayBuffer();
      const base64 = Buffer.from(arr).toString('base64');
      const mime = contentType.startsWith('video/') ? contentType : 'video/mp4';
      return {
        videoUrl: `data:${mime};base64,${base64}`,
        providerResponse: { contentType, bytes: arr.byteLength },
        hint: 'Lip-sync provider returned binary video data.',
      };
    }

    const json = (await res.json()) as Record<string, unknown>;
    const videoUrl = this.pickVideoUrl(json);
    if (!videoUrl) {
      throw new Error('Lip-sync provider response did not contain a video URL');
    }

    return {
      videoUrl,
      providerResponse: json,
    };
  }

  private async pollAliyunTask(
    cfg: ResolvedLipSyncConfig,
    taskId: string,
  ): Promise<Record<string, unknown>> {
    const deadline = Date.now() + cfg.pollMaxMs;
    let lastResponse: Record<string, unknown> | null = null;

    while (Date.now() <= deadline) {
      const url = `${cfg.taskBaseUrl.replace(/\/+$/, '')}/tasks/${encodeURIComponent(taskId)}`;
      const json = await this.fetchJson(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      lastResponse = json as Record<string, unknown>;

      const output =
        json && typeof json === 'object' && 'output' in json
          ? (json.output as Record<string, unknown>)
          : {};
      const status = this.readString(output.task_status).toUpperCase();
      if (status === 'SUCCEEDED') return lastResponse;
      if (status === 'FAILED' || status === 'UNKNOWN') {
        const code = this.readString(output.code);
        const message = this.readString(output.message);
        throw new Error(
          `Aliyun VideoRetalk task ${status}${code ? ` (${code})` : ''}${message ? `: ${message}` : ''}`,
        );
      }

      await sleep(cfg.pollIntervalMs);
    }

    throw new Error(
      `Aliyun VideoRetalk task timed out after ${Math.round(cfg.pollMaxMs / 1000)}s: ${JSON.stringify(
        lastResponse,
      ).slice(0, 800)}`,
    );
  }

  private async fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetch(url, init);
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new Error(`Provider returned non-JSON response: ${text.slice(0, 800)}`);
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 1200)}`);
    }
    return json;
  }

  private async persistPublicMedia(
    kind: 'videos' | 'audios',
    media: MediaPayload,
    publicBaseUrl: string,
  ): Promise<string> {
    const dir = getLipSyncPublicDir(this.config, kind);
    await fs.mkdir(dir, { recursive: true });
    const ext = safeExtFromMedia(media, kind === 'videos' ? '.mp4' : '.mp3');
    const prefix = kind === 'videos' ? 'lip-video' : 'lip-audio';
    const fileName = `${prefix}_${Date.now()}_${randomUUID().slice(0, 10)}${ext}`;
    await fs.writeFile(path.join(dir, fileName), media.buffer);
    return `${publicBaseUrl.replace(/\/+$/, '')}/api/v1/tools/lip-sync-public/${kind}/${encodeURIComponent(fileName)}/stream`;
  }

  private async prepareAliyunInputUrls(
    cfg: ResolvedLipSyncConfig,
    media: { video: MediaPayload; audio: MediaPayload },
  ): Promise<{ videoUrl: string; audioUrl: string; inputMode: 'dashscope-temp-upload' | 'public-url' }> {
    if (cfg.tempUploadEnabled) {
      const policy = await this.getDashScopeUploadPolicy(cfg);
      const [videoUrl, audioUrl] = await Promise.all([
        this.uploadDashScopeTempFile(policy, media.video),
        this.uploadDashScopeTempFile(policy, media.audio),
      ]);
      return { videoUrl, audioUrl, inputMode: 'dashscope-temp-upload' };
    }

    const [videoUrl, audioUrl] = await Promise.all([
      this.persistPublicMedia('videos', media.video, cfg.publicBaseUrl),
      this.persistPublicMedia('audios', media.audio, cfg.publicBaseUrl),
    ]);
    return { videoUrl, audioUrl, inputMode: 'public-url' };
  }

  private async getDashScopeUploadPolicy(
    cfg: ResolvedLipSyncConfig,
  ): Promise<DashScopeUploadPolicy> {
    const url = new URL(cfg.uploadsUrl);
    url.searchParams.set('action', 'getPolicy');
    url.searchParams.set('model', cfg.model);

    const json = await this.fetchJson(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    const data = json.data as Partial<DashScopeUploadPolicy> | undefined;
    const required: Array<keyof DashScopeUploadPolicy> = [
      'policy',
      'signature',
      'upload_dir',
      'upload_host',
      'oss_access_key_id',
      'x_oss_object_acl',
      'x_oss_forbid_overwrite',
    ];
    for (const key of required) {
      if (typeof data?.[key] !== 'string' || !data[key]) {
        throw new Error(`DashScope upload policy missing ${key}`);
      }
    }
    return data as DashScopeUploadPolicy;
  }

  private async uploadDashScopeTempFile(
    policy: DashScopeUploadPolicy,
    media: MediaPayload,
  ): Promise<string> {
    if (
      policy.max_file_size_mb &&
      media.buffer.length > policy.max_file_size_mb * 1024 * 1024
    ) {
      throw new BadRequestException(
        `文件超过 DashScope 临时存储限制：${policy.max_file_size_mb}MB`,
      );
    }

    const ext = safeExtFromMedia(media, media.mimeType.startsWith('video/') ? '.mp4' : '.wav');
    const safeBase =
      path
        .basename(media.filename || `media${ext}`, path.extname(media.filename || ''))
        .replace(/[^\w.-]+/g, '_')
        .slice(0, 80) || 'media';
    const fileName = `${Date.now()}_${randomUUID().slice(0, 10)}_${safeBase}${ext}`;
    const key = `${policy.upload_dir.replace(/\/+$/, '')}/${fileName}`;
    const form = new FormData();
    form.append('OSSAccessKeyId', policy.oss_access_key_id);
    form.append('Signature', policy.signature);
    form.append('policy', policy.policy);
    form.append('x-oss-object-acl', policy.x_oss_object_acl);
    form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
    form.append('key', key);
    form.append('success_action_status', '200');
    form.append(
      'file',
      new Blob([new Uint8Array(media.buffer)], {
        type: media.mimeType || 'application/octet-stream',
      }),
      fileName,
    );

    const res = await fetch(policy.upload_host, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`DashScope temporary file upload failed: HTTP ${res.status} ${text.slice(0, 800)}`);
    }
    return `oss://${key}`;
  }

  private resolveConfig(): ResolvedLipSyncConfig {
    const genericApiUrl =
      this.config.get<string>('LIP_SYNC_API_URL')?.trim() ||
      this.config.get<string>('ALI_LIP_SYNC_API_URL')?.trim() ||
      '';
    const provider = this.resolveProvider(genericApiUrl);
    const dashScopeBase =
      this.config.get<string>('ALI_VIDEORETALK_BASE_URL')?.trim() ||
      this.config.get<string>('DASHSCOPE_ASR_BASE_URL')?.trim() ||
      'https://dashscope.aliyuncs.com/api/v1';
    const normalizedDashScopeBase = dashScopeBase.replace(/\/+$/, '');
    const pollMaxMs = readNumber(this.config.get('ALI_VIDEORETALK_POLL_MAX_MS'), 900_000);
    const queryFaceThreshold = readNumber(
      this.config.get('ALI_VIDEORETALK_QUERY_FACE_THRESHOLD'),
      Number.NaN,
    );

    return {
      provider,
      apiUrl:
        provider === 'aliyun-videoretalk'
          ? this.config.get<string>('ALI_VIDEORETALK_API_URL')?.trim() ||
            this.config.get<string>('VIDEO_RETALK_API_URL')?.trim() ||
            `${normalizedDashScopeBase}/services/aigc/image2video/video-synthesis/`
          : genericApiUrl,
      taskBaseUrl:
        this.config.get<string>('ALI_VIDEORETALK_TASK_BASE_URL')?.trim() ||
        normalizedDashScopeBase,
      apiKey:
        this.config.get<string>('LIP_SYNC_API_KEY')?.trim() ||
        this.config.get<string>('ALI_LIP_SYNC_API_KEY')?.trim() ||
        this.config.get<string>('DASHSCOPE_API_KEY')?.trim() ||
        '',
      model: this.config.get<string>('ALI_VIDEORETALK_MODEL')?.trim() || 'videoretalk',
      timeoutMs: readNumber(
        this.config.get('LIP_SYNC_TIMEOUT_MS') ?? this.config.get('ALI_LIP_SYNC_TIMEOUT_MS'),
        120_000,
      ),
      pollMaxMs,
      pollIntervalMs: readNumber(this.config.get('ALI_VIDEORETALK_POLL_INTERVAL_MS'), 3_000),
      publicBaseUrl:
        this.config.get<string>('LIP_SYNC_PUBLIC_BASE_URL')?.trim() ||
        this.config.get<string>('PUBLIC_BASE_URL')?.trim() ||
        this.config.get<string>('BACKEND_PUBLIC_BASE_URL')?.trim() ||
        this.config.get<string>('API_PUBLIC_BASE_URL')?.trim() ||
        '',
      tempUploadEnabled: readBool(
        this.config.get<string>('ALI_VIDEORETALK_USE_TEMP_UPLOAD'),
        true,
      ),
      uploadsUrl:
        this.config.get<string>('ALI_VIDEORETALK_UPLOADS_URL')?.trim() ||
        `${normalizedDashScopeBase}/uploads`,
      allowPrivatePublicUrl: readBool(
        this.config.get<string>('LIP_SYNC_ALLOW_PRIVATE_PUBLIC_URL'),
        false,
      ),
      videoFieldName:
        this.config.get<string>('LIP_SYNC_VIDEO_FIELD')?.trim() ||
        this.config.get<string>('ALI_LIP_SYNC_VIDEO_FIELD')?.trim() ||
        'video',
      durationFieldName:
        this.config.get<string>('LIP_SYNC_DURATION_FIELD')?.trim() ||
        this.config.get<string>('ALI_LIP_SYNC_DURATION_FIELD')?.trim() ||
        'duration_seconds',
      videoExtension: readBool(this.config.get<string>('ALI_VIDEORETALK_VIDEO_EXTENSION'), false),
      queryFaceThreshold: Number.isFinite(queryFaceThreshold)
        ? Math.max(120, Math.min(200, Math.round(queryFaceThreshold)))
        : undefined,
    };
  }

  private resolveProvider(genericApiUrl: string): LipSyncProvider {
    const raw =
      this.config.get<string>('LIP_SYNC_PROVIDER')?.trim() ||
      this.config.get<string>('ALI_LIP_SYNC_PROVIDER')?.trim() ||
      '';
    if (/^(generic|generic-form|custom)$/i.test(raw)) return 'generic-form';
    if (/^(aliyun|aliyun-videoretalk|videoretalk)$/i.test(raw)) return 'aliyun-videoretalk';
    return genericApiUrl ? 'generic-form' : 'aliyun-videoretalk';
  }

  private isUsablePublicBaseUrl(value: string, allowPrivate: boolean): boolean {
    try {
      const u = new URL(value);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      if (allowPrivate) return true;
      const host = u.hostname.toLowerCase();
      if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false;
      if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false;
      const match = host.match(/^172\.(\d+)\./);
      if (match) {
        const n = Number(match[1]);
        if (n >= 16 && n <= 31) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private pickVideoUrl(json: Record<string, unknown>): string | null {
    const directKeys = ['videoUrl', 'video_url', 'url', 'outputVideoUrl', 'output_video_url'];
    for (const key of directKeys) {
      const v = json[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }

    for (const key of ['output', 'data', 'result']) {
      const nested = json[key];
      if (nested && typeof nested === 'object') {
        const picked = this.pickVideoUrl(nested as Record<string, unknown>);
        if (picked) return picked;
      }
    }

    return null;
  }
}
