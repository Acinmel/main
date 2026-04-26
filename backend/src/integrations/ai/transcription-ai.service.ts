import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mockAsrText } from './ai-mock.util';

/**
 * 语音转写（ASR）集成占位。
 *
 * 真实流水线建议：
 * 1) 下载 sourceVideoUrl 指向的视频（注意版权与平台协议）
 * 2) FFmpeg 抽取 16k/mono wav
 * 3) 调用厂商 ASR，例如 OpenAI Whisper：
 *
 *    POST ${OPENAI_BASE_URL}/audio/transcriptions
 *    Headers: Authorization: Bearer ${OPENAI_API_KEY}
 *    Content-Type: multipart/form-data
 *    Fields:
 *      - model: whisper-1
 *      - file: (wav 二进制)
 *
 * 当前实现：默认返回 mock 文案；当 ASR_MODE=whisper 且已配置 KEY 时，
 * 仍因缺少音频 buffer 而记录告警并回退 mock（先把「请求形态」与配置位留好）。
 */
@Injectable()
export class TranscriptionAiService {
  private readonly logger = new Logger(TranscriptionAiService.name);

  constructor(private readonly config: ConfigService) {}

  async transcribe(params: {
    taskId: string;
    sourceVideoUrl: string;
  }): Promise<{ fullText: string; language: string }> {
    const mode = (this.config.get<string>('ASR_MODE') ?? 'mock').toLowerCase();
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();

    if (mode === 'whisper' && apiKey) {
      this.logger.warn(
        `task=${params.taskId} 已配置 ASR_MODE=whisper，但尚未接入「下载+FFmpeg+multipart」；此处仅记录 Whisper 请求占位。`,
      );
      // 预留：const form = new FormData(); form.append('model','whisper-1'); form.append('file', blob, 'audio.wav');
      // await fetch(`${base}/audio/transcriptions`, { method:'POST', headers:{ Authorization: `Bearer ${apiKey}` }, body: form })
    }

    return {
      fullText: mockAsrText(params.sourceVideoUrl),
      language: 'zh-CN',
    };
  }
}
