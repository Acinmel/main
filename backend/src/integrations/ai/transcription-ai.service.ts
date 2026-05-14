import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_TRANSCRIBE_MEDIA_MAX_BYTES } from '../../common/media.constants';
import { resolveConfiguredDir } from '../../common/resource-paths.util';
import type {
  TranscribeResultDto,
  TranscriptSegmentDto,
} from '../transcription/transcript.types';
import { TranscriptStore } from '../transcription/transcript.store';
import { buildMockSegments, mockAsrText } from './ai-mock.util';

const execFileAsync = promisify(execFile);

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

interface OpenAiTranscriptionVerboseJson {
  text?: string;
  language?: string;
  segments?: Array<{
    start?: number;
    end?: number;
    text?: string;
  }>;
}

interface DashScopeRealtimeTranscriptionJson {
  requestId?: string;
  fullText?: string;
  language?: string;
  segments?: Array<{
    startMs?: number;
    endMs?: number;
    text?: string;
  }>;
}

type AsrProvider =
  | 'dashscope'
  | 'openai-compatible'
  | 'mock';

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
    const result = await this.transcribeFromSourceReference(params.sourceVideoUrl);
    return { fullText: result.fullText, language: result.language };
  }

  async transcribeMedia(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<TranscribeResultDto> {
    this.assertAcceptableMedia(file);
    const result = await this.transcribeFromMedia(file);
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
    provider?: AsrProvider;
    error?: string;
  }> {
    const t0 = Date.now();
    try {
      const provider = this.resolveProvider();
      if (provider.type === 'dashscope') {
        return {
          ok: true,
          transcribeUrlConfigured: true,
          healthUrl: this.isRealtimeModel(provider.config.model)
            ? this.getDashScopeRealtimeWsUrl()
            : this.isFileTransModel(provider.config.model)
              ? provider.config.asyncSubmitUrl
              : provider.config.chatCompletionsUrl,
          latencyMs: Date.now() - t0,
          provider: 'dashscope',
        };
      }
      if (provider.type === 'openai-compatible') {
        return {
          ok: true,
          transcribeUrlConfigured: true,
          healthUrl: provider.config.url,
          latencyMs: Date.now() - t0,
          provider: 'openai-compatible',
        };
      }
      return {
        ok: true,
        transcribeUrlConfigured: false,
        healthUrl: 'mock://transcription',
        latencyMs: Date.now() - t0,
        provider: 'mock',
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

  private async transcribeFromSourceReference(sourceRef: string): Promise<{
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  }> {
    const provider = this.resolveProvider();
    if (provider.type === 'dashscope') {
      if (this.isRealtimeModel(provider.config.model)) {
        const maybeLocal = this.resolveLocalSourceReference(sourceRef);
        if (!maybeLocal) {
          if (this.isMockFallbackEnabled()) {
            this.logger.warn(
              'FunASR 实时 SDK 仅支持本地文件输入，sourceVideoUrl 非本地媒体，已回退 mock',
            );
            return this.buildMockTranscript(sourceRef);
          }
          throw new BadRequestException(
            'FunASR 实时转写仅支持本地媒体文件，请改走上传转写或先保存视频后再转写。',
          );
        }
        return this.transcribeLocalFileWithDashScopeRealtimeSdk(maybeLocal, provider.config);
      }
      return this.transcribeWithQwenAsr(sourceRef, provider.config);
    }
    return this.buildMockTranscript(sourceRef);
  }

  private async transcribeFromMedia(file: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }): Promise<{
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  }> {
    const provider = this.resolveProvider();
    if (provider.type === 'dashscope') {
      if (this.isRealtimeModel(provider.config.model)) {
        return this.transcribeWithDashScopeRealtimeSdk(file, provider.config);
      }
      return this.transcribeWithQwenAsr(this.toAudioDataUrl(file), provider.config);
    }
    if (provider.type === 'openai-compatible') {
      return this.transcribeWithOpenAiStyleApi(file, provider.config);
    }
    return this.buildMockTranscript(file.originalname);
  }

  private resolveProvider():
    | {
        type: 'dashscope';
        config: ReturnType<TranscriptionAiService['getQwenAsrConfig']>;
      }
    | {
        type: 'openai-compatible';
        config: ReturnType<TranscriptionAiService['getOpenAiTranscribeConfig']>;
      }
    | {
        type: 'mock';
      } {
    if (this.hasDashScopeConfig()) {
      return { type: 'dashscope', config: this.getQwenAsrConfig() };
    }
    if (this.hasOpenAiCompatibleConfig()) {
      return { type: 'openai-compatible', config: this.getOpenAiTranscribeConfig() };
    }
    if (this.isMockFallbackEnabled()) {
      return { type: 'mock' };
    }
    throw new BadRequestException(
      '未配置可用转写服务。请设置 DASHSCOPE_API_KEY，或配置 ASR_API_KEY/OPENAI_API_KEY；本地联调可启用 AI_MOCK_FALLBACK=true。',
    );
  }

  private hasDashScopeConfig(): boolean {
    return Boolean(this.config.get<string>('DASHSCOPE_API_KEY')?.trim());
  }

  private hasOpenAiCompatibleConfig(): boolean {
    return Boolean(
      this.config.get<string>('ASR_API_KEY')?.trim() ||
        this.config.get<string>('OPENAI_API_KEY')?.trim(),
    );
  }

  private isMockFallbackEnabled(): boolean {
    const raw = this.config.get<string>('AI_MOCK_FALLBACK')?.trim().toLowerCase();
    if (raw === 'true' || raw === '1' || raw === 'on') return true;
    if (raw === 'false' || raw === '0' || raw === 'off') return false;
    return false;
  }

  private getOpenAiTranscribeConfig(): {
    apiKey: string;
    url: string;
    model: string;
    language?: string;
  } {
    const apiKey =
      this.config.get<string>('ASR_API_KEY')?.trim() ||
      this.config.get<string>('OPENAI_API_KEY')?.trim() ||
      '';
    if (!apiKey) {
      throw new BadRequestException('未配置 ASR_API_KEY / OPENAI_API_KEY');
    }
    const base =
      this.config.get<string>('ASR_API_BASE_URL')?.trim() ||
      this.config.get<string>('OPENAI_BASE_URL')?.trim() ||
      'https://api.openai.com/v1';
    const model =
      this.config.get<string>('ASR_API_MODEL')?.trim() ||
      this.config.get<string>('OPENAI_TRANSCRIBE_MODEL')?.trim() ||
      'whisper-1';
    const language = this.config.get<string>('ASR_LANGUAGE')?.trim();
    return {
      apiKey,
      url: `${base.replace(/\/+$/, '')}/audio/transcriptions`,
      model,
      language: language || undefined,
    };
  }

  private async transcribeWithOpenAiStyleApi(
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    config: ReturnType<TranscriptionAiService['getOpenAiTranscribeConfig']>,
  ): Promise<{
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  }> {
    const timeoutMs = Number(this.config.get('ASR_TIMEOUT_MS') ?? 600_000);
    const fileBytes = new Uint8Array(file.buffer.byteLength);
    fileBytes.set(file.buffer);

    const form = new FormData();
    form.append(
      'file',
      new Blob([fileBytes], {
        type: this.guessAudioMime(file.originalname, file.mimetype),
      }),
      file.originalname || 'audio.wav',
    );
    form.append('model', config.model);
    form.append('response_format', 'verbose_json');
    if (config.language) {
      form.append('language', config.language);
    }

    let res: Response;
    try {
      res = await fetch(config.url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`OpenAI 兼容转写 API 请求失败: ${msg}`);
      if (this.isMockFallbackEnabled()) {
        this.logger.warn('OpenAI 兼容转写失败，已回退本地 mock');
        return this.buildMockTranscript(file.originalname);
      }
      throw new BadRequestException(`OpenAI 兼容转写 API 不可达：${msg}`);
    }

    const raw = await res.text();
    if (!res.ok) {
      this.logger.warn(`OpenAI 兼容转写 API HTTP ${res.status}: ${raw.slice(0, 800)}`);
      if (this.isMockFallbackEnabled()) {
        this.logger.warn('OpenAI 兼容转写返回错误，已回退本地 mock');
        return this.buildMockTranscript(file.originalname);
      }
      throw new BadRequestException(
        `OpenAI 兼容转写 API 返回错误（${res.status}）：${raw.slice(0, 500)}`,
      );
    }

    let json: OpenAiTranscriptionVerboseJson;
    try {
      json = JSON.parse(raw) as OpenAiTranscriptionVerboseJson;
    } catch {
      throw new BadRequestException('OpenAI 兼容转写 API 返回非 JSON，无法解析');
    }

    const fullText = json.text?.trim() ?? '';
    if (!fullText) {
      if (this.isMockFallbackEnabled()) {
        this.logger.warn('OpenAI 兼容转写返回空文本，已回退本地 mock');
        return this.buildMockTranscript(file.originalname);
      }
      throw new BadRequestException('OpenAI 兼容转写 API 未返回有效转写文本');
    }

    const segments = (json.segments ?? [])
      .map((segment) => ({
        startMs: Math.max(0, Math.round((segment.start ?? 0) * 1000)),
        endMs: Math.max(0, Math.round((segment.end ?? 0) * 1000)),
        text: segment.text?.trim() ?? '',
      }))
      .filter((segment) => segment.text);

    return {
      fullText,
      language: json.language?.trim() || config.language || 'zh-CN',
      segments: segments.length ? segments : this.buildSegments(fullText),
    };
  }

  private buildMockTranscript(source: string): {
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  } {
    const fullText = mockAsrText(source);
    return {
      fullText,
      language: 'zh-CN',
      segments: buildMockSegments(fullText),
    };
  }

  private async transcribeWithQwenAsr(
    audioData: string,
    config: ReturnType<TranscriptionAiService['getQwenAsrConfig']>,
  ): Promise<{
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  }> {
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

  private async transcribeWithDashScopeRealtimeSdk(
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    config: ReturnType<TranscriptionAiService['getQwenAsrConfig']>,
  ): Promise<{
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  }> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-funasr-'));
    const ext = this.resolveRealtimeAudioExtension(file.originalname, file.mimetype);
    const inputPath = path.join(tmpDir, `input${ext}`);
    try {
      await fs.writeFile(inputPath, file.buffer);
      return await this.transcribeLocalFileWithDashScopeRealtimeSdk(inputPath, config, {
        originalname: file.originalname,
        mimetype: file.mimetype,
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async transcribeLocalFileWithDashScopeRealtimeSdk(
    filePath: string,
    config: ReturnType<TranscriptionAiService['getQwenAsrConfig']>,
    meta?: { originalname?: string; mimetype?: string },
  ): Promise<{
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  }> {
    const timeoutMs = Number(this.config.get('ASR_TIMEOUT_MS') ?? 600_000);
    const scriptPath = this.resolveDashScopeRealtimeScriptPath();
    const python = this.resolveAsrPythonCommand();
    const args = [
      ...python.prefixArgs,
      scriptPath,
      '--file',
      filePath,
      '--model',
      config.model,
      '--format',
      this.resolveRealtimeAudioFormat(meta?.originalname || filePath, meta?.mimetype || ''),
      '--sample-rate',
      String(this.getDashScopeRealtimeSampleRate()),
    ];
    const language = this.config.get<string>('QWEN_ASR_LANGUAGE')?.trim();
    if (language) {
      args.push('--language', language);
    }
    if (this.getDashScopeSemanticPunctuationEnabled()) {
      args.push('--semantic-punctuation-enabled');
    }

    try {
      const { stdout } = await execFileAsync(python.command, args, {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        env: {
          ...process.env,
          DASHSCOPE_API_KEY: config.apiKey,
          DASHSCOPE_REALTIME_WS_URL: this.getDashScopeRealtimeWsUrl(),
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
      });
      return this.normalizeDashScopeRealtimeResult(stdout);
    } catch (e) {
      const err = e as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
      const stderr = err.stderr?.toString?.().trim() ?? '';
      const stdout = err.stdout?.toString?.().trim() ?? '';
      const detail = this.extractDashScopeRealtimeError(stderr || stdout || err.message);
      this.logger.error(
        `FunASR 实时转写失败: ${detail}${stderr ? ` | stderr=${stderr.slice(0, 500)}` : ''}`,
      );
      if (this.isMockFallbackEnabled()) {
        this.logger.warn('FunASR 实时转写失败，已回退本地 mock');
        return this.buildMockTranscript(meta?.originalname || path.basename(filePath));
      }
      throw new BadRequestException(`FunASR 实时转写失败：${detail}`);
    }
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

  private isRealtimeModel(model: string): boolean {
    const normalized = model.toLowerCase();
    return normalized.includes('fun-asr-realtime') || normalized.includes('funasr');
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

  private getDashScopeSemanticPunctuationEnabled(): boolean {
    const raw = this.config
      .get<string>('QWEN_ASR_SEMANTIC_PUNCTUATION_ENABLED')
      ?.trim()
      .toLowerCase();
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return true;
  }

  private getDashScopeRealtimeSampleRate(): number {
    const raw =
      this.config.get<string>('QWEN_ASR_SAMPLE_RATE')?.trim() ||
      this.config.get<string>('ASR_SAMPLE_RATE')?.trim() ||
      '16000';
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
    return 16000;
  }

  private getDashScopeRealtimeWsUrl(): string {
    return (
      this.config.get<string>('DASHSCOPE_REALTIME_WS_URL')?.trim() ||
      'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
    );
  }

  private resolveDashScopeRealtimeScriptPath(): string {
    const fromEnv = this.config.get<string>('ASR_FUNASR_SCRIPT')?.trim();
    if (fromEnv && existsSync(fromEnv)) return fromEnv;

    const candidates = [
      path.join(process.cwd(), 'scripts', 'dashscope_funasr_transcribe.py'),
      path.join(process.cwd(), 'backend', 'scripts', 'dashscope_funasr_transcribe.py'),
      path.join(__dirname, '..', '..', '..', 'scripts', 'dashscope_funasr_transcribe.py'),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    throw new BadRequestException('未找到 FunASR Python 转写脚本，请检查 backend/scripts 目录。');
  }

  private resolveAsrPythonCommand(): {
    command: string;
    prefixArgs: string[];
  } {
    const fromEnv = this.config.get<string>('ASR_PYTHON_BIN')?.trim();
    if (fromEnv) {
      return { command: fromEnv, prefixArgs: this.readCommandArgs('ASR_PYTHON_ARGS') };
    }

    const genericPython = this.config.get<string>('PYTHON_BIN')?.trim();
    if (genericPython) {
      return { command: genericPython, prefixArgs: this.readCommandArgs('ASR_PYTHON_ARGS') };
    }

    if (process.platform === 'win32') {
      return { command: 'py', prefixArgs: ['-3'] };
    }

    return { command: 'python3', prefixArgs: [] };
  }

  private readCommandArgs(key: string): string[] {
    const raw = this.config.get<string>(key)?.trim();
    return raw ? raw.split(/\s+/).filter(Boolean) : [];
  }

  private normalizeDashScopeRealtimeResult(raw: string | Buffer): {
    fullText: string;
    language: string;
    segments: TranscriptSegmentDto[];
  } {
    let json: DashScopeRealtimeTranscriptionJson;
    try {
      json = JSON.parse(raw.toString()) as DashScopeRealtimeTranscriptionJson;
    } catch {
      throw new BadRequestException('FunASR 实时转写返回非 JSON，无法解析。');
    }

    const fullText = json.fullText?.trim() ?? '';
    if (!fullText) {
      throw new BadRequestException('FunASR 实时转写未返回有效文本。');
    }

    const segments = (json.segments ?? [])
      .map((segment) => ({
        startMs: Math.max(0, Math.round(segment.startMs ?? 0)),
        endMs: Math.max(0, Math.round(segment.endMs ?? 0)),
        text: segment.text?.trim() ?? '',
      }))
      .filter((segment) => segment.text);

    return {
      fullText,
      language: json.language?.trim() || 'zh-CN',
      segments: segments.length > 0 ? segments : this.buildSegments(fullText),
    };
  }

  private extractDashScopeRealtimeError(raw: string): string {
    if (!raw) {
      return '未知错误';
    }
    try {
      const json = JSON.parse(raw) as {
        message?: string;
        code?: string;
        status_code?: number;
      };
      const parts = [json.code, json.message, json.status_code?.toString()].filter(Boolean);
      return parts.join(' | ') || raw;
    } catch {
      return raw;
    }
  }

  private resolveLocalSourceReference(sourceRef: string): string | null {
    const trimmed = sourceRef.trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed) || /^data:/i.test(trimmed)) {
      return null;
    }
    const saveDir = resolveConfiguredDir(this.config.get<string>('VIDEO_SAVE_DIR'), 'download-video');
    const candidates = [path.resolve(trimmed), path.resolve(path.join(saveDir, path.basename(trimmed)))];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private resolveRealtimeAudioExtension(originalname: string, mimetype: string): string {
    const ext = path.extname(originalname).toLowerCase();
    if (ext) return ext;
    const mime = this.guessAudioMime(originalname, mimetype);
    if (mime === 'audio/mpeg') return '.mp3';
    if (mime === 'audio/mp4') return '.m4a';
    if (mime === 'audio/flac') return '.flac';
    if (mime === 'audio/ogg') return '.ogg';
    if (mime === 'audio/webm') return '.webm';
    return '.wav';
  }

  private resolveRealtimeAudioFormat(originalname: string, mimetype: string): string {
    const ext = this.resolveRealtimeAudioExtension(originalname, mimetype).replace('.', '');
    const alias: Record<string, string> = {
      mpeg: 'mp3',
      mpga: 'mp3',
      wave: 'wav',
      xwav: 'wav',
    };
    return alias[ext] ?? (ext || 'wav');
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
