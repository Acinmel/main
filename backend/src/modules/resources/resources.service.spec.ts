import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { DatabaseService } from '../../database/database.service';
import type { QwenVoiceCloneService } from '../../integrations/ai/qwen-voice-clone.service';
import type { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import { ResourcesService } from './resources.service';
import type {
  AvatarResourceDto,
  ResourceRow,
  VoiceResourceDto,
} from './resources.types';

const LEGACY_PLACEHOLDER_AUDIO_URL =
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

type ResourcesServiceInternals = {
  toAvatar(row: ResourceRow, userId: string): AvatarResourceDto;
  toVoice(row: ResourceRow, userId: string): VoiceResourceDto;
  normalizeLegacyVoiceAudioUrls(): Promise<void>;
};

type CloneFallbackInternals = {
  fetchRemoteVoiceSample: (url: string) => Promise<{
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
    durationMs: number;
  }>;
  persistVoiceSample: (sample: {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
  }) => Promise<{ audioUrl: string }>;
  removeVoiceSampleByUrl: (audioUrl?: string | null) => Promise<void>;
  createVoice: (
    userId: string,
    body: Record<string, unknown>,
  ) => Promise<VoiceResourceDto>;
  toProviderErrorMessage: (error: unknown) => string;
  qwenVoiceClone: {
    createVoiceClone: jest.Mock;
  };
};

type VoiceSampleStreamInternals = {
  voiceSampleOssClient: {
    put: jest.Mock;
    get: jest.Mock;
    getStream: jest.Mock;
    delete: jest.Mock;
  };
};

function makeService(configValues: Record<string, unknown> = {}) {
  const db = {
    execute: jest.fn((): Promise<void> => Promise.resolve()),
    queryOne: jest.fn(),
    queryAll: jest.fn(),
  };
  const qwenVoiceClone = {
    createVoiceClone: jest.fn(),
    deleteVoice: jest.fn(),
  };
  const ffmpegAudio = {
    probeDurationSeconds: jest.fn(),
  };
  const service = new ResourcesService(
    db as unknown as DatabaseService,
    new ConfigService(configValues),
    qwenVoiceClone as unknown as QwenVoiceCloneService,
    ffmpegAudio as unknown as FfmpegAudioService,
  );

  return { db, service };
}

function voiceRow(patch: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: 'voice-1',
    user_id: null,
    name: 'Recommended voice',
    is_recommended: 1,
    audio_url: null,
    clone_status: 'ready',
    provider: 'aliyun-qwen-vd',
    provider_voice: 'provider-voice-1',
    provider_model: 'provider-model-1',
    sample_duration_ms: null,
    clone_error: null,
    expires_at: null,
    created_at: '2026-05-18T00:00:00.000Z',
    updated_at: '2026-05-18T00:00:00.000Z',
    ...patch,
  };
}

function avatarRow(patch: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: 'avatar-1',
    user_id: null,
    name: 'Recommended avatar',
    is_recommended: 1,
    cover_url: 'https://example.com/avatar-cover.png',
    source_video_url: null,
    style_id: 'business',
    expires_at: null,
    created_at: '2026-05-18T00:00:00.000Z',
    updated_at: '2026-05-18T00:00:00.000Z',
    ...patch,
  };
}

describe('ResourcesService voice resources', () => {
  it('rejects non-avatar-upload local source when creating avatar', async () => {
    const { service } = makeService();
    await expect(
      service.createAvatar('user-1', {
        name: 'avatar',
        originalVideoUrl: '1779127452981_douyin_dy_video.mp4',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects avatar-upload file not owned by current user', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce(null);
    await expect(
      service.createAvatar('user-1', {
        name: 'avatar',
        originalVideoUrl: 'avatar-upload_12345678_abcd1234.mp4',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('marks avatar without source video as unavailable for render', () => {
    const { service } = makeService();
    const internals = service as unknown as ResourcesServiceInternals;

    const dto = internals.toAvatar(avatarRow({ source_video_url: null }), 'u1');

    expect(dto.canUseForRender).toBe(false);
    expect(dto.renderMode).toBe('source-video');
    expect(dto.renderUnavailableReason).toBeTruthy();
  });

  it('marks avatar with invalid local source as unavailable for render', () => {
    const { service } = makeService();
    const internals = service as unknown as ResourcesServiceInternals;

    const dto = internals.toAvatar(
      avatarRow({ source_video_url: 'avatar-upload_missing.mp4' }),
      'u1',
    );

    expect(dto.canUseForRender).toBe(false);
    expect(dto.renderUnavailableReason).toBeTruthy();
  });

  it('marks avatar with remote source as renderable', () => {
    const { service } = makeService();
    const internals = service as unknown as ResourcesServiceInternals;

    const dto = internals.toAvatar(
      avatarRow({ source_video_url: 'https://cdn.example.com/avatar.mp4' }),
      'u1',
    );

    expect(dto.canUseForRender).toBe(true);
    expect(dto.renderUnavailableReason).toBeNull();
  });

  it('does not expose the old shared music URL as a voice preview', () => {
    const { service } = makeService();
    const internals = service as unknown as ResourcesServiceInternals;

    const dto = internals.toVoice(
      voiceRow({ audio_url: LEGACY_PLACEHOLDER_AUDIO_URL }),
      'user-1',
    );

    expect(dto.audioUrl).toBe('');
    expect(dto.canUseForRender).toBe(true);
    expect(dto.renderMode).toBe('tts');
  });

  it('marks processing voices as unavailable with reason', () => {
    const { service } = makeService();
    const internals = service as unknown as ResourcesServiceInternals;

    const dto = internals.toVoice(
      voiceRow({ clone_status: 'processing', clone_error: null }),
      'user-1',
    );

    expect(dto.canUseForRender).toBe(false);
    expect(dto.renderUnavailableReason).toBeTruthy();
  });

  it('rejects user voice creation without audio or provider voice', async () => {
    const { db, service } = makeService();

    await expect(
      service.createVoice('user-1', { name: 'Empty voice' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('keeps provider-only voices but stores no fake preview audio', async () => {
    const { db, service } = makeService();

    const result = await service.createVoice('user-1', {
      name: 'Imported provider voice',
      provider: 'aliyun-qwen-vc',
      providerVoice: 'provider-voice-1',
      audioUrl: LEGACY_PLACEHOLDER_AUDIO_URL,
    });

    expect(result.audioUrl).toBe('');
    expect(result.providerVoice).toBe('provider-voice-1');
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO voice_resources'),
      expect.arrayContaining([null, 'aliyun-qwen-vc', 'provider-voice-1']),
    );
  });

  it('normalizes persisted legacy placeholder audio URLs', async () => {
    const { db, service } = makeService();
    const internals = service as unknown as ResourcesServiceInternals;

    await internals.normalizeLegacyVoiceAudioUrls();

    expect(db.execute).toHaveBeenCalledWith(
      `UPDATE voice_resources SET audio_url = NULL WHERE audio_url = ?`,
      [LEGACY_PLACEHOLDER_AUDIO_URL],
    );
  });

  it('streams OSS voice samples without buffering in the stream endpoint path', async () => {
    const { service } = makeService({ VOICE_SAMPLE_STORAGE: 'oss' });
    const internals = service as unknown as VoiceSampleStreamInternals;
    internals.voiceSampleOssClient = {
      put: jest.fn(),
      get: jest.fn(),
      getStream: jest.fn().mockResolvedValue({
        stream: Readable.from(Buffer.from('sample')),
        res: { headers: { 'content-length': '6', etag: '"voice-etag"' } },
      }),
      delete: jest.fn(),
    };

    const file =
      await service.openVoiceSampleStreamOrThrow('voice-sample_1.wav');
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream as AsyncIterable<
      Buffer | Uint8Array | string
    >) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    expect(internals.voiceSampleOssClient.getStream).toHaveBeenCalledWith(
      'voice-samples/voice-sample_1.wav',
    );
    expect(internals.voiceSampleOssClient.get).not.toHaveBeenCalled();
    expect(Buffer.concat(chunks).toString('utf8')).toBe('sample');
    expect(file.contentLength).toBe(6);
    expect(file.etag).toBe('"voice-etag"');
  });

  it('streams owned avatar upload videos with byte ranges', async () => {
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-video-'));
    try {
      const fileName = 'avatar-upload_1234567890_test.mp4';
      await fs.writeFile(
        path.join(videoDir, fileName),
        Buffer.from('0123456789'),
      );
      const { db, service } = makeService({ VIDEO_SAVE_DIR: videoDir });
      db.queryOne.mockResolvedValue({ id: 'avatar-1', name: 'avatar' });

      const file = await service.openOwnedAvatarVideoStreamOrThrow(
        'user-1',
        fileName,
        'bytes=2-5',
      );
      const chunks: Buffer[] = [];
      for await (const chunk of file.stream as AsyncIterable<
        Buffer | Uint8Array | string
      >) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      expect(file.range).toEqual({ start: 2, end: 5 });
      expect(file.contentLength).toBe(4);
      expect(file.totalSize).toBe(10);
      expect(Buffer.concat(chunks).toString('utf8')).toBe('2345');
    } finally {
      await fs.rm(videoDir, { recursive: true, force: true });
    }
  });

  it('returns unsatisfiable marker for invalid avatar upload video ranges', async () => {
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-video-'));
    try {
      const fileName = 'avatar-upload_1234567890_test.mp4';
      await fs.writeFile(
        path.join(videoDir, fileName),
        Buffer.from('0123456789'),
      );
      const { db, service } = makeService({ VIDEO_SAVE_DIR: videoDir });
      db.queryOne.mockResolvedValue({ id: 'avatar-1', name: 'avatar' });

      const file = await service.openOwnedAvatarVideoStreamOrThrow(
        'user-1',
        fileName,
        'bytes=99-100',
      );
      const chunks: Buffer[] = [];
      for await (const chunk of file.stream as AsyncIterable<
        Buffer | Uint8Array | string
      >) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      expect(file.rangeNotSatisfiable).toBe(true);
      expect(file.contentLength).toBe(0);
      expect(file.totalSize).toBe(10);
      expect(Buffer.concat(chunks).length).toBe(0);
    } finally {
      await fs.rm(videoDir, { recursive: true, force: true });
    }
  });

  it('returns owned avatar upload video metadata without reading file contents', async () => {
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-video-'));
    try {
      const fileName = 'avatar-upload_1234567890_test.mp4';
      await fs.writeFile(
        path.join(videoDir, fileName),
        Buffer.from('0123456789'),
      );
      const { db, service } = makeService({ VIDEO_SAVE_DIR: videoDir });
      db.queryOne.mockResolvedValue({ id: 'avatar-1', name: 'avatar' });

      const metadata = await service.getOwnedAvatarVideoMetadataOrThrow(
        'user-1',
        fileName,
      );

      expect(metadata).toMatchObject({
        avatarId: 'avatar-1',
        avatarName: 'avatar',
        fileName,
        fileSize: 10,
        mimeType: 'video/mp4',
        previewUrl: `/api/v1/resources/avatar-video-files/${fileName}/stream`,
        metadataUrl: `/api/v1/resources/avatar-video-files/${fileName}/metadata`,
      });
      expect(typeof metadata.mtime).toBe('string');
    } finally {
      await fs.rm(videoDir, { recursive: true, force: true });
    }
  });

  it('falls back to local-upload voice when provider cloning fails', async () => {
    const { service } = makeService();
    const serviceAny = service as unknown as CloneFallbackInternals;
    const sampleAudioUrl = '/api/v1/resources/voice-files/sample.wav/stream';
    const fallbackVoice: VoiceResourceDto = {
      id: 'voice-fallback-1',
      name: '我的上传音频',
      owner: 'mine',
      recommended: false,
      audioUrl: sampleAudioUrl,
      cloneStatus: 'ready',
      renderMode: 'sample-audio',
      canUseForRender: true,
      renderUnavailableReason: null,
      supportsDynamicTts: false,
      provider: 'local-upload',
      providerVoice: null,
      providerModel: null,
      sampleDurationMs: 3200,
      cloneError: 'provider unavailable',
      expiresAt: null,
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
    };

    jest.spyOn(serviceAny, 'fetchRemoteVoiceSample').mockResolvedValue({
      buffer: Buffer.from('sample'),
      originalname: 'sample.wav',
      mimetype: 'audio/wav',
      size: 6,
      durationMs: 3200,
    });
    jest
      .spyOn(serviceAny, 'persistVoiceSample')
      .mockResolvedValue({ audioUrl: sampleAudioUrl });
    const removeSpy = jest
      .spyOn(serviceAny, 'removeVoiceSampleByUrl')
      .mockResolvedValue(undefined);
    const createSpy = jest
      .spyOn(serviceAny, 'createVoice')
      .mockResolvedValue(fallbackVoice);
    jest
      .spyOn(serviceAny, 'toProviderErrorMessage')
      .mockReturnValue('provider unavailable');

    const qwen = serviceAny.qwenVoiceClone;
    qwen.createVoiceClone.mockRejectedValueOnce(new Error('boom'));

    const result = await service.cloneVoice('user-1', {
      name: '我的音色',
      audioUrl: 'https://example.com/sample.wav',
    });

    expect(createSpy).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        provider: 'local-upload',
        audioUrl: sampleAudioUrl,
        cloneError: 'provider unavailable',
      }),
    );
    expect(removeSpy).not.toHaveBeenCalled();
    expect(result.provider).toBe('local-upload');
  });
});
