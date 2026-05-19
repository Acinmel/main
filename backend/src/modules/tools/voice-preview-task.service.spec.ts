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

  return { service, db, cache };
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
});
