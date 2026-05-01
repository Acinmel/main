import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveOpenAiStyleV1Base, resolveSpeechApiKey } from './openai-ark-compat.util';

export type OpenAiSpeechRequest = {
  /** POST ${OPENAI_BASE_URL}/audio/speech */
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    voice: string;
    input: string;
    format: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';
  };
};

/**
 * 配音（TTS）请求占位：先把「可发送的 HTTP 请求体」准备好，后续接到渲染 Worker。
 */
@Injectable()
export class SpeechAiService {
  private readonly logger = new Logger(SpeechAiService.name);

  constructor(private readonly config: ConfigService) {}

  /** 将前端的 voiceStyleId 映射到 OpenAI TTS voice（可按产品表扩展） */
  mapVoice(voiceStyleId: string): string {
    const table: Record<string, string> = {
      neutral_female: 'nova',
      magnetic_male: 'onyx',
      bright_narration: 'shimmer',
    };
    return table[voiceStyleId] ?? 'alloy';
  }

  buildOpenAiSpeechRequest(text: string, voiceStyleId: string): OpenAiSpeechRequest {
    const baseUrl = resolveOpenAiStyleV1Base(this.config);
    const apiKey = resolveSpeechApiKey(this.config);
    return {
      url: `${baseUrl}/audio/speech`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model: 'tts-1',
        voice: this.mapVoice(voiceStyleId),
        input: text,
        format: 'mp3',
      },
    };
  }

  /**
   * 当前不做真实下载音频文件；仅记录一次「将要发出的请求」，便于你后续接线。
   * 返回 ok=false 时不阻断流水线（MVP 仍以示例 mp4 作为成片占位）。
   */
  async synthesizeWithPlaceholder(params: {
    taskId: string;
    text: string;
    voiceStyleId: string;
  }): Promise<{ ok: boolean; note: string }> {
    const apiKey = resolveSpeechApiKey(this.config);
    const req = this.buildOpenAiSpeechRequest(params.text, params.voiceStyleId);
    if (!apiKey) {
      this.logger.log(
        `task=${params.taskId} TTS 跳过：未配置 OPENAI_API_KEY / ARK_API_KEY。请求预览=${JSON.stringify(
          { url: req.url, body: { ...req.body, input: `${req.body.input.slice(0, 80)}…` } },
        )}`,
      );
      return { ok: false, note: '未配置 OPENAI_API_KEY / ARK_API_KEY，跳过真实 TTS' };
    }

    this.logger.log(
      `task=${params.taskId} TTS 请求已组装（默认不自动调用以避免产生费用）。` +
        ` 若要启用：在 Worker 中 fetch(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(req.body)})`,
    );
    return { ok: true, note: 'TTS 请求体已就绪，待 Worker 启用' };
  }
}
