import type { ConfigService } from '@nestjs/config';
import { readPositiveInt, runWithRuntimeLimit } from './runtime-limits.util';

type AiLimitOptions = {
  retries?: number;
  retryDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
};

function readNonNegativeInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultShouldRetry(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      /aborted|timeout|timed out|fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(
        message,
      ))
  );
}

export function runAiLimited<T>(
  config: ConfigService,
  work: () => Promise<T>,
  options: AiLimitOptions = {},
): Promise<T> {
  return runWithRuntimeLimit(
    'ai-api',
    {
      concurrency: readPositiveInt(config.get('AI_API_MAX_CONCURRENCY'), 4),
      queueLimit: readPositiveInt(config.get('AI_API_QUEUE_LIMIT'), 100),
    },
    async () => {
      const retries =
        options.retries ??
        readNonNegativeInt(config.get('AI_API_MAX_RETRIES'), 0);
      const delayMs =
        options.retryDelayMs ??
        readPositiveInt(config.get('AI_API_RETRY_DELAY_MS'), 500);
      const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
      let attempt = 0;
      for (;;) {
        try {
          return await work();
        } catch (error) {
          if (attempt >= retries || !shouldRetry(error)) {
            throw error;
          }
          attempt += 1;
          await sleep(delayMs * attempt);
        }
      }
    },
  );
}
