import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_TRANSCRIBE_MEDIA_MAX_BYTES } from '../../common/media.constants';
import type {
  TranscribeResultDto,
  TranscriptSegmentDto,
} from '../transcription/transcript.types';
import { TranscriptStore } from '../transcription/transcript.store';
import * as path from 'node:path';

interface QwenAsrChatCompletionJson {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface QwenAsrTaskJson {
  output?: {
    task_id?: string;
    task_status?: string;
    result?: {
      transcription_url?: string;
    };
  };
  message?: string;
  code?: string;
}

interface QwenFileTransResultJson {
  transcripts?: Array<{
    text?: string;
    sentences?: Array<{
      begin_time?: number;
      end_time?: number;
      text?: string;
    }>;
  }>;
}

/**
 * 语音转写：唯一入口为百炼千问 ASR。
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
    const result = await this.transcribeWithQwenAsr(params.sourceVideoUrl);
    return { fullText: result.fullText, language: result.language };
  }

  async transcribeMedia(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<TranscribeResultDto> {
    this.assertAcceptableMedia(file);
    const result = await this.transcribeWithQwenAsr(this.toAudioDataUrl(file));
    const transcriptId = this.transcriptStore.save({
      fullText: result.fullText,
      language: result.language,
      segments: result.segments,
      sourceFilename: file.originalname,
    });

    return {
      transcriptId,
      fullText: result.fullText,
      language: result.language,
      segments: result.segments,
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
    const t0 = Date.now();
    try {
      const config = this.getQwenAsrConfig();
      return {
        ok: true,
        transcribeUrlConfigured: true,
        healthUrl: this.isFileTransModel(config.model)
          ? config.asyncSubmitUrl
          : config.chatCompletionsUrl,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      return {
        ok: false,
        transcribeUrlConfigured: false,
        healthUrl: '',
        latencyMs: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async transcribeWithQwenAsr(audioData: string): Promise<{
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  }> {
    const config = this.getQwenAsrConfig();
    if (this.isFileTransModel(config.model)) {
      return this.transcribeWithQwenFileTrans(audioData, config);
    }

    const timeoutMs = Number(this.config.get('ASR_TIMEOUT_MS') ?? 600_000);
    let res: Response;
    try {
      res = await fetch(config.chatCompletionsUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_audio',
                  input_audio: {
                    data: audioData,
                  },
                },
              ],
            },
          ],
          stream: false,
          asr_options: {
            enable_itn: this.getAsrEnableItn(),
            ...this.getOptionalAsrLanguage(),
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`千问 ASR API 请求失败: ${msg}`);
      throw new BadRequestException(`千问 ASR API 不可达：${msg}`);
    }

    const raw = await res.text();
    if (!res.ok) {
      this.logger.warn(`千问 ASR API HTTP ${res.status}: ${raw.slice(0, 800)}`);
      throw new BadRequestException(
        `千问 ASR API 返回错误（${res.status}）：${raw.slice(0, 500)}`,
      );
    }

    let json: QwenAsrChatCompletionJson;
    try {
      json = JSON.parse(raw) as QwenAsrChatCompletionJson;
    } catch {
      throw new BadRequestException('千问 ASR API 返回非 JSON，无法解析');
    }

    const fullText = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!fullText) {
      throw new BadRequestException('千问 ASR API 未返回有效转写文本');
    }
    return {
      fullText,
      language: 'zh-CN',
      segments: this.buildSegments(fullText),
    };
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

  private getQwenAsrConfig(): {
    apiKey: string;
    chatCompletionsUrl: string;
    asyncSubmitUrl: string;
    asyncTaskBaseUrl: string;
    model: string;
  } {
    const apiKey = this.config.get<string>('DASHSCOPE_API_KEY')?.trim();
    if (!apiKey) {
      throw new BadRequestException('请配置千问 ASR 密钥：DASHSCOPE_API_KEY');
    }
    const compatibleBase = (
      this.config.get<string>('DASHSCOPE_BASE_URL')?.trim() ||
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    ).replace(/\/+$/, '');
    const asyncBase = (
      this.config.get<string>('DASHSCOPE_ASR_BASE_URL')?.trim() ||
      this.resolveDashScopeAsyncBase(compatibleBase)
    ).replace(/\/+$/, '');
    return {
      apiKey,
      chatCompletionsUrl: `${compatibleBase}/chat/completions`,
      asyncSubmitUrl: `${asyncBase}/services/audio/asr/transcription`,
      asyncTaskBaseUrl: `${asyncBase}/tasks`,
      model:
        this.config.get<string>('QWEN_ASR_MODEL')?.trim() ||
        'qwen3-asr-flash-filetrans',
    };
  }

  private async transcribeWithQwenFileTrans(
    audioData: string,
    config: ReturnType<TranscriptionAiService['getQwenAsrConfig']>,
  ): Promise<{
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  }> {
    const timeoutMs = Number(this.config.get('ASR_TIMEOUT_MS') ?? 600_000);
    const submit = await this.fetchQwenJson<QwenAsrTaskJson>(
      config.asyncSubmitUrl,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: config.model,
          input: {
            file_url: audioData,
          },
          parameters: {
            channel_id: [0],
            enable_itn: this.getAsrEnableItn(),
            enable_words: this.getAsrEnableWords(),
            ...this.getOptionalAsrLanguage(),
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
      '千问 FileTrans ASR 提交任务',
    );

    const taskId = submit.output?.task_id;
    if (!taskId) {
      throw new BadRequestException(
        `千问 FileTrans ASR 未返回 task_id：${JSON.stringify(submit).slice(0, 500)}`,
      );
    }

    const task = await this.pollQwenFileTransTask(taskId, config);
    const resultUrl = task.output?.result?.transcription_url;
    if (!resultUrl) {
      throw new BadRequestException(
        `千问 FileTrans ASR 未返回 transcription_url：${JSON.stringify(task).slice(0, 500)}`,
      );
    }

    const result = await this.fetchQwenJson<QwenFileTransResultJson>(
      resultUrl,
      {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
      },
      '千问 FileTrans ASR 下载结果',
    );
    const normalized = this.normalizeFileTransResult(result);
    if (!normalized.fullText) {
      throw new BadRequestException('千问 FileTrans ASR 结果为空');
    }
    return normalized;
  }

  private async pollQwenFileTransTask(
    taskId: string,
    config: ReturnType<TranscriptionAiService['getQwenAsrConfig']>,
  ): Promise<QwenAsrTaskJson> {
    const timeoutMs = Number(this.config.get('ASR_TIMEOUT_MS') ?? 600_000);
    const pollIntervalMs = Number(this.config.get('QWEN_ASR_POLL_INTERVAL_MS') ?? 2_000);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await this.sleep(pollIntervalMs);
      const task = await this.fetchQwenJson<QwenAsrTaskJson>(
        `${config.asyncTaskBaseUrl}/${encodeURIComponent(taskId)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
          },
          signal: AbortSignal.timeout(Math.min(timeoutMs, 60_000)),
        },
        '千问 FileTrans ASR 查询任务',
      );
      const status = task.output?.task_status?.toUpperCase();
      if (status === 'SUCCEEDED') return task;
      if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
        throw new BadRequestException(
          `千问 FileTrans ASR 任务失败（${status}）：${JSON.stringify(task).slice(0, 500)}`,
        );
      }
    }

    throw new BadRequestException('千问 FileTrans ASR 转写超时，请稍后重试');
  }

  private async fetchQwenJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`${label}请求失败: ${msg}`);
      throw new BadRequestException(`${label}不可达：${msg}`);
    }

    const raw = await res.text();
    if (!res.ok) {
      this.logger.warn(`${label} HTTP ${res.status}: ${raw.slice(0, 800)}`);
      throw new BadRequestException(`${label}返回错误（${res.status}）：${raw.slice(0, 500)}`);
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new BadRequestException(`${label}返回非 JSON，无法解析`);
    }
  }

  private normalizeFileTransResult(result: QwenFileTransResultJson): {
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  } {
    const transcripts = result.transcripts ?? [];
    const fullText = transcripts
      .map((t) => t.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n')
      .trim();
    const segments = transcripts.flatMap((t) =>
      (t.sentences ?? []).map((s) => ({
        startMs: Math.max(0, Math.round(s.begin_time ?? 0)),
        endMs: Math.max(0, Math.round(s.end_time ?? 0)),
        text: (s.text ?? '').trim(),
      })),
    );

    return {
      fullText,
      language: 'zh-CN',
      segments: segments.length > 0 ? segments : this.buildSegments(fullText),
    };
  }

  private resolveDashScopeAsyncBase(compatibleBase: string): string {
    if (compatibleBase.includes('dashscope-intl.aliyuncs.com')) {
      return 'https://dashscope-intl.aliyuncs.com/api/v1';
    }
    return 'https://dashscope.aliyuncs.com/api/v1';
  }

  private isFileTransModel(model: string): boolean {
    return model.toLowerCase().includes('filetrans');
  }

  private getAsrEnableItn(): boolean {
    const raw = this.config.get<string>('QWEN_ASR_ENABLE_ITN')?.trim().toLowerCase();
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return false;
  }

  private getOptionalAsrLanguage(): { language?: string } {
    const language = this.config.get<string>('QWEN_ASR_LANGUAGE')?.trim();
    return language ? { language } : {};
  }

  private getAsrEnableWords(): boolean {
    const raw = this.config.get<string>('QWEN_ASR_ENABLE_WORDS')?.trim().toLowerCase();
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return false;
  }

  private toAudioDataUrl(file: { buffer: Buffer; originalname: string; mimetype: string }): string {
    const mime = this.guessAudioMime(file.originalname, file.mimetype);
    return `data:${mime};base64,${file.buffer.toString('base64')}`;
  }

  private guessAudioMime(originalname: string, mimetype: string): string {
    const mt = mimetype.toLowerCase();
    if (mt.startsWith('audio/')) return mt;

    const ext = path.extname(originalname).replace('.', '').toLowerCase();
    const byExt: Record<string, string> = {
      aac: 'audio/aac',
      flac: 'audio/flac',
      m4a: 'audio/mp4',
      mp3: 'audio/mpeg',
      mp4: 'audio/mp4',
      mpeg: 'audio/mpeg',
      mpga: 'audio/mpeg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      webm: 'audio/webm',
    };
    return byExt[ext] ?? 'audio/wav';
  }

  private buildSegments(fullText: string): TranscriptSegmentDto[] {
    const chunks = fullText
      .split(/(?<=[。！？!?])|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    let cursor = 0;
    return chunks.slice(0, 100).map((text) => {
      const duration = Math.max(1200, Math.min(8000, text.length * 180));
      const segment = { startMs: cursor, endMs: cursor + duration, text };
      cursor += duration;
      return segment;
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
