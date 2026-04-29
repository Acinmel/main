import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_WHISPER_MEDIA_MAX_BYTES } from '../../common/media.constants';
import type { WhisperSegmentDto, WhisperTranscribeResultDto } from './whisper.types';
import { WhisperTranscriptStore } from './whisper-transcript.store';

/** Python 服务返回的分段（兼容秒或毫秒） */
interface RemoteSegment {
  startMs?: number;
  endMs?: number;
  start?: number;
  end?: number;
  text?: string;
}

interface RemoteTranscribeJson {
  fullText?: string;
  text?: string;
  language?: string;
  segments?: RemoteSegment[];
}

/**
 * 本地 openai-whisper：将上传文件 **原样 multipart** 转发到 Python HTTP 服务，
 * 由 Python 加载模型并转写；Nest 只做校验与响应归一化。
 */
@Injectable()
export class WhisperService {
  private readonly logger = new Logger(WhisperService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly transcriptStore: WhisperTranscriptStore,
  ) {}

  async transcribeUpload(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<WhisperTranscribeResultDto> {
    this.assertAcceptableMedia(file);

    const url = this.config.get<string>('WHISPER_HTTP_URL')?.trim();
    if (!url) {
      throw new BadRequestException(
        '未配置 WHISPER_HTTP_URL。请在 backend/.env 中填写 Python 转写服务完整地址（如 http://127.0.0.1:8010/transcribe）后重启。',
      );
    }

    const timeoutMs = Number(this.config.get('WHISPER_HTTP_TIMEOUT_MS') ?? 600_000);
    const token = this.config.get<string>('WHISPER_HTTP_TOKEN')?.trim();

    const form = new FormData();
    // 拷贝一份再封装 Blob，避免 Buffer 底层 SharedArrayBuffer 与 BlobPart 类型不兼容
    const payload = new Uint8Array(file.buffer.length);
    payload.set(file.buffer);
    const blob = new Blob([payload], {
      type: file.mimetype || 'application/octet-stream',
    });
    form.append('file', blob, this.safeMultipartFilename(file.originalname));

    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        body: form,
        headers,
        signal: ac.signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Whisper HTTP 请求失败: ${msg}`);
      throw new BadRequestException(`无法连接 Python 转写服务：${msg}`);
    } finally {
      clearTimeout(timer);
    }

    const raw = await res.text();
    if (!res.ok) {
      this.logger.warn(`Whisper HTTP ${res.status}: ${raw.slice(0, 800)}`);
      throw new BadRequestException(
        `Python 转写服务返回错误（${res.status}）：${raw.slice(0, 400)}`,
      );
    }

    let json: RemoteTranscribeJson;
    try {
      json = JSON.parse(raw) as RemoteTranscribeJson;
    } catch {
      throw new BadRequestException('Python 转写服务返回非 JSON，无法解析');
    }

    const language = String(json.language ?? 'und').trim() || 'und';
    const fullTextRaw = (json.fullText ?? json.text ?? '').trim();
    const segments = this.normalizeSegments(json.segments ?? []);

    const fullText =
      fullTextRaw ||
      segments
        .map((s) => s.text)
        .filter(Boolean)
        .join(' ')
        .trim();

    if (!fullText && segments.length === 0) {
      throw new BadRequestException('Python 转写服务未返回有效文本');
    }

    const resolvedFullText = fullText || segments.map((s) => s.text).join('\n');
    const transcriptId = this.transcriptStore.save({
      fullText: resolvedFullText,
      language,
      segments,
      sourceFilename: file.originalname,
    });

    return {
      transcriptId,
      fullText: resolvedFullText,
      language,
      segments,
      provider: 'python-whisper-http',
    };
  }

  /**
   * 探测 Python 服务是否存活（GET，默认与 WHISPER_HTTP_URL 同 host，路径末段换为 health）。
   */
  async checkHealth(): Promise<{
    ok: boolean;
    transcribeUrlConfigured: boolean;
    healthUrl: string;
    latencyMs: number;
    error?: string;
  }> {
    const transcribeUrl = this.config.get<string>('WHISPER_HTTP_URL')?.trim();
    if (!transcribeUrl) {
      return {
        ok: false,
        transcribeUrlConfigured: false,
        healthUrl: '',
        latencyMs: 0,
        error: 'WHISPER_HTTP_URL 未配置',
      };
    }

    const healthUrl = this.resolveHealthUrl(transcribeUrl);
    const token = this.config.get<string>('WHISPER_HTTP_TOKEN')?.trim();
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const timeoutMs = Number(
      this.config.get('WHISPER_HTTP_HEALTH_TIMEOUT_MS') ?? 10_000,
    );
    const t0 = Date.now();
    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const latencyMs = Date.now() - t0;
      if (!res.ok) {
        return {
          ok: false,
          transcribeUrlConfigured: true,
          healthUrl,
          latencyMs,
          error: `HTTP ${res.status}`,
        };
      }
      return {
        ok: true,
        transcribeUrlConfigured: true,
        healthUrl,
        latencyMs,
      };
    } catch (e) {
      const latencyMs = Date.now() - t0;
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Whisper health check failed: ${msg}`);
      return {
        ok: false,
        transcribeUrlConfigured: true,
        healthUrl,
        latencyMs,
        error: msg,
      };
    }
  }

  private resolveHealthUrl(transcribeUrl: string): string {
    const fromEnv = this.config.get<string>('WHISPER_HTTP_HEALTH_URL')?.trim();
    if (fromEnv) {
      return fromEnv;
    }
    const u = new URL(transcribeUrl);
    const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts.length) {
      parts[parts.length - 1] = 'health';
    } else {
      parts.push('health');
    }
    u.pathname = '/' + parts.join('/');
    return u.toString();
  }

  private normalizeSegments(raw: RemoteSegment[]): WhisperSegmentDto[] {
    return raw.map((s) => {
      let startMs = 0;
      let endMs = 0;
      if (typeof s.startMs === 'number' && typeof s.endMs === 'number') {
        startMs = Math.max(0, Math.round(s.startMs));
        endMs = Math.max(0, Math.round(s.endMs));
      } else if (typeof s.start === 'number' && typeof s.end === 'number') {
        // openai-whisper 默认：秒（浮点）
        startMs = Math.max(0, Math.round(s.start * 1000));
        endMs = Math.max(0, Math.round(s.end * 1000));
      }
      return {
        startMs,
        endMs,
        text: (s.text ?? '').trim(),
      };
    });
  }

  /** multipart 文件名仅保留安全字符，避免部分 Python/网关对非 ASCII 处理异常 */
  private safeMultipartFilename(originalname: string): string {
    const base = (originalname || 'upload.bin').split(/[/\\]/).pop() || 'upload.bin';
    const ascii = base.replace(/[^\x20-\x7E]/g, '_');
    return ascii.length > 0 ? ascii : 'upload.bin';
  }

  private assertAcceptableMedia(file: {
    mimetype: string;
    originalname: string;
    size: number;
  }) {
    const max = Number(
      this.config.get('WHISPER_MEDIA_MAX_BYTES') ??
        this.config.get('VIDEO_MEDIA_MAX_BYTES') ??
        DEFAULT_WHISPER_MEDIA_MAX_BYTES,
    );
    if (file.size <= 0) {
      throw new BadRequestException('文件为空');
    }
    if (file.size > max) {
      const mb = Math.round(max / (1024 * 1024));
      throw new BadRequestException(
        `文件过大（当前上限约 ${mb}MB），当前 ${file.size} 字节`,
      );
    }

    const mt = (file.mimetype || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    const extOk = /\.(flac|mp3|mp4|mpeg|mpga|m4a|ogg|wav|webm|mov|aac)$/i.test(name);
    const mimeOk =
      mt.startsWith('audio/') ||
      mt.startsWith('video/') ||
      mt === 'application/octet-stream';

    if (!mimeOk && !extOk) {
      throw new BadRequestException(
        '不支持的文件类型，请上传常见音视频格式（如 mp3、wav、m4a、mp4、webm 等）',
      );
    }
  }
}
