import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DASHSCOPE_AUDIO_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const DEFAULT_CLONE_TARGET_MODEL = 'cosyvoice-v3.5-plus';
const DEFAULT_DESIGN_TARGET_MODEL = 'cosyvoice-v3.5-plus';
const LEGACY_UPLOAD_CLONE_FALLBACK_MODEL = 'qwen3-tts-vc-2026-01-22';
const QWEN_ENROLLMENT_MODEL = 'qwen-voice-enrollment';
const COSYVOICE_ENROLLMENT_MODEL = 'voice-enrollment';
const DESIGN_MODEL = 'qwen-voice-design';
const MAX_ENROLLMENT_PAYLOAD_BYTES = 10 * 1024 * 1024;

export type QwenVoiceCloneResult = {
  provider: 'aliyun-qwen-vc';
  voice: string;
  targetModel: string;
  requestId: string | null;
};

export type QwenVoiceDesignResult = {
  provider: 'aliyun-qwen-vd';
  voice: string;
  targetModel: string;
  requestId: string | null;
  previewAudio: {
    buffer: Buffer;
    mimeType: string;
    sampleRate: number | null;
    responseFormat: string;
  };
};

type CreateQwenVoiceCloneParams = {
  preferredName: string;
  sample: {
    url?: string;
    buffer?: Buffer;
    mimeType?: string;
  };
  transcriptText?: string | null;
  language?: string | null;
};

type CreateQwenVoiceDesignParams = {
  preferredName: string;
  voicePrompt: string;
  previewText: string;
  language?: string | null;
  sampleRate?: number | null;
  responseFormat?: 'pcm' | 'wav' | 'mp3' | 'opus' | null;
};

@Injectable()
export class QwenVoiceCloneService {
  private readonly logger = new Logger(QwenVoiceCloneService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.resolveApiKey());
  }

  resolveCloneTargetModel(): string {
    return (
      this.config.get<string>('QWEN_VOICE_TARGET_MODEL')?.trim() ||
      this.config.get<string>('QWEN_TTS_CLONE_MODEL')?.trim() ||
      DEFAULT_CLONE_TARGET_MODEL
    );
  }

  resolveDesignTargetModel(): string {
    return (
      this.config.get<string>('QWEN_VOICE_DESIGN_TARGET_MODEL')?.trim() ||
      DEFAULT_DESIGN_TARGET_MODEL
    );
  }

  async createVoiceClone(
    params: CreateQwenVoiceCloneParams,
  ): Promise<QwenVoiceCloneResult> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new BadRequestException('请先配置 DASHSCOPE_API_KEY 后再进行声音克隆');
    }

    const preferredName = this.sanitizePreferredName(params.preferredName);
    let targetModel = this.resolveCloneTargetModel();
    if (this.isCosyVoiceModel(targetModel) && !params.sample.url?.trim() && params.sample.buffer?.length) {
      targetModel =
        this.config.get<string>('QWEN_UPLOAD_CLONE_FALLBACK_MODEL')?.trim() ||
        LEGACY_UPLOAD_CLONE_FALLBACK_MODEL;
      this.logger.warn(
        'CosyVoice clone requires a provider-accessible audio URL; falling back to legacy Qwen3 enrollment for local buffer upload.',
      );
    }
    if (this.isCosyVoiceModel(targetModel)) {
      const sampleUrl = params.sample.url?.trim();
      if (!sampleUrl) {
        throw new BadRequestException(
          'CosyVoice v3.5 声音复刻需要可访问的音频 URL。请配置 PUBLIC_BASE_URL 后再上传克隆样本，或临时改用 Qwen3 旧模型。',
        );
      }

      const payload = {
        model: COSYVOICE_ENROLLMENT_MODEL,
        input: {
          action: 'create_voice',
          target_model: targetModel,
          prefix: preferredName,
          url: sampleUrl,
          language_hints: this.normalizeLanguageHints(params.language),
        },
      };

      const response = await this.postJson(
        `${this.resolveAudioBaseUrl()}/services/audio/tts/customization`,
        apiKey,
        payload,
        { timeoutMs: this.resolveVoiceCloneTimeoutMs() },
      );

      const voice = this.readString(response?.output?.voice);
      if (!voice) {
        throw new BadRequestException('阿里云 CosyVoice 声音复刻未返回可用 voice');
      }

      return {
        provider: 'aliyun-qwen-vc',
        voice,
        targetModel,
        requestId: this.readString(response?.request_id),
      };
    }

    const audioData = this.resolveSampleData(params.sample);
    const payload = {
      model: QWEN_ENROLLMENT_MODEL,
      input: {
        action: 'create',
        target_model: targetModel,
        preferred_name: preferredName,
        audio: { data: audioData },
        ...(params.transcriptText?.trim()
          ? { text: params.transcriptText.trim().slice(0, 1024) }
          : {}),
        ...(params.language?.trim() ? { language: params.language.trim() } : {}),
      },
    };

    const response = await this.postJson(
      `${this.resolveAudioBaseUrl()}/services/audio/tts/customization`,
      apiKey,
      payload,
      { timeoutMs: this.resolveVoiceCloneTimeoutMs() },
    );

    const voice = this.readString(response?.output?.voice);
    const responseTargetModel =
      this.readString(response?.output?.target_model) || targetModel;

    if (!voice) {
      throw new BadRequestException('阿里云声音克隆未返回可用 voice');
    }

    return {
      provider: 'aliyun-qwen-vc',
      voice,
      targetModel: responseTargetModel,
      requestId: this.readString(response?.request_id),
    };
  }

  async designVoice(
    params: CreateQwenVoiceDesignParams,
  ): Promise<QwenVoiceDesignResult> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new BadRequestException('DASHSCOPE_API_KEY is required for voice design');
    }

    const voicePrompt = params.voicePrompt.trim();
    const previewText = params.previewText.trim();
    if (!voicePrompt || !previewText) {
      throw new BadRequestException('voice_prompt and preview_text are required');
    }

    const targetModel = this.resolveDesignTargetModel();
    const responseFormat = params.responseFormat?.trim() || 'mp3';
    const payload = {
      model: DESIGN_MODEL,
      input: {
        action: 'create',
        target_model: targetModel,
        voice_prompt: voicePrompt.slice(0, 2048),
        preview_text: previewText.slice(0, 1024),
        preferred_name: this.sanitizePreferredName(params.preferredName),
        language: params.language?.trim() || 'zh',
      },
      parameters: {
        sample_rate: params.sampleRate || 24_000,
        response_format: responseFormat,
      },
    };

    const response = await this.postJson(
      `${this.resolveAudioBaseUrl()}/services/audio/tts/customization`,
      apiKey,
      payload,
    );

    const voice = this.readString(response?.output?.voice);
    const responseTargetModel =
      this.readString(response?.output?.target_model) || targetModel;
    const audioData = this.readString(response?.output?.preview_audio?.data);
    if (!voice || !audioData) {
      throw new BadRequestException('Voice design did not return a usable voice or preview audio');
    }

    const buffer = Buffer.from(audioData, 'base64');
    if (buffer.length < 128) {
      throw new BadRequestException('Voice design returned an empty preview audio');
    }

    const returnedFormat =
      this.readString(response?.output?.preview_audio?.response_format) ||
      responseFormat;

    return {
      provider: 'aliyun-qwen-vd',
      voice,
      targetModel: responseTargetModel,
      requestId: this.readString(response?.request_id),
      previewAudio: {
        buffer,
        mimeType: this.mimeTypeForAudioFormat(returnedFormat),
        sampleRate:
          typeof response?.output?.preview_audio?.sample_rate === 'number'
            ? response.output.preview_audio.sample_rate
            : null,
        responseFormat: returnedFormat,
      },
    };
  }

  async synthesizeVoice(params: {
    text: string;
    voice: string;
    targetModel?: string | null;
    languageType?: string | null;
    instruction?: string | null;
    speechRate?: number | null;
    volume?: number | null;
    pitch?: number | null;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    providerVoice: string;
    requestId: string | null;
    audioUrl: string | null;
    styleApplied?: boolean;
    styleHint?: string;
  }> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new BadRequestException('请先配置 DASHSCOPE_API_KEY 后再进行语音合成');
    }

    const model = params.targetModel?.trim() || this.resolveCloneTargetModel();
    if (this.isCosyVoiceModel(model)) {
      return this.synthesizeCosyVoice({
        ...params,
        model,
      });
    }

    const style = this.buildSynthesisStyle(model, params);
    const languageType = this.normalizeTtsLanguageType(params.languageType);
    const payload = {
      model,
      input: {
        text: params.text,
        voice: params.voice,
        ...(languageType ? { language_type: languageType } : {}),
        ...style.input,
      },
      ...(Object.keys(style.parameters).length ? { parameters: style.parameters } : {}),
    };

    const response = await this.postJson(
      `${this.resolveAudioBaseUrl()}/services/aigc/multimodal-generation/generation`,
      apiKey,
      payload,
    );

    const audioUrl = this.readString(response?.output?.audio?.url);
    const requestId = this.readString(response?.request_id);

    if (!audioUrl) {
      throw new BadRequestException('阿里云语音合成未返回音频地址');
    }

    const audio = await this.fetchBinary(audioUrl);
    if (audio.buffer.length < 128) {
      throw new BadRequestException('阿里云语音合成返回的音频内容过小');
    }

    return {
      buffer: audio.buffer,
      mimeType: audio.mimeType,
      providerVoice: params.voice,
      requestId,
      audioUrl,
      styleApplied: style.applied,
      styleHint: style.hint,
    };
  }

  async synthesizeDefaultVoice(params: {
    text: string;
    languageType?: string | null;
    instruction?: string | null;
    speechRate?: number | null;
    volume?: number | null;
    pitch?: number | null;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    providerVoice: string;
    requestId: string | null;
    audioUrl: string | null;
    styleApplied?: boolean;
    styleHint?: string;
  }> {
    const voice = this.resolveDefaultTtsVoice();
    const targetModel = this.resolveDefaultTtsModel();
    return this.synthesizeVoice({
      ...params,
      voice,
      targetModel,
    });
  }

  async deleteVoice(voice: string): Promise<void> {
    const apiKey = this.resolveApiKey();
    const voiceName = voice.trim();
    if (!apiKey || !voiceName) return;

    try {
      await this.postJson(
        `${this.resolveAudioBaseUrl()}/services/audio/tts/customization`,
        apiKey,
        {
          model: QWEN_ENROLLMENT_MODEL,
          input: {
            action: 'delete',
            voice: voiceName,
          },
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to delete cloned voice ${voiceName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async synthesizeCosyVoice(params: {
    text: string;
    voice: string;
    model: string;
    languageType?: string | null;
    instruction?: string | null;
    speechRate?: number | null;
    volume?: number | null;
    pitch?: number | null;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    providerVoice: string;
    requestId: string | null;
    audioUrl: string | null;
    styleApplied?: boolean;
    styleHint?: string;
  }> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new BadRequestException('请先配置 DASHSCOPE_API_KEY 后再进行语音合成');
    }

    const style = this.buildSynthesisStyle(params.model, params);
    const responseFormat =
      this.config.get<string>('QWEN_TTS_RESPONSE_FORMAT')?.trim() || 'mp3';
    const rawSampleRate = Number(this.config.get('QWEN_TTS_SAMPLE_RATE') ?? 24_000);
    const payload = {
      model: params.model,
      input: {
        text: params.text,
        voice: params.voice,
        format: responseFormat,
        sample_rate: Number.isFinite(rawSampleRate) ? rawSampleRate : 24_000,
        language_hints: this.normalizeLanguageHints(params.languageType),
        ...style.input,
      },
      ...(Object.keys(style.parameters).length ? { parameters: style.parameters } : {}),
    };

    const response = await this.postJson(
      `${this.resolveAudioBaseUrl()}/services/audio/tts/SpeechSynthesizer`,
      apiKey,
      payload,
    );

    const audioUrl = this.readString(response?.output?.audio?.url);
    const requestId = this.readString(response?.request_id);
    if (!audioUrl) {
      throw new BadRequestException('阿里云 CosyVoice 语音合成未返回音频地址');
    }

    const audio = await this.fetchBinary(audioUrl);
    if (audio.buffer.length < 128) {
      throw new BadRequestException('阿里云 CosyVoice 语音合成返回的音频内容过小');
    }

    return {
      buffer: audio.buffer,
      mimeType: audio.mimeType,
      providerVoice: params.voice,
      requestId,
      audioUrl,
      styleApplied: style.applied,
      styleHint: style.hint,
    };
  }

  private resolveAudioBaseUrl(): string {
    return (
      this.config.get<string>('TTS_API_URL')?.trim() ||
      this.config.get<string>('QWEN_TTS_BASE_URL')?.trim() ||
      this.config.get<string>('DASHSCOPE_TTS_BASE_URL')?.trim() ||
      DASHSCOPE_AUDIO_BASE
    ).replace(/\/+$/, '');
  }

  private resolveApiKey(): string {
    return (
      this.config.get<string>('QWEN_TTS_API_KEY')?.trim() ||
      this.config.get<string>('DASHSCOPE_API_KEY')?.trim() ||
      ''
    );
  }

  private resolveDefaultTtsVoice(): string {
    return (
      this.config.get<string>('QWEN_TTS_DEFAULT_VOICE')?.trim() ||
      this.config.get<string>('DASHSCOPE_TTS_DEFAULT_VOICE')?.trim() ||
      'longxiaochun_v2'
    );
  }

  private resolveDefaultTtsModel(): string {
    return (
      this.config.get<string>('QWEN_TTS_DEFAULT_MODEL')?.trim() ||
      this.config.get<string>('DASHSCOPE_TTS_MODEL')?.trim() ||
      'cosyvoice-v2'
    );
  }

  private resolveVoiceCloneTimeoutMs(): number {
    const raw = Number(
      this.config.get('QWEN_VOICE_CLONE_TIMEOUT_MS') ??
        this.config.get('VOICE_CLONE_TIMEOUT_MS') ??
        600_000,
    );
    return Number.isFinite(raw) && raw >= 60_000 ? raw : 600_000;
  }

  private resolveSampleData(sample: CreateQwenVoiceCloneParams['sample']): string {
    const sampleUrl = sample.url?.trim();
    if (sampleUrl) {
      return sampleUrl;
    }

    if (!sample.buffer?.length) {
      throw new BadRequestException('声音克隆缺少样本音频');
    }

    const mimeType = sample.mimeType?.trim() || 'audio/wav';
    const dataUrl = `data:${mimeType};base64,${sample.buffer.toString('base64')}`;
    if (Buffer.byteLength(dataUrl, 'utf8') > MAX_ENROLLMENT_PAYLOAD_BYTES) {
      throw new BadRequestException(
        '上传样本经过 Base64 编码后超过 10MB，请缩短音频或压缩后重试',
      );
    }
    return dataUrl;
  }

  private sanitizePreferredName(name: string): string {
    const normalized = name
      .trim()
      .replace(/[^0-9A-Za-z_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 16);
    return normalized || `voice_${Date.now().toString(36).slice(-8)}`;
  }

  private mimeTypeForAudioFormat(format: string): string {
    switch (format.toLowerCase()) {
      case 'mp3':
        return 'audio/mpeg';
      case 'wav':
        return 'audio/wav';
      case 'opus':
        return 'audio/opus';
      case 'pcm':
        return 'audio/pcm';
      default:
        return 'application/octet-stream';
    }
  }

  private buildSynthesisStyle(
    model: string,
    params: {
      instruction?: string | null;
      speechRate?: number | null;
      volume?: number | null;
      pitch?: number | null;
    },
  ): {
    input: Record<string, unknown>;
    parameters: Record<string, unknown>;
    applied: boolean;
    hint?: string;
  } {
    const instruction = this.limitInstruction(params.instruction);
    const hasInstruction = Boolean(instruction);
    const supportsInstruction = this.supportsInstructionControls(model);
    const supportsParameterControls = this.supportsParameterControls(model);
    const input: Record<string, unknown> = {};
    const parameters: Record<string, unknown> = {};

    if (hasInstruction && supportsInstruction) {
      // CosyVoice-style models understand instruction prompts for emotion and delivery.
      input.instruction = instruction;
    }

    if (
      supportsParameterControls &&
      typeof params.speechRate === 'number' &&
      Number.isFinite(params.speechRate)
    ) {
      parameters.rate = Math.min(2, Math.max(0.5, Number(params.speechRate.toFixed(2))));
    }

    if (
      supportsParameterControls &&
      typeof params.volume === 'number' &&
      Number.isFinite(params.volume)
    ) {
      parameters.volume = Math.min(100, Math.max(0, Math.round(params.volume * 50)));
    }

    if (
      supportsParameterControls &&
      typeof params.pitch === 'number' &&
      Number.isFinite(params.pitch)
    ) {
      parameters.pitch = Math.min(2, Math.max(0.5, Number(params.pitch.toFixed(2))));
    }

    const applied = Object.keys(input).length > 0 || Object.keys(parameters).length > 0;
    if (hasInstruction && !supportsInstruction) {
      return {
        input,
        parameters,
        applied,
        hint:
          applied
            ? '当前音色模型不支持情绪指令，已应用语速/音量/音调参数生成。'
            : '当前音色模型不支持情绪指令，已按原音色合成。',
      };
    }

    return {
      input,
      parameters,
      applied,
      hint: applied ? `已使用 ${model} 的情绪指令或语速/音量/音调参数生成配音。` : undefined,
    };
  }

  private isCosyVoiceModel(model?: string | null): boolean {
    return /^cosyvoice-/i.test(model?.trim() || '');
  }

  private supportsInstructionControls(model: string): boolean {
    const normalized = model.trim().toLowerCase();
    return /^cosyvoice-v3/i.test(normalized) || /instruct/i.test(normalized);
  }

  private supportsParameterControls(model: string): boolean {
    return this.isCosyVoiceModel(model);
  }

  private limitInstruction(value?: string | null): string | null {
    const trimmed = value?.trim();
    if (!trimmed) return null;
    return Array.from(trimmed).slice(0, 100).join('');
  }

  private normalizeLanguageHints(language?: string | null): string[] {
    const raw = language?.trim().toLowerCase();
    if (!raw) return ['zh'];
    if (raw.includes('en') || raw === 'english') return ['en'];
    if (raw.includes('ja') || raw.includes('jp') || raw === 'japanese') return ['ja'];
    if (raw.includes('ko') || raw === 'korean') return ['ko'];
    if (raw.includes('yue') || raw.includes('hk') || raw.includes('cantonese')) return ['yue'];
    return ['zh'];
  }

  private normalizeTtsLanguageType(language?: string | null): string | null {
    const raw = language?.trim();
    if (!raw) return null;
    const key = raw.toLowerCase().replace(/_/g, '-');
    const map: Record<string, string> = {
      auto: 'auto',
      zh: 'chinese',
      'zh-cn': 'chinese',
      'zh-hans': 'chinese',
      'zh-hant': 'chinese',
      'zh-hk': 'chinese',
      'zh-tw': 'chinese',
      cn: 'chinese',
      chinese: 'chinese',
      mandarin: 'chinese',
      yue: 'chinese',
      cantonese: 'chinese',
      en: 'english',
      'en-us': 'english',
      'en-gb': 'english',
      english: 'english',
      de: 'german',
      german: 'german',
      it: 'italian',
      italian: 'italian',
      pt: 'portuguese',
      'pt-br': 'portuguese',
      portuguese: 'portuguese',
      es: 'spanish',
      spanish: 'spanish',
      ja: 'japanese',
      jp: 'japanese',
      japanese: 'japanese',
      ko: 'korean',
      korean: 'korean',
      fr: 'french',
      french: 'french',
      ru: 'russian',
      russian: 'russian',
    };
    return map[key] ?? 'auto';
  }

  private async postJson(
    url: string,
    apiKey: string,
    payload: Record<string, unknown>,
    options: { timeoutMs?: number } = {},
  ): Promise<any> {
    const timeoutMs = Number(options.timeoutMs ?? this.config.get('OPENAI_TIMEOUT_MS') ?? 120_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (error) {
        if (this.isAbortError(error)) {
          throw new BadRequestException(
            `阿里云语音接口请求超时（${Math.round(timeoutMs / 1000)}秒），请稍后重试`,
          );
        }
        throw error;
      }

      const text = await response.text().catch(() => '');
      const json = text ? this.tryParseJson(text) : null;

      if (!response.ok) {
        const providerMessage = this.formatProviderError(response.status, json, text);
        throw new BadRequestException(
          `阿里云语音接口失败：${providerMessage}`,
        );
      }

      return json ?? {};
    } finally {
      clearTimeout(timer);
    }
  }

  private isAbortError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'AbortError' || /aborted/i.test(error.message))
    );
  }

  private async fetchBinary(url: string): Promise<{
    buffer: Buffer;
    mimeType: string;
  }> {
    const timeoutMs = Number(this.config.get('OPENAI_TIMEOUT_MS') ?? 120_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new BadRequestException(
          `下载阿里云合成音频失败：HTTP ${response.status}`,
        );
      }

      return {
        buffer: Buffer.from(await response.arrayBuffer()),
        mimeType:
          response.headers.get('content-type')?.split(';', 1)[0].trim() ||
          'audio/wav',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private tryParseJson(text: string): any {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private formatProviderError(status: number, json: any, rawText: string): string {
    const code = this.readString(json?.code);
    const message = this.readString(json?.message);
    const requestId = this.readString(json?.request_id);
    const parts = [`HTTP ${status}`];
    if (code) parts.push(code);
    if (message) parts.push(message);
    if (requestId) parts.push(`request_id=${requestId}`);
    if (parts.length > 1) return parts.join(' | ');
    return `HTTP ${status} ${rawText.slice(0, 500)}`;
  }
}
