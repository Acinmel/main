import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RewriteStyle } from '../../modules/tasks/tasks.types';
import { mockSuggest } from './ai-mock.util';

type ChatCompletionMessage = {
  role: 'system' | 'user';
  content: string;
};

/**
 * 文案改写 / 一键增强：优先调用 OpenAI 兼容的 Chat Completions。
 *
 * 请求形态（便于后续切换任意兼容网关）：
 * POST ${OPENAI_BASE_URL}/chat/completions
 * Headers: Authorization: Bearer ${OPENAI_API_KEY}
 * Body: { model, temperature, messages: [{role, content}] }
 */
@Injectable()
export class RewriteAiService {
  private readonly logger = new Logger(RewriteAiService.name);

  constructor(private readonly config: ConfigService) {}

  async suggest(params: {
    source: string;
    style: RewriteStyle;
    sourceVideoUrl: string;
  }): Promise<string> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY 未配置，改写使用本地 mock');
      return mockSuggest(params.source, params.style, params.sourceVideoUrl);
    }

    const baseUrl = (
      this.config.get<string>('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    const model = this.config.get<string>('OPENAI_MODEL') ?? 'gpt-4o-mini';
    const timeoutMs = Number(this.config.get('OPENAI_TIMEOUT_MS') ?? 60_000);

    const messages = this.buildMessages(params);
    const url = `${baseUrl}/chat/completions`;
    const body = {
      model,
      temperature: 0.7,
      messages,
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${errText.slice(0, 400)}`);
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('模型返回空内容');
      return text;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`LLM 调用失败，回退 mock：${msg}`);
      return mockSuggest(params.source, params.style, params.sourceVideoUrl);
    }
  }

  private buildMessages(params: {
    source: string;
    style: RewriteStyle;
    sourceVideoUrl: string;
  }): ChatCompletionMessage[] {
    const styleGuide: Record<RewriteStyle, string> = {
      conservative: '保守改写：保留主题与逻辑，降低重复表达，适合口播朗读。',
      viral: '爆款增强：开头加钩子，中段加情绪与反差，结尾引导互动或关注。',
      commerce: '带货转化：痛点-方案-证明-行动号召，语气真诚有说服力。',
      knowledge: '知识分享：结构化输出（定义→步骤→例子→小结），便于理解记忆。',
    };

    return [
      {
        role: 'system',
        content:
          '你是中文短视频口播编剧。输出一段可直接口播的连贯文案，不要 Markdown，不要分点列表（除非知识分享风格确有必要）。',
      },
      {
        role: 'user',
        content: [
          `改写风格：${styleGuide[params.style]}`,
          `原视频链接（仅供参考，勿逐字复述链接）：${params.sourceVideoUrl}`,
          '--- 原文案 ---',
          params.source,
        ].join('\n'),
      },
    ];
  }
}
