import { ConfigService } from '@nestjs/config';

export function normalizeArkApiV3Base(raw: string): string {
  let base = raw.replace(/\/+$/, '');
  if (base.endsWith('/v1')) base = base.slice(0, -3);
  return base;
}

function resolveDashScopeCompatibleBase(config: ConfigService): string {
  return (
    config.get<string>('DASHSCOPE_LLM_BASE_URL')?.trim() ||
    config.get<string>('DASHSCOPE_BASE_URL')?.trim() ||
    'https://dashscope.aliyuncs.com/compatible-mode/v1'
  ).replace(/\/+$/, '');
}

function hasDashScopeLlmKey(config: ConfigService): boolean {
  return Boolean(config.get<string>('DASHSCOPE_API_KEY')?.trim());
}

/**
 * Chat Completions URL priority:
 * 1. OPENAI_BASE_URL
 * 2. DashScope compatible-mode when DASHSCOPE_API_KEY exists
 * 3. Ark API v3
 */
export function resolveChatCompletionsUrl(config: ConfigService): string {
  const openaiBase = config.get<string>('OPENAI_BASE_URL')?.trim();
  if (openaiBase) {
    return `${openaiBase.replace(/\/+$/, '')}/chat/completions`;
  }
  if (hasDashScopeLlmKey(config)) {
    return `${resolveDashScopeCompatibleBase(config)}/chat/completions`;
  }
  const rawArk =
    config.get<string>('ARK_BASE_URL')?.trim() ||
    'https://ark.cn-beijing.volces.com/api/v3';
  return `${normalizeArkApiV3Base(rawArk)}/chat/completions`;
}

export function resolveChatCompletionsApiKey(config: ConfigService): string {
  return (
    config.get<string>('LLM_API_KEY')?.trim() ||
    config.get<string>('OPENAI_API_KEY')?.trim() ||
    config.get<string>('DASHSCOPE_API_KEY')?.trim() ||
    config.get<string>('ARK_API_KEY')?.trim() ||
    ''
  );
}

export function resolveRewriteApiKey(config: ConfigService): string {
  return (
    config.get<string>('LLM_API_KEY')?.trim() ||
    config.get<string>('OPENAI_API_KEY')?.trim() ||
    config.get<string>('DASHSCOPE_API_KEY')?.trim() ||
    config.get<string>('ARK_API_KEY')?.trim() ||
    ''
  );
}

export function resolveChatModel(config: ConfigService): string {
  const configured =
    config.get<string>('LLM_MODEL')?.trim() ||
    config.get<string>('OPENAI_MODEL')?.trim() ||
    config.get<string>('DASHSCOPE_CHAT_MODEL')?.trim() ||
    config.get<string>('ARK_CHAT_MODEL')?.trim();
  if (configured) return configured;

  if (
    !config.get<string>('LLM_API_KEY')?.trim() &&
    !config.get<string>('OPENAI_API_KEY')?.trim() &&
    hasDashScopeLlmKey(config)
  ) {
    return 'qwen-plus';
  }

  const useArk =
    !config.get<string>('LLM_API_KEY')?.trim() &&
    !config.get<string>('OPENAI_API_KEY')?.trim() &&
    !hasDashScopeLlmKey(config) &&
    Boolean(config.get<string>('ARK_API_KEY')?.trim());
  return useArk ? 'doubao-seed-2-0-lite-260215' : 'gpt-4o-mini';
}

export function resolveRewriteModel(config: ConfigService): string {
  const configured =
    config.get<string>('LLM_MODEL')?.trim() ||
    config.get<string>('OPENAI_MODEL')?.trim() ||
    config.get<string>('DASHSCOPE_CHAT_MODEL')?.trim() ||
    config.get<string>('ARK_CHAT_MODEL')?.trim();
  if (configured) return configured;

  if (
    !config.get<string>('LLM_API_KEY')?.trim() &&
    !config.get<string>('OPENAI_API_KEY')?.trim() &&
    hasDashScopeLlmKey(config)
  ) {
    return 'qwen-plus';
  }

  const useArk =
    !config.get<string>('OPENAI_API_KEY')?.trim() &&
    !hasDashScopeLlmKey(config) &&
    Boolean(config.get<string>('ARK_API_KEY')?.trim());
  return useArk ? 'doubao-seed-2-0-lite-260215' : 'gpt-4o-mini';
}

export function resolveOpenAiStyleV1Base(config: ConfigService): string {
  const speechBase = config.get<string>('SPEECH_API_BASE_URL')?.trim();
  if (speechBase) {
    return speechBase.replace(/\/+$/, '');
  }
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
    config.get<string>('SPEECH_API_KEY')?.trim() ||
    config.get<string>('OPENAI_API_KEY')?.trim() ||
    config.get<string>('ARK_API_KEY')?.trim() ||
    ''
  );
}

export function resolveSpeechModel(config: ConfigService): string {
  return (
    config.get<string>('SPEECH_MODEL')?.trim() ||
    config.get<string>('OPENAI_TTS_MODEL')?.trim() ||
    'tts-1'
  );
}
