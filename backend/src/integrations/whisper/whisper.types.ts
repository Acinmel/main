export interface WhisperSegmentDto {
  startMs: number;
  endMs: number;
  text: string;
}

export interface WhisperTranscribeResultDto {
  /** 主后端保存本条转写后的 ID，可用 GET /v1/tools/transcripts/:id 取回 */
  transcriptId: string;
  fullText: string;
  language: string;
  segments: WhisperSegmentDto[];
  /** 经 HTTP 调用的本地 Python openai-whisper 服务 */
  provider: 'python-whisper-http';
}
