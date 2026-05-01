import { ConfigService } from '@nestjs/config';

/** 与 digital-human-image：ARK base 末尾多写的 /v1 去掉 */
export function normalizeArkApiV3Base(raw: string): string {
  let b = raw.replace(/\/+$/, '');
  if (b.endsWith('/v1')) b = b.slice(0, -3);
  return b;
}

/**
 * Chat Completions：显式 OPENAI_BASE_URL 时用其 + /chat/completions；否则用火山区 api/v3。
 */
export function resolveChatCompletionsUrl(config: ConfigService): string {
  const openaiBase = config.get<string>('OPENAI_BASE_URL')?.trim();
  if (openaiBase) {
    return `${openaiBase.replace(/\/+$/, '')}/chat/completions`;
  }
  const rawArk =
    config.get<string>('ARK_BASE_URL')?.trim() ||
    'https://ark.cn-beijing.volces.com/api/v3';
  return `${normalizeArkApiV3Base(rawArk)}/chat/completions`;
}

/**
 * 对话/改写/口播优化：密钥优先独立 LLM_*，再用 OPENAI_*，再 ARK_API_KEY。
 */
export function resolveChatCompletionsApiKey(config: ConfigService): string {
  return (
    config.get<string>('LLM_API_KEY')?.trim() ||
    config.get<string>('OPENAI_API_KEY')?.trim() ||
    config.get<string>('ARK_API_KEY')?.trim() ||
    ''
  );
}

/** 仅改写（无 LLM_*）：OpenAI 与 ARK 二选一式回退 */
export function resolveRewriteApiKey(config: ConfigService): string {
  return (
    config.get<string>('OPENAI_API_KEY')?.trim() ||
    config.get<string>('ARK_API_KEY')?.trim() ||
    ''
  );
}

/**
 * 对话模型：LLM_MODEL / OPENAI_MODEL / ARK_CHAT_MODEL；未设时按密钥推断默认（仅 ARK 用豆包 lite）。
 */
export function resolveChatModel(config: ConfigService): string {
  const m =
    config.get<string>('LLM_MODEL')?.trim() ||
    config.get<string>('OPENAI_MODEL')?.trim() ||
    config.get<string>('ARK_CHAT_MODEL')?.trim();
  if (m) return m;
  const useArk =
    !config.get<string>('LLM_API_KEY')?.trim() &&
    !config.get<string>('OPENAI_API_KEY')?.trim() &&
    Boolean(config.get<string>('ARK_API_KEY')?.trim());
  return useArk ? 'doubao-seed-2-0-lite-260215' : 'gpt-4o-mini';
}

export function resolveRewriteModel(config: ConfigService): string {
  const m =
    config.get<string>('OPENAI_MODEL')?.trim() ||
    config.get<string>('ARK_CHAT_MODEL')?.trim();
  if (m) return m;
  const useArk =
    !config.get<string>('OPENAI_API_KEY')?.trim() &&
    Boolean(config.get<string>('ARK_API_KEY')?.trim());
  return useArk ? 'doubao-seed-2-0-lite-260215' : 'gpt-4o-mini';
}

/** TTS 等仍用 /v1 风格路径时：优先 OPENAI_BASE_URL，否则 ARK api/v3 */
export function resolveOpenAiStyleV1Base(config: ConfigService): string {
  const openaiBase = config.get<string>('OPENAI_BASE_URL')?.trim();
  if (openaiBase) {
    return openaiBase.replace(/\/+$/, '');
  }
  const rawArk =
    config.get<string>('ARK_BASE_URL')?.trim() ||
    'https://ark.cn-beijing.volces.com/api/v3';
  return normalizeArkApiV3Base(rawArk);
}

export function resolveSpeechApiKey(config: ConfigService): string {
  return (
    config.get<string>('OPENAI_API_KEY')?.trim() ||
    config.get<string>('ARK_API_KEY')?.trim() ||
    ''
  );
}
