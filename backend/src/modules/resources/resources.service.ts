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
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
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
  SubtitleTemplateResourceDto,
  VoiceResourceDto,
} from './resources.types';

type ResourceTable =
  | 'avatar_resources'
  | 'voice_resources'
  | 'subtitle_template_resources';
type HttpByteRange = { start: number; end: number };

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
  private voiceSampleOssClient: {
    put: (...args: unknown[]) => Promise<unknown>;
    get: (...args: unknown[]) => Promise<unknown>;
    getStream?: (...args: unknown[]) => Promise<unknown>;
    delete: (...args: unknown[]) => Promise<unknown>;
  } | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly qwenVoiceClone: QwenVoiceCloneService,
    private readonly ffmpegAudio: FfmpegAudioService,
  ) {}

  onModuleInit() {
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
    await this.ensureSeeded();
    const page = await this.listRows('avatar_resources', userId, opts);
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
    const page = await this.listRows('voice_resources', userId, opts);
    return {
      ...page,
      items: page.items.map((row) => this.toVoice(row, userId)),
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
      result.push({
        avatarId: row.id,
        avatarName: row.name,
        fileName,
        fileSize: stat.size,
        mimeType: this.guessVideoMime(fileName),
        mtime: new Date(stat.mtimeMs).toISOString(),
        previewUrl: `/api/v1/resources/avatar-video-files/${encodeURIComponent(fileName)}/stream`,
        metadataUrl: `/api/v1/resources/avatar-video-files/${encodeURIComponent(fileName)}/metadata`,
      });
      if (result.length >= limit) break;
    }
    return result;
  }

  async getAvatar(userId: string, id: string) {
    await this.ensureSeeded();
    const row = await this.findRow('avatar_resources', id);
    if (!row) throw new NotFoundException('视频资源不存在');
    if (row.user_id && row.user_id !== userId) {
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
      expires_at: this.expiresAtFrom(now),
      created_at: now,
      updated_at: now,
    };
    await this.db.execute(
      `INSERT INTO avatar_resources
       (id, user_id, name, is_recommended, cover_url, source_video_url, style_id, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.name,
        row.is_recommended,
        row.cover_url,
        row.source_video_url,
        row.style_id,
        row.expires_at,
        row.created_at,
        row.updated_at,
      ],
    );
    return this.toAvatar(row, userId);
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
    this.assertMutableResourceTable('subtitle_template_resources');
    const now = nowIso();
    const styleJson = this.stylePayload(body.styleJson);
    const row: ResourceRow = {
      id: randomUUID(),
      user_id: userId,
      name: trimName(body.name, '我的字幕模板'),
      is_recommended: 0,
      cover_url:
        this.optionalString(body.coverUrl) || this.placeholder('subtitle'),
      preview_url:
        this.optionalString(body.previewCoverUrl) ||
        this.placeholder('subtitle-alt'),
      style_json: JSON.stringify(styleJson),
      created_at: now,
      updated_at: now,
    };
    await this.db.execute(
      `INSERT INTO subtitle_template_resources
       (id, user_id, name, is_recommended, cover_url, preview_url, style_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.name,
        row.is_recommended,
        row.cover_url,
        row.preview_url,
        row.style_json,
        row.created_at,
        row.updated_at,
      ],
    );
    return this.toSubtitle(row, userId);
  }

  async copySubtitleTemplate(userId: string, id: string) {
    this.assertMutableResourceTable('subtitle_template_resources');
    const row = await this.findRow('subtitle_template_resources', id);
    if (!row) throw new NotFoundException('字幕模板不存在');
    const now = nowIso();
    const next: ResourceRow = {
      ...row,
      id: randomUUID(),
      user_id: userId,
      name: `${row.name} 副本`.slice(0, 80),
      is_recommended: 0,
      created_at: now,
      updated_at: now,
    };
    await this.db.execute(
      `INSERT INTO subtitle_template_resources
       (id, user_id, name, is_recommended, cover_url, preview_url, style_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        next.id,
        next.user_id,
        next.name,
        next.is_recommended,
        next.cover_url,
        next.preview_url,
        next.style_json,
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
    this.assertMutableResourceTable('subtitle_template_resources');
    const row = await this.assertOwned(
      'subtitle_template_resources',
      userId,
      id,
    );
    const name = trimName(body.name, row.name);
    const styleJson =
      body.styleJson &&
      typeof body.styleJson === 'object' &&
      !Array.isArray(body.styleJson)
        ? JSON.stringify(body.styleJson)
        : row.style_json || '{}';
    const coverUrl =
      this.optionalString(body.coverUrl) ||
      row.cover_url ||
      this.placeholder('subtitle');
    const previewUrl =
      this.optionalString(body.previewCoverUrl) ||
      row.preview_url ||
      row.cover_url ||
      this.placeholder('subtitle-alt');
    const updatedAt = nowIso();
    await this.db.execute(
      `UPDATE subtitle_template_resources
       SET name = ?, cover_url = ?, preview_url = ?, style_json = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [name, coverUrl, previewUrl, styleJson, updatedAt, id, userId],
    );
    return this.toSubtitle(
      {
        ...row,
        name,
        cover_url: coverUrl,
        preview_url: previewUrl,
        style_json: styleJson,
        updated_at: updatedAt,
      },
      userId,
    );
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
        previewUrl: `/api/v1/resources/avatar-video-files/${encodeURIComponent(base)}/stream`,
        metadataUrl: `/api/v1/resources/avatar-video-files/${encodeURIComponent(base)}/metadata`,
      };
    } catch {
      throw new NotFoundException('avatar upload video not found');
    }
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

  private async deleteRetiredRecommendedVoices() {
    for (const id of RETIRED_RECOMMENDED_VOICE_IDS) {
      await this.db.execute(
        `DELETE FROM voice_resources WHERE id = ? AND user_id IS NULL AND is_recommended = 1`,
        [id],
      );
    }
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
    return {
      id: row.id,
      name: row.name,
      owner: row.user_id === userId ? 'mine' : 'recommended',
      recommended: row.is_recommended === 1,
      coverUrl: row.cover_url || this.placeholder('avatar'),
      originalVideoUrl: row.source_video_url || null,
      renderMode: 'source-video',
      canUseForRender: renderState.canUseForRender,
      renderUnavailableReason: renderState.renderUnavailableReason,
      styleId: row.style_id || null,
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
    return {
      id: row.id,
      name: row.name,
      owner: row.user_id === userId ? 'mine' : 'recommended',
      recommended: row.is_recommended === 1,
      coverUrl: row.cover_url || this.placeholder('subtitle'),
      previewCoverUrl:
        row.preview_url || row.cover_url || this.placeholder('subtitle-alt'),
      styleJson: this.parseStyle(row.style_json),
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
    await this.deleteRetiredRecommendedVoices();
    await this.upsertRecommendedDesignedVoices(now);
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

  private async upsertRecommendedDesignedVoices(now: string) {
    for (const item of RECOMMENDED_DESIGNED_VOICES) {
      const audioUrl = (await this.hasLocalVoiceSample(item.fileName))
        ? this.voiceSampleStreamUrl(item.fileName)
        : this.placeholderAudio();
      const existing = await this.findRow('voice_resources', item.id);
      if (existing) {
        await this.db.execute(
          `UPDATE voice_resources
           SET user_id = NULL, name = ?, is_recommended = 1, audio_url = ?, clone_status = 'ready',
               provider = 'aliyun-qwen-vd', provider_voice = ?, provider_model = ?,
               sample_duration_ms = NULL, clone_error = NULL, updated_at = ?
           WHERE id = ?`,
          [
            item.name,
            audioUrl,
            item.providerVoice,
            item.providerModel,
            now,
            item.id,
          ],
        );
        continue;
      }

      await this.db.execute(
        `INSERT INTO voice_resources
         (id, user_id, name, is_recommended, audio_url, clone_status, provider, provider_voice, provider_model, sample_duration_ms, clone_error, created_at, updated_at)
         VALUES (?, NULL, ?, 1, ?, 'ready', 'aliyun-qwen-vd', ?, ?, NULL, NULL, ?, ?)`,
        [
          item.id,
          item.name,
          audioUrl,
          item.providerVoice,
          item.providerModel,
          now,
          now,
        ],
      );
    }
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
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
        <defs>
          <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${params.background}" />
            <stop offset="100%" stop-color="${params.panel}" />
          </linearGradient>
          <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="${params.accent}" />
            <stop offset="100%" stop-color="#ffffff" stop-opacity="0.2" />
          </linearGradient>
        </defs>
        <rect width="800" height="500" rx="36" fill="url(#bg)" />
        <circle cx="654" cy="88" r="116" fill="${params.accent}" fill-opacity="0.16" />
        <circle cx="132" cy="402" r="96" fill="${params.accent}" fill-opacity="0.12" />
        <rect x="54" y="54" width="214" height="42" rx="21" fill="url(#accent)" />
        <text x="86" y="82" fill="#0f172a" font-size="22" font-family="Noto Sans CJK SC, Noto Sans SC, Arial, sans-serif" font-weight="700">${params.badge}</text>
        <text x="58" y="144" fill="#0f172a" font-size="44" font-family="Noto Sans CJK SC, Noto Sans SC, Arial, sans-serif" font-weight="800">${params.title}</text>
        <text x="58" y="188" fill="#47607b" font-size="20" font-family="Noto Sans CJK SC, Noto Sans SC, Arial, sans-serif">Subtitle Template Demo</text>
        <rect x="76" y="322" width="648" height="118" rx="30" fill="${params.subtitleBackground}" />
        <text x="400" y="374"
              fill="${params.subtitleColor}"
              stroke="${params.subtitleStroke}"
              stroke-width="3"
              paint-order="stroke"
              text-anchor="middle"
              font-size="40"
              font-family="Noto Sans CJK SC, Noto Sans SC, Arial, sans-serif"
              font-weight="700">${params.previewText[0]}</text>
        <text x="400" y="418"
              fill="${params.subtitleColor}"
              stroke="${params.subtitleStroke}"
              stroke-width="3"
              paint-order="stroke"
              text-anchor="middle"
              font-size="30"
              font-family="Noto Sans CJK SC, Noto Sans SC, Arial, sans-serif"
              font-weight="600">${params.previewText[1]}</text>
      </svg>
    `.trim();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  private optionalNumber(value: unknown): number | null {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
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

  private async removeVoiceSampleByUrl(
    audioUrl?: string | null,
  ): Promise<void> {
    const fileName = this.extractManagedVoiceSampleName(audioUrl);
    if (!fileName) return;
    if (this.isVoiceSampleOssEnabled()) {
      const key = this.voiceSampleOssObjectKey(fileName);
      await this.getVoiceSampleOssClient()
        .delete(key)
        .catch(() => undefined);
      return;
    }
    const full = this.resolveVoiceSamplePathOrThrow(fileName);
    await fs.rm(full, { force: true }).catch(() => undefined);
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

  private async normalizeLegacyVoiceAudioUrls(): Promise<void> {
    await this.db.execute(
      `UPDATE voice_resources SET audio_url = NULL WHERE audio_url = ?`,
      [LEGACY_PLACEHOLDER_AUDIO_URL],
    );
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
    ) => {
      put: (...args: unknown[]) => Promise<unknown>;
      get: (...args: unknown[]) => Promise<unknown>;
      getStream?: (...args: unknown[]) => Promise<unknown>;
      delete: (...args: unknown[]) => Promise<unknown>;
    };
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
    const expiresMs = Number(expires);
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
      throw new ForbiddenException('音频样本访问令牌已过期');
    }
    const expected = this.signProviderVoiceSample(fileName, expires, secret);
    const actualBuffer = Buffer.from(token, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException('音频样本访问令牌无效');
    }
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
