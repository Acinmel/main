import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mockAsrText } from './ai-mock.util';
import { normalizeArkApiV3Base } from './openai-ark-compat.util';
import { DEFAULT_TRANSCRIBE_MEDIA_MAX_BYTES } from '../../common/media.constants';
import type {
  TranscriptSegmentDto,
  TranscribeResultDto,
} from '../transcription/transcript.types';
import { TranscriptStore } from '../transcription/transcript.store';

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
 * 语音转写（ASR）：OpenAI 兼容 multipart（POST model + file → JSON 含 text）。
 * - 方舟 api/v3「兼容 OpenAI」文档未提供与官方一致的 `/audio/transcriptions` HTTP，拼该 URL 常见 404；对话仍用 ARK_API_KEY。
 * - 默认：有 OPENAI/ASR 密钥 → OpenAI 系地址；否则同上地址（需自行配密钥或 ASR_TRANSCRIBE_URL）。
 * - 仅显式 `ASR_TRANSCRIBE_URL` 或 `ASR_PROVIDER=ark` 会指向方舟转写路径（易 404，自负兼容）。
 */
@Injectable()
export class TranscriptionAiService {
  private readonly logger = new Logger(TranscriptionAiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly transcriptStore: TranscriptStore,
  ) {}

  async transcribe(params: {
    taskId: string;
    sourceVideoUrl: string;
  }): Promise<{ fullText: string; language: string }> {
    const mode = this.getMode();
    if (mode !== 'mock') {
      this.logger.warn(
        `task=${params.taskId} 当前任务阶段仅有 sourceVideoUrl，未携带可上传的音频二进制；转写回退 mock。`,
      );
    }

    return {
      fullText: mockAsrText(params.sourceVideoUrl),
      language: 'zh-CN',
    };
  }

  async transcribeMedia(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<TranscribeResultDto> {
    this.assertAcceptableMedia(file);
    const mode = this.getMode();
    if (mode === 'mock') {
      const fullText = mockAsrText(file.originalname || 'upload');
      const transcriptId = this.transcriptStore.save({
        fullText,
        language: 'zh-CN',
        segments: [],
        sourceFilename: file.originalname,
      });
      return {
        transcriptId,
        fullText,
        language: 'zh-CN',
        segments: [],
        provider: 'asr-api',
      };
    }

    const url = this.resolveTranscribeUrl();
    const apiKey = this.getTranscribeApiKey(url);
    if (!apiKey) {
      throw new BadRequestException(
        this.buildMissingKeyHint(url),
      );
    }
    const model = this.config.get<string>('ASR_MODEL')?.trim() || 'whisper-1';
    const timeoutMs = Number(
      this.config.get('ASR_TIMEOUT_MS') ?? this.config.get('OPENAI_TIMEOUT_MS') ?? 600_000,
    );

    const form = new FormData();
    form.append('model', model);
    const payload = new Uint8Array(file.buffer.length);
    payload.set(file.buffer);
    const blob = new Blob([payload], {
      type: file.mimetype || 'application/octet-stream',
    });
    form.append('file', blob, this.safeMultipartFilename(file.originalname));

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: ac.signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`ASR API 请求失败: ${msg}`);
      throw new BadRequestException(`ASR API 不可达：${msg}`);
    } finally {
      clearTimeout(timer);
    }

    const raw = await res.text();
    if (!res.ok) {
      this.logger.warn(`ASR API HTTP ${res.status} url=${url}: ${raw.slice(0, 800)}`);
      let hint = '';
      if (res.status === 404) {
        try {
          const host = new URL(url).hostname.toLowerCase();
          if (this.isArkTranscribeHost(host)) {
            hint =
              '（404：方舟 api/v3 通常无 OpenAI 式 /audio/transcriptions。请配置 OPENAI_API_KEY 走 Whisper，或设 ASR_TRANSCRIBE_URL 为实际提供 multipart 转写的地址；勿仅指望 ARK 密钥与本路径）';
          } else {
            hint =
              '（404：请核对 ASR_TRANSCRIBE_URL、网关是否支持 multipart 转写及 ASR_MODEL）';
          }
        } catch {
          hint = '';
        }
      }
      throw new BadRequestException(
        `ASR API 返回错误（${res.status}）${hint}；请求：${url}；响应摘录：${raw.slice(0, 400)}`,
      );
    }

    let json: RemoteTranscribeJson;
    try {
      json = JSON.parse(raw) as RemoteTranscribeJson;
    } catch {
      throw new BadRequestException('ASR API 返回非 JSON，无法解析');
    }

    const language = String(json.language ?? 'und').trim() || 'und';
    const segments = this.normalizeSegments(json.segments ?? []);
    const fullTextRaw = (json.fullText ?? json.text ?? '').trim();
    const fullText =
      fullTextRaw ||
      segments
        .map((s) => s.text)
        .filter(Boolean)
        .join(' ')
        .trim();

    if (!fullText && segments.length === 0) {
      throw new BadRequestException('ASR API 未返回有效文本');
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
      provider: 'asr-api',
    };
  }

  async checkHealth(): Promise<{
    ok: boolean;
    transcribeUrlConfigured: boolean;
    healthUrl: string;
    latencyMs: number;
    error?: string;
  }> {
    let transcribeUrl: string;
    try {
      transcribeUrl = this.resolveTranscribeUrl();
    } catch (e) {
      return {
        ok: false,
        transcribeUrlConfigured: false,
        healthUrl: '',
        latencyMs: 0,
        error: this.formatConfigError(e),
      };
    }

    const healthUrl = this.resolveHealthUrl(transcribeUrl);
    if (!healthUrl) {
      return {
        ok: false,
        transcribeUrlConfigured: true,
        healthUrl: '',
        latencyMs: 0,
        error: '无法推导 ASR 健康检查地址',
      };
    }

    const apiKey = this.getTranscribeApiKey(transcribeUrl);
    if (!apiKey) {
      return {
        ok: false,
        transcribeUrlConfigured: true,
        healthUrl,
        latencyMs: 0,
        error: this.buildMissingKeyHint(transcribeUrl),
      };
    }

    const timeoutMs = Number(this.config.get('ASR_HEALTH_TIMEOUT_MS') ?? 10_000);
    const t0 = Date.now();
    try {
      const res = await fetch(healthUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
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
      this.logger.warn(`ASR health check failed: ${msg}`);
      return {
        ok: false,
        transcribeUrlConfigured: true,
        healthUrl,
        latencyMs,
        error: msg,
      };
    }
  }

  private getMode(): 'mock' | 'api' {
    const mode = (this.config.get<string>('ASR_MODE') ?? 'api').toLowerCase();
    return mode === 'mock' ? 'mock' : 'api';
  }

  private isArkTranscribeHost(host: string): boolean {
    const h = host.toLowerCase();
    return h.includes('volces.com') || h.includes('volcengine.com');
  }

  /** 转写用密钥：按目标 host 选择，避免把 ARK_KEY 误发到 OpenAI（或反过来）。 */
  private getTranscribeApiKey(transcribeUrl: string): string {
    let host = '';
    try {
      host = new URL(transcribeUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
    if (host.includes('openai.com')) {
      return (
        this.config.get<string>('OPENAI_API_KEY')?.trim() ||
        this.config.get<string>('ASR_API_KEY')?.trim() ||
        ''
      );
    }
    if (this.isArkTranscribeHost(host)) {
      return (
        this.config.get<string>('ARK_API_KEY')?.trim() ||
        this.config.get<string>('ASR_API_KEY')?.trim() ||
        this.config.get<string>('OPENAI_API_KEY')?.trim() ||
        ''
      );
    }
    return (
      this.config.get<string>('ASR_API_KEY')?.trim() ||
      this.config.get<string>('OPENAI_API_KEY')?.trim() ||
      this.config.get<string>('ARK_API_KEY')?.trim() ||
      ''
    );
  }

  private buildMissingKeyHint(transcribeUrl: string): string {
    let host = '';
    try {
      host = new URL(transcribeUrl).hostname.toLowerCase();
    } catch {
      return 'ASR：请配置 ARK_API_KEY、OPENAI_API_KEY 或 ASR_API_KEY（见 backend/.env.example）';
    }
    if (host.includes('openai.com')) {
      const arkOnly =
        !this.config.get<string>('OPENAI_API_KEY')?.trim() &&
        !this.config.get<string>('ASR_API_KEY')?.trim() &&
        !!this.config.get<string>('ARK_API_KEY')?.trim();
      if (arkOnly) {
        return '已配置 ARK_API_KEY，但口播转写走 OpenAI 兼容接口（非方舟对话网关）。请增加 OPENAI_API_KEY（Whisper），或设置 ASR_TRANSCRIBE_URL + ASR_API_KEY 指向提供转写的服务。';
      }
      return '口播转写目标为 OpenAI：请配置 OPENAI_API_KEY（或 ASR_API_KEY）；勿将 ARK_API_KEY 用于 api.openai.com。';
    }
    if (this.isArkTranscribeHost(host)) {
      return '口播转写指向火山域名：请配置 ARK_API_KEY。若 HTTP 404，说明该路径在方舟侧不可用，请改用 OPENAI_API_KEY 或 ASR_TRANSCRIBE_URL。';
    }
    return '口播转写：请配置 ASR_API_KEY（专用转写密钥），或可接受的 OPENAI_API_KEY。';
  }

  /**
   * - ASR_TRANSCRIBE_URL：最优先
   * - ASR_PROVIDER=ark：方舟路径（常见 404，仅实验）
   * - ASR_PROVIDER=openai 或默认：OpenAI 系 /audio/transcriptions（Whisper 或兼容网关）
   */
  private resolveTranscribeUrl(): string {
    const direct = this.config.get<string>('ASR_TRANSCRIBE_URL')?.trim();
    if (direct) return direct;

    const provider = (this.config.get<string>('ASR_PROVIDER') ?? '')
      .trim()
      .toLowerCase();
    if (provider === 'ark') {
      const rawBase =
        this.config.get<string>('ARK_BASE_URL')?.trim() ||
        'https://ark.cn-beijing.volces.com/api/v3';
      return `${normalizeArkApiV3Base(rawBase)}/audio/transcriptions`;
    }
    if (provider === 'openai') {
      const base =
        this.config.get<string>('OPENAI_BASE_URL')?.trim() ||
        'https://api.openai.com/v1';
      return `${base.replace(/\/+$/, '')}/audio/transcriptions`;
    }

    const base =
      this.config.get<string>('OPENAI_BASE_URL')?.trim() ||
      'https://api.openai.com/v1';
    return `${base.replace(/\/+$/, '')}/audio/transcriptions`;
  }

  private resolveHealthUrl(transcribeUrl?: string): string {
    const fromEnv = this.config.get<string>('ASR_HEALTH_URL')?.trim();
    if (fromEnv) return fromEnv;
    const t = transcribeUrl ?? this.resolveTranscribeUrl();
    if (!t) return '';
    const u = new URL(t);
    const host = u.hostname.toLowerCase();
    if (host.includes('openai.com')) {
      return `${u.origin}/v1/models`;
    }
    if (this.isArkTranscribeHost(host)) {
      const m = u.pathname.match(/^(\/api\/v\d+)/);
      const prefix = m?.[1] ?? '/api/v3';
      return `${u.origin}${prefix}/models`;
    }
    const parts = u.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
    if (parts.length) {
      parts[parts.length - 1] = 'health';
    } else {
      parts.push('health');
    }
    u.pathname = `/${parts.join('/')}`;
    return u.toString();
  }

  private formatConfigError(e: unknown): string {
    if (e instanceof HttpException) {
      const r = e.getResponse();
      if (typeof r === 'string') return r;
      if (r && typeof r === 'object' && 'message' in r) {
        const m = (r as { message: string | string[] }).message;
        return Array.isArray(m) ? m.join('；') : String(m);
      }
    }
    return e instanceof Error ? e.message : String(e);
  }

  private normalizeSegments(raw: RemoteSegment[]): TranscriptSegmentDto[] {
    return raw.map((s) => {
      let startMs = 0;
      let endMs = 0;
      if (typeof s.startMs === 'number' && typeof s.endMs === 'number') {
        startMs = Math.max(0, Math.round(s.startMs));
        endMs = Math.max(0, Math.round(s.endMs));
      } else if (typeof s.start === 'number' && typeof s.end === 'number') {
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
      this.config.get('ASR_MEDIA_MAX_BYTES') ??
        this.config.get('TRANSCRIBE_MEDIA_MAX_BYTES') ??
        this.config.get('WHISPER_MEDIA_MAX_BYTES') ??
        this.config.get('VIDEO_MEDIA_MAX_BYTES') ??
        DEFAULT_TRANSCRIBE_MEDIA_MAX_BYTES,
    );
    if (file.size <= 0) {
      throw new BadRequestException('文件为空');
    }
    if (file.size > max) {
      const mb = Math.round(max / (1024 * 1024));
      throw new BadRequestException(`文件过大（当前上限约 ${mb}MB），当前 ${file.size} 字节`);
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
