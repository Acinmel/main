import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { resolveConfiguredDir } from '../../common/resource-paths.util';
import { DatabaseService } from '../../database/database.service';
import { QwenVoiceCloneService } from '../../integrations/ai/qwen-voice-clone.service';
import { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import type {
  AvatarSavedVideoDto,
  AvatarResourceDto,
  CursorPage,
  ResourceRow,
  ResourceScope,
  SignedUploadUrlDto,
  SubtitleTemplateResourceDto,
  UploadPurpose,
  VoiceResourceDto,
} from './resources.types';

type ResourceTable =
  | 'avatar_resources'
  | 'voice_resources'
  | 'subtitle_template_resources';
type HttpByteRange = { start: number; end: number };
type OssClient = {
  put: (...args: unknown[]) => Promise<unknown>;
  get: (...args: unknown[]) => Promise<unknown>;
  getStream?: (...args: unknown[]) => Promise<unknown>;
  head?: (...args: unknown[]) => Promise<unknown>;
  getObjectMeta?: (...args: unknown[]) => Promise<unknown>;
  delete: (...args: unknown[]) => Promise<unknown>;
  signatureUrl: (name: string, options?: Record<string, unknown>) => string;
};

const PAGE_LIMIT_MAX = 40;
const AVATAR_UPLOAD_PREFIX = 'avatar-upload';
const VOICE_UPLOAD_PREFIX = 'voice-sample';
const LOCAL_UPLOAD_VOICE_PROVIDER = 'local-upload';
const LEGACY_PLACEHOLDER_AUDIO_URL =
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
const EMPTY_VOICE_AUDIO_URL = '';
const AVATAR_VIDEO_MAX_SECONDS = 10 * 60;
const AVATAR_VIDEO_DURATION_TOLERANCE_SECONDS = 1;
const VOICE_SAMPLE_MAX_BYTES = 10 * 1024 * 1024;
const VOICE_SAMPLE_MIN_SECONDS = 0.5;
const VOICE_SAMPLE_MAX_SECONDS = 15;
const VOICE_SAMPLE_DURATION_TOLERANCE_SECONDS = 0.5;
const DEFAULT_UPLOAD_RESOURCE_TTL_DAYS = 7;
const DEFAULT_UPLOAD_RESOURCE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const UPLOAD_RESOURCE_CLEANUP_BATCH_SIZE = 80;
const AVATAR_VIDEO_PREVIEW_TTL_SECONDS = 2 * 60 * 60;
const DEFAULT_SIGNED_UPLOAD_TTL_SECONDS = 15 * 60;
const MAX_SIGNED_UPLOAD_TTL_SECONDS = 60 * 60;
const UPLOAD_ID_PREFIX = 'upload_';
const SIGNED_UPLOAD_PURPOSES: readonly UploadPurpose[] = [
  'source-video',
  'cover',
  'audio',
  'result',
  'title-asset',
] as const;
const SIGNED_UPLOAD_RULES: Record<
  UploadPurpose,
  {
    maxBytes: number;
    allowedMimeTypes: readonly string[];
    extensionByMime: Record<string, string>;
  }
> = {
  'source-video': {
    maxBytes: 1024 * 1024 * 1024,
    allowedMimeTypes: [
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'video/x-matroska',
      'video/m4v',
    ],
    extensionByMime: {
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'video/webm': '.webm',
      'video/x-matroska': '.mkv',
      'video/m4v': '.m4v',
    },
  },
  cover: {
    maxBytes: 20 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    extensionByMime: {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    },
  },
  audio: {
    maxBytes: 50 * 1024 * 1024,
    allowedMimeTypes: [
      'audio/mpeg',
      'audio/wav',
      'audio/x-wav',
      'audio/mp4',
      'audio/aac',
      'audio/ogg',
      'audio/flac',
      'audio/webm',
    ],
    extensionByMime: {
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/x-wav': '.wav',
      'audio/mp4': '.m4a',
      'audio/aac': '.aac',
      'audio/ogg': '.ogg',
      'audio/flac': '.flac',
      'audio/webm': '.webm',
    },
  },
  result: {
    maxBytes: 2 * 1024 * 1024 * 1024,
    allowedMimeTypes: ['video/mp4', 'video/quicktime'],
    extensionByMime: {
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
    },
  },
  'title-asset': {
    maxBytes: 300 * 1024 * 1024,
    allowedMimeTypes: [
      'video/webm',
      'video/mp4',
      'video/quicktime',
      'image/png',
    ],
    extensionByMime: {
      'video/webm': '.webm',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'image/png': '.png',
    },
  },
};
const RETIRED_RECOMMENDED_VOICE_IDS = [
  'rec-voice-female',
  'rec-voice-male',
  'rec-voice-narration',
  'rec-voice-bright-young-female',
] as const;
const RECOMMENDED_DESIGNED_VOICES = [
  {
    id: 'rec-voice-market-male',
    name: '市井低沙男声',
    fileName: 'rec-voice-market-male.mp3',
    providerVoice: 'qwen-tts-vd-market_male-voice-20260510192748379-0a08',
    providerModel: 'qwen3-tts-vd-2026-01-26',
  },
  {
    id: 'rec-voice-office-female',
    name: '亲和职场女声',
    fileName: 'rec-voice-office-female.mp3',
    providerVoice: 'qwen-tts-vd-office_female-voice-20260510192807833-ab4a',
    providerModel: 'qwen3-tts-vd-2026-01-26',
  },
  {
    id: 'rec-voice-calm-daily-female',
    name: '自然日常女声',
    fileName: 'rec-voice-calm-daily-female.mp3',
    providerVoice: 'qwen-tts-vd-daily_female-voice-20260510192816920-a2a9',
    providerModel: 'qwen3-tts-vd-2026-01-26',
  },
  {
    id: 'rec-voice-service-female',
    name: '前台服务女声',
    fileName: 'rec-voice-service-female.mp3',
    providerVoice: 'qwen-tts-vd-service_female-voice-20260510192823027-1e16',
    providerModel: 'qwen3-tts-vd-2026-01-26',
  },
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function addDaysIso(sourceIso: string, days: number): string {
  const sourceMs = Date.parse(sourceIso);
  const baseMs = Number.isFinite(sourceMs) ? sourceMs : Date.now();
  return new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
}

function sanitizeUploadFilename(filename: string, fallbackExt: string): string {
  const ext = path.extname(filename || '').toLowerCase();
  if (/^\.[a-z0-9]{2,6}$/i.test(ext)) return ext;
  return fallbackExt;
}

function trimName(name: unknown, fallback = '未命名资源'): string {
  const s = typeof name === 'string' ? name.trim() : '';
  if (!s) return fallback;
  return s.slice(0, 80);
}

function encodeCursor(row: Pick<ResourceRow, 'updated_at' | 'id'>): string {
  return Buffer.from(JSON.stringify({ u: row.updated_at, i: row.id })).toString(
    'base64url',
  );
}

function decodeCursor(
  cursor?: string,
): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const obj = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as {
      u?: unknown;
      i?: unknown;
    };
    if (typeof obj.u === 'string' && typeof obj.i === 'string') {
      return { updatedAt: obj.u, id: obj.i };
    }
  } catch {
    /* noop */
  }
  throw new BadRequestException('cursor 无效');
}

@Injectable()
export class ResourcesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResourcesService.name);
  private seeded = false;
  private seedPromise: Promise<void> | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private cleanupRunning = false;
  private voiceSampleOssClient: OssClient | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly qwenVoiceClone: QwenVoiceCloneService,
    private readonly ffmpegAudio: FfmpegAudioService,
  ) {}

  onModuleInit() {
    // Legacy seed helpers kept for rollback compatibility; mark as intentionally retained.
    void RECOMMENDED_DESIGNED_VOICES;
    void this.hasLocalVoiceSample;
    void this.voiceSampleStreamUrl;

    void this.ensureSeeded().catch((error) => {
      this.logger.error(
        `seed recommended resources failed on startup: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    void this.runExpiredUploadCleanup('startup');
    const intervalMs = this.getCleanupIntervalMs();
    if (intervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        void this.runExpiredUploadCleanup('interval');
      }, intervalMs);
      this.cleanupTimer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  async listAvatars(
    userId: string,
    opts: { scope: ResourceScope; cursor?: string; limit?: number },
  ) {
    const page =
      opts.scope === 'recommended'
        ? { items: [], hasMore: false, nextCursor: null }
        : await this.listRows('avatar_resources', userId, {
            ...opts,
            scope: 'mine',
          });
    return {
      ...page,
      items: page.items.map((row) => this.toAvatar(row, userId)),
    };
  }

  async listVoices(
    userId: string,
    opts: { scope: ResourceScope; cursor?: string; limit?: number },
  ) {
    await this.ensureSeeded();
    const page =
      opts.scope === 'recommended'
        ? { items: [], hasMore: false, nextCursor: null }
        : await this.listRows('voice_resources', userId, {
            ...opts,
            scope: 'mine',
          });
    const items = await Promise.all(
      page.items.map(async (row) =>
        this.applyVoiceSampleIntegrity(userId, row, this.toVoice(row, userId)),
      ),
    );
    return {
      ...page,
      items,
    };
  }

  async listSubtitleTemplates(
    userId: string,
    opts: { scope: ResourceScope; cursor?: string; limit?: number },
  ) {
    await this.ensureSeeded();
    const page = await this.listRows(
      'subtitle_template_resources',
      userId,
      opts,
    );
    return {
      ...page,
      items: page.items.map((row) => this.toSubtitle(row, userId)),
    };
  }

  async listAvatarUploadVideos(
    userId: string,
    limitRaw?: number,
  ): Promise<AvatarSavedVideoDto[]> {
    const limit = Math.min(Math.max(Number(limitRaw) || 30, 1), 100);
    const rows = await this.db.queryAll<
      Pick<ResourceRow, 'id' | 'name' | 'source_video_url' | 'updated_at'>
    >(
      `SELECT id, name, source_video_url, updated_at
       FROM avatar_resources
       WHERE user_id = ? AND is_recommended = 0 AND source_video_url LIKE ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
      [userId, `${AVATAR_UPLOAD_PREFIX}_%`, limit * 4],
    );

    const result: AvatarSavedVideoDto[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const fileName = row.source_video_url?.trim() || '';
      if (!fileName || seen.has(fileName)) continue;
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(this.resolveSavedVideoPathOrThrow(fileName));
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      seen.add(fileName);
      const signed = this.createSignedAvatarVideoPreviewUrls(userId, fileName);
      result.push({
        avatarId: row.id,
        avatarName: row.name,
        fileName,
        fileSize: stat.size,
        mimeType: this.guessVideoMime(fileName),
        mtime: new Date(stat.mtimeMs).toISOString(),
        previewUrl: signed.previewUrl,
        metadataUrl: signed.metadataUrl,
      });
      if (result.length >= limit) break;
    }
    return result;
  }

  async createSignedUploadUrl(
    userId: string,
    body: Record<string, unknown>,
  ): Promise<SignedUploadUrlDto> {
    const purpose = this.parseSignedUploadPurpose(body.purpose);
    const contentType = this.normalizeUploadContentType(body.contentType);
    const fileSize = this.parseSignedUploadFileSize(body.fileSize);
    const rules = SIGNED_UPLOAD_RULES[purpose];
    if (!rules.allowedMimeTypes.includes(contentType)) {
      throw new BadRequestException(
        `contentType not allowed for purpose=${purpose}`,
      );
    }
    if (fileSize > rules.maxBytes) {
      throw new BadRequestException(
        `fileSize exceeds limit for purpose=${purpose}`,
      );
    }

    const originalFileName = this.optionalString(body.fileName);
    const ext = this.resolveSignedUploadExtension(
      contentType,
      originalFileName,
      rules.extensionByMime,
    );
    const now = nowIso();
    const uploadId = `${UPLOAD_ID_PREFIX}${randomUUID()}`;
    const objectKey = this.buildSignedUploadObjectKey(
      userId,
      purpose,
      uploadId,
      ext,
    );
    const ttlSeconds = this.signedUploadTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const uploadUrl = this.getVoiceSampleOssClient().signatureUrl(objectKey, {
      method: 'PUT',
      expires: ttlSeconds,
      'Content-Type': contentType,
    });

    await this.db.execute(
      `INSERT INTO oss_upload_grants
       (id, user_id, purpose, object_key, mime_type, file_size, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uploadId,
        userId,
        purpose,
        objectKey,
        contentType,
        fileSize,
        'pending',
        expiresAt,
        now,
        now,
      ],
    );

    return {
      uploadId,
      purpose,
      objectKey,
      uploadUrl,
      method: 'PUT',
      requiredHeaders: {
        'Content-Type': contentType,
      },
      expiresAt,
    };
  }

  async getAvatar(userId: string, id: string) {
    const row = await this.findRow('avatar_resources', id);
    if (!row) throw new NotFoundException('视频资源不存在');
    if (row.user_id !== userId) {
      throw new ForbiddenException('只能使用自己的视频资源');
    }
    return this.toAvatar(row, userId);
  }

  async getVoice(userId: string, id: string) {
    await this.ensureSeeded();
    const row = await this.findRow('voice_resources', id);
    if (!row) throw new NotFoundException('音色资源不存在');
    if (row.user_id && row.user_id !== userId) {
      throw new ForbiddenException('只能使用自己的音色资源');
    }
    return this.toVoice(row, userId);
  }

  async getSubtitleTemplate(userId: string, id: string) {
    await this.ensureSeeded();
    const row = await this.findRow('subtitle_template_resources', id); /*
    if (!row) throw new NotFoundException('Subtitle template not found');
    if (row.user_id && row.user_id !== userId) {
      throw new ForbiddenException('You can only use your own subtitle template');
    }
    */
    if (!row) throw new NotFoundException('字幕模板不存在');
    if (row.user_id && row.user_id !== userId) {
      throw new ForbiddenException('只能使用自己的字幕模板');
    }
    return this.toSubtitle(row, userId);
  }

  async createAvatar(userId: string, body: Record<string, unknown>) {
    const now = nowIso();
    const originalVideoUrl = this.optionalString(body.originalVideoUrl);
    if (body.__allowUploadSourceBypass !== true) {
      await this.assertAvatarVideoSourceOwnership(userId, originalVideoUrl);
    }
    const row: ResourceRow = {
      id: randomUUID(),
      user_id: userId,
      name: trimName(body.name, '我的数字人'),
      is_recommended: 0,
      cover_url:
        this.optionalString(body.coverUrl) || this.placeholder('avatar'),
      source_video_url: originalVideoUrl,
      style_id: this.optionalString(body.styleId) || 'custom',
      video_cover_url:
        this.optionalString(body.videoCoverUrl) ||
        this.optionalString(body.coverUrl),
      video_duration_seconds: this.optionalNumber(body.videoDurationSeconds),
      model_type: this.optionalString(body.modelType) || 'default',
      asset_status:
        this.optionalString(body.assetStatus)?.toUpperCase() || 'COMPLETED',
      video_oss_key: this.optionalString(body.videoOssKey),
      expires_at: this.expiresAtFrom(now),
      created_at: now,
      updated_at: now,
    };
    await this.db.execute(
      `INSERT INTO avatar_resources
       (id, user_id, name, is_recommended, cover_url, source_video_url, style_id, video_cover_url, video_duration_seconds, model_type, asset_status, video_oss_key, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.name,
        row.is_recommended,
        row.cover_url,
        row.source_video_url,
        row.style_id,
        row.video_cover_url,
        row.video_duration_seconds,
        row.model_type,
        row.asset_status,
        row.video_oss_key,
        row.expires_at,
        row.created_at,
        row.updated_at,
      ],
    );
    return this.toAvatar(row, userId);
  }

  async createDigitalHumanAsset(userId: string, body: Record<string, unknown>) {
    const sourceVideoUrl =
      this.optionalString(body.videoPath) ||
      this.optionalString(body.originalVideoUrl);
    const videoOssKey =
      this.optionalString(body.videoOssKey) || this.optionalString(body.ossKey);
    const normalized: Record<string, unknown> = {
      ...body,
      originalVideoUrl: sourceVideoUrl,
      coverUrl:
        this.optionalString(body.coverUrl) ||
        this.optionalString(body.videoCoverUrl),
      videoCoverUrl:
        this.optionalString(body.videoCoverUrl) ||
        this.optionalString(body.coverUrl),
      videoDurationSeconds: this.optionalNumber(body.videoDurationSeconds),
      modelType: this.optionalString(body.modelType) || 'default',
      assetStatus:
        this.optionalString(body.status) ||
        this.optionalString(body.assetStatus) ||
        'COMPLETED',
      videoOssKey,
      styleId: this.optionalString(body.styleId) || 'uploaded-video',
      __allowUploadSourceBypass: Boolean(videoOssKey),
    };
    if (!normalized.originalVideoUrl && !normalized.videoOssKey) {
      throw new BadRequestException(
        'videoPath/originalVideoUrl/videoOssKey 至少需要一个',
      );
    }
    return this.createAvatar(userId, normalized);
  }

  async createAvatarFromUpload(
    userId: string,
    file: {
      buffer?: Buffer;
      path?: string;
      originalname: string;
      mimetype: string;
      size: number;
    },
    body: Record<string, unknown>,
  ) {
    this.assertAvatarVideoFile(file);
    await this.validateAvatarVideoDuration(file);
    const dir = this.getVideoSaveDir();
    await fs.mkdir(dir, { recursive: true });
    const ext = sanitizeUploadFilename(file.originalname, '.mp4');
    const fileName = `${AVATAR_UPLOAD_PREFIX}_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
    const outputPath = path.join(dir, fileName);
    let tempPath = file.path;

    try {
      if (tempPath) {
        try {
          await fs.rename(tempPath, outputPath);
        } catch {
          await fs.copyFile(tempPath, outputPath);
          await fs.rm(tempPath, { force: true });
        }
        tempPath = undefined;
      } else if (file.buffer?.length) {
        await fs.writeFile(outputPath, file.buffer);
      } else {
        throw new BadRequestException('视频文件读取失败，请重新上传');
      }

      return this.createAvatar(userId, {
        ...body,
        originalVideoUrl: fileName,
        styleId: this.optionalString(body.styleId) || 'uploaded-video',
        __allowUploadSourceBypass: true,
      });
    } finally {
      if (tempPath) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
      }
    }
  }

  async createVoice(userId: string, body: Record<string, unknown>) {
    const now = nowIso();
    const audioUrl = this.normalizeVoiceAudioUrl(body.audioUrl);
    const providerVoice = this.optionalString(body.providerVoice);
    if (!audioUrl && !providerVoice) {
      throw new BadRequestException('missing audioUrl/providerVoice');
    }
    const row: ResourceRow = {
      id: randomUUID(),
      user_id: userId,
      name: trimName(body.name, '我的克隆音色'),
      is_recommended: 0,
      audio_url: audioUrl || null,
      clone_status: this.voiceCloneStatus(body.cloneStatus),
      provider: this.optionalString(body.provider),
      provider_voice: providerVoice,
      provider_model: this.optionalString(body.providerModel),
      sample_duration_ms: this.optionalNumber(body.sampleDurationMs),
      clone_error: this.optionalString(body.cloneError),
      expires_at: this.expiresAtFrom(now),
      created_at: now,
      updated_at: now,
    };
    await this.db.execute(
      `INSERT INTO voice_resources
       (id, user_id, name, is_recommended, audio_url, clone_status, provider, provider_voice, provider_model, sample_duration_ms, clone_error, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.name,
        row.is_recommended,
        row.audio_url,
        row.clone_status,
        row.provider,
        row.provider_voice,
        row.provider_model,
        row.sample_duration_ms,
        row.clone_error,
        row.expires_at,
        row.created_at,
        row.updated_at,
      ],
    );
    return this.toVoice(row, userId);
  }

  async cloneVoice(userId: string, body: Record<string, unknown>) {
    const sampleUrl = this.optionalString(body.audioUrl);
    if (!sampleUrl) {
      throw new BadRequestException('请填写可公开访问的样本音频 URL');
    }

    const remoteSample = await this.fetchRemoteVoiceSample(sampleUrl);
    const stored = await this.persistVoiceSample(remoteSample);

    try {
      const cloned = await this.qwenVoiceClone.createVoiceClone({
        preferredName: trimName(body.name, '鎴戠殑鍏嬮殕闊宠壊'),
        sample: { url: sampleUrl },
        transcriptText: this.optionalString(body.sampleText),
        language: this.optionalString(body.language) || 'zh',
      });

      return this.createVoice(userId, {
        name: trimName(body.name, '鎴戠殑鍏嬮殕闊宠壊'),
        audioUrl: stored.audioUrl,
        provider: cloned.provider,
        providerVoice: cloned.voice,
        providerModel: cloned.targetModel,
        sampleDurationMs: remoteSample.durationMs,
      });
    } catch (error) {
      return this.createVoice(userId, {
        name: trimName(body.name, '我的上传音频'),
        audioUrl: stored.audioUrl,
        provider: LOCAL_UPLOAD_VOICE_PROVIDER,
        sampleDurationMs: remoteSample.durationMs,
        cloneError: this.toProviderErrorMessage(error),
      });
    }
  }

  async createVoiceFromUpload(
    userId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    body: Record<string, unknown>,
  ) {
    this.assertVoiceSampleFile(file);
    const sample = await this.validateVoiceSampleBuffer(file);
    const stored = await this.persistVoiceSample({
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      durationMs: sample.durationMs,
    });

    try {
      const providerSampleUrl = this.buildProviderVoiceSampleUrl(
        stored.audioUrl,
      );
      const cloned = await this.qwenVoiceClone.createVoiceClone({
        preferredName: trimName(body.name, '鎴戠殑鍏嬮殕闊宠壊'),
        sample: providerSampleUrl
          ? { url: providerSampleUrl }
          : {
              buffer: file.buffer,
              mimeType: this.normalizeVoiceSampleMimeType(
                file.mimetype,
                file.originalname,
              ),
            },
        transcriptText: this.optionalString(body.sampleText),
        language: this.optionalString(body.language) || 'zh',
      });

      return this.createVoice(userId, {
        name: trimName(body.name, '鎴戠殑鍏嬮殕闊宠壊'),
        audioUrl: stored.audioUrl,
        provider: cloned.provider,
        providerVoice: cloned.voice,
        providerModel: cloned.targetModel,
        sampleDurationMs: sample.durationMs,
      });
    } catch (error) {
      return this.createVoice(userId, {
        name: trimName(body.name, '我的上传音频'),
        audioUrl: stored.audioUrl,
        provider: LOCAL_UPLOAD_VOICE_PROVIDER,
        sampleDurationMs: sample.durationMs,
        cloneError: this.toProviderErrorMessage(error),
      });
    }
  }

  async createSubtitleTemplate(userId: string, body: Record<string, unknown>) {
    const now = nowIso();
    const styleJson = this.stylePayload(
      this.styleConfigToStyleJson(body.styleConfig) ?? body.styleJson,
    );
    const styleConfig = this.styleConfigPayload(body.styleConfig, styleJson);
    const fallbackCover = this.buildTemplatePreviewFallbackUrl(
      'custom',
      'cover',
    );
    const fallbackPreview = this.buildTemplatePreviewFallbackUrl(
      'custom',
      'preview',
    );
    const row: ResourceRow = {
      id: randomUUID(),
      user_id: userId,
      name: trimName(body.name, '我的字幕模板'),
      is_recommended: 0,
      cover_url: this.sanitizeTemplateAssetUrl(
        this.optionalString(body.coverUrl),
        fallbackCover,
      ),
      preview_url: this.sanitizeTemplateAssetUrl(
        this.optionalString(body.previewCoverUrl),
        fallbackPreview,
      ),
      style_json: JSON.stringify(styleJson),
      style_config_json: JSON.stringify(styleConfig),
      base_template_id: this.optionalString(body.baseTemplateId),
      created_at: now,
      updated_at: now,
    };
    await this.db.execute(
      `INSERT INTO subtitle_template_resources
       (id, user_id, name, is_recommended, cover_url, preview_url, style_json, style_config_json, base_template_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.name,
        row.is_recommended,
        row.cover_url,
        row.preview_url,
        row.style_json,
        row.style_config_json,
        row.base_template_id,
        row.created_at,
        row.updated_at,
      ],
    );
    return this.toSubtitle(row, userId);
  }

  async copySubtitleTemplate(userId: string, id: string) {
    const row = await this.findRow('subtitle_template_resources', id);
    if (row?.user_id && row.user_id !== userId) {
      throw new ForbiddenException('鍙兘澶嶅埗鑷繁鎴栧叕鐗堢殑瀛楀箷妯℃澘');
    }
    if (!row) throw new NotFoundException('字幕模板不存在');
    const now = nowIso();
    const styleJson = this.parseStyle(row.style_json);
    const styleConfig = this.styleConfigPayload(
      this.parseStyle(row.style_config_json),
      styleJson,
    );
    const fallbackCover = this.buildTemplatePreviewFallbackUrl(id, 'cover');
    const fallbackPreview = this.buildTemplatePreviewFallbackUrl(id, 'preview');
    const next: ResourceRow = {
      ...row,
      id: randomUUID(),
      user_id: userId,
      name: `${row.name} 副本`.slice(0, 80),
      is_recommended: 0,
      cover_url: this.sanitizeTemplateAssetUrl(row.cover_url, fallbackCover),
      preview_url: this.sanitizeTemplateAssetUrl(
        row.preview_url || row.cover_url,
        fallbackPreview,
      ),
      style_json: JSON.stringify(styleJson),
      style_config_json: JSON.stringify(styleConfig),
      base_template_id: row.base_template_id || row.id,
      created_at: now,
      updated_at: now,
    };
    await this.db.execute(
      `INSERT INTO subtitle_template_resources
       (id, user_id, name, is_recommended, cover_url, preview_url, style_json, style_config_json, base_template_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        next.id,
        next.user_id,
        next.name,
        next.is_recommended,
        next.cover_url,
        next.preview_url,
        next.style_json,
        next.style_config_json,
        next.base_template_id,
        next.created_at,
        next.updated_at,
      ],
    );
    return this.toSubtitle(next, userId);
  }

  async updateSubtitleTemplate(
    userId: string,
    id: string,
    body: Record<string, unknown>,
  ) {
    const row = await this.assertOwned(
      'subtitle_template_resources',
      userId,
      id,
    );
    const name = trimName(body.name, row.name);
    const existingStyleJson = this.parseStyle(row.style_json);
    const existingStyleConfig = this.styleConfigPayload(
      this.parseStyle(row.style_config_json),
      existingStyleJson,
    );
    const incomingStyleConfig =
      body.styleConfig &&
      typeof body.styleConfig === 'object' &&
      !Array.isArray(body.styleConfig)
        ? (body.styleConfig as Record<string, unknown>)
        : null;
    const incomingStyleJson =
      this.styleConfigToStyleJson(incomingStyleConfig) ??
      (body.styleJson &&
      typeof body.styleJson === 'object' &&
      !Array.isArray(body.styleJson)
        ? (body.styleJson as Record<string, unknown>)
        : null);
    const nextStyleJson = this.stylePayload(
      incomingStyleJson ?? existingStyleJson,
    );
    const nextStyleConfig = this.styleConfigPayload(
      incomingStyleConfig ?? existingStyleConfig,
      nextStyleJson,
    );
    const styleJson = JSON.stringify(nextStyleJson);
    const styleConfigJson = JSON.stringify(nextStyleConfig);
    const fallbackCover = this.buildTemplatePreviewFallbackUrl(id, 'cover');
    const fallbackPreview = this.buildTemplatePreviewFallbackUrl(id, 'preview');
    const coverUrl =
      this.sanitizeTemplateAssetUrl(
        this.optionalString(body.coverUrl) || row.cover_url,
        fallbackCover,
      ) || fallbackCover;
    const previewUrl =
      this.sanitizeTemplateAssetUrl(
        this.optionalString(body.previewCoverUrl) ||
          row.preview_url ||
          row.cover_url,
        fallbackPreview,
      ) || fallbackPreview;
    const updatedAt = nowIso();
    await this.db.execute(
      `UPDATE subtitle_template_resources
       SET name = ?, cover_url = ?, preview_url = ?, style_json = ?, style_config_json = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        name,
        coverUrl,
        previewUrl,
        styleJson,
        styleConfigJson,
        updatedAt,
        id,
        userId,
      ],
    );
    return this.toSubtitle(
      {
        ...row,
        name,
        cover_url: coverUrl,
        preview_url: previewUrl,
        style_json: styleJson,
        style_config_json: styleConfigJson,
        updated_at: updatedAt,
      },
      userId,
    );
  }

  async deleteSubtitleTemplate(userId: string, id: string) {
    const row = await this.assertOwned(
      'subtitle_template_resources',
      userId,
      id,
    );
    await this.db.execute(
      `DELETE FROM subtitle_template_resources WHERE id = ? AND user_id = ?`,
      [id, userId],
    );
    await this.cleanupOwnedLocalAsset('subtitle_template_resources', row);
    return { deletedIds: [id] };
  }

  async deleteSubtitleTemplates(userId: string, ids: unknown) {
    const idList = Array.isArray(ids)
      ? ids.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        )
      : [];
    if (!idList.length) throw new BadRequestException('ids 涓嶈兘涓虹┖');
    const deleted: string[] = [];
    for (const id of idList) {
      const row = await this.findOwnedRow(
        'subtitle_template_resources',
        userId,
        id,
      );
      if (!row) continue;
      await this.db.execute(
        `DELETE FROM subtitle_template_resources WHERE id = ? AND user_id = ?`,
        [id, userId],
      );
      await this.cleanupOwnedLocalAsset('subtitle_template_resources', row);
      deleted.push(id);
    }
    return { deletedIds: deleted };
  }

  async rename(
    table: ResourceTable,
    userId: string,
    id: string,
    name: unknown,
  ) {
    this.assertMutableResourceTable(table);
    const row = await this.assertOwned(table, userId, id);
    const nextName = trimName(name, row.name);
    const updatedAt = nowIso();
    await this.db.execute(
      `UPDATE ${table} SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [nextName, updatedAt, id, userId],
    );
    return { id, name: nextName, updatedAt };
  }

  async deleteOne(table: ResourceTable, userId: string, id: string) {
    this.assertMutableResourceTable(table);
    const row = await this.assertOwned(table, userId, id);
    await this.db.execute(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, [
      id,
      userId,
    ]);
    await this.cleanupOwnedLocalAsset(table, row);
    return { deletedIds: [id] };
  }

  async deleteMany(table: ResourceTable, userId: string, ids: unknown) {
    this.assertMutableResourceTable(table);
    const idList = Array.isArray(ids)
      ? ids.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        )
      : [];
    if (!idList.length) throw new BadRequestException('ids 不能为空');
    const deleted: string[] = [];
    for (const id of idList) {
      const row = await this.findOwnedRow(table, userId, id);
      if (!row) continue;
      await this.db.execute(
        `DELETE FROM ${table} WHERE id = ? AND user_id = ?`,
        [id, userId],
      );
      await this.cleanupOwnedLocalAsset(table, row);
      deleted.push(id);
    }
    return { deletedIds: deleted };
  }

  resolveVoiceSamplePathOrThrow(fileName: string): string {
    const base = this.assertSafeBasename(fileName);
    const dir = path.resolve(this.getVoiceSampleDir());
    const full = path.resolve(path.join(dir, base));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('非法音频文件路径');
    }
    return full;
  }

  resolveProviderVoiceSamplePathOrThrow(
    fileName: string,
    token?: string,
    expires?: string,
  ): string {
    const base = this.assertSafeBasename(fileName);
    this.assertProviderVoiceSampleToken(base, token, expires);
    return this.resolveVoiceSamplePathOrThrow(base);
  }

  async readManagedVoiceSample(audioUrl?: string | null): Promise<{
    buffer: Buffer;
    originalname: string;
    mimetype: string;
  } | null> {
    const fileName = this.extractManagedVoiceSampleName(audioUrl);
    if (!fileName) return null;
    const full = this.resolveVoiceSamplePathOrThrow(fileName);
    const buffer = await fs.readFile(full);
    return {
      buffer,
      originalname: fileName,
      mimetype: this.normalizeVoiceSampleMimeType('', fileName),
    };
  }

  async openVoiceSampleStreamOrThrow(fileName: string): Promise<{
    stream: Readable;
    originalname: string;
    mimetype: string;
    contentLength?: number;
    etag?: string;
  }> {
    const base = this.assertSafeBasename(fileName);
    try {
      if (this.isVoiceSampleOssEnabled()) {
        const object = await this.getVoiceSampleStreamObjectFromOss(base);
        return {
          stream: this.toReadable(
            (object as { stream?: unknown }).stream ??
              (object as { content?: unknown }).content,
          ),
          originalname: base,
          mimetype: this.normalizeVoiceSampleMimeType('', base),
          contentLength: this.headerNumber(
            (
              object as {
                res?: {
                  headers?: Record<string, string | string[] | undefined>;
                };
              }
            ).res?.headers,
            'content-length',
          ),
          etag: this.headerString(
            (
              object as {
                res?: {
                  headers?: Record<string, string | string[] | undefined>;
                };
              }
            ).res?.headers,
            'etag',
          ),
        };
      }
      const full = this.resolveVoiceSamplePathOrThrow(base);
      const stat = await fs.stat(full);
      return {
        stream: createReadStream(full),
        originalname: base,
        mimetype: this.normalizeVoiceSampleMimeType('', base),
        contentLength: stat.size,
      };
    } catch {
      throw new NotFoundException('voice sample not found');
    }
  }

  async openProviderVoiceSampleStreamOrThrow(
    fileName: string,
    token?: string,
    expires?: string,
  ): Promise<{
    stream: Readable;
    originalname: string;
    mimetype: string;
    contentLength?: number;
    etag?: string;
  }> {
    const base = this.assertSafeBasename(fileName);
    this.assertProviderVoiceSampleToken(base, token, expires);
    return this.openVoiceSampleStreamOrThrow(base);
  }

  async openOwnedAvatarVideoStreamOrThrow(
    userId: string,
    fileName: string,
    rangeHeader?: string,
  ): Promise<{
    stream: Readable;
    originalname: string;
    mimetype: string;
    contentLength: number;
    totalSize: number;
    range?: HttpByteRange;
    rangeNotSatisfiable?: boolean;
  }> {
    const base = this.assertSafeBasename(fileName);
    if (!base.startsWith(`${AVATAR_UPLOAD_PREFIX}_`)) {
      throw new NotFoundException('avatar upload video not found');
    }
    const ownerRow = await this.findOwnedAvatarUploadVideoRow(userId, base);
    if (!ownerRow) {
      throw new NotFoundException('avatar upload video not found');
    }
    const full = this.resolveSavedVideoPathOrThrow(base);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) {
        throw new NotFoundException('avatar upload video not found');
      }
      const totalSize = stat.size;
      if (totalSize <= 0) {
        return {
          stream: createReadStream(full),
          originalname: base,
          mimetype: this.guessVideoMime(base),
          contentLength: 0,
          totalSize,
        };
      }
      const range = this.parseHttpRange(rangeHeader, totalSize);
      if (rangeHeader && !range) {
        return {
          stream: Readable.from([]),
          originalname: base,
          mimetype: this.guessVideoMime(base),
          contentLength: 0,
          totalSize,
          rangeNotSatisfiable: true,
        };
      }
      if (range) {
        return {
          stream: createReadStream(full, {
            start: range.start,
            end: range.end,
          }),
          originalname: base,
          mimetype: this.guessVideoMime(base),
          contentLength: range.end - range.start + 1,
          totalSize,
          range,
        };
      }
      return {
        stream: createReadStream(full),
        originalname: base,
        mimetype: this.guessVideoMime(base),
        contentLength: totalSize,
        totalSize,
      };
    } catch {
      throw new NotFoundException('avatar upload video not found');
    }
  }

  async openSignedAvatarVideoStreamOrThrow(
    fileName: string,
    token?: string,
    expires?: string,
    rangeHeader?: string,
  ): Promise<{
    stream: Readable;
    originalname: string;
    mimetype: string;
    contentLength: number;
    totalSize: number;
    range?: HttpByteRange;
    rangeNotSatisfiable?: boolean;
  }> {
    const { userId, fileName: safeFileName } =
      await this.assertSignedAvatarVideoToken(
        fileName,
        token,
        expires,
        'stream',
      );
    return this.openOwnedAvatarVideoStreamOrThrow(
      userId,
      safeFileName,
      rangeHeader,
    );
  }

  async getOwnedAvatarVideoMetadataOrThrow(
    userId: string,
    fileName: string,
  ): Promise<AvatarSavedVideoDto> {
    const base = this.assertSafeBasename(fileName);
    if (!base.startsWith(`${AVATAR_UPLOAD_PREFIX}_`)) {
      throw new NotFoundException('avatar upload video not found');
    }
    const ownerRow = await this.findOwnedAvatarUploadVideoRow(userId, base);
    if (!ownerRow) {
      throw new NotFoundException('avatar upload video not found');
    }
    const full = this.resolveSavedVideoPathOrThrow(base);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) {
        throw new NotFoundException('avatar upload video not found');
      }
      return {
        avatarId: ownerRow.id,
        avatarName: ownerRow.name,
        fileName: base,
        fileSize: stat.size,
        mimeType: this.guessVideoMime(base),
        mtime: new Date(stat.mtimeMs).toISOString(),
        ...this.createSignedAvatarVideoPreviewUrls(userId, base),
      };
    } catch {
      throw new NotFoundException('avatar upload video not found');
    }
  }

  async getSignedAvatarVideoMetadataOrThrow(
    fileName: string,
    token?: string,
    expires?: string,
  ): Promise<AvatarSavedVideoDto> {
    const { userId, fileName: safeFileName } =
      await this.assertSignedAvatarVideoToken(
        fileName,
        token,
        expires,
        'metadata',
      );
    return this.getOwnedAvatarVideoMetadataOrThrow(userId, safeFileName);
  }

  private resolveSavedVideoPathOrThrow(fileName: string): string {
    const base = this.assertSafeBasename(fileName);
    const dir = path.resolve(this.getVideoSaveDir());
    const full = path.resolve(path.join(dir, base));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('非法视频文件路径');
    }
    return full;
  }

  private async listRows(
    table: ResourceTable,
    userId: string,
    opts: { scope: ResourceScope; cursor?: string; limit?: number },
  ): Promise<CursorPage<ResourceRow>> {
    const limit = Math.min(
      Math.max(Number(opts.limit) || 18, 1),
      PAGE_LIMIT_MAX,
    );
    const cursor = decodeCursor(opts.cursor);
    const args: unknown[] = [];
    const where: string[] = [];

    if (opts.scope === 'mine') {
      where.push('user_id = ?');
      args.push(userId);
    } else if (opts.scope === 'recommended') {
      where.push('is_recommended = 1');
    } else {
      where.push('(user_id = ? OR is_recommended = 1)');
      args.push(userId);
    }

    if (table === 'voice_resources') {
      where.push(
        `id NOT IN (${RETIRED_RECOMMENDED_VOICE_IDS.map(() => '?').join(', ')})`,
      );
      args.push(...RETIRED_RECOMMENDED_VOICE_IDS);
    }

    if (cursor) {
      where.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
      args.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }

    args.push(limit + 1);
    const rows = await this.db.queryAll<ResourceRow>(
      `SELECT * FROM ${table} WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
      args,
    );
    const items = rows.slice(0, limit);
    return {
      items,
      hasMore: rows.length > limit,
      nextCursor:
        rows.length > limit && items.length
          ? encodeCursor(items[items.length - 1])
          : null,
    };
  }

  private async assertOwned(
    table: ResourceTable,
    userId: string,
    id: string,
  ): Promise<ResourceRow> {
    const row = await this.findRow(table, id);
    if (!row) throw new NotFoundException('资源不存在');
    if (row.user_id !== userId)
      throw new ForbiddenException('只能管理自己的资源');
    return row;
  }

  private assertMutableResourceTable(table: ResourceTable) {
    if (table === 'subtitle_template_resources') {
      throw new ForbiddenException(
        '字幕模板由系统统一维护，用户不可新建、编辑或删除',
      );
    }
  }

  private async findOwnedRow(table: ResourceTable, userId: string, id: string) {
    return this.db.queryOne<ResourceRow>(
      `SELECT * FROM ${table} WHERE id = ? AND user_id = ?`,
      [id, userId],
    );
  }

  private async findRow(table: ResourceTable, id: string) {
    return this.db.queryOne<ResourceRow>(
      `SELECT * FROM ${table} WHERE id = ?`,
      [id],
    );
  }

  private async runExpiredUploadCleanup(reason: 'startup' | 'interval') {
    if (this.cleanupRunning) return;
    this.cleanupRunning = true;
    try {
      await this.backfillMissingUploadExpirations();
      const avatarDeleted = await this.deleteExpiredRows('avatar_resources');
      const voiceDeleted = await this.deleteExpiredRows('voice_resources');
      const total = avatarDeleted + voiceDeleted;
      if (total > 0) {
        this.logger.log(
          `已清理过期用户素材 ${total} 条（视频 ${avatarDeleted}，音频 ${voiceDeleted}，触发：${reason}）`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `清理过期用户素材失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.cleanupRunning = false;
    }
  }

  private async backfillMissingUploadExpirations() {
    const ttlDays = this.getUploadResourceTtlDays();
    for (const table of ['avatar_resources', 'voice_resources'] as const) {
      const rows = await this.db.queryAll<
        Pick<ResourceRow, 'id' | 'created_at' | 'updated_at'>
      >(
        `SELECT id, created_at, updated_at FROM ${table}
         WHERE user_id IS NOT NULL AND is_recommended = 0 AND expires_at IS NULL
         LIMIT ?`,
        [UPLOAD_RESOURCE_CLEANUP_BATCH_SIZE],
      );
      for (const row of rows) {
        const expiresAt = addDaysIso(
          row.created_at || row.updated_at || nowIso(),
          ttlDays,
        );
        await this.db.execute(
          `UPDATE ${table} SET expires_at = ? WHERE id = ?`,
          [expiresAt, row.id],
        );
      }
    }
  }

  private async deleteExpiredRows(
    table: 'avatar_resources' | 'voice_resources',
  ): Promise<number> {
    const rows = await this.db.queryAll<ResourceRow>(
      `SELECT * FROM ${table}
       WHERE user_id IS NOT NULL AND is_recommended = 0 AND expires_at IS NOT NULL AND expires_at <= ?
       ORDER BY expires_at ASC, id ASC LIMIT ?`,
      [nowIso(), UPLOAD_RESOURCE_CLEANUP_BATCH_SIZE],
    );
    let deleted = 0;
    for (const row of rows) {
      await this.db.execute(
        `DELETE FROM ${table} WHERE id = ? AND user_id = ?`,
        [row.id, row.user_id],
      );
      await this.cleanupOwnedLocalAsset(table, row);
      deleted += 1;
    }
    return deleted;
  }

  private expiresAtFrom(createdAt: string): string {
    return addDaysIso(createdAt, this.getUploadResourceTtlDays());
  }

  private getUploadResourceTtlDays(): number {
    const configured = Number(
      this.config.get('USER_UPLOAD_RESOURCE_TTL_DAYS') ?? '',
    );
    if (Number.isFinite(configured) && configured > 0) return configured;
    return DEFAULT_UPLOAD_RESOURCE_TTL_DAYS;
  }

  private getCleanupIntervalMs(): number {
    const configured = Number(
      this.config.get('USER_UPLOAD_RESOURCE_CLEANUP_INTERVAL_MS') ?? '',
    );
    if (Number.isFinite(configured) && configured >= 0) return configured;
    return DEFAULT_UPLOAD_RESOURCE_CLEANUP_INTERVAL_MS;
  }

  private async cleanupOwnedLocalAsset(table: ResourceTable, row: ResourceRow) {
    if (table === 'avatar_resources') {
      const fileName = this.extractManagedAvatarVideoName(row.source_video_url);
      if (!fileName) return;
      const full = this.resolveSavedVideoPathOrThrow(fileName);
      await fs.rm(full, { force: true }).catch(() => undefined);
      return;
    }

    if (table === 'voice_resources') {
      if (row.provider === 'aliyun-qwen-vc' && row.provider_voice) {
        await this.qwenVoiceClone.deleteVoice(row.provider_voice);
      }
      const fileName = this.extractManagedVoiceSampleName(row.audio_url);
      if (!fileName) return;
      const full = this.resolveVoiceSamplePathOrThrow(fileName);
      await fs.rm(full, { force: true }).catch(() => undefined);
    }
  }

  private toAvatar(row: ResourceRow, userId: string): AvatarResourceDto {
    const renderState = this.resolveAvatarRenderState(row.source_video_url);
    const preview = this.resolveAvatarPreviewUrls(row, userId);
    return {
      id: row.id,
      name: row.name,
      owner: row.user_id === userId ? 'mine' : 'recommended',
      recommended: row.is_recommended === 1,
      coverUrl: row.cover_url || this.placeholder('avatar'),
      originalVideoUrl: row.source_video_url || null,
      previewUrl: preview.previewUrl,
      metadataUrl: preview.metadataUrl,
      renderMode: 'source-video',
      canUseForRender: renderState.canUseForRender,
      renderUnavailableReason: renderState.renderUnavailableReason,
      styleId: row.style_id || null,
      videoCoverUrl: row.video_cover_url || row.cover_url || null,
      videoDurationSeconds:
        typeof row.video_duration_seconds === 'number'
          ? row.video_duration_seconds
          : null,
      modelType: row.model_type || null,
      assetStatus: row.asset_status || null,
      videoOssKey: row.video_oss_key || null,
      expiresAt: row.expires_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toVoice(row: ResourceRow, userId: string): VoiceResourceDto {
    const status =
      row.clone_status === 'processing' || row.clone_status === 'failed'
        ? row.clone_status
        : 'ready';
    const providerVoice = row.provider_voice || null;
    const audioUrl = this.normalizeVoiceAudioUrl(row.audio_url);
    const renderMode: 'tts' | 'sample-audio' = providerVoice
      ? 'tts'
      : 'sample-audio';
    const canUseForRender =
      status === 'ready' && (Boolean(providerVoice) || Boolean(audioUrl));
    const renderUnavailableReason =
      status === 'failed'
        ? row.clone_error || '澹伴煶鍏嬮殕澶辫触锛岃閲嶆柊涓婁紶鏍锋湰'
        : status === 'processing'
          ? '澹伴煶鍏嬮殕杩樺湪杩涜涓紝璇风◢鍚庡啀璇?'
          : canUseForRender
            ? null
            : '褰撳墠闊宠壊缂哄皯鍙敤鐨勫悎鎴愯兘鍔涙垨鏍锋湰闊抽';
    return {
      id: row.id,
      name: row.name,
      owner: row.user_id === userId ? 'mine' : 'recommended',
      recommended: row.is_recommended === 1,
      audioUrl: audioUrl || this.placeholderAudio(),
      sampleMissing: false,
      cloneStatus: status,
      renderMode,
      canUseForRender,
      renderUnavailableReason,
      supportsDynamicTts: Boolean(providerVoice),
      provider: row.provider || null,
      providerVoice,
      providerModel: row.provider_model || null,
      sampleDurationMs:
        typeof row.sample_duration_ms === 'number'
          ? row.sample_duration_ms
          : null,
      cloneError: row.clone_error || null,
      expiresAt: row.expires_at || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async applyVoiceSampleIntegrity(
    userId: string,
    row: ResourceRow,
    voice: VoiceResourceDto,
  ): Promise<VoiceResourceDto> {
    if (row.user_id !== userId || row.is_recommended === 1) {
      return voice;
    }
    const fileName = this.extractManagedVoiceSampleName(row.audio_url);
    if (!fileName) {
      return voice;
    }
    const exists = await this.managedVoiceSampleExists(fileName);
    if (exists) {
      return voice;
    }
    if (voice.supportsDynamicTts) {
      return {
        ...voice,
        audioUrl: this.placeholderAudio(),
        sampleMissing: true,
        canUseForRender: voice.cloneStatus === 'ready',
        renderUnavailableReason:
          voice.cloneStatus === 'ready' ? null : voice.renderUnavailableReason,
      };
    }

    const unavailableReason = 'voice sample file not found';
    return {
      ...voice,
      audioUrl: this.placeholderAudio(),
      sampleMissing: true,
      canUseForRender: false,
      renderUnavailableReason:
        voice.cloneStatus === 'ready'
          ? unavailableReason
          : (voice.renderUnavailableReason ?? unavailableReason),
    };
  }

  private resolveAvatarRenderState(sourceVideoUrl?: string | null): {
    canUseForRender: boolean;
    renderUnavailableReason: string | null;
  } {
    const source = sourceVideoUrl?.trim();
    if (!source) {
      return {
        canUseForRender: false,
        renderUnavailableReason:
          '褰撳墠鏁板瓧浜烘湭缁戝畾鍙敤瑙嗛锛岃鍏堜笂浼犳垨閲嶆柊閫夋嫨',
      };
    }
    if (/^https?:\/\//i.test(source) || source.startsWith('data:')) {
      return { canUseForRender: true, renderUnavailableReason: null };
    }
    try {
      const full = this.resolveSavedVideoPathOrThrow(source);
      if (existsSync(full)) {
        return { canUseForRender: true, renderUnavailableReason: null };
      }
      return {
        canUseForRender: false,
        renderUnavailableReason: 'avatar video file not found',
      };
    } catch {
      return {
        canUseForRender: false,
        renderUnavailableReason: '鏁板瓧浜鸿棰戝湴鍧€鏃犳晥锛岃閲嶆柊涓婁紶',
      };
    }
  }

  private toSubtitle(
    row: ResourceRow,
    userId: string,
  ): SubtitleTemplateResourceDto {
    const styleJson = this.parseStyle(row.style_json);
    const fallbackCover = this.buildTemplatePreviewFallbackUrl(row.id, 'cover');
    const fallbackPreview = this.buildTemplatePreviewFallbackUrl(
      row.id,
      'preview',
    );
    const coverUrl = this.sanitizeTemplateAssetUrl(
      row.cover_url,
      fallbackCover,
    );
    const previewCoverUrl = this.sanitizeTemplateAssetUrl(
      row.preview_url || row.cover_url,
      fallbackPreview,
    );
    return {
      id: row.id,
      name: row.name,
      owner: row.user_id === userId ? 'mine' : 'recommended',
      recommended: row.is_recommended === 1,
      editable: row.user_id === userId,
      baseTemplateId: this.optionalString(row.base_template_id),
      coverUrl,
      previewCoverUrl,
      styleJson,
      styleConfig: this.styleConfigPayload(
        this.parseStyle(row.style_config_json),
        styleJson,
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private async ensureSeeded() {
    if (this.seeded) return;
    if (!this.seedPromise) {
      this.seedPromise = this.seedRecommended()
        .then(() => {
          this.seeded = true;
        })
        .finally(() => {
          this.seedPromise = null;
        });
    }
    await this.seedPromise;
  }

  private async seedRecommended() {
    const now = nowIso();
    const avatars = [
      ['rec-avatar-business', '商务讲解数字人', 'suit'],
      ['rec-avatar-knowledge', '知识科普数字人', 'programmer'],
      ['rec-avatar-fashion', '时尚探店数字人', 'fashion'],
    ];
    for (const [id, name, styleId] of avatars) {
      if (await this.findRow('avatar_resources', id)) continue;
      await this.db.execute(
        `INSERT INTO avatar_resources
         (id, user_id, name, is_recommended, cover_url, source_video_url, style_id, created_at, updated_at)
         VALUES (?, NULL, ?, 1, ?, ?, ?, ?, ?)`,
        [id, name, this.placeholder('avatar'), null, styleId, now, now],
      );
    }
    const subtitles: [string, string, Record<string, unknown>][] = [
      [
        'rec-subtitle-minimal',
        '极简白字',
        { color: '#ffffff', stroke: '#111827', size: 42 },
      ],
      [
        'rec-subtitle-yellow',
        '高对比黄字',
        { color: '#facc15', stroke: '#111827', size: 44 },
      ],
      [
        'rec-subtitle-card',
        '知识卡片字幕',
        { color: '#111827', background: '#ffffff', size: 38 },
      ],
    ];
    for (const [id, name, style] of subtitles) {
      if (await this.findRow('subtitle_template_resources', id)) continue;
      await this.db.execute(
        `INSERT INTO subtitle_template_resources
         (id, user_id, name, is_recommended, cover_url, preview_url, style_json, created_at, updated_at)
         VALUES (?, NULL, ?, 1, ?, ?, ?, ?, ?)`,
        [
          id,
          name,
          this.placeholder('subtitle'),
          this.placeholder('subtitle-alt'),
          JSON.stringify(style),
          now,
          now,
        ],
      );
    }
    await this.upsertRecommendedSubtitleTemplates(now);
  }

  private async hasLocalVoiceSample(fileName: string): Promise<boolean> {
    const full = path.join(
      this.getVoiceSampleDir(),
      this.assertSafeBasename(fileName),
    );
    const stat = await fs.stat(full).catch(() => null);
    return Boolean(stat?.isFile() && stat.size > 1024);
  }

  private voiceSampleStreamUrl(fileName: string): string {
    return `/api/v1/resources/voice-files/${encodeURIComponent(fileName)}/stream`;
  }

  private async upsertRecommendedSubtitleTemplates(now: string) {
    const templates: Array<{
      id: string;
      name: string;
      style: Record<string, unknown>;
      coverUrl: string;
      previewUrl: string;
    }> = [
      {
        id: 'rec-subtitle-minimal',
        name: '轻透白描',
        style: {
          theme: 'airy-clean',
          fontFamily: 'Noto Sans CJK SC',
          size: 44,
          color: '#F8FBFF',
          stroke: '#17324E',
          strokeWidth: 2.8,
          background: '#10233B52',
          weight: 700,
          lineChars: 14,
          marginBottom: 76,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: '轻透白描',
          accent: '#4B6BFF',
          background: '#F4F8FF',
          panel: '#E7F0FF',
          subtitleColor: '#F8FBFF',
          subtitleStroke: '#17324E',
          subtitleBackground: '#10233B88',
          badge: 'Clean',
          previewText: ['一句一屏更清爽', '适合讲解和品牌口播'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: '轻透白描',
          accent: '#6CA9FF',
          background: '#EAF3FF',
          panel: '#DDEBFF',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#112842',
          subtitleBackground: '#10233BB8',
          badge: 'Hover',
          previewText: ['白字描边更稳', '信息清楚、干净耐看'],
        }),
      },
      {
        id: 'rec-subtitle-yellow',
        name: '重点高亮',
        style: {
          theme: 'highlight-pop',
          fontFamily: 'Noto Sans CJK SC',
          size: 46,
          color: '#0F172A',
          stroke: '#FFFFFF',
          strokeWidth: 1.2,
          highlightColor: '#FFE066',
          background: '#FFFFFFCC',
          weight: 800,
          lineChars: 13,
          marginBottom: 70,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: '重点高亮',
          accent: '#14B8A6',
          background: '#F6FFFD',
          panel: '#DDFBF4',
          subtitleColor: '#0F172A',
          subtitleStroke: '#FFFFFF',
          subtitleBackground: '#FFF6BF',
          badge: 'Focus',
          previewText: ['关键词自动突出', '带一点营销感但不吵'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: '重点高亮',
          accent: '#0EA5E9',
          background: '#F4FBFF',
          panel: '#DFF4FF',
          subtitleColor: '#111827',
          subtitleStroke: '#FFFFFF',
          subtitleBackground: '#FFE066',
          badge: 'Bright',
          previewText: ['高亮更适合短视频', '重点句一眼抓住'],
        }),
      },
      {
        id: 'rec-subtitle-card',
        name: '卡片知识框',
        style: {
          theme: 'card-knowledge',
          fontFamily: 'Noto Sans CJK SC',
          size: 38,
          color: '#0F172A',
          stroke: '#FFFFFF',
          strokeWidth: 1,
          background: '#F8FAFCCF',
          weight: 700,
          lineChars: 15,
          marginBottom: 84,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: '卡片知识框',
          accent: '#1D4ED8',
          background: '#F7FAFF',
          panel: '#E8F0FF',
          subtitleColor: '#0F172A',
          subtitleStroke: '#FFFFFF',
          subtitleBackground: '#F8FAFCE6',
          badge: 'Card',
          previewText: ['知识点像小卡片一样', '适合教程、解说、答疑'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: '卡片知识框',
          accent: '#3B82F6',
          background: '#EFF6FF',
          panel: '#DBEAFE',
          subtitleColor: '#111827',
          subtitleStroke: '#FFFFFF',
          subtitleBackground: '#FFFFFFF2',
          badge: 'Learn',
          previewText: ['边框更柔和', '中长句依然保持可读'],
        }),
      },
      {
        id: 'rec-subtitle-night',
        name: '夜蓝沉浸',
        style: {
          theme: 'night-immersive',
          fontFamily: 'Noto Sans CJK SC',
          size: 42,
          color: '#F8FAFC',
          stroke: '#0B1220',
          strokeWidth: 2.4,
          background: '#07111ECC',
          weight: 700,
          lineChars: 14,
          marginBottom: 78,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: '夜蓝沉浸',
          accent: '#0F766E',
          background: '#0F172A',
          panel: '#16213B',
          subtitleColor: '#F8FAFC',
          subtitleStroke: '#020617',
          subtitleBackground: '#07111ECC',
          badge: 'Moody',
          previewText: ['深底字幕更聚焦', '适合人物口播和故事感'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: '夜蓝沉浸',
          accent: '#38BDF8',
          background: '#111C32',
          panel: '#1E2A44',
          subtitleColor: '#F8FAFC',
          subtitleStroke: '#020617',
          subtitleBackground: '#0A1322E6',
          badge: 'Deep',
          previewText: ['暗底更像成片样式', '适合情绪感更强的画面'],
        }),
      },
      {
        id: 'rec-subtitle-a-classic-white-yellow',
        name: 'A 经典白黄',
        style: {
          theme: 'classic-white-yellow',
          fontFamily: 'Noto Sans CJK SC',
          size: 44,
          color: '#FFFFFF',
          highlightColor: '#FFD400',
          stroke: '#000000',
          strokeWidth: 2.2,
          background: '#000000BF',
          weight: 800,
          lineChars: 14,
          marginBottom: 76,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: 'A 经典白黄',
          accent: '#FFD400',
          background: '#111827',
          panel: '#1F2937',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#000000BF',
          badge: 'A',
          previewText: ['最通用字幕配色', '适合口播与知识分享'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: 'A 经典白黄',
          accent: '#F59E0B',
          background: '#0F172A',
          panel: '#1E293B',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#000000BF',
          badge: 'Classic',
          previewText: ['关键词黄色高亮', '暗底场景可读性稳定'],
        }),
      },
      {
        id: 'rec-subtitle-b-white-green-tech',
        name: 'B 白绿科技',
        style: {
          theme: 'white-green-tech',
          fontFamily: 'Noto Sans CJK SC',
          size: 44,
          color: '#FFFFFF',
          highlightColor: '#00FF66',
          stroke: '#000000',
          strokeWidth: 2.2,
          background: '#00FF6673',
          weight: 800,
          lineChars: 14,
          marginBottom: 76,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: 'B 白绿科技',
          accent: '#00FF66',
          background: '#0B1325',
          panel: '#10203A',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#00FF6673',
          badge: 'B',
          previewText: ['白绿高科技感', '适合 AI 与工具类视频'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: 'B 白绿科技',
          accent: '#10B981',
          background: '#101827',
          panel: '#0F2A28',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#00FF6673',
          badge: 'Tech',
          previewText: ['高亮信息更醒目', '科技评测风格友好'],
        }),
      },
      {
        id: 'rec-subtitle-c-white-red-impact',
        name: 'C 白红冲击',
        style: {
          theme: 'white-red-impact',
          fontFamily: 'Noto Sans CJK SC',
          size: 45,
          color: '#FFFFFF',
          highlightColor: '#FF3B30',
          stroke: '#000000',
          strokeWidth: 2.3,
          background: '#FF3B3073',
          weight: 820,
          lineChars: 13,
          marginBottom: 74,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: 'C 白红冲击',
          accent: '#FF3B30',
          background: '#1F172A',
          panel: '#3B1828',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#FF3B3073',
          badge: 'C',
          previewText: ['爆点信息高冲击', '适合警示与强情绪文案'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: 'C 白红冲击',
          accent: '#EF4444',
          background: '#111827',
          panel: '#2B1A1A',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#FF3B3073',
          badge: 'Impact',
          previewText: ['红色高亮抓眼球', '营销节奏更强烈'],
        }),
      },
      {
        id: 'rec-subtitle-d-black-yellow-alert',
        name: 'D 黑黄醒目',
        style: {
          theme: 'black-yellow-alert',
          fontFamily: 'Noto Sans CJK SC',
          size: 43,
          color: '#111111',
          highlightColor: '#FFCC00',
          stroke: '#FFFFFF',
          strokeWidth: 2,
          background: '#00000059',
          weight: 780,
          lineChars: 14,
          marginBottom: 72,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: 'D 黑黄醒目',
          accent: '#FFCC00',
          background: '#F8FAFC',
          panel: '#E2E8F0',
          subtitleColor: '#111111',
          subtitleStroke: '#FFFFFF',
          subtitleBackground: '#00000059',
          badge: 'D',
          previewText: ['浅底画面更清楚', '采访与室内口播更稳'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: 'D 黑黄醒目',
          accent: '#EAB308',
          background: '#F1F5F9',
          panel: '#E5E7EB',
          subtitleColor: '#111111',
          subtitleStroke: '#FFFFFF',
          subtitleBackground: '#00000059',
          badge: 'Light',
          previewText: ['黑字主体可读性高', '黄色重点信息突出'],
        }),
      },
      {
        id: 'rec-subtitle-e-white-blue-pro',
        name: 'E 白蓝专业',
        style: {
          theme: 'white-blue-pro',
          fontFamily: 'Noto Sans CJK SC',
          size: 44,
          color: '#FFFFFF',
          highlightColor: '#2F80ED',
          stroke: '#000000',
          strokeWidth: 2.2,
          background: '#2F80ED73',
          weight: 780,
          lineChars: 14,
          marginBottom: 76,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: 'E 白蓝专业',
          accent: '#2F80ED',
          background: '#0F172A',
          panel: '#1E3A8A',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#2F80ED73',
          badge: 'E',
          previewText: ['专业感蓝色高亮', '适合商业财经课程类'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: 'E 白蓝专业',
          accent: '#60A5FA',
          background: '#111827',
          panel: '#1D4ED8',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#2F80ED73',
          badge: 'Pro',
          previewText: ['信息层级更清晰', 'SaaS 演示常用风格'],
        }),
      },
      {
        id: 'rec-subtitle-f-white-orange-commerce',
        name: 'F 白橙带货',
        style: {
          theme: 'white-orange-commerce',
          fontFamily: 'Noto Sans CJK SC',
          size: 45,
          color: '#FFFFFF',
          highlightColor: '#FF7A00',
          stroke: '#000000',
          strokeWidth: 2.3,
          background: '#FF7A0073',
          weight: 820,
          lineChars: 13,
          marginBottom: 74,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: 'F 白橙带货',
          accent: '#FF7A00',
          background: '#1F2937',
          panel: '#7C2D12',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#FF7A0073',
          badge: 'F',
          previewText: ['橙色重点转化感强', '电商直播切片更合适'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: 'F 白橙带货',
          accent: '#F97316',
          background: '#111827',
          panel: '#9A3412',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#FF7A0073',
          badge: 'Shop',
          previewText: ['节奏快且抓眼球', '适合种草转化内容'],
        }),
      },
      {
        id: 'rec-subtitle-g-ivory-gold-brand',
        name: 'G 米白金色',
        style: {
          theme: 'ivory-gold-brand',
          fontFamily: 'Noto Sans CJK SC',
          size: 44,
          color: '#FFF7E6',
          highlightColor: '#F5C542',
          stroke: '#1A1A1A',
          strokeWidth: 2.1,
          background: '#000000A6',
          weight: 760,
          lineChars: 14,
          marginBottom: 78,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: 'G 米白金色',
          accent: '#F5C542',
          background: '#2B2113',
          panel: '#3F2E1E',
          subtitleColor: '#FFF7E6',
          subtitleStroke: '#1A1A1A',
          subtitleBackground: '#000000A6',
          badge: 'G',
          previewText: ['米白金色更高级', '品牌文旅宣传更匹配'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: 'G 米白金色',
          accent: '#D4A017',
          background: '#1F1A12',
          panel: '#3A2D1F',
          subtitleColor: '#FFF7E6',
          subtitleStroke: '#1A1A1A',
          subtitleBackground: '#000000A6',
          badge: 'Gold',
          previewText: ['质感风格更稳重', '适合高级感叙事内容'],
        }),
      },
      {
        id: 'rec-subtitle-h-white-purple-trend',
        name: 'H 白紫潮流',
        style: {
          theme: 'white-purple-trend',
          fontFamily: 'Noto Sans CJK SC',
          size: 44,
          color: '#FFFFFF',
          highlightColor: '#A855F7',
          stroke: '#000000',
          strokeWidth: 2.2,
          background: '#A855F773',
          weight: 800,
          lineChars: 14,
          marginBottom: 76,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: 'H 白紫潮流',
          accent: '#A855F7',
          background: '#1E1B4B',
          panel: '#312E81',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#A855F773',
          badge: 'H',
          previewText: ['紫色高亮更年轻', '适合创作者与 AI 内容'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: 'H 白紫潮流',
          accent: '#C084FC',
          background: '#111827',
          panel: '#4C1D95',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#000000',
          subtitleBackground: '#A855F773',
          badge: 'Trend',
          previewText: ['潮流视觉辨识度高', '中短视频口播常用'],
        }),
      },
      {
        id: 'rec-subtitle-i-cyan-white-fresh',
        name: 'I 青白清爽',
        style: {
          theme: 'cyan-white-fresh',
          fontFamily: 'Noto Sans CJK SC',
          size: 43,
          color: '#EFFFFF',
          highlightColor: '#00D5FF',
          stroke: '#003344',
          strokeWidth: 2.1,
          background: '#00D5FF59',
          weight: 760,
          lineChars: 14,
          marginBottom: 76,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: 'I 青白清爽',
          accent: '#00D5FF',
          background: '#0F172A',
          panel: '#0C4A6E',
          subtitleColor: '#EFFFFF',
          subtitleStroke: '#003344',
          subtitleBackground: '#00D5FF59',
          badge: 'I',
          previewText: ['青白配色更清爽', '教程与测评内容更自然'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: 'I 青白清爽',
          accent: '#22D3EE',
          background: '#0B132B',
          panel: '#155E75',
          subtitleColor: '#EFFFFF',
          subtitleStroke: '#003344',
          subtitleBackground: '#00D5FF59',
          badge: 'Fresh',
          previewText: ['浅科技感不刺眼', '中性场景可读性稳定'],
        }),
      },
      {
        id: 'rec-subtitle-j-white-pink-lifestyle',
        name: 'J 白粉小红书',
        style: {
          theme: 'white-pink-lifestyle',
          fontFamily: 'Noto Sans CJK SC',
          size: 44,
          color: '#FFFFFF',
          highlightColor: '#FF4FA3',
          stroke: '#2A0A18',
          strokeWidth: 2,
          background: '#FF4FA366',
          weight: 780,
          lineChars: 14,
          marginBottom: 74,
          position: 'bottom',
        },
        coverUrl: this.subtitleTemplatePreview({
          title: 'J 白粉小红书',
          accent: '#FF4FA3',
          background: '#FFE4EF',
          panel: '#FBCFE8',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#2A0A18',
          subtitleBackground: '#FF4FA366',
          badge: 'J',
          previewText: ['白粉风格更生活化', '女性向内容更匹配'],
        }),
        previewUrl: this.subtitleTemplatePreview({
          title: 'J 白粉小红书',
          accent: '#EC4899',
          background: '#FCE7F3',
          panel: '#F9A8D4',
          subtitleColor: '#FFFFFF',
          subtitleStroke: '#2A0A18',
          subtitleBackground: '#FF4FA366',
          badge: 'Life',
          previewText: ['小红书视觉感更强', '生活方式内容更友好'],
        }),
      },
    ];

    for (const item of templates) {
      const styleJson = JSON.stringify(item.style);
      const existing = await this.findRow(
        'subtitle_template_resources',
        item.id,
      );
      if (existing) {
        await this.db.execute(
          `UPDATE subtitle_template_resources
           SET name = ?, is_recommended = 1, cover_url = ?, preview_url = ?, style_json = ?, updated_at = ?
           WHERE id = ?`,
          [item.name, item.coverUrl, item.previewUrl, styleJson, now, item.id],
        );
        continue;
      }
      await this.db.execute(
        `INSERT INTO subtitle_template_resources
         (id, user_id, name, is_recommended, cover_url, preview_url, style_json, created_at, updated_at)
         VALUES (?, NULL, ?, 1, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.name,
          item.coverUrl,
          item.previewUrl,
          styleJson,
          now,
          now,
        ],
      );
    }
  }

  private subtitleTemplatePreview(params: {
    title: string;
    accent: string;
    background: string;
    panel: string;
    subtitleColor: string;
    subtitleStroke: string;
    subtitleBackground: string;
    badge: string;
    previewText: [string, string];
  }): string {
    const key = createHash('sha1')
      .update(JSON.stringify(params))
      .digest('hex')
      .slice(0, 16);
    return this.buildTemplatePreviewFallbackUrl(key, 'cover');
  }

  private buildTemplatePreviewFallbackUrl(
    templateId: string,
    variant: 'cover' | 'preview',
  ): string {
    const base = this.resolveTemplatePreviewBaseUrl();
    const safeId = templateId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-');
    return `${base}/subtitle-template-${safeId}-${variant}.png`;
  }

  private resolveTemplatePreviewBaseUrl(): string {
    const configured =
      this.config.get<string>('PUBLIC_TEMPLATE_PREVIEW_BASE_URL')?.trim() ||
      this.config.get<string>('TEMPLATE_PREVIEW_BASE_URL')?.trim() ||
      '/template-previews';
    return configured.replace(/\/+$/, '');
  }

  private sanitizeTemplateAssetUrl(
    value: string | null | undefined,
    fallback: string,
  ): string {
    const text = value?.trim();
    if (!text) return fallback;
    const normalized = text.toLowerCase();
    if (
      normalized.startsWith('data:') ||
      normalized.startsWith('javascript:') ||
      normalized.startsWith('blob:')
    ) {
      return fallback;
    }
    if (text.length > 2000) {
      return fallback;
    }
    return text;
  }

  private optionalNumber(value: unknown): number | null {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  private parseSignedUploadPurpose(value: unknown): UploadPurpose {
    if (typeof value !== 'string') {
      throw new BadRequestException('purpose is required');
    }
    const normalized = value.trim() as UploadPurpose;
    if (!SIGNED_UPLOAD_PURPOSES.includes(normalized)) {
      throw new BadRequestException('purpose is invalid');
    }
    return normalized;
  }

  private normalizeUploadContentType(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException('contentType is required');
    }
    return value.split(';', 1)[0].trim().toLowerCase();
  }

  private parseSignedUploadFileSize(value: unknown): number {
    const fileSize = Number(value);
    if (!Number.isInteger(fileSize) || fileSize <= 0) {
      throw new BadRequestException('fileSize must be a positive integer');
    }
    return fileSize;
  }

  private resolveSignedUploadExtension(
    contentType: string,
    fileName: string | null,
    extensionByMime: Record<string, string>,
  ): string {
    const defaultExt = extensionByMime[contentType];
    if (!defaultExt) {
      throw new BadRequestException('contentType is invalid');
    }
    if (!fileName) return defaultExt;
    const ext = path.extname(fileName).toLowerCase();
    if (!ext) return defaultExt;
    const allowed = new Set(Object.values(extensionByMime));
    if (!allowed.has(ext)) {
      throw new BadRequestException(
        'fileName extension does not match purpose',
      );
    }
    return ext;
  }

  private buildSignedUploadObjectKey(
    userId: string,
    purpose: UploadPurpose,
    uploadId: string,
    ext: string,
  ): string {
    const prefix =
      this.config.get<string>('ALI_OSS_UPLOAD_PREFIX')?.trim() ||
      this.config.get<string>('OSS_UPLOAD_PREFIX')?.trim() ||
      'runtime-assets';
    const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
    const date = new Date().toISOString().slice(0, 10);
    return `${normalizedPrefix}/${purpose}/${userId}/${date}/${uploadId}${ext}`;
  }

  private signedUploadTtlSeconds(): number {
    const raw = Number(
      this.config.get<string>('OSS_SIGNED_UPLOAD_TTL_SECONDS'),
    );
    if (!Number.isFinite(raw) || raw <= 0) {
      return DEFAULT_SIGNED_UPLOAD_TTL_SECONDS;
    }
    return Math.min(Math.floor(raw), MAX_SIGNED_UPLOAD_TTL_SECONDS);
  }

  private voiceCloneStatus(value: unknown): 'ready' | 'processing' | 'failed' {
    return value === 'processing' || value === 'failed' ? value : 'ready';
  }

  private toProviderErrorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      500,
    );
  }

  private async validateVoiceSampleBuffer(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<{ durationMs: number }> {
    this.assertVoiceSampleBinarySize(file.size);
    const durationSeconds = await this.ffmpegAudio.probeDurationSeconds({
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
    if (!durationSeconds) {
      throw new BadRequestException(
        '无法识别样本音频时长，请上传 10-15 秒的清晰人声',
      );
    }
    this.assertVoiceSampleDuration(durationSeconds);
    return { durationMs: Math.round(durationSeconds * 1000) };
  }

  private async fetchRemoteVoiceSample(sampleUrl: string): Promise<{
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
    durationMs: number;
  }> {
    let parsed: URL;
    try {
      parsed = new URL(sampleUrl);
    } catch {
      throw new BadRequestException('样本音频 URL 格式无效');
    }
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new BadRequestException('样本音频 URL 只支持 http 或 https');
    }

    const timeoutMs = Number(
      this.config.get('VOICE_SAMPLE_FETCH_TIMEOUT_MS') ?? 120_000,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(sampleUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new BadRequestException(
          `下载样本音频失败：HTTP ${response.status}`,
        );
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      this.assertVoiceSampleBinarySize(buffer.length);
      const originalname =
        path.basename(new URL(response.url || sampleUrl).pathname) ||
        'voice-sample.wav';
      const mimetype = this.normalizeVoiceSampleMimeType(
        response.headers.get('content-type') || '',
        originalname,
      );
      const validation = await this.validateVoiceSampleBuffer({
        buffer,
        originalname,
        mimetype,
        size: buffer.length,
      });
      return {
        buffer,
        originalname,
        mimetype,
        size: buffer.length,
        durationMs: validation.durationMs,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async persistVoiceSample(sample: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
    durationMs: number;
  }): Promise<{ audioUrl: string }> {
    const ext = sanitizeUploadFilename(sample.originalname, '.wav');
    const fileName = `${VOICE_UPLOAD_PREFIX}_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
    if (this.isVoiceSampleOssEnabled()) {
      const key = this.voiceSampleOssObjectKey(fileName);
      await this.getVoiceSampleOssClient().put(key, sample.buffer, {
        headers: {
          'Content-Type': this.normalizeVoiceSampleMimeType(
            sample.mimetype,
            sample.originalname,
          ),
        },
      });
    } else {
      const dir = this.getVoiceSampleDir();
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, fileName), sample.buffer);
    }
    return {
      audioUrl: `/api/v1/resources/voice-files/${encodeURIComponent(fileName)}/stream`,
    };
  }

  private async managedVoiceSampleExists(fileName: string): Promise<boolean> {
    const safeName = this.assertSafeBasename(fileName);
    if (this.isVoiceSampleOssEnabled()) {
      const key = this.voiceSampleOssObjectKey(safeName);
      const client = this.getVoiceSampleOssClient();
      try {
        if (typeof client.head === 'function') {
          await client.head(key);
          return true;
        }
        if (typeof client.getObjectMeta === 'function') {
          await client.getObjectMeta(key);
          return true;
        }
        const object = await this.getVoiceSampleStreamObjectFromOss(safeName);
        const stream = (object as { stream?: Readable }).stream;
        stream?.destroy?.();
        return true;
      } catch {
        return false;
      }
    }
    try {
      const stat = await fs.stat(this.resolveVoiceSamplePathOrThrow(safeName));
      return stat.isFile();
    } catch {
      return false;
    }
  }

  private async assertAvatarVideoSourceOwnership(
    userId: string,
    originalVideoUrl: string | null,
  ): Promise<void> {
    if (!originalVideoUrl) return;
    if (
      /^https?:\/\//i.test(originalVideoUrl) ||
      /^data:/i.test(originalVideoUrl)
    ) {
      return;
    }
    const base = this.assertSafeBasename(originalVideoUrl);
    if (!base.startsWith(`${AVATAR_UPLOAD_PREFIX}_`)) {
      throw new ForbiddenException(
        'only avatar upload videos can be reused here',
      );
    }
    const owned = await this.isOwnedAvatarUploadVideoFile(userId, base);
    if (!owned) {
      throw new ForbiddenException(
        'avatar upload video is not owned by current user',
      );
    }
  }

  private async isOwnedAvatarUploadVideoFile(
    userId: string,
    fileName: string,
  ): Promise<boolean> {
    return Boolean(await this.findOwnedAvatarUploadVideoRow(userId, fileName));
  }

  private async findOwnedAvatarUploadVideoRow(
    userId: string,
    fileName: string,
  ): Promise<{ id: string; name: string } | null> {
    return this.db.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM avatar_resources
       WHERE user_id = ? AND source_video_url = ? AND is_recommended = 0
       LIMIT 1`,
      [userId, fileName],
    );
  }

  private guessVideoMime(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const map: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.m4v': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.flv': 'video/x-flv',
      '.mpeg': 'video/mpeg',
      '.mpg': 'video/mpeg',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  private parseHttpRange(
    rangeHeader: string | undefined,
    size: number,
  ): HttpByteRange | null {
    if (!rangeHeader || size <= 0) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) return null;

    const [, startRaw, endRaw] = match;
    if (!startRaw && !endRaw) return null;

    let start: number;
    let end: number;
    if (!startRaw) {
      const suffixLength = Number(endRaw);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(startRaw);
      end = endRaw ? Number(endRaw) : size - 1;
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      return null;
    }

    return { start, end: Math.min(end, size - 1) };
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private normalizeVoiceAudioUrl(value: unknown): string {
    const url = this.optionalString(value);
    if (!url || url === LEGACY_PLACEHOLDER_AUDIO_URL) {
      return this.placeholderAudio();
    }
    return url;
  }

  private assertAvatarVideoFile(file: {
    mimetype: string;
    originalname: string;
    size: number;
  }) {
    if (!file?.size) {
      throw new BadRequestException('请上传数字人视频文件');
    }
    const mt = (file.mimetype || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    if (!mt.startsWith('video/') && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(name)) {
      throw new BadRequestException(
        '仅支持上传常见视频文件（mp4、mov、webm、mkv 等）',
      );
    }
  }

  private async validateAvatarVideoDuration(file: {
    buffer?: Buffer;
    path?: string;
    originalname: string;
    mimetype?: string;
  }): Promise<void> {
    const durationSeconds = file.path
      ? await this.ffmpegAudio.probeFileDurationSeconds(file.path)
      : file.buffer?.length
        ? await this.ffmpegAudio.probeDurationSeconds({
            buffer: file.buffer,
            originalname: file.originalname,
            mimetype: file.mimetype,
          })
        : null;
    if (
      !durationSeconds ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0
    ) {
      throw new BadRequestException(
        '无法识别数字人视频时长，请上传可正常播放的视频文件',
      );
    }
    if (
      durationSeconds >
      AVATAR_VIDEO_MAX_SECONDS + AVATAR_VIDEO_DURATION_TOLERANCE_SECONDS
    ) {
      throw new BadRequestException(
        '数字人视频最长支持 10 分钟，请重新选择更短的视频',
      );
    }
  }

  private assertVoiceSampleFile(file: {
    mimetype: string;
    originalname: string;
    size: number;
  }) {
    if (!file?.size) {
      throw new BadRequestException('请上传音频样本');
    }
    const mt = (file.mimetype || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    if (
      !mt.startsWith('audio/') &&
      !/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(name)
    ) {
      throw new BadRequestException(
        '仅支持上传常见音频文件（mp3、wav、m4a、aac、ogg 等）',
      );
    }
    this.assertVoiceSampleBinarySize(file.size);
  }

  private assertVoiceSampleBinarySize(size: number) {
    if (size > VOICE_SAMPLE_MAX_BYTES) {
      throw new BadRequestException('声音克隆样本不能超过 10MB');
    }
  }

  private assertVoiceSampleDuration(durationSeconds: number) {
    const min =
      VOICE_SAMPLE_MIN_SECONDS - VOICE_SAMPLE_DURATION_TOLERANCE_SECONDS;
    const max =
      VOICE_SAMPLE_MAX_SECONDS + VOICE_SAMPLE_DURATION_TOLERANCE_SECONDS;
    if (durationSeconds > max) {
      throw new BadRequestException(
        `音频素材请控制在 15 秒以内，当前约 ${durationSeconds.toFixed(1)} 秒`,
      );
    }
    if (durationSeconds < min || durationSeconds > max) {
      throw new BadRequestException(
        `声音克隆样本建议控制在 10-15 秒之间，当前约 ${durationSeconds.toFixed(
          1,
        )} 秒`,
      );
    }
  }

  private normalizeVoiceSampleMimeType(
    mimetype: string,
    originalname: string,
  ): string {
    const mt = mimetype.split(';', 1)[0].trim().toLowerCase();
    if (mt.startsWith('audio/')) {
      return mt;
    }

    const ext = path.extname(originalname).toLowerCase();
    const map: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.webm': 'audio/webm',
    };
    return map[ext] ?? 'audio/wav';
  }

  private getVideoSaveDir(): string {
    return resolveConfiguredDir(
      this.config.get<string>('VIDEO_SAVE_DIR'),
      'download-video',
    );
  }

  private getVoiceSampleDir(): string {
    return resolveConfiguredDir(
      this.config.get<string>('VOICE_SAMPLE_DIR'),
      'voice-samples',
    );
  }

  private isVoiceSampleOssEnabled(): boolean {
    const mode =
      this.config.get<string>('VOICE_SAMPLE_STORAGE')?.trim().toLowerCase() ||
      'local';
    return mode === 'oss';
  }

  private voiceSampleOssObjectKey(fileName: string): string {
    const prefix =
      this.config.get<string>('VOICE_SAMPLE_OSS_PREFIX')?.trim() ||
      'voice-samples';
    return `${prefix.replace(/^\/+|\/+$/g, '')}/${fileName}`;
  }

  private getVoiceSampleOssClient() {
    if (this.voiceSampleOssClient) return this.voiceSampleOssClient;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const OSS = require('ali-oss') as new (
      options: Record<string, unknown>,
    ) => OssClient;
    const accessKeyId = this.config
      .get<string>('ALI_OSS_ACCESS_KEY_ID')
      ?.trim();
    const accessKeySecret = this.config
      .get<string>('ALI_OSS_ACCESS_KEY_SECRET')
      ?.trim();
    const bucket = this.config.get<string>('ALI_OSS_BUCKET')?.trim();
    const endpoint = this.config.get<string>('ALI_OSS_ENDPOINT')?.trim();
    const region = this.config.get<string>('ALI_OSS_REGION')?.trim();
    if (!accessKeyId || !accessKeySecret || !bucket) {
      throw new BadRequestException(
        'VOICE_SAMPLE_STORAGE=oss requires ALI_OSS_ACCESS_KEY_ID/ALI_OSS_ACCESS_KEY_SECRET/ALI_OSS_BUCKET',
      );
    }
    this.voiceSampleOssClient = new OSS({
      accessKeyId,
      accessKeySecret,
      bucket,
      ...(endpoint ? { endpoint } : {}),
      ...(region ? { region } : {}),
    });
    if (typeof this.voiceSampleOssClient.signatureUrl !== 'function') {
      throw new BadRequestException('ali-oss signatureUrl is not available');
    }
    return this.voiceSampleOssClient;
  }

  private async getVoiceSampleStreamObjectFromOss(fileName: string) {
    const key = this.voiceSampleOssObjectKey(fileName);
    const client = this.getVoiceSampleOssClient();
    if (typeof client.getStream === 'function') {
      return client.getStream(key);
    }
    return client.get(key);
  }

  private toReadable(content: unknown): Readable {
    if (content && typeof (content as Readable).pipe === 'function') {
      return content as Readable;
    }
    if (Buffer.isBuffer(content)) return Readable.from(content);
    if (content instanceof Uint8Array)
      return Readable.from(Buffer.from(content));
    if (typeof content === 'string') return Readable.from(Buffer.from(content));
    throw new BadRequestException('invalid OSS voice sample stream');
  }

  private headerString(
    headers: Record<string, string | string[] | undefined> | undefined,
    name: string,
  ): string | undefined {
    if (!headers) return undefined;
    const lowerName = name.toLowerCase();
    const value =
      headers[name] ??
      headers[lowerName] ??
      Object.entries(headers).find(
        ([key]) => key.toLowerCase() === lowerName,
      )?.[1];
    if (Array.isArray(value)) return value[0];
    return value;
  }

  private headerNumber(
    headers: Record<string, string | string[] | undefined> | undefined,
    name: string,
  ): number | undefined {
    const value = this.headerString(headers, name);
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }

  private assertSafeBasename(name: string): string {
    const trimmed = name.trim();
    const base = path.basename(trimmed);
    if (
      !trimmed ||
      base !== trimmed ||
      /[\\/]/.test(trimmed) ||
      trimmed.includes('..')
    ) {
      throw new BadRequestException('文件名不合法');
    }
    return base;
  }

  private extractManagedVoiceSampleName(
    audioUrl?: string | null,
  ): string | null {
    const value = audioUrl?.trim();
    if (!value) return null;
    const match = value.match(/\/voice-files\/([^/]+)\/stream$/);
    if (!match?.[1]) return null;
    const decoded = decodeURIComponent(match[1]);
    return decoded.startsWith(VOICE_UPLOAD_PREFIX) ? decoded : null;
  }

  private avatarVideoPreviewSecret(): string {
    return (
      this.config.get<string>('AVATAR_VIDEO_STREAM_SECRET')?.trim() ||
      this.config.get<string>('VOICE_PROVIDER_STREAM_SECRET')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim() ||
      ''
    );
  }

  private avatarVideoPreviewTtlSeconds(): number {
    const raw = Number(
      this.config.get<string>('AVATAR_VIDEO_STREAM_TTL_SECONDS') ?? '',
    );
    if (Number.isFinite(raw) && raw > 0) {
      return Math.min(Math.floor(raw), 24 * 60 * 60);
    }
    return AVATAR_VIDEO_PREVIEW_TTL_SECONDS;
  }

  private signAvatarVideoPreviewToken(
    userId: string,
    fileName: string,
    expires: string,
    purpose: 'stream' | 'metadata',
    secret: string,
  ): string {
    return createHmac('sha256', secret)
      .update(`${purpose}:${userId}:${fileName}:${expires}`)
      .digest('hex');
  }

  private createSignedAvatarVideoPreviewUrls(
    userId: string,
    fileName: string,
  ): {
    previewUrl: string;
    metadataUrl: string;
  } {
    const safeFileName = this.assertSafeBasename(fileName);
    const encoded = encodeURIComponent(safeFileName);
    const secret = this.avatarVideoPreviewSecret();
    const expires = String(
      Date.now() + this.avatarVideoPreviewTtlSeconds() * 1000,
    );
    const streamToken = this.signAvatarVideoPreviewToken(
      userId,
      safeFileName,
      expires,
      'stream',
      secret,
    );
    const metadataToken = this.signAvatarVideoPreviewToken(
      userId,
      safeFileName,
      expires,
      'metadata',
      secret,
    );
    return {
      previewUrl: `/api/v1/resources/avatar-video-files/${encoded}/preview-stream?expires=${encodeURIComponent(expires)}&token=${streamToken}`,
      metadataUrl: `/api/v1/resources/avatar-video-files/${encoded}/preview-metadata?expires=${encodeURIComponent(expires)}&token=${metadataToken}`,
    };
  }

  private async assertSignedAvatarVideoToken(
    fileName: string,
    token: string | undefined,
    expires: string | undefined,
    purpose: 'stream' | 'metadata',
  ): Promise<{ userId: string; fileName: string }> {
    const safeFileName = this.assertSafeBasename(fileName);
    const secret = this.avatarVideoPreviewSecret();
    if (!secret || !token || !expires) {
      throw new ForbiddenException('avatar preview token invalid');
    }
    if (!this.isStrictSha256HexToken(token)) {
      throw new ForbiddenException('avatar preview token invalid');
    }
    const expiresMs = Number(expires);
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
      throw new ForbiddenException('avatar preview token expired');
    }

    const rows = await this.db.queryAll<{ id: string }>(
      `SELECT user_id AS id FROM avatar_resources
       WHERE source_video_url = ? AND is_recommended = 0 AND user_id IS NOT NULL`,
      [safeFileName],
    );
    for (const row of rows) {
      if (!row.id) continue;
      const expected = this.signAvatarVideoPreviewToken(
        row.id,
        safeFileName,
        expires,
        purpose,
        secret,
      );
      if (!this.isStrictSha256HexToken(expected)) {
        continue;
      }
      const actualBuffer = Buffer.from(token, 'hex');
      const expectedBuffer = Buffer.from(expected, 'hex');
      if (
        actualBuffer.length === expectedBuffer.length &&
        timingSafeEqual(actualBuffer, expectedBuffer)
      ) {
        return { userId: row.id, fileName: safeFileName };
      }
    }
    throw new ForbiddenException('avatar preview token invalid');
  }

  private resolveAvatarPreviewUrls(
    row: ResourceRow,
    userId: string,
  ): { previewUrl: string | null; metadataUrl: string | null } {
    const source = row.source_video_url?.trim();
    if (!source) {
      return { previewUrl: null, metadataUrl: null };
    }
    if (
      row.user_id === userId &&
      source.startsWith(`${AVATAR_UPLOAD_PREFIX}_`) &&
      !/^https?:\/\//i.test(source) &&
      !/^data:/i.test(source)
    ) {
      return this.createSignedAvatarVideoPreviewUrls(userId, source);
    }
    if (/^https?:\/\//i.test(source) || /^data:/i.test(source)) {
      return { previewUrl: source, metadataUrl: null };
    }
    return { previewUrl: null, metadataUrl: null };
  }

  private buildProviderVoiceSampleUrl(audioUrl?: string | null): string | null {
    const fileName = this.extractManagedVoiceSampleName(audioUrl);
    const baseUrl = this.config.get<string>('PUBLIC_BASE_URL')?.trim();
    const secret = this.providerVoiceSampleSecret();
    if (!fileName || !baseUrl || !secret) return null;

    const expires = String(Date.now() + 15 * 60_000);
    const token = this.signProviderVoiceSample(fileName, expires, secret);
    const base = baseUrl.replace(/\/+$/, '');
    const encoded = encodeURIComponent(fileName);
    return `${base}/api/v1/resources/voice-files/${encoded}/provider-stream?expires=${expires}&token=${token}`;
  }

  private providerVoiceSampleSecret(): string {
    return (
      this.config.get<string>('VOICE_PROVIDER_STREAM_SECRET')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim() ||
      this.config.get<string>('DASHSCOPE_API_KEY')?.trim() ||
      ''
    );
  }

  private signProviderVoiceSample(
    fileName: string,
    expires: string,
    secret: string,
  ): string {
    return createHmac('sha256', secret)
      .update(`${fileName}:${expires}`)
      .digest('hex');
  }

  private assertProviderVoiceSampleToken(
    fileName: string,
    token?: string,
    expires?: string,
  ): void {
    const secret = this.providerVoiceSampleSecret();
    if (!secret || !token || !expires) {
      throw new ForbiddenException('音频样本访问令牌无效');
    }
    if (!this.isStrictSha256HexToken(token)) {
      throw new ForbiddenException('闊抽鏍锋湰璁块棶浠ょ墝鏃犳晥');
    }
    const expiresMs = Number(expires);
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
      throw new ForbiddenException('音频样本访问令牌已过期');
    }
    const expected = this.signProviderVoiceSample(fileName, expires, secret);
    if (!this.isStrictSha256HexToken(expected)) {
      throw new ForbiddenException('闊抽鏍锋湰璁块棶浠ょ墝鏃犳晥');
    }
    const actualBuffer = Buffer.from(token, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException('音频样本访问令牌无效');
    }
  }

  private isStrictSha256HexToken(token: string): boolean {
    return /^[0-9a-fA-F]{64}$/.test(token);
  }

  private extractManagedAvatarVideoName(
    sourceVideoUrl?: string | null,
  ): string | null {
    const value = sourceVideoUrl?.trim();
    if (!value || /^https?:\/\//i.test(value) || /^data:/i.test(value))
      return null;
    const base = path.basename(value);
    return base.startsWith(AVATAR_UPLOAD_PREFIX) ? base : null;
  }

  private stylePayload(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { color: '#ffffff', stroke: '#111827', size: 42 };
  }

  private styleConfigToStyleJson(
    value: unknown,
  ): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const subtitle = (value as Record<string, unknown>).subtitle;
    if (!subtitle || typeof subtitle !== 'object' || Array.isArray(subtitle)) {
      return null;
    }
    const style = (subtitle as Record<string, unknown>).style;
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      return null;
    }
    return style as Record<string, unknown>;
  }

  private styleConfigPayload(
    value: unknown,
    fallbackStyleJson: Record<string, unknown>,
  ): Record<string, unknown> {
    const styleJson = this.stylePayload(
      this.styleConfigToStyleJson(value) ?? fallbackStyleJson,
    );
    const config =
      value && typeof value === 'object' && !Array.isArray(value)
        ? ({ ...(value as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    const subtitleValue = config.subtitle;
    const subtitle =
      subtitleValue &&
      typeof subtitleValue === 'object' &&
      !Array.isArray(subtitleValue)
        ? ({ ...(subtitleValue as Record<string, unknown>) } as Record<
            string,
            unknown
          >)
        : {};
    subtitle.style = styleJson;
    config.subtitle = subtitle;
    if (
      typeof config.aspectRatio !== 'string' ||
      config.aspectRatio.trim().length === 0
    ) {
      config.aspectRatio = '9:16';
    }
    return config;
  }

  private parseStyle(value?: string | null): Record<string, unknown> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private placeholder(kind: string): string {
    return `https://placehold.co/720x960/f7f8fb/111827?text=${encodeURIComponent(kind)}`;
  }

  private placeholderAudio(): string {
    return EMPTY_VOICE_AUDIO_URL;
  }
}
