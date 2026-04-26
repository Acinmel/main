import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 第二步「生成视频」：用大模型优化口播稿（OpenAI 兼容 Chat Completions）。
 *
 * 环境变量（优先独立配置，便于接入任意兼容网关）：
 * - LLM_API_BASE_URL / LLM_API_KEY / LLM_MODEL / LLM_TIMEOUT_MS
 * 未配置 LLM_* 时回退到 OPENAI_*；均无密钥时返回原文案，不抛错。
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

    const apiKey =
      this.config.get<string>('LLM_API_KEY')?.trim() ||
      this.config.get<string>('OPENAI_API_KEY')?.trim() ||
      '';
    if (!apiKey) {
      this.logger.warn('LLM_API_KEY / OPENAI_API_KEY 均未配置，口播优化跳过模型，返回原文');
      return { text: trimmed, usedLlm: false };
    }

    const baseUrl = (
      this.config.get<string>('LLM_API_BASE_URL')?.trim() ||
      this.config.get<string>('OPENAI_BASE_URL')?.trim() ||
      'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    const model =
      this.config.get<string>('LLM_MODEL')?.trim() ||
      this.config.get<string>('OPENAI_MODEL')?.trim() ||
      'gpt-4o-mini';
    const timeoutMs = Number(
      this.config.get('LLM_TIMEOUT_MS') ?? this.config.get('OPENAI_TIMEOUT_MS') ?? 120_000,
    );

    const system = `你是短视频口播编辑。请将用户口播稿整理为适合数字人成片与口播配音（TTS）的终稿：口语自然、节奏清晰、无多余寒暄与链接说明；可适当分段但不编号；不要编造事实。润色后的正文将直接作为口播台词提交给视频模型生成口播音频，请保持可朗读、与事实一致。若稿件已足够好，可只做轻微润色。`;
    const userParts = [`【口播稿】\n${trimmed}`];
    if (sourceVideoUrl?.trim()) {
      userParts.push(`【参考视频页链接】${sourceVideoUrl.trim()}`);
    }

    const url = `${baseUrl}/chat/completions`;
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
