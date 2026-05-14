import type { RewriteStyle, TranscriptSegmentDto } from '../../modules/tasks/tasks.types';
import type { OralScriptStrategy } from './oral-script-strategies';

/** Mock transcript text when ASR is unavailable. */
export function mockAsrText(videoUrl: string): string {
  return [
    '这是一段模拟口播原文稿，用于本地联调或 ASR 暂时不可用时的回退结果。',
    '原视频链接占位：',
    videoUrl,
    '',
    '后续会走真实链路：下载视频 -> FFmpeg 抽音轨 -> 调用 ASR -> 回填这段文案。',
  ].join('\n');
}

/** Mock rewrite result when no LLM key is configured. */
export function mockSuggest(
  source: string,
  style: RewriteStyle,
  videoUrl: string,
): string {
  const head: Record<RewriteStyle, string> = {
    conservative: '【保守改写】保留主旨，仅调整表达和节奏：',
    viral: '【爆款增强】加强开头钩子和情绪张力，更适合短视频留存：',
    commerce: '【带货转化】突出痛点、方案和行动号召：',
    knowledge: '【知识分享】结构化整理核心重点，更适合讲解：',
  };
  const tail =
    '\n\n（以上为本地 mock：配置 OPENAI_API_KEY 或 ARK_API_KEY 后会切到真实模型输出。）';
  return `${head[style]}\n${source.trim()}\n\n来源占位：${videoUrl.slice(0, 120)}${tail}`;
}

export function mockHookedOralScript(
  source: string,
  strategy?: OralScriptStrategy,
): {
  hook3s: string;
  hook10s: string;
  optimizedScript: string;
  strategyId: string;
  strategyLabel: string;
  llmUsed: boolean;
} {
  const sanitized = source
    .replace(/\s+/g, ' ')
    .replace(/(?:嗯|啊|呀|吧|呢|啦|这个|那个|然后|那么)/g, ' ')
    .trim();
  const sentences = sanitized
    .split(/[。！？!?]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const core = sentences;
  const activeStrategy = strategy ?? {
    id: 'default',
    label: '基础整理',
    temperature: 0.55,
    systemHints: [],
    mockHook3Lead: '先别划走，',
    mockHook10Lead: '接下来 10 秒，我把最关键的重点帮你直接讲清楚。',
    mockBodyLead: '先把核心信息整理出来：',
    mockEnding: '照这个结构继续展开，会更适合直接做成视频口播。',
  };
  const firstSnippet = sentences[0]?.slice(0, 22) || '这条内容和你接下来要做的事直接相关。';
  const secondSnippet = sentences[1]?.slice(0, 28) || core[0]?.slice(0, 28) || '最值得先讲的重点其实已经很明确。';
  const hook3s = `${activeStrategy.mockHook3Lead}${firstSnippet}`;
  const hook10s =
    core.length >= 2
      ? `${activeStrategy.mockHook10Lead}${secondSnippet}`
      : `${activeStrategy.mockHook10Lead}`;
  const body = core.length
    ? `${activeStrategy.mockBodyLead}${core.map((item) => `${item}。`).join('')}`
    : `${activeStrategy.mockBodyLead}我已经把原始内容整理成更适合数字人口播的视频脚本，方便继续做配音和成片。`;
  return {
    hook3s,
    hook10s,
    optimizedScript: `${hook3s}\n${hook10s}\n${body}\n${activeStrategy.mockEnding}`,
    strategyId: activeStrategy.id,
    strategyLabel: activeStrategy.label,
    llmUsed: false,
  };
}

/** Build simple mock timeline segments when real ASR timestamps are unavailable. */
export function buildMockSegments(fullText: string): TranscriptSegmentDto[] {
  const chunks = fullText.split(/[。！\n]/).filter(Boolean);
  const segments: TranscriptSegmentDto[] = [];
  let cursor = 0;
  for (const chunk of chunks.slice(0, 6)) {
    const duration = 1500;
    segments.push({ startMs: cursor, endMs: cursor + duration, text: chunk });
    cursor += duration;
  }
  return segments;
}
