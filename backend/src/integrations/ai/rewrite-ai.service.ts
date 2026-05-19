import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { runAiLimited } from '../../common/ai-concurrency.util';
import type { RewriteStyle } from '../../modules/tasks/tasks.types';
import { mockHookedOralScript, mockSuggest } from './ai-mock.util';
import {
  pickRandomOralScriptStrategy,
  type OralScriptStrategy,
} from './oral-script-strategies';
import {
  resolveChatCompletionsUrl,
  resolveRewriteApiKey,
  resolveRewriteModel,
} from './openai-ark-compat.util';

type ChatCompletionMessage = {
  role: 'system' | 'user';
  content: string;
};

export interface HookedOralScriptResult {
  hook3s: string;
  hook10s: string;
  optimizedScript: string;
  strategyId: string;
  strategyLabel: string;
  llmUsed: boolean;
}

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

@Injectable()
export class RewriteAiService {
  private readonly logger = new Logger(RewriteAiService.name);
  private readonly suggestCache = new Map<string, CacheEntry<string>>();
  private readonly hookedCache = new Map<
    string,
    CacheEntry<HookedOralScriptResult>
  >();

  constructor(private readonly config: ConfigService) {}

  async suggest(params: {
    source: string;
    style: RewriteStyle;
    sourceVideoUrl: string;
  }): Promise<string> {
    const cacheKey = this.cacheKey(
      'suggest',
      params.source,
      params.style,
      params.sourceVideoUrl,
    );
    const cached = this.getCache(this.suggestCache, cacheKey);
    if (cached) return cached;

    const apiKey = resolveRewriteApiKey(this.config);
    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY / ARK_API_KEY 未配置，改写使用本地 mock',
      );
      const text = mockSuggest(
        params.source,
        params.style,
        params.sourceVideoUrl,
      );
      this.setCache(this.suggestCache, cacheKey, text);
      return text;
    }

    try {
      const text = await this.requestChatCompletion(
        this.buildMessages(params),
        0.7,
      );
      this.setCache(this.suggestCache, cacheKey, text);
      return text;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`LLM 调用失败，回退 mock：${msg}`);
      const text = mockSuggest(
        params.source,
        params.style,
        params.sourceVideoUrl,
      );
      this.setCache(this.suggestCache, cacheKey, text);
      return text;
    }
  }

  async optimizeHookedOralScript(params: {
    source: string;
    sourceVideoUrl?: string;
  }): Promise<HookedOralScriptResult> {
    const rawSource = params.source.trim();
    const cacheKey = this.cacheKey(
      'hooked',
      rawSource,
      params.sourceVideoUrl ?? '',
    );
    const cached = this.getCache(this.hookedCache, cacheKey);
    if (cached) return cached;

    const strategy = pickRandomOralScriptStrategy();
    if (!rawSource) {
      const result = mockHookedOralScript(params.source, strategy);
      this.setCache(this.hookedCache, cacheKey, result);
      return result;
    }

    const apiKey = resolveRewriteApiKey(this.config);
    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY / ARK_API_KEY 未配置，口播优化使用本地 mock',
      );
      const result = mockHookedOralScript(rawSource, strategy);
      this.setCache(this.hookedCache, cacheKey, result);
      return result;
    }

    try {
      const content = await this.requestChatCompletion(
        this.buildHookedOralScriptMessages({
          source: rawSource,
          sourceVideoUrl: params.sourceVideoUrl?.trim() || '',
          strategy,
        }),
        strategy.temperature,
      );
      const result = this.parseHookedOralScriptResult(
        content,
        rawSource,
        strategy,
        true,
      );
      this.setCache(this.hookedCache, cacheKey, result);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`口播优化调用失败，回退 mock：${msg}`);
      const result = mockHookedOralScript(rawSource, strategy);
      this.setCache(this.hookedCache, cacheKey, result);
      return result;
    }
  }

  private cacheTtlMs(): number {
    const parsed = Number(
      this.config.get('AI_REWRITE_CACHE_TTL_MS') ?? 30 * 60_000,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 60_000;
  }

  private cacheKey(...parts: string[]): string {
    return createHash('sha256').update(parts.join('\0')).digest('hex');
  }

  private getCache<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
  ): T | null {
    const row = cache.get(key);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) {
      cache.delete(key);
      return null;
    }
    return row.value;
  }

  private setCache<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    value: T,
  ): void {
    cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs() });
    if (cache.size <= 300) return;
    const firstEntry = cache.keys().next();
    const firstKey = firstEntry.done ? undefined : firstEntry.value;
    if (firstKey) cache.delete(firstKey);
  }

  private async requestChatCompletion(
    messages: ChatCompletionMessage[],
    temperature: number,
  ): Promise<string> {
    const apiKey = resolveRewriteApiKey(this.config);
    if (!apiKey) {
      throw new Error('rewrite api key missing');
    }

    const url = resolveChatCompletionsUrl(this.config);
    const model = resolveRewriteModel(this.config);
    const timeoutMs = Number(this.config.get('OPENAI_TIMEOUT_MS') ?? 60_000);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await runAiLimited(
        this.config,
        () =>
          fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              temperature,
              messages,
            }),
            signal: controller.signal,
          }),
        { retries: 1 },
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${errText.slice(0, 400)}`);
      }

      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) {
        throw new Error('model returned empty content');
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildMessages(params: {
    source: string;
    style: RewriteStyle;
    sourceVideoUrl: string;
  }): ChatCompletionMessage[] {
    const styleGuide: Record<RewriteStyle, string> = {
      conservative: '保守改写：保留主题与逻辑，减少重复表达，适合直接口播。',
      viral: '爆款增强：开头更有钩子，中段加强反差和情绪张力，结尾加互动引导。',
      commerce: '带货转化：突出痛点、方案、结果和行动号召，语气真诚有说服力。',
      knowledge: '知识分享：结构清楚，适合把概念、步骤和案例讲明白。',
    };

    return [
      {
        role: 'system',
        content:
          '你是中文短视频口播编剧。请输出一段可直接朗读的成稿，不要使用 Markdown，不要输出多余说明。',
      },
      {
        role: 'user',
        content: [
          `改写风格：${styleGuide[params.style]}`,
          `来源链接（仅供理解主题，不要复述链接）：${params.sourceVideoUrl}`,
          '--- 原始内容 ---',
          params.source,
        ].join('\n'),
      },
    ];
  }

  private buildHookedOralScriptMessages(params: {
    source: string;
    sourceVideoUrl: string;
    strategy: OralScriptStrategy;
  }): ChatCompletionMessage[] {
    return [
      {
        role: 'system',
        content: [
          '你是中文短视频口播编剧。',
          '你的任务是把转写或爬取得到的原始内容，改写成适合数字人口播的视频脚本。',
          '要求：',
          '1. 保留原文核心信息，不要编造原文没有提到的事实。',
          '2. 去掉口头禅、重复、跑题和明显不适合口播的表达。',
          '3. 单独生成一个 3 秒钩子和一个 10 秒钩子。',
          '4. optimizedScript 必须把 hook3s 和 hook10s 自然融入开头，然后继续完整正文。',
          '5. 输出必须是严格 JSON，不要 Markdown，不要解释。',
          '6. JSON 结构必须是 {"hook3s":"...","hook10s":"...","optimizedScript":"..."}',
          `7. 本次必须采用「${params.strategy.label}」方案。`,
          ...params.strategy.systemHints.map(
            (hint, index) => `${index + 8}. ${hint}`,
          ),
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          params.sourceVideoUrl
            ? `来源链接（仅供理解上下文，不要复述链接）：${params.sourceVideoUrl}`
            : '',
          '请把下面这段原始内容整理成可直接给客户使用的口播文案：',
          params.source,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];
  }

  private parseHookedOralScriptResult(
    raw: string,
    source: string,
    strategy: OralScriptStrategy,
    llmUsed: boolean,
  ): HookedOralScriptResult {
    const fallback = mockHookedOralScript(source, strategy);
    const candidate = this.extractJsonObject(raw);
    if (!candidate) {
      return {
        ...fallback,
        optimizedScript: raw.trim() || fallback.optimizedScript,
        llmUsed,
      };
    }

    try {
      const json = JSON.parse(candidate) as Partial<HookedOralScriptResult>;
      const hook3s = json.hook3s?.trim() || fallback.hook3s;
      const hook10s = json.hook10s?.trim() || fallback.hook10s;
      const optimizedScript =
        json.optimizedScript?.trim() || fallback.optimizedScript;
      return {
        hook3s,
        hook10s,
        optimizedScript,
        strategyId: strategy.id,
        strategyLabel: strategy.label,
        llmUsed,
      };
    } catch {
      return {
        ...fallback,
        optimizedScript: raw.trim() || fallback.optimizedScript,
        llmUsed,
      };
    }
  }

  private extractJsonObject(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return trimmed.slice(start, end + 1);
    }
    return null;
  }
}
