import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readPositiveInt } from '../../common/runtime-limits.util';
import type { TranscriptSegmentDto } from './transcript.types';

export interface SavedTranscript {
  transcriptId: string;
  createdAt: string;
  fullText: string;
  language: string;
  segments: TranscriptSegmentDto[];
  sourceFilename?: string;
}

/**
 * 进程内暂存最近一次转写结果（开发/工具链；重启丢失）。
 */
@Injectable()
export class TranscriptStore implements OnModuleInit, OnModuleDestroy {
  private readonly byId = new Map<string, SavedTranscript>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(
      () => {
        this.evictExpired();
      },
      readPositiveInt(
        this.config.get('TRANSCRIPT_STORE_CLEANUP_INTERVAL_MS'),
        10 * 60_000,
      ),
    );
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  save(row: {
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
    sourceFilename?: string;
  }): string {
    const transcriptId = randomUUID();
    const createdAt = new Date().toISOString();
    const saved: SavedTranscript = {
      transcriptId,
      createdAt,
      fullText: row.fullText,
      language: row.language,
      segments: row.segments,
      sourceFilename: row.sourceFilename,
    };
    this.byId.set(transcriptId, saved);
    this.evictExpired();
    return transcriptId;
  }

  get(transcriptId: string): SavedTranscript | undefined {
    const row = this.byId.get(transcriptId);
    if (!row) return undefined;
    const ttlMs = readPositiveInt(
      this.config.get('TRANSCRIPT_STORE_TTL_MS'),
      6 * 60 * 60_000,
    );
    const createdAt = Date.parse(row.createdAt);
    if (Number.isFinite(createdAt) && Date.now() - createdAt > ttlMs) {
      this.byId.delete(transcriptId);
      return undefined;
    }
    return row;
  }

  private evictExpired(): void {
    const ttlMs = readPositiveInt(
      this.config.get('TRANSCRIPT_STORE_TTL_MS'),
      6 * 60 * 60_000,
    );
    const max = readPositiveInt(this.config.get('TRANSCRIPT_STORE_MAX'), 200);
    const now = Date.now();
    for (const [id, row] of this.byId.entries()) {
      const createdAt = Date.parse(row.createdAt);
      if (Number.isFinite(createdAt) && now - createdAt > ttlMs) {
        this.byId.delete(id);
      }
    }
    if (this.byId.size <= max) return;
    const oldest = [...this.byId.entries()].sort(
      (a, b) => Date.parse(a[1].createdAt) - Date.parse(b[1].createdAt),
    );
    for (const [id] of oldest) {
      if (this.byId.size <= max) return;
      this.byId.delete(id);
    }
  }
}
