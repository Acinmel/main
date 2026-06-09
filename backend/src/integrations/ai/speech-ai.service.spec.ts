import { ConfigService } from '@nestjs/config';
import { SpeechAiService } from './speech-ai.service';
import { QwenVoiceCloneService } from './qwen-voice-clone.service';

describe('SpeechAiService', () => {
  function makeService() {
    const config = {
      get: jest.fn(),
    } as unknown as ConfigService;

    const qwenVoiceClone = {
      isConfigured: jest.fn().mockReturnValue(true),
      synthesizeVoice: jest.fn().mockResolvedValue({
        buffer: Buffer.from('ok'),
        mimeType: 'audio/mpeg',
        providerVoice: 'qwen-tts-vc-voice-test',
        requestId: 'req-test',
        audioUrl: 'https://example.com/audio.mp3',
      }),
      synthesizeDefaultVoice: jest.fn().mockResolvedValue({
        buffer: Buffer.from('ok'),
        mimeType: 'audio/mpeg',
        providerVoice: 'longxiaochun_v2',
        requestId: 'req-default',
        audioUrl: 'https://example.com/audio-default.mp3',
      }),
    } as unknown as QwenVoiceCloneService;

    return {
      service: new SpeechAiService(config, qwenVoiceClone),
      qwenVoiceClone,
    };
  }

  it('uses speed-only controls for aliyun qwen custom voice', async () => {
    const { service, qwenVoiceClone } = makeService();

    await service.synthesizeAudio({
      text: '中文测试',
      voiceStyleId: 'voice_001',
      provider: 'aliyun-qwen-vc',
      providerVoice: 'qwen-tts-vc-voice-test',
      providerModel: 'qwen3-tts-vc-2026-01-22',
      voiceTuning: {
        emotion: 'happy',
        emotionIntensity: 1.3,
        speechRate: 2.8,
        volume: 1.4,
        pitch: 1.3,
      },
    });

    expect(
      (qwenVoiceClone.synthesizeVoice as jest.Mock).mock.calls[0][0],
    ).toMatchObject({
      instruction: null,
      speechRate: 2,
      volume: null,
      pitch: null,
    });
  });

  it('uses speed-only controls for aliyun default voice synthesis', async () => {
    const { service, qwenVoiceClone } = makeService();

    await service.synthesizeAudio({
      text: '英文 test',
      voiceStyleId: 'default',
      voiceTuning: {
        speechRate: 0.4,
        emotion: 'sad',
      },
    });

    expect(
      (qwenVoiceClone.synthesizeDefaultVoice as jest.Mock).mock.calls[0][0],
    ).toMatchObject({
      instruction: null,
      speechRate: 0.5,
      volume: null,
      pitch: null,
    });
  });
});
