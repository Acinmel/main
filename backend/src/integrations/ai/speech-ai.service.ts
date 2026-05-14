import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  resolveOpenAiStyleV1Base,
  resolveSpeechApiKey,
  resolveSpeechModel,
} from './openai-ark-compat.util';
import { QwenVoiceCloneService } from './qwen-voice-clone.service';

export type OpenAiSpeechRequest = {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    voice: string;
    input: string;
    format: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';
    speed?: number;
  };
};

export type VoiceTuningOptions = {
  language?: string | null;
  emotion?: string | null;
  emotionIntensity?: number | null;
  speechRate?: number | null;
  volume?: number | null;
};

type SpeechMimeType =
  | 'audio/mpeg'
  | 'audio/wav'
  | 'audio/mp4'
  | 'application/octet-stream';

@Injectable()
export class SpeechAiService {
  private readonly logger = new Logger(SpeechAiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly qwenVoiceClone: QwenVoiceCloneService,
  ) {}

  mapVoice(voiceStyleId: string, voiceName?: string): string {
    const key = `${voiceStyleId} ${voiceName ?? ''}`.toLowerCase();
    const table: Array<[RegExp, string]> = [
      [/(neutral_female|female|woman|nova|清亮|温柔|甜美)/, 'nova'],
      [/(magnetic_male|male|man|onyx|磁性|低沉|男声)/, 'onyx'],
      [/(bright_narration|narration|旁白|讲述|解说|播音|shimmer)/, 'shimmer'],
      [/(cheerful|bright|阳光|活力|轻快|fable)/, 'fable'],
    ];
    return table.find(([pattern]) => pattern.test(key))?.[1] ?? 'alloy';
  }

  buildOpenAiSpeechRequest(
    text: string,
    voiceStyleId: string,
    voiceName?: string,
    voiceTuning?: VoiceTuningOptions,
  ): OpenAiSpeechRequest {
    const baseUrl = resolveOpenAiStyleV1Base(this.config);
    const apiKey = resolveSpeechApiKey(this.config);
    const model = resolveSpeechModel(this.config);
    const speed = this.normalizeOpenAiSpeed(voiceTuning?.speechRate);
    return {
      url: `${baseUrl}/audio/speech`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model,
        voice: this.mapVoice(voiceStyleId, voiceName),
        input: text,
        format: 'mp3',
        ...(speed ? { speed } : {}),
      },
    };
  }

  isConfigured(): boolean {
    return Boolean(resolveSpeechApiKey(this.config) || this.qwenVoiceClone.isConfigured());
  }

  async synthesizeAudio(params: {
    taskId?: string;
    text: string;
    voiceStyleId: string;
    voiceName?: string;
    provider?: string | null;
    providerVoice?: string | null;
    providerModel?: string | null;
    voiceTuning?: VoiceTuningOptions;
  }): Promise<{
    ok: true;
    buffer: Buffer;
    mimeType: SpeechMimeType;
    voice: string;
    styleApplied?: boolean;
    styleHint?: string;
  }> {
    if (this.isQwenCustomVoiceProvider(params.provider) && params.providerVoice) {
      if (!this.qwenVoiceClone.isConfigured()) {
        throw new BadRequestException('DASHSCOPE_API_KEY is required for Qwen custom voices');
      }

      const qwenSpeech = await this.qwenVoiceClone.synthesizeVoice({
        text: params.text,
        voice: params.providerVoice,
        targetModel: params.providerModel,
        languageType: params.voiceTuning?.language || this.detectLanguageType(params.text),
        instruction: this.buildVoiceInstruction(params.voiceTuning),
        speechRate: params.voiceTuning?.speechRate,
        volume: params.voiceTuning?.volume,
      });

      return {
        ok: true,
        buffer: qwenSpeech.buffer,
        mimeType: this.normalizeMimeType(qwenSpeech.mimeType),
        voice: params.providerVoice,
        styleApplied: qwenSpeech.styleApplied,
        styleHint: qwenSpeech.styleHint,
      };
    }

    const req = this.buildOpenAiSpeechRequest(
      params.text,
      params.voiceStyleId,
      params.voiceName,
      params.voiceTuning,
    );
    const apiKey = resolveSpeechApiKey(this.config);
    if (!apiKey) {
      throw new BadRequestException('未配置可用 TTS 密钥，无法生成音频');
    }

    const timeoutMs = Number(this.config.get('OPENAI_TIMEOUT_MS') ?? 120_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new BadRequestException(
          `音频合成失败：HTTP ${res.status} ${text.slice(0, 500)}`,
        );
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 128) {
        throw new BadRequestException('音频合成失败：返回内容过小');
      }

      return {
        ok: true,
        buffer,
        mimeType: 'audio/mpeg',
        voice: req.body.voice,
        styleApplied: Boolean(req.body.speed),
        styleHint: req.body.speed
          ? `已按语速 ${req.body.speed.toFixed(2)} 生成；当前通用 TTS 接口不支持情绪强度。`
          : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async synthesizeWithPlaceholder(params: {
    taskId: string;
    text: string;
    voiceStyleId: string;
  }): Promise<{ ok: boolean; note: string }> {
    const apiKey = resolveSpeechApiKey(this.config);
    const req = this.buildOpenAiSpeechRequest(params.text, params.voiceStyleId);
    if (!apiKey) {
      this.logger.log(
        `task=${params.taskId} TTS skipped because no generic speech key is configured: ${JSON.stringify(
          {
            url: req.url,
            body: { ...req.body, input: `${req.body.input.slice(0, 80)}...` },
          },
        )}`,
      );
      return { ok: false, note: '未配置通用 TTS 密钥，跳过真实 TTS' };
    }

    this.logger.log(
      `task=${params.taskId} TTS request assembled but not dispatched automatically`,
    );
    return { ok: true, note: 'TTS 请求体已就绪，待 Worker 启用' };
  }

  private isQwenCustomVoiceProvider(provider?: string | null): boolean {
    return provider === 'aliyun-qwen-vc' || provider === 'aliyun-qwen-vd';
  }

  private normalizeMimeType(input: string): SpeechMimeType {
    if (input === 'audio/wav' || input === 'audio/mp4' || input === 'audio/mpeg') {
      return input;
    }
    return 'application/octet-stream';
  }

  private normalizeOpenAiSpeed(value?: number | null): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const speed = Math.min(4, Math.max(0.25, value));
    return Math.abs(speed - 1) < 0.01 ? null : Number(speed.toFixed(2));
  }

  private buildVoiceInstruction(tuning?: VoiceTuningOptions): string | null {
    if (!tuning) return null;
    const parts: string[] = [];
    const emotion = tuning.emotion?.trim();
    const emotionMap: Record<string, string> = {
      自然: '自然真实，像真人口播，不要机械朗读',
      开心: '带笑意，轻快热情，像真诚分享',
      沉稳: '沉稳克制，节奏平稳，有可信赖感',
      紧张: '略带紧迫感，语速稍快，吐字清楚',
      激励: '积极有力量，重点词略加强',
    };
    if (emotion) {
      parts.push(emotionMap[emotion] || `${emotion}语气，表达自然`);
    }

    if (typeof tuning.emotionIntensity === 'number' && Number.isFinite(tuning.emotionIntensity)) {
      const intensity = Math.min(1.5, Math.max(0.6, tuning.emotionIntensity));
      const label = intensity >= 1.18 ? '情绪更明显' : intensity <= 0.85 ? '情绪更克制' : '情绪适中';
      parts.push(label);
    }

    if (typeof tuning.speechRate === 'number' && Number.isFinite(tuning.speechRate)) {
      if (tuning.speechRate >= 1.08) parts.push('语速稍快但吐字清楚');
      else if (tuning.speechRate <= 0.92) parts.push('语速稍慢，停顿自然');
    }

    if (typeof tuning.volume === 'number' && Number.isFinite(tuning.volume)) {
      if (tuning.volume >= 1.12) parts.push('音量略强，有存在感');
      else if (tuning.volume <= 0.88) parts.push('音量略柔和');
    }

    if (!parts.length) return null;
    return `${parts.join('；')}。只朗读正文。`;
  }

  private detectLanguageType(text: string): string {
    return /[\u4e00-\u9fff]/.test(text) ? 'Chinese' : 'English';
  }
}
