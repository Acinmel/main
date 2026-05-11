import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseService } from '../../database/database.service';
import { QwenVoiceCloneService } from '../../integrations/ai/qwen-voice-clone.service';
import { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import type {
  AvatarResourceDto,
  CursorPage,
  ResourceRow,
  ResourceScope,
  SubtitleTemplateResourceDto,
  VoiceResourceDto,
} from './resources.types';

type ResourceTable = 'avatar_resources' | 'voice_resources' | 'subtitle_template_resources';

const PAGE_LIMIT_MAX = 40;
const AVATAR_UPLOAD_PREFIX = 'avatar-upload';
const VOICE_UPLOAD_PREFIX = 'voice-sample';
const VOICE_SAMPLE_MAX_BYTES = 10 * 1024 * 1024;
const VOICE_SAMPLE_MIN_SECONDS = 10;
const VOICE_SAMPLE_MAX_SECONDS = 15;
const VOICE_SAMPLE_DURATION_TOLERANCE_SECONDS = 0.5;
const RECOMMENDED_DESIGNED_VOICES = [
  {
    id: 'rec-voice-market-male',
    name: '市井低沙男声',
    fileName: 'rec-voice-market-male.mp3',
    providerVoice: 'qwen-tts-vd-market_male-voice-20260510192748379-0a08',
    providerModel: 'qwen3-tts-vd-2026-01-26',
  },
  {
    id: 'rec-voice-bright-young-female',
    name: '清亮机灵女声',
    fileName: 'rec-voice-bright-young-female.mp3',
    providerVoice: 'qwen-tts-vd-bright_female-voice-20260510192758850-6cdf',
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
  return Buffer.from(JSON.stringify({ u: row.updated_at, i: row.id })).toString('base64url');
}

function decodeCursor(cursor?: string): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const obj = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
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
export class ResourcesService {
  private readonly logger = new Logger(ResourcesService.name);
  private seeded = false;
  private seedPromise: Promise<void> | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly qwenVoiceClone: QwenVoiceCloneService,
    private readonly ffmpegAudio: FfmpegAudioService,
  ) {}

  async listAvatars(userId: string, opts: { scope: ResourceScope; cursor?: string; limit?: number }) {
    await this.ensureSeeded();
    const page = await this.listRows('avatar_resources', userId, opts);
    return { ...page, items: page.items.map((row) => this.toAvatar(row, userId)) };
  }

  async listVoices(userId: string, opts: { scope: ResourceScope; cursor?: string; limit?: number }) {
    await this.ensureSeeded();
    const page = await this.listRows('voice_resources', userId, opts);
    return { ...page, items: page.items.map((row) => this.toVoice(row, userId)) };
  }

  async listSubtitleTemplates(
    userId: string,
    opts: { scope: ResourceScope; cursor?: string; limit?: number },
  ) {
    await this.ensureSeeded();
    const page = await this.listRows('subtitle_template_resources', userId, opts);
    return { ...page, items: page.items.map((row) => this.toSubtitle(row, userId)) };
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
    const row: ResourceRow = {
      id: randomUUID(),
      user_id: userId,
      name: trimName(body.name, '我的数字人'),
      is_recommended: 0,
      cover_url: this.optionalString(body.coverUrl) || this.placeholder('avatar'),
      source_video_url: this.optionalString(body.originalVideoUrl),
      style_id: this.optionalString(body.styleId) || 'custom',
      created_at: now,
      updated_at: now,
    };
    await this.db.execute(
      `INSERT INTO avatar_resources
       (id, user_id, name, is_recommended, cover_url, source_video_url, style_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.name,
        row.is_recommended,
        row.cover_url,
        row.source_video_url,
        row.style_id,
        row.created_at,
        row.updated_at,
      ],
    );
    return this.toAvatar(row, userId);
  }

  async createAvatarFromUpload(
    userId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    body: Record<string, unknown>,
  ) {
    this.assertAvatarVideoFile(file);
    const dir = this.getVideoSaveDir();
    await fs.mkdir(dir, { recursive: true });
    const ext = sanitizeUploadFilename(file.originalname, '.mp4');
    const fileName = `${AVATAR_UPLOAD_PREFIX}_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
    await fs.writeFile(path.join(dir, fileName), file.buffer);
    return this.createAvatar(userId, {
      ...body,
      originalVideoUrl: fileName,
      styleId: this.optionalString(body.styleId) || 'uploaded-video',
    });
  }

  async createVoice(userId: string, body: Record<string, unknown>) {
    const now = nowIso();
    const row: ResourceRow = {
      id: randomUUID(),
      user_id: userId,
      name: trimName(body.name, '我的克隆音色'),
      is_recommended: 0,
      audio_url: this.optionalString(body.audioUrl) || this.placeholderAudio(),
      clone_status: 'ready',
      provider: this.optionalString(body.provider),
      provider_voice: this.optionalString(body.providerVoice),
      provider_model: this.optionalString(body.providerModel),
      sample_duration_ms: this.optionalNumber(body.sampleDurationMs),
      clone_error: this.optionalString(body.cloneError),
      created_at: now,
      updated_at: now,
    };
    await this.db.execute(
      `INSERT INTO voice_resources
       (id, user_id, name, is_recommended, audio_url, clone_status, provider, provider_voice, provider_model, sample_duration_ms, clone_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      await this.removeVoiceSampleByUrl(stored.audioUrl);
      throw error;
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
      const cloned = await this.qwenVoiceClone.createVoiceClone({
        preferredName: trimName(body.name, '鎴戠殑鍏嬮殕闊宠壊'),
        sample: {
          buffer: file.buffer,
          mimeType: this.normalizeVoiceSampleMimeType(file.mimetype, file.originalname),
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
      await this.removeVoiceSampleByUrl(stored.audioUrl);
      throw error;
    }
  }

  async createSubtitleTemplate(userId: string, body: Record<string, unknown>) {
    const now = nowIso();
    const styleJson = this.stylePayload(body.styleJson);
    const row: ResourceRow = {
      id: randomUUID(),
      user_id: userId,
      name: trimName(body.name, '我的字幕模板'),
      is_recommended: 0,
      cover_url: this.optionalString(body.coverUrl) || this.placeholder('subtitle'),
      preview_url: this.optionalString(body.previewCoverUrl) || this.placeholder('subtitle-alt'),
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

  async updateSubtitleTemplate(userId: string, id: string, body: Record<string, unknown>) {
    const row = await this.assertOwned('subtitle_template_resources', userId, id);
    const name = trimName(body.name, row.name);
    const styleJson =
      body.styleJson && typeof body.styleJson === 'object' && !Array.isArray(body.styleJson)
        ? JSON.stringify(body.styleJson)
        : row.style_json || '{}';
    const coverUrl = this.optionalString(body.coverUrl) || row.cover_url || this.placeholder('subtitle');
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

  async rename(table: ResourceTable, userId: string, id: string, name: unknown) {
    const row = await this.assertOwned(table, userId, id);
    const nextName = trimName(name, row.name);
    const updatedAt = nowIso();
    await this.db.execute(`UPDATE ${table} SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`, [
      nextName,
      updatedAt,
      id,
      userId,
    ]);
    return { id, name: nextName, updatedAt };
  }

  async deleteOne(table: ResourceTable, userId: string, id: string) {
    const row = await this.assertOwned(table, userId, id);
    await this.db.execute(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, [id, userId]);
    await this.cleanupOwnedLocalAsset(table, row);
    return { deletedIds: [id] };
  }

  async deleteMany(table: ResourceTable, userId: string, ids: unknown) {
    const idList = Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (!idList.length) throw new BadRequestException('ids 不能为空');
    const deleted: string[] = [];
    for (const id of idList) {
      const row = await this.findOwnedRow(table, userId, id);
      if (!row) continue;
      await this.db.execute(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, [id, userId]);
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

  private async listRows(
    table: ResourceTable,
    userId: string,
    opts: { scope: ResourceScope; cursor?: string; limit?: number },
  ): Promise<CursorPage<ResourceRow>> {
    const limit = Math.min(Math.max(Number(opts.limit) || 18, 1), PAGE_LIMIT_MAX);
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
      nextCursor: rows.length > limit && items.length ? encodeCursor(items[items.length - 1]) : null,
    };
  }

  private async assertOwned(table: ResourceTable, userId: string, id: string): Promise<ResourceRow> {
    const row = await this.findRow(table, id);
    if (!row) throw new NotFoundException('资源不存在');
    if (row.user_id !== userId) throw new ForbiddenException('只能管理自己的资源');
    return row;
  }

  private async findOwnedRow(table: ResourceTable, userId: string, id: string) {
    return this.db.queryOne<ResourceRow>(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`, [
      id,
      userId,
    ]);
  }

  private async findRow(table: ResourceTable, id: string) {
    return this.db.queryOne<ResourceRow>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  }

  private async cleanupOwnedLocalAsset(table: ResourceTable, row: ResourceRow) {
    if (table !== 'voice_resources') return;
    if (row.provider === 'aliyun-qwen-vc' && row.provider_voice) {
      await this.qwenVoiceClone.deleteVoice(row.provider_voice);
    }
    const fileName = this.extractManagedVoiceSampleName(row.audio_url);
    if (!fileName) return;
    const full = this.resolveVoiceSamplePathOrThrow(fileName);
    await fs.rm(full, { force: true }).catch(() => undefined);
  }

  private toAvatar(row: ResourceRow, userId: string): AvatarResourceDto {
    return {
      id: row.id,
      name: row.name,
      owner: row.user_id === userId ? 'mine' : 'recommended',
      recommended: row.is_recommended === 1,
      coverUrl: row.cover_url || this.placeholder('avatar'),
      originalVideoUrl: row.source_video_url || null,
      styleId: row.style_id || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toVoice(row: ResourceRow, userId: string): VoiceResourceDto {
    const status = row.clone_status === 'processing' || row.clone_status === 'failed' ? row.clone_status : 'ready';
    return {
      id: row.id,
      name: row.name,
      owner: row.user_id === userId ? 'mine' : 'recommended',
      recommended: row.is_recommended === 1,
      audioUrl: row.audio_url || this.placeholderAudio(),
      cloneStatus: status,
      provider: row.provider || null,
      providerVoice: row.provider_voice || null,
      providerModel: row.provider_model || null,
      sampleDurationMs:
        typeof row.sample_duration_ms === 'number' ? row.sample_duration_ms : null,
      cloneError: row.clone_error || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toSubtitle(row: ResourceRow, userId: string): SubtitleTemplateResourceDto {
    return {
      id: row.id,
      name: row.name,
      owner: row.user_id === userId ? 'mine' : 'recommended',
      recommended: row.is_recommended === 1,
      coverUrl: row.cover_url || this.placeholder('subtitle'),
      previewCoverUrl: row.preview_url || row.cover_url || this.placeholder('subtitle-alt'),
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
    const voices = [
      ['rec-voice-female', '清亮女声', 'ready'],
      ['rec-voice-male', '磁性男声', 'ready'],
      ['rec-voice-narration', '旁白讲述音', 'ready'],
    ];
    for (const [id, name, status] of voices) {
      if (await this.findRow('voice_resources', id)) continue;
      await this.db.execute(
        `INSERT INTO voice_resources
         (id, user_id, name, is_recommended, audio_url, clone_status, provider, provider_voice, provider_model, sample_duration_ms, clone_error, created_at, updated_at)
         VALUES (?, NULL, ?, 1, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
        [id, name, this.placeholderAudio(), status, now, now],
      );
    }
    await this.upsertRecommendedDesignedVoices(now);
    const subtitles: [string, string, Record<string, unknown>][] = [
      ['rec-subtitle-minimal', '极简白字', { color: '#ffffff', stroke: '#111827', size: 42 }],
      ['rec-subtitle-yellow', '高对比黄字', { color: '#facc15', stroke: '#111827', size: 44 }],
      ['rec-subtitle-card', '知识卡片字幕', { color: '#111827', background: '#ffffff', size: 38 }],
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
          [item.name, audioUrl, item.providerVoice, item.providerModel, now, item.id],
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
    const full = path.join(this.getVoiceSampleDir(), this.assertSafeBasename(fileName));
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
          fontFamily: 'Microsoft YaHei',
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
          fontFamily: 'Microsoft YaHei',
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
          fontFamily: 'Microsoft YaHei',
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
          fontFamily: 'Microsoft YaHei',
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
      const existing = await this.findRow('subtitle_template_resources', item.id);
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
        [item.id, item.name, item.coverUrl, item.previewUrl, styleJson, now, now],
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
        <text x="86" y="82" fill="#0f172a" font-size="22" font-family="Microsoft YaHei, Arial, sans-serif" font-weight="700">${params.badge}</text>
        <text x="58" y="144" fill="#0f172a" font-size="44" font-family="Microsoft YaHei, Arial, sans-serif" font-weight="800">${params.title}</text>
        <text x="58" y="188" fill="#47607b" font-size="20" font-family="Microsoft YaHei, Arial, sans-serif">Subtitle Template Demo</text>
        <rect x="76" y="322" width="648" height="118" rx="30" fill="${params.subtitleBackground}" />
        <text x="400" y="374"
              fill="${params.subtitleColor}"
              stroke="${params.subtitleStroke}"
              stroke-width="3"
              paint-order="stroke"
              text-anchor="middle"
              font-size="40"
              font-family="Microsoft YaHei, Arial, sans-serif"
              font-weight="700">${params.previewText[0]}</text>
        <text x="400" y="418"
              fill="${params.subtitleColor}"
              stroke="${params.subtitleStroke}"
              stroke-width="3"
              paint-order="stroke"
              text-anchor="middle"
              font-size="30"
              font-family="Microsoft YaHei, Arial, sans-serif"
              font-weight="600">${params.previewText[1]}</text>
      </svg>
    `.trim();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  private optionalNumber(value: unknown): number | null {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
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
    });
    if (!durationSeconds) {
      throw new BadRequestException('无法识别样本音频时长，请上传 10-15 秒的清晰人声');
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

    const timeoutMs = Number(this.config.get('VOICE_SAMPLE_FETCH_TIMEOUT_MS') ?? 120_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(sampleUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new BadRequestException(`下载样本音频失败：HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      this.assertVoiceSampleBinarySize(buffer.length);
      const originalname =
        path.basename(new URL(response.url || sampleUrl).pathname) || 'voice-sample.wav';
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
    const dir = this.getVoiceSampleDir();
    await fs.mkdir(dir, { recursive: true });
    const ext = sanitizeUploadFilename(sample.originalname, '.wav');
    const fileName = `${VOICE_UPLOAD_PREFIX}_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
    await fs.writeFile(path.join(dir, fileName), sample.buffer);
    return {
      audioUrl: `/api/v1/resources/voice-files/${encodeURIComponent(fileName)}/stream`,
    };
  }

  private async removeVoiceSampleByUrl(audioUrl?: string | null): Promise<void> {
    const fileName = this.extractManagedVoiceSampleName(audioUrl);
    if (!fileName) return;
    const full = this.resolveVoiceSamplePathOrThrow(fileName);
    await fs.rm(full, { force: true }).catch(() => undefined);
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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
      throw new BadRequestException('仅支持上传常见视频文件（mp4、mov、webm、mkv 等）');
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
    if (!mt.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(name)) {
      throw new BadRequestException('仅支持上传常见音频文件（mp3、wav、m4a、aac、ogg 等）');
    }
    this.assertVoiceSampleBinarySize(file.size);
  }

  private assertVoiceSampleBinarySize(size: number) {
    if (size > VOICE_SAMPLE_MAX_BYTES) {
      throw new BadRequestException('声音克隆样本不能超过 10MB');
    }
  }

  private assertVoiceSampleDuration(durationSeconds: number) {
    const min = VOICE_SAMPLE_MIN_SECONDS - VOICE_SAMPLE_DURATION_TOLERANCE_SECONDS;
    const max = VOICE_SAMPLE_MAX_SECONDS + VOICE_SAMPLE_DURATION_TOLERANCE_SECONDS;
    if (durationSeconds < min || durationSeconds > max) {
      throw new BadRequestException(
        `声音克隆样本建议控制在 10-15 秒之间，当前约 ${durationSeconds.toFixed(
          1,
        )} 秒`,
      );
    }
  }

  private normalizeVoiceSampleMimeType(mimetype: string, originalname: string): string {
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
    const fromEnv = this.config.get<string>('VIDEO_SAVE_DIR')?.trim();
    if (fromEnv) return path.resolve(fromEnv);
    return process.platform === 'win32'
      ? 'C:\\downloadVideo'
      : path.join(os.homedir(), 'downloadVideo');
  }

  private getVoiceSampleDir(): string {
    const fromEnv = this.config.get<string>('VOICE_SAMPLE_DIR')?.trim();
    if (fromEnv) return path.resolve(fromEnv);
    return path.join(process.cwd(), 'data', 'voice-samples');
  }

  private assertSafeBasename(name: string): string {
    const trimmed = name.trim();
    const base = path.basename(trimmed);
    if (!trimmed || base !== trimmed || /[\\/]/.test(trimmed) || trimmed.includes('..')) {
      throw new BadRequestException('文件名不合法');
    }
    return base;
  }

  private extractManagedVoiceSampleName(audioUrl?: string | null): string | null {
    const value = audioUrl?.trim();
    if (!value) return null;
    const match = value.match(/\/voice-files\/([^/]+)\/stream$/);
    if (!match?.[1]) return null;
    const decoded = decodeURIComponent(match[1]);
    return decoded.startsWith(VOICE_UPLOAD_PREFIX) ? decoded : null;
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
    return 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
  }
}
