import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * jiekou.ai Seedance 1.5 Pro 图生视频（异步）
 * POST https://api.jiekou.ai/v3/async/seedance-v1.5-pro-i2v
 *
 * 鉴权：Bearer；密钥见 SEEDANCE_I2V_API_KEY（可回退 JIEKOU_API_KEY、SEEDREAM_API_KEY）。
 * 各字段默认值可通过 SEEDANCE_I2V_* 环境变量覆盖。
 */
export interface SeedanceI2vSubmitBody {
  /** 首帧参考图：URL 或 data URL */
  image: string;
  prompt: string;
  fps?: number;
  seed?: number;
  ratio?: string;
  duration?: number;
  watermark?: boolean;
  /** 尾帧图（可选） */
  last_image?: string;
  resolution?: string;
  camera_fixed?: boolean;
  service_tier?: string;
  generate_audio?: boolean;
  execution_expires_after?: number;
}

@Injectable()
export class SeedanceI2vService {
  private readonly logger = new Logger(SeedanceI2vService.name);

  constructor(private readonly config: ConfigService) {}

  getDefaultApiUrl(): string {
    return (
      this.config.get<string>('SEEDANCE_I2V_API_URL')?.trim() ||
      'https://api.jiekou.ai/v3/async/seedance-v1.5-pro-i2v'
    );
  }

  resolveApiKey(): string | undefined {
    return (
      this.config.get<string>('SEEDANCE_I2V_API_KEY')?.trim() ||
      this.config.get<string>('JIEKOU_API_KEY')?.trim() ||
      this.config.get<string>('SEEDREAM_API_KEY')?.trim()
    );
  }

  isConfigured(): boolean {
    return Boolean(this.resolveApiKey());
  }

  /**
   * 合并请求体与环境默认，字段与官方 curl 示例一致。
   */
  buildPayload(body: SeedanceI2vSubmitBody): Record<string, unknown> {
    const image = body.image?.trim();
    const prompt = body.prompt?.trim();
    if (!image) throw new BadRequestException('image 不能为空');
    if (!prompt) throw new BadRequestException('prompt 不能为空');

    const num = (key: string, fallback: number) => {
      const raw = this.config.get<string>(key)?.trim();
      if (raw === undefined || raw === '') return fallback;
      const n = Number(raw);
      return Number.isFinite(n) ? n : fallback;
    };

    const str = (key: string, fallback: string) =>
      this.config.get<string>(key)?.trim() || fallback;

    const bool = (key: string, fallback: boolean) => {
      const v = this.config.get<string>(key)?.trim();
      if (v === undefined || v === '') return fallback;
      return v !== '0' && v !== 'false' && v !== 'no';
    };

    const payload: Record<string, unknown> = {
      fps: body.fps ?? num('SEEDANCE_I2V_FPS', 24),
      image,
      ratio: body.ratio ?? str('SEEDANCE_I2V_RATIO', '9:16'),
      prompt,
      duration: body.duration ?? num('SEEDANCE_I2V_DURATION', 5),
      watermark: body.watermark ?? bool('SEEDANCE_I2V_WATERMARK', true),
      resolution: body.resolution ?? str('SEEDANCE_I2V_RESOLUTION', '1080p'),
      camera_fixed: body.camera_fixed ?? bool('SEEDANCE_I2V_CAMERA_FIXED', true),
      generate_audio: body.generate_audio ?? bool('SEEDANCE_I2V_GENERATE_AUDIO', true),
      execution_expires_after:
        body.execution_expires_after ?? num('SEEDANCE_I2V_EXECUTION_EXPIRES_AFTER', 86400),
    };

    if (body.seed !== undefined) {
      payload.seed = body.seed;
    } else {
      const seedEnv = this.config.get<string>('SEEDANCE_I2V_SEED')?.trim();
      if (seedEnv !== undefined && seedEnv !== '') {
        const s = Number(seedEnv);
        if (Number.isFinite(s)) payload.seed = s;
      }
    }

    const last = body.last_image?.trim();
    if (last) {
      payload.last_image = last;
    } else {
      const fromEnv = this.config.get<string>('SEEDANCE_I2V_LAST_IMAGE')?.trim();
      if (fromEnv) payload.last_image = fromEnv;
    }

    const tier = body.service_tier?.trim() ?? this.config.get<string>('SEEDANCE_I2V_SERVICE_TIER')?.trim();
    if (tier) payload.service_tier = tier;

    return payload;
  }

  /**
   * 提交异步任务；返回 HTTP 状态与解析后的 JSON（具体含 task_id 等以控制台文档为准）。
   */
  async submitAsync(body: SeedanceI2vSubmitBody): Promise<{ status: number; data: unknown }> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new BadRequestException(
        '未配置 SEEDANCE_I2V_API_KEY（或 JIEKOU_API_KEY / SEEDREAM_API_KEY）',
      );
    }

    const url = this.getDefaultApiUrl();
    const timeoutMs = Number(this.config.get('SEEDANCE_I2V_HTTP_TIMEOUT_MS') ?? 120_000);
    const payload = this.buildPayload(body);

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

      let data: unknown;
      const text = await res.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!res.ok) {
        this.logger.warn(`Seedance i2v HTTP ${res.status}: ${text.slice(0, 500)}`);
      }

      return { status: res.status, data };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Seedance i2v 请求失败：${msg}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}
