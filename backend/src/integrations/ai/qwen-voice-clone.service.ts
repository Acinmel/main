import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DASHSCOPE_AUDIO_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const DEFAULT_CLONE_TARGET_MODEL = 'qwen3-tts-vc-2026-01-22';
const DEFAULT_DESIGN_TARGET_MODEL = 'qwen3-tts-vd-2026-01-26';
const ENROLLMENT_MODEL = 'qwen-voice-enrollment';
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

    const audioData = this.resolveSampleData(params.sample);
    const preferredName = this.sanitizePreferredName(params.preferredName);
    const targetModel = this.resolveCloneTargetModel();
    const payload = {
      model: ENROLLMENT_MODEL,
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
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    providerVoice: string;
    requestId: string | null;
    audioUrl: string | null;
  }> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new BadRequestException('请先配置 DASHSCOPE_API_KEY 后再进行语音合成');
    }

    const model = params.targetModel?.trim() || this.resolveCloneTargetModel();
    const payload = {
      model,
      input: {
        text: params.text,
        voice: params.voice,
        ...(params.languageType?.trim()
          ? { language_type: params.languageType.trim() }
          : {}),
      },
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
    };
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
          model: ENROLLMENT_MODEL,
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

  private resolveAudioBaseUrl(): string {
    return (
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

  private async postJson(
    url: string,
    apiKey: string,
    payload: Record<string, unknown>,
  ): Promise<any> {
    const timeoutMs = Number(this.config.get('OPENAI_TIMEOUT_MS') ?? 120_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

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
