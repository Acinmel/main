import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { WhisperSegmentDto } from './whisper.types';

export interface SavedWhisperTranscript {
  transcriptId: string;
  createdAt: string;
  fullText: string;
  language: string;
  segments: WhisperSegmentDto[];
  sourceFilename?: string;
}

/**
 * 首页转写结果暂存（内存，进程重启丢失；后续可换 DB / 对象存储）。
 */
@Injectable()
export class WhisperTranscriptStore {
  private readonly byId = new Map<string, SavedWhisperTranscript>();
  /** 防止无限增长 */
  private readonly maxEntries = 500;

  save(payload: {
    fullText: string;
    language: string;
    segments: WhisperSegmentDto[];
    sourceFilename?: string;
  }): string {
    const transcriptId = randomUUID();
    const row: SavedWhisperTranscript = {
      transcriptId,
      createdAt: new Date().toISOString(),
      fullText: payload.fullText,
      language: payload.language,
      segments: payload.segments,
      sourceFilename: payload.sourceFilename,
    };
    this.byId.set(transcriptId, row);
    this.evictIfNeeded();
    return transcriptId;
  }

  get(transcriptId: string): SavedWhisperTranscript | undefined {
    return this.byId.get(transcriptId);
  }

  private evictIfNeeded() {
    while (this.byId.size > this.maxEntries) {
      const first = this.byId.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.byId.delete(first);
    }
  }
}
