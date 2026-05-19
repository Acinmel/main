import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { DatabaseService } from '../../database/database.service';

type SavedVideoRow = {
  id: string;
  user_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  source_video_url: string;
  created_at: string;
  updated_at: string;
};

type SavedVideoDto = {
  id: string;
  userId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  sourceVideoUrl: string;
  createdAt: string;
  updatedAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

@Injectable()
export class SavedVideoService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async upsertForUser(
    userId: string,
    payload: {
      fileName: string;
      fileSize: number;
      mimeType?: string;
      sourceVideoUrl?: string;
    },
  ): Promise<SavedVideoDto> {
    const fileName = this.safeBaseName(payload.fileName);
    if (!userId?.trim()) {
      throw new BadRequestException('userId 不能为空');
    }
    const now = nowIso();
    const rowId = randomUUID();
    const fileSize = toInt(payload.fileSize);
    const mimeType = asString(payload.mimeType).slice(0, 120);
    const sourceVideoUrl = asString(payload.sourceVideoUrl).slice(0, 1024);

    if (this.isMysql()) {
      await this.db.execute(
        `INSERT INTO saved_videos
         (id, user_id, file_name, file_size, mime_type, source_video_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           file_size = VALUES(file_size),
           mime_type = VALUES(mime_type),
           source_video_url = VALUES(source_video_url),
           updated_at = VALUES(updated_at)`,
        [rowId, userId, fileName, fileSize, mimeType, sourceVideoUrl, now, now],
      );
    } else {
      await this.db.execute(
        `INSERT INTO saved_videos
         (id, user_id, file_name, file_size, mime_type, source_video_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, file_name) DO UPDATE SET
           file_size = excluded.file_size,
           mime_type = excluded.mime_type,
           source_video_url = excluded.source_video_url,
           updated_at = excluded.updated_at`,
        [rowId, userId, fileName, fileSize, mimeType, sourceVideoUrl, now, now],
      );
    }

    const saved = await this.findByUserAndFileName(userId, fileName);
    if (!saved) {
      throw new BadRequestException('保存视频元数据失败');
    }
    return saved;
  }

  async listByUser(
    userId: string,
    limitRaw?: number,
  ): Promise<SavedVideoDto[]> {
    const limit = this.clampLimit(limitRaw);
    const rows = await this.db.queryAll<SavedVideoRow>(
      `SELECT id, user_id, file_name, file_size, mime_type, source_video_url, created_at, updated_at
       FROM saved_videos
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC
       LIMIT ?`,
      [userId, limit],
    );
    return rows.map((row) => this.toDto(row));
  }

  async assertOwnedByUser(
    userId: string,
    fileName: string,
  ): Promise<SavedVideoDto> {
    const base = this.safeBaseName(fileName);
    const row = await this.findByUserAndFileName(userId, base);
    if (!row) {
      throw new NotFoundException(`未找到已保存视频：${base}`);
    }
    return row;
  }

  async isOwnedByUser(userId: string, fileName: string): Promise<boolean> {
    const base = this.safeBaseName(fileName);
    const row = await this.findByUserAndFileName(userId, base);
    return Boolean(row);
  }

  private async findByUserAndFileName(
    userId: string,
    fileName: string,
  ): Promise<SavedVideoDto | null> {
    const row = await this.db.queryOne<SavedVideoRow>(
      `SELECT id, user_id, file_name, file_size, mime_type, source_video_url, created_at, updated_at
       FROM saved_videos
       WHERE user_id = ? AND file_name = ?
       LIMIT 1`,
      [userId, fileName],
    );
    return row ? this.toDto(row) : null;
  }

  private toDto(row: SavedVideoRow): SavedVideoDto {
    return {
      id: asString(row.id),
      userId: asString(row.user_id),
      fileName: asString(row.file_name),
      fileSize: toInt(row.file_size),
      mimeType: asString(row.mime_type),
      sourceVideoUrl: asString(row.source_video_url),
      createdAt: asString(row.created_at),
      updatedAt: asString(row.updated_at),
    };
  }

  private safeBaseName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('fileName 不能为空');
    }
    const base = path.basename(trimmed);
    if (base !== trimmed || /[\\/]/.test(trimmed) || trimmed.includes('..')) {
      throw new BadRequestException('fileName 不合法');
    }
    return base;
  }

  private clampLimit(limitRaw?: number): number {
    const n = Number(limitRaw);
    if (!Number.isFinite(n)) return 200;
    return Math.min(200, Math.max(1, Math.floor(n)));
  }

  private isMysql(): boolean {
    return Boolean(this.config.get<string>('MYSQL_DATABASE')?.trim());
  }
}
