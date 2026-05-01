/** 未配置 TRANSCRIBE_MEDIA_MAX_BYTES / VIDEO_MEDIA_MAX_BYTES 时的默认上限（字节），约 200MB */
export const DEFAULT_TRANSCRIBE_MEDIA_MAX_BYTES = 200 * 1024 * 1024;

/** 与 .env 对齐；需在 import AppModule 前执行 load-env.ts */
export function getTranscribeMediaMaxBytes(): number {
  const v =
    process.env.TRANSCRIBE_MEDIA_MAX_BYTES?.trim() ||
    process.env.WHISPER_MEDIA_MAX_BYTES?.trim();
  if (v && /^\d+$/.test(v)) return parseInt(v, 10);
  return DEFAULT_TRANSCRIBE_MEDIA_MAX_BYTES;
}
