import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service';

export type RecentExtractionItem = {
  id: string;
  sourceUrl: string;
  platform: string;
  title: string;
  summary: string;
  coverUrl: string;
  videoUrl: string;
  extractedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertRecentExtractionInput = {
  sourceUrl: string;
  platform?: string;
  title?: string;
  summary?: string;
  coverUrl?: string;
  videoUrl?: string;
  extractedAt?: string;
};

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 20;
const MAX_SOURCE_URL_LENGTH = 512;
const MAX_PLATFORM_LENGTH = 32;
const MAX_TITLE_LENGTH = 140;
const MAX_SUMMARY_LENGTH = 280;
const MAX_MEDIA_URL_LENGTH = 1024;

type RecentExtractionRow = {
  id: string;
  source_url: string;
  platform: string | null;
  title: string | null;
  summary: string | null;
  cover_url: string | null;
  video_url: string | null;
  extracted_at: string;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class RecentExtractionService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async listByUser(
    userId: string,
    limitRaw?: number,
  ): Promise<RecentExtractionItem[]> {
    const limit = this.normalizeLimit(limitRaw);
    const rows = await this.db.queryAll<RecentExtractionRow>(
      `SELECT id, source_url, platform, title, summary, cover_url, video_url, extracted_at, created_at, updated_at
         FROM recent_extractions
        WHERE user_id = ?
        ORDER BY extracted_at DESC, updated_at DESC
        LIMIT ?`,
      [userId, limit],
    );
    return rows.map((row) => this.toItem(row));
  }

  async upsertForUser(
    userId: string,
    input: UpsertRecentExtractionInput,
  ): Promise<RecentExtractionItem> {
    const sourceUrl = this.normalizeRequired(
      input.sourceUrl,
      MAX_SOURCE_URL_LENGTH,
      'sourceUrl',
    );
    const platform = this.normalizeOptional(
      input.platform,
      MAX_PLATFORM_LENGTH,
    );
    const title = this.normalizeOptional(input.title, MAX_TITLE_LENGTH);
    const summary = this.normalizeOptional(input.summary, MAX_SUMMARY_LENGTH);
    const coverUrl = this.normalizeOptional(
      input.coverUrl,
      MAX_MEDIA_URL_LENGTH,
    );
    const videoUrl = this.normalizeOptional(
      input.videoUrl,
      MAX_MEDIA_URL_LENGTH,
    );
    const extractedAt = this.normalizeIsoTime(input.extractedAt);
    const now = new Date().toISOString();

    if (this.isMysql()) {
      await this.db.execute(
        `INSERT INTO recent_extractions
          (id, user_id, source_url, platform, title, summary, cover_url, video_url, extracted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           platform = VALUES(platform),
           title = VALUES(title),
           summary = VALUES(summary),
           cover_url = VALUES(cover_url),
           video_url = VALUES(video_url),
           extracted_at = VALUES(extracted_at),
           updated_at = VALUES(updated_at)`,
        [
          randomUUID(),
          userId,
          sourceUrl,
          platform,
          title,
          summary,
          coverUrl,
          videoUrl,
          extractedAt,
          now,
          now,
        ],
      );
    } else {
      await this.db.execute(
        `INSERT INTO recent_extractions
          (id, user_id, source_url, platform, title, summary, cover_url, video_url, extracted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, source_url) DO UPDATE SET
           platform = excluded.platform,
           title = excluded.title,
           summary = excluded.summary,
           cover_url = excluded.cover_url,
           video_url = excluded.video_url,
           extracted_at = excluded.extracted_at,
           updated_at = excluded.updated_at`,
        [
          randomUUID(),
          userId,
          sourceUrl,
          platform,
          title,
          summary,
          coverUrl,
          videoUrl,
          extractedAt,
          now,
          now,
        ],
      );
    }

    const rows = await this.db.queryAll<RecentExtractionRow>(
      `SELECT id, source_url, platform, title, summary, cover_url, video_url, extracted_at, created_at, updated_at
         FROM recent_extractions
        WHERE user_id = ? AND source_url = ?
        LIMIT 1`,
      [userId, sourceUrl],
    );
    const row = rows[0];
    if (!row) {
      throw new BadRequestException('recent extraction save failed');
    }
    return this.toItem(row);
  }

  private toItem(row: RecentExtractionRow): RecentExtractionItem {
    return {
      id: row.id,
      sourceUrl: row.source_url,
      platform: row.platform || '',
      title: row.title || '',
      summary: row.summary || '',
      coverUrl: row.cover_url || '',
      videoUrl: row.video_url || '',
      extractedAt: row.extracted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private normalizeLimit(limitRaw?: number): number {
    if (!Number.isFinite(limitRaw)) return DEFAULT_LIMIT;
    const value = Math.floor(Number(limitRaw));
    if (value <= 0) return DEFAULT_LIMIT;
    return Math.min(value, MAX_LIMIT);
  }

  private normalizeOptional(
    value: string | undefined,
    maxLength: number,
  ): string {
    const normalized = (value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.slice(0, maxLength);
  }

  private normalizeRequired(
    value: string | undefined,
    maxLength: number,
    field: string,
  ): string {
    const normalized = (value || '').trim();
    if (!normalized) {
      throw new BadRequestException(`${field} is required`);
    }
    return normalized.slice(0, maxLength);
  }

  private normalizeIsoTime(value?: string): string {
    const next = value ? new Date(value) : new Date();
    if (Number.isNaN(next.getTime())) return new Date().toISOString();
    return next.toISOString();
  }

  private isMysql(): boolean {
    return Boolean(this.config.get<string>('MYSQL_DATABASE')?.trim());
  }
}
