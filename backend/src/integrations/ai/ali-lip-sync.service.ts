import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AliLipSyncResult {
  videoUrl: string | null;
  providerResponse: unknown;
  hint?: string;
}

@Injectable()
export class AliLipSyncService {
  private readonly logger = new Logger(AliLipSyncService.name);

  constructor(private readonly config: ConfigService) {}

  async submitVideo(params: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
    durationSeconds?: number;
  }): Promise<AliLipSyncResult> {
    const apiUrl = this.config.get<string>('ALI_LIP_SYNC_API_URL')?.trim();
    if (!apiUrl) {
      throw new BadRequestException('未配置 ALI_LIP_SYNC_API_URL，无法调用阿里视频对口型接口');
    }

    const apiKey =
      this.config.get<string>('ALI_LIP_SYNC_API_KEY')?.trim() ||
      this.config.get<string>('DASHSCOPE_API_KEY')?.trim();
    if (!apiKey) {
      throw new BadRequestException('未配置 ALI_LIP_SYNC_API_KEY 或 DASHSCOPE_API_KEY');
    }

    const timeoutMs = Number(this.config.get('ALI_LIP_SYNC_TIMEOUT_MS') ?? 900_000);
    const videoFieldName = this.config.get<string>('ALI_LIP_SYNC_VIDEO_FIELD')?.trim() || 'video';
    const durationFieldName =
      this.config.get<string>('ALI_LIP_SYNC_DURATION_FIELD')?.trim() || 'duration_seconds';

    const videoBytes = new Uint8Array(params.buffer.byteLength);
    videoBytes.set(params.buffer);

    const form = new FormData();
    form.append(
      videoFieldName,
      new Blob([videoBytes], { type: params.mimeType || 'video/mp4' }),
      params.filename || 'input.mp4',
    );
    if (params.durationSeconds !== undefined) {
      form.append(durationFieldName, String(Math.round(params.durationSeconds * 100) / 100));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: form,
        signal: controller.signal,
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${text.slice(0, 800)}`);
      }

      if (contentType.startsWith('video/') || contentType === 'application/octet-stream') {
        const arr = await res.arrayBuffer();
        const base64 = Buffer.from(arr).toString('base64');
        const mime = contentType.startsWith('video/') ? contentType : 'video/mp4';
        return {
          videoUrl: `data:${mime};base64,${base64}`,
          providerResponse: { contentType, bytes: arr.byteLength },
          hint: '阿里接口返回了视频二进制，已转换为可预览的 data URL。',
        };
      }

      const json = (await res.json()) as Record<string, unknown>;
      const videoUrl = this.pickVideoUrl(json);
      if (!videoUrl) {
        throw new Error('阿里接口响应中未找到视频地址字段（支持 videoUrl / video_url / output.video_url 等）');
      }

      return {
        videoUrl,
        providerResponse: json,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`阿里视频对口型接口调用失败：${msg}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private pickVideoUrl(json: Record<string, unknown>): string | null {
    const directKeys = ['videoUrl', 'video_url', 'url', 'outputVideoUrl', 'output_video_url'];
    for (const key of directKeys) {
      const v = json[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }

    for (const key of ['output', 'data', 'result']) {
      const nested = json[key];
      if (nested && typeof nested === 'object') {
        const picked = this.pickVideoUrl(nested as Record<string, unknown>);
        if (picked) return picked;
      }
    }

    return null;
  }
}
