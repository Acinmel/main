import type { RewriteStyle, TranscriptSegmentDto } from '../../modules/tasks/tasks.types';

/** 无 ASR 时的占位口播稿 */
export function mockAsrText(videoUrl: string): string {
  return [
    '这是一段模拟口播原文案（未配置或未走通真实 ASR 流水线时自动回退）。',
    '原视频链接占位：',
    videoUrl,
    '',
    '后续接入：下载视频 → FFmpeg 抽音轨 → 调用云厂商 ASR → 回填本段文案。',
  ].join('\n');
}

/** 无 LLM 时的占位改写 */
export function mockSuggest(
  source: string,
  style: RewriteStyle,
  videoUrl: string,
): string {
  const head: Record<RewriteStyle, string> = {
    conservative: '【保守改写】保留主旨，仅调整措辞与节奏：',
    viral: '【爆款增强】加强钩子与情绪词，更适合短视频留存：',
    commerce: '【带货转化】突出痛点-方案-行动号召，语气更促单：',
    knowledge: '【知识分享】结构化讲解，补充一个记忆点或小清单：',
  };
  const tail =
    '\n\n（以上为本地 mock：配置 ARK_API_KEY 或 OPENAI_API_KEY 后将改为真实模型输出；失败时也会回退到此占位。）';
  return `${head[style]}\n${source.slice(0, 400)}\n\n来源占位：${videoUrl.slice(0, 120)}${tail}`;
}

/** 将整段文案切成简易时间轴（真实 ASR 应返回词级时间戳） */
export function buildMockSegments(fullText: string): TranscriptSegmentDto[] {
  const chunks = fullText.split(/[。!？\n]/).filter(Boolean);
  const segments: TranscriptSegmentDto[] = [];
  let cursor = 0;
  for (const c of chunks.slice(0, 6)) {
    const dur = 1500;
    segments.push({ startMs: cursor, endMs: cursor + dur, text: c });
    cursor += dur;
  }
  return segments;
}
