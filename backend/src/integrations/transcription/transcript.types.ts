export interface TranscriptSegmentDto {
  startMs: number;
  endMs: number;
  text: string;
}

/** 工具链 / ASR API 返回的转写结果（内存 transcriptId 可 GET /v1/tools/transcripts/:id） */
export interface TranscribeResultDto {
  transcriptId: string;
  fullText: string;
  language: string;
  segments: TranscriptSegmentDto[];
  provider: 'asr-api';
}
