import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';
import { readPositiveInt } from '../../common/runtime-limits.util';

@Injectable()
export class TaskStatusCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskStatusCacheService.name);
  private client: RedisClientType | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url =
      this.config.get<string>('TASK_STATUS_REDIS_URL')?.trim() ||
      this.config.get<string>('REDIS_URL')?.trim();
    if (!url) return;

    const client = createClient({ url });
    client.on('error', (error) => {
      this.logger.warn(
        `Redis task status cache error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
    try {
      await client.connect();
      this.client = client as RedisClientType;
      this.logger.log('Redis task status cache enabled');
    } catch (error) {
      this.logger.warn(
        `Redis task status cache disabled: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await client.quit().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = null;
    await client?.quit().catch(() => undefined);
  }

  async get<T>(taskId: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(this.key(taskId));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async set(taskId: string, payload: unknown): Promise<void> {
    if (!this.client) return;
    const ttlSeconds = readPositiveInt(
      this.config.get('TASK_STATUS_CACHE_TTL_SECONDS'),
      24 * 60 * 60,
    );
    try {
      await this.client.set(this.key(taskId), JSON.stringify(payload), {
        EX: ttlSeconds,
      });
    } catch {
      /* cache best effort */
    }
  }

  private key(taskId: string): string {
    return `shuziren:task-status:${taskId}`;
  }
}
