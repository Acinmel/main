import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
export class TranscriptStore {
  private readonly byId = new Map<string, SavedTranscript>();

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
    return transcriptId;
  }

  get(transcriptId: string): SavedTranscript | undefined {
    return this.byId.get(transcriptId);
  }
}
