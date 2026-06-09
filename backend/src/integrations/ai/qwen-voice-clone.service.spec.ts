import { ConfigService } from '@nestjs/config';
import { QwenVoiceCloneService } from './qwen-voice-clone.service';

describe('QwenVoiceCloneService', () => {
  it('routes qwen custom voice synthesis to multimodal-generation endpoint', async () => {
    const service = new QwenVoiceCloneService(
      new ConfigService({
        DASHSCOPE_API_KEY: 'test-key',
        QWEN_TTS_DEFAULT_MODEL: 'qwen3-tts-vc-2026-01-22',
      }),
    );

    const postJson = jest
      .spyOn(
        service as unknown as {
          postJson: (
            url: string,
            apiKey: string,
            payload: Record<string, unknown>,
          ) => Promise<Record<string, unknown>>;
        },
        'postJson',
      )
      .mockResolvedValue({
        request_id: 'req_qwen_1',
        output: { audio: { url: 'https://example.com/qwen.wav' } },
      });

    jest
      .spyOn(
        service as unknown as {
          fetchBinary: (url: string) => Promise<{
            buffer: Buffer;
            mimeType: string;
          }>;
        },
        'fetchBinary',
      )
      .mockResolvedValue({
        buffer: Buffer.alloc(256, 1),
        mimeType: 'audio/wav',
      });

    await service.synthesizeVoice({
      text: '那我来给大家推荐一款T恤，这款真的非常好看，搭配起来很显气质。',
      voice: 'qwen-tts-vc-voice_xxx',
      targetModel: 'qwen3-tts-vc-2026-01-22',
      languageType: 'zh',
      speechRate: 1.12,
    });

    expect(postJson).toHaveBeenCalledWith(
      expect.stringContaining(
        '/services/aigc/multimodal-generation/generation',
      ),
      'test-key',
      expect.objectContaining({
        model: 'qwen3-tts-vc-2026-01-22',
        input: expect.objectContaining({
          voice: 'qwen-tts-vc-voice_xxx',
          language_type: 'Chinese',
          rate: 1.12,
        }),
      }),
    );
  });

  it('keeps cosyvoice endpoint for non-qwen voice ids', async () => {
    const service = new QwenVoiceCloneService(
      new ConfigService({
        DASHSCOPE_API_KEY: 'test-key',
        QWEN_COSYVOICE_TTS_MODEL: 'cosyvoice-v3.5-plus',
      }),
    );

    const postJson = jest
      .spyOn(
        service as unknown as {
          postJson: (
            url: string,
            apiKey: string,
            payload: Record<string, unknown>,
          ) => Promise<Record<string, unknown>>;
        },
        'postJson',
      )
      .mockResolvedValue({
        request_id: 'req_cosy_1',
        output: { audio: { url: 'https://example.com/cosy.mp3' } },
      });

    jest
      .spyOn(
        service as unknown as {
          fetchBinary: (url: string) => Promise<{
            buffer: Buffer;
            mimeType: string;
          }>;
        },
        'fetchBinary',
      )
      .mockResolvedValue({
        buffer: Buffer.alloc(256, 1),
        mimeType: 'audio/mpeg',
      });

    await service.synthesizeVoice({
      text: '这是一段普通音色测试文案。',
      voice: 'longxiaochun_v2',
      targetModel: 'cosyvoice-v3.5-plus',
      speechRate: 1.2,
    });

    expect(postJson).toHaveBeenCalledWith(
      expect.stringContaining('/services/audio/tts/SpeechSynthesizer'),
      'test-key',
      expect.objectContaining({
        model: 'cosyvoice-v3.5-plus',
        input: expect.objectContaining({
          voice: 'longxiaochun_v2',
          rate: 1.2,
        }),
      }),
    );
  });
});
