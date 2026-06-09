import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DatabaseService } from '../../database/database.service';
import type { SpeechAiService } from '../../integrations/ai/speech-ai.service';
import type { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import type { ResourcesService } from '../resources/resources.service';
import type { TaskStatusCacheService } from './task-status-cache.service';
import { VoicePreviewTaskService } from './voice-preview-task.service';

function makeService() {
  const db = {
    queryOne: jest.fn(),
    queryAll: jest.fn().mockResolvedValue([]),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const resources = {
    getVoice: jest.fn(),
    readManagedVoiceSample: jest.fn(),
  };
  const speechAi = {
    synthesizeAudio: jest.fn(),
  };
  const ffmpegAudio = {
    probeDurationSeconds: jest.fn(),
  };
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        PREVIEW_AUDIO_STREAM_SECRET: 'preview-secret',
        PREVIEW_AUDIO_URL_TTL_SECONDS: 300,
      };
      return values[key];
    }),
  } as unknown as ConfigService;
  const service = new VoicePreviewTaskService(
    config,
    db as unknown as DatabaseService,
    cache as unknown as TaskStatusCacheService,
    resources as unknown as ResourcesService,
    speechAi as unknown as SpeechAiService,
    ffmpegAudio as unknown as FfmpegAudioService,
  );

  return { service, db, cache, resources, speechAi, ffmpegAudio };
}

describe('VoicePreviewTaskService', () => {
  it('creates queued task and schedules async execution', () => {
    const { service } = makeService();
    const persistSpy = jest
      .spyOn(
        service as unknown as { persistTask: () => Promise<void> },
        'persistTask',
      )
      .mockResolvedValue(undefined);
    const runSpy = jest
      .spyOn(service as unknown as { runTask: () => Promise<void> }, 'runTask')
      .mockResolvedValue(undefined);

    const task = service.createTask('user-1', {
      script: 'test script',
      voiceResourceId: 'voice-1',
    });

    expect(task.previewTaskId).toMatch(/^voice_preview_/);
    expect(task.status).toBe('queued');
    expect(task.audioUrl).toBeUndefined();
    expect(persistSpy).toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalledWith(task.previewTaskId);
  });

  it('marks previous user preview task as superseded', async () => {
    const { service } = makeService();
    jest
      .spyOn(
        service as unknown as { persistTask: () => Promise<void> },
        'persistTask',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as unknown as { runTask: () => Promise<void> }, 'runTask')
      .mockResolvedValue(undefined);

    const first = service.createTask('user-1', {
      script: 'first script',
      voiceResourceId: 'voice-1',
    });
    const second = service.createTask('user-1', {
      script: 'second script',
      voiceResourceId: 'voice-1',
    });

    const firstState = await service.getTask('user-1', first.previewTaskId);
    const secondState = await service.getTask('user-1', second.previewTaskId);

    expect(firstState.status).toBe('failed');
    expect(firstState.error).toContain('Superseded');
    expect(secondState.status).toBe('queued');
  });

  it('builds signed preview url and validates signature', () => {
    const { service } = makeService();
    const signed = service.createSignedAudioUrl('user-1', 'preview.mp3');
    const parsed = new URL(`http://localhost${signed}`);
    const token = parsed.searchParams.get('token');
    const expires = parsed.searchParams.get('expires');

    expect(signed).toContain(
      '/api/v1/tools/preview-audios/preview.mp3/stream?',
    );
    expect(token).toBeTruthy();
    expect(expires).toBeTruthy();
    expect(() =>
      service.assertSignedAudioAccess(
        'user-1',
        'preview.mp3',
        token ?? undefined,
        expires ?? undefined,
      ),
    ).not.toThrow();
    expect(() =>
      service.assertSignedAudioAccess(
        'user-2',
        'preview.mp3',
        token ?? undefined,
        expires ?? undefined,
      ),
    ).toThrow(ForbiddenException);
  });

  it('validates signed preview audio by persisted file owner for public stream requests', async () => {
    const { service, db } = makeService();
    const signed = service.createSignedAudioUrl('user-1', 'preview.mp3');
    const parsed = new URL(`http://localhost${signed}`);
    const token = parsed.searchParams.get('token') ?? undefined;
    const expires = parsed.searchParams.get('expires') ?? undefined;
    db.queryAll.mockResolvedValue([
      {
        user_id: 'user-1',
        result_json: JSON.stringify({ fileName: 'preview.mp3' }),
      },
    ]);

    await expect(
      service.assertSignedAudioFileAccess('preview.mp3', token, expires),
    ).resolves.toBe('user-1');
  });

  it('rejects public preview audio stream tokens that do not match the file owner', async () => {
    const { service, db } = makeService();
    const signed = service.createSignedAudioUrl('user-1', 'preview.mp3');
    const parsed = new URL(`http://localhost${signed}`);
    const token = parsed.searchParams.get('token') ?? undefined;
    const expires = parsed.searchParams.get('expires') ?? undefined;
    db.queryAll.mockResolvedValue([
      {
        user_id: 'user-2',
        result_json: JSON.stringify({ fileName: 'preview.mp3' }),
      },
    ]);

    await expect(
      service.assertSignedAudioFileAccess('preview.mp3', token, expires),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects signed preview url token with non-hex suffix', () => {
    const { service } = makeService();
    const signed = service.createSignedAudioUrl('user-1', 'preview.mp3');
    const parsed = new URL(`http://localhost${signed}`);
    const token = parsed.searchParams.get('token') ?? '';
    const expires = parsed.searchParams.get('expires') ?? '';

    expect(() =>
      service.assertSignedAudioAccess(
        'user-1',
        'preview.mp3',
        `${token}x`,
        expires,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects malformed preview audio tokens', () => {
    const { service } = makeService();
    const signed = service.createSignedAudioUrl('user-1', 'preview.mp3');
    const parsed = new URL(`http://localhost${signed}`);
    const token = parsed.searchParams.get('token');
    const expires = parsed.searchParams.get('expires');
    expect(token).toBeTruthy();
    expect(expires).toBeTruthy();

    const malformed = [
      `${token}x`,
      `${token}00`,
      token!.slice(1),
      token!.slice(0, 63),
      `zz${token!.slice(2)}`,
    ];

    for (const badToken of malformed) {
      expect(() =>
        service.assertSignedAudioAccess(
          'user-1',
          'preview.mp3',
          badToken,
          expires ?? undefined,
        ),
      ).toThrow(ForbiddenException);
    }
  });

  it('loads task from db when cache/memory miss', async () => {
    const { service, db, cache } = makeService();
    cache.get = jest.fn().mockResolvedValue(null);
    db.queryOne.mockResolvedValue({
      id: 'task-1',
      user_id: 'user-1',
      kind: 'voice-preview',
      status: 'succeeded',
      progress: 100,
      payload_json: '{}',
      result_json: JSON.stringify({
        fileName: 'preview.mp3',
        durationSeconds: 3.2,
        hint: 'ok',
        ttsMode: 'provider',
        voiceLabel: 'voice',
      }),
      error: null,
      created_at: '2026-05-18T00:00:00.000Z',
      updated_at: '2026-05-18T00:00:01.000Z',
    });

    const task = await service.getTask('user-1', 'task-1');
    expect(task.status).toBe('succeeded');
    expect(task.durationSeconds).toBe(3.2);
    expect(task.audioUrl).toContain(
      '/api/v1/tools/preview-audios/preview.mp3/stream?',
    );
    expect(db.queryOne).toHaveBeenCalled();
  });

  it('throws not found when db row is missing', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValue(null);
    await expect(service.getTask('user-1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('passes voice pitch/rate/volume tuning to speech synthesis', async () => {
    const { service, resources, speechAi, ffmpegAudio } = makeService();
    jest
      .spyOn(service as unknown as { runTask: () => Promise<void> }, 'runTask')
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        service as unknown as { persistTask: () => Promise<void> },
        'persistTask',
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        service as unknown as {
          persistPreviewAudioFile: (params: {
            buffer: Buffer;
            originalname: string;
          }) => Promise<string>;
        },
        'persistPreviewAudioFile',
      )
      .mockResolvedValue('preview.mp3');

    const tuning = {
      language: 'zh-CN',
      emotion: '自然',
      emotionIntensity: 1.18,
      speechRate: 1.23,
      volume: 0.88,
      pitch: 1.41,
    };

    const created = service.createTask('user-1', {
      script: '这是一段用于测试音色调节透传的文案',
      voiceResourceId: 'voice-1',
      voiceTuning: tuning,
    });

    resources.getVoice.mockResolvedValue({
      id: 'voice-1',
      name: 'Voice 1',
      canUseForRender: true,
      provider: 'aliyun-qwen-vc',
      providerVoice: 'voice_provider_1',
      providerModel: 'cosyvoice-v2',
    });
    speechAi.synthesizeAudio.mockResolvedValue({
      ok: true,
      buffer: Buffer.from('1234567890'),
      mimeType: 'audio/mpeg',
      voice: 'voice_provider_1',
      styleApplied: true,
      styleHint: 'ok',
    });
    ffmpegAudio.probeDurationSeconds.mockResolvedValue(3.2);

    const task = (
      service as unknown as {
        tasks: Map<
          string,
          {
            payload: {
              script: string;
              voiceResourceId: string;
              voiceTuning?: unknown;
            };
          }
        >;
      }
    ).tasks.get(created.previewTaskId);

    await (
      service as unknown as {
        generatePreviewAudio: (task: unknown) => Promise<unknown>;
      }
    ).generatePreviewAudio(task);

    expect(speechAi.synthesizeAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceTuning: tuning,
      }),
    );
  });
});
