import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 火山方舟「图生视频」异步任务
 * POST {ARK_BASE_URL}/contents/generations/tasks
 * GET  {ARK_BASE_URL}/contents/generations/tasks/{id}
 *
 * 文档以火山侧为准。
 */
export interface ArkI2vTaskSubmitBody {
  /** 与示例一致：可含 `--duration 12 --camerafixed false --watermark true` 等后缀 */
  prompt: string;
  /** 首帧参考图：公网 HTTPS URL 或 data:image/...;base64,... */
  imageUrl: string;
  /** 默认读 ARK_I2V_MODEL，可被 body 覆盖 */
  model?: string;
  duration?: 12;
}

@Injectable()
export class ArkI2vVideoService {
  private readonly logger = new Logger(ArkI2vVideoService.name);

  constructor(private readonly config: ConfigService) {}

  resolveBaseUrl(): string {
    return (
      this.config.get<string>('ARK_BASE_URL')?.trim() ||
      'https://ark.cn-beijing.volces.com/api/v3'
    ).replace(/\/$/, '');
  }

  resolveApiKey(): string | undefined {
    return (
      this.config.get<string>('ARK_I2V_API_KEY')?.trim() ||
      this.config.get<string>('ARK_API_KEY')?.trim()
    );
  }

  defaultModel(): string {
    return (
      this.config.get<string>('ARK_I2V_MODEL')?.trim() ||
      'doubao-seedance-1-5-pro-251215'
    );
  }

  isConfigured(): boolean {
    return Boolean(this.resolveApiKey());
  }

  /**
   * 创建图生视频任务；返回方舟 HTTP 状态与解析后的 JSON。
   */
  async createTask(
    body: ArkI2vTaskSubmitBody,
  ): Promise<{ status: number; data: unknown }> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new BadRequestException(
        '未配置 ARK_API_KEY 或 ARK_I2V_API_KEY，无法调用火山方舟图生视频',
      );
    }

    const prompt = body.prompt?.trim();
    const imageUrl = body.imageUrl?.trim();
    if (!prompt) {
      throw new BadRequestException('prompt 不能为空');
    }
    if (!imageUrl) {
      throw new BadRequestException('imageUrl 不能为空');
    }

    const model = (body.model?.trim() || this.defaultModel()).trim();
    const url = `${this.resolveBaseUrl()}/contents/generations/tasks`;
    const timeoutMs = Number(this.config.get('ARK_I2V_HTTP_TIMEOUT_MS') ?? 120_000);

    const payload = {
      model,
      content: [
        { type: 'text' as const, text: prompt },
        {
          type: 'image_url' as const,
          image_url: { url: imageUrl },
        },
      ],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await res.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        this.logger.warn(`Ark i2v task HTTP ${res.status}: ${text.slice(0, 500)}`);
      }

      return { status: res.status, data };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Ark i2v 请求失败：${msg}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 查询任务详情（轮询用）。
   */
  async getTaskById(taskId: string): Promise<{ status: number; data: unknown }> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new BadRequestException('未配置 ARK_API_KEY');
    }
    const url = `${this.resolveBaseUrl()}/contents/generations/tasks/${encodeURIComponent(taskId)}`;
    const timeoutMs = Number(this.config.get('ARK_I2V_HTTP_TIMEOUT_MS') ?? 120_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      const text = await res.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 轮询直到成功并返回 video_url。
   */
  async pollUntilVideoUrl(taskId: string): Promise<string> {
    const maxMs = Number(this.config.get('ARK_I2V_POLL_MAX_MS') ?? 600_000);
    const intervalMs = Number(this.config.get('ARK_I2V_POLL_INTERVAL_MS') ?? 2500);
    const deadline = Date.now() + maxMs;

    while (Date.now() < deadline) {
      const { status, data } = await this.getTaskById(taskId);
      if (status !== 200) {
        await sleep(intervalMs);
        continue;
      }
      const d = data as Record<string, unknown>;
      const st = d?.status;
      if (st === 'succeeded') {
        const url = this.extractVideoUrl(d);
        if (url) return url;
      }
      if (st === 'failed') {
        throw new BadRequestException(
          `图生视频失败：${this.formatTaskFailure(d)}`,
        );
      }
      await sleep(intervalMs);
    }
    throw new BadRequestException('图生视频任务超时，请稍后重试');
  }

  /** 从创建任务响应中解析任务 id */
  extractTaskIdFromCreateResponse(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (typeof d.id === 'string' && d.id.length > 0) return d.id;
    const inner = d.data;
    if (inner && typeof inner === 'object') {
      const id = (inner as Record<string, unknown>).id;
      if (typeof id === 'string' && id.length > 0) return id;
    }
    return null;
  }

  private extractVideoUrl(d: Record<string, unknown>): string | null {
    const content = d.content;
    if (content && typeof content === 'object') {
      const c = content as Record<string, unknown>;
      if (typeof c.video_url === 'string') return c.video_url;
    }
    if (typeof d.video_url === 'string') return d.video_url;
    return null;
  }

  private formatTaskFailure(d: Record<string, unknown>): string {
    const err = d.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      if (typeof e.message === 'string') return e.message;
      if (typeof e.code === 'string') return e.code;
    }
    return JSON.stringify(d).slice(0, 400);
  }
}
