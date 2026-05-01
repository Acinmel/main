import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  resolveChatCompletionsApiKey,
  resolveChatCompletionsUrl,
  resolveChatModel,
} from './openai-ark-compat.util';

/**
 * 第二步「生成视频」：用大模型优化口播稿（OpenAI 兼容 Chat Completions）。
 *
 * 环境变量：LLM_* 优先；否则 OPENAI_*；再否则火山方舟 ARK_API_KEY + ARK_BASE_URL。
 * 均无密钥时返回原文案，不抛错。
 */
@Injectable()
export class VideoGenerateLlmService {
  private readonly logger = new Logger(VideoGenerateLlmService.name);

  constructor(private readonly config: ConfigService) {}

  async optimizeScriptForVideo(
    script: string,
    sourceVideoUrl?: string,
  ): Promise<{ text: string; usedLlm: boolean }> {
    const trimmed = script.trim();
    if (!trimmed) {
      return { text: '', usedLlm: false };
    }

    const apiKey = resolveChatCompletionsApiKey(this.config);
    if (!apiKey) {
      this.logger.warn(
        'LLM_API_KEY / OPENAI_API_KEY / ARK_API_KEY 均未配置，口播优化跳过模型，返回原文',
      );
      return { text: trimmed, usedLlm: false };
    }

    const llmBase = this.config.get<string>('LLM_API_BASE_URL')?.trim();
    const url = llmBase
      ? `${llmBase.replace(/\/+$/, '')}/chat/completions`
      : resolveChatCompletionsUrl(this.config);
    const model = resolveChatModel(this.config);
    const timeoutMs = Number(
      this.config.get('LLM_TIMEOUT_MS') ?? this.config.get('OPENAI_TIMEOUT_MS') ?? 120_000,
    );

    const system = `你是短视频口播编辑。请将用户口播稿整理为适合数字人成片与口播配音（TTS）的终稿：口语自然、节奏清晰、无多余寒暄与链接说明；可适当分段但不编号；不要编造事实。润色后的正文将直接作为口播台词提交给视频模型生成口播音频，请保持可朗读、与事实一致。若稿件已足够好，可只做轻微润色。`;
    const userParts = [`【口播稿】\n${trimmed}`];
    if (sourceVideoUrl?.trim()) {
      userParts.push(`【参考视频页链接】${sourceVideoUrl.trim()}`);
    }

    const body = {
      model,
      temperature: 0.5,
      messages: [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: userParts.join('\n\n') },
      ],
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
      return { text, usedLlm: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`口播优化 LLM 失败，回退原文：${msg}`);
      return { text: trimmed, usedLlm: false };
    }
  }

  /** 供前端展示进度条：粗略预估总耗时（秒） */
  estimateDurationSeconds(scriptLength: number): number {
    const base = 12;
    const perChar = 0.02;
    return Math.min(180, Math.max(15, Math.round(base + scriptLength * perChar)));
  }
}
