import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service';
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

function nowIso(): string {
  return new Date().toISOString();
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
  private seeded = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
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

  async createVoice(userId: string, body: Record<string, unknown>) {
    const now = nowIso();
    const row: ResourceRow = {
      id: randomUUID(),
      user_id: userId,
      name: trimName(body.name, '我的克隆音色'),
      is_recommended: 0,
      audio_url: this.optionalString(body.audioUrl) || this.placeholderAudio(),
      clone_status: 'ready',
      created_at: now,
      updated_at: now,
    };
    await this.db.execute(
      `INSERT INTO voice_resources
       (id, user_id, name, is_recommended, audio_url, clone_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.name,
        row.is_recommended,
        row.audio_url,
        row.clone_status,
        row.created_at,
        row.updated_at,
      ],
    );
    return this.toVoice(row, userId);
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
    await this.assertOwned(table, userId, id);
    await this.db.execute(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, [id, userId]);
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
      deleted.push(id);
    }
    return { deletedIds: deleted };
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
    const forceMock = this.config.get<string>('RESOURCE_LIBRARY_MOCK')?.trim() === 'true';
    const count = await this.db.queryOne<{ c: number }>(
      `SELECT
        (SELECT COUNT(1) FROM avatar_resources) +
        (SELECT COUNT(1) FROM voice_resources) +
        (SELECT COUNT(1) FROM subtitle_template_resources) AS c`,
    );
    const total = Number(count?.c ?? 0);
    if (forceMock || total <= 0) {
      await this.seedRecommended();
    }
    this.seeded = true;
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
         (id, user_id, name, is_recommended, audio_url, clone_status, created_at, updated_at)
         VALUES (?, NULL, ?, 1, ?, ?, ?, ?)`,
        [id, name, this.placeholderAudio(), status, now, now],
      );
    }
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
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
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
