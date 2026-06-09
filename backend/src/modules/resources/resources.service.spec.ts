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
    head?: jest.Mock;
    delete: jest.Mock;
    signatureUrl: jest.Mock;
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

function subtitleRow(patch: Partial<ResourceRow> = {}): ResourceRow {
  return {
    id: 'subtitle-1',
    user_id: null,
    name: 'Recommended subtitle',
    is_recommended: 1,
    cover_url: 'https://example.com/subtitle-cover.png',
    preview_url: 'https://example.com/subtitle-preview.png',
    style_json: JSON.stringify({
      color: '#FFFFFF',
      stroke: '#000000',
      size: 46,
    }),
    style_config_json: null,
    base_template_id: null,
    created_at: '2026-05-18T00:00:00.000Z',
    updated_at: '2026-05-18T00:00:00.000Z',
    ...patch,
  };
}

describe('ResourcesService voice resources', () => {
  it('creates digital-human asset by normalizing payload fields', async () => {
    const { service } = makeService();
    const expected = { id: 'avatar-dh-1' } as unknown as AvatarResourceDto;
    const spy = jest.spyOn(service, 'createAvatar').mockResolvedValue(expected);

    const result = await service.createDigitalHumanAsset('user-1', {
      name: 'my-avatar',
      videoPath: 'avatar-upload_1234.mp4',
      ossKey: 'runtime-assets/source-video/user-1/xx.mp4',
      status: 'completed',
      modelType: 'pro',
      videoDurationSeconds: 7.8,
      videoCoverUrl: 'https://example.com/cover.png',
    });

    expect(spy).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        originalVideoUrl: 'avatar-upload_1234.mp4',
        videoOssKey: 'runtime-assets/source-video/user-1/xx.mp4',
        assetStatus: 'completed',
        modelType: 'pro',
        videoDurationSeconds: 7.8,
        videoCoverUrl: 'https://example.com/cover.png',
        styleId: 'uploaded-video',
        __allowUploadSourceBypass: true,
      }),
    );
    expect(result).toBe(expected);
  });

  it('rejects digital-human asset creation when video source is missing', async () => {
    const { service } = makeService();
    await expect(
      service.createDigitalHumanAsset('user-1', {
        name: 'invalid',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

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

  it('lists only current-user avatar resources even when scope all is requested', async () => {
    const { service, db } = makeService();
    db.queryAll.mockResolvedValueOnce([
      avatarRow({
        id: 'avatar-mine',
        user_id: 'user-1',
        is_recommended: 0,
        name: 'Mine avatar',
        source_video_url: 'https://cdn.example.com/user-1/avatar.mp4',
      }),
    ]);

    const page = await service.listAvatars('user-1', {
      scope: 'all',
      limit: 10,
    });

    expect(page.items.map((item) => item.id)).toEqual(['avatar-mine']);
    expect(db.queryAll).toHaveBeenCalledTimes(1);
    const [sql, args] = db.queryAll.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE user_id = ?');
    expect(sql).not.toContain('is_recommended = 1');
    expect(args).toEqual(['user-1', 11]);
  });

  it('returns signed preview urls for avatar-upload items in avatar list', async () => {
    const { service, db } = makeService({
      JWT_SECRET: 'avatar-preview-secret',
    });
    db.queryAll.mockResolvedValueOnce([
      avatarRow({
        id: 'avatar-uploaded-1',
        user_id: 'user-1',
        is_recommended: 0,
        name: 'Uploaded avatar',
        source_video_url: 'avatar-upload_1234567890_test.mp4',
      }),
    ]);

    const page = await service.listAvatars('user-1', {
      scope: 'all',
      limit: 10,
    });

    expect(page.items).toHaveLength(1);
    const item = page.items[0];
    expect(item.originalVideoUrl).toBe('avatar-upload_1234567890_test.mp4');
    expect(item.previewUrl).toMatch(
      /^\/api\/v1\/resources\/avatar-video-files\/avatar-upload_1234567890_test\.mp4\/preview-stream\?/,
    );
    expect(item.metadataUrl).toMatch(
      /^\/api\/v1\/resources\/avatar-video-files\/avatar-upload_1234567890_test\.mp4\/preview-metadata\?/,
    );
    expect(item.previewUrl).not.toBe(
      '/api/v1/resources/avatar-video-files/avatar-upload_1234567890_test.mp4/stream',
    );
  });

  it('does not expose shared avatar resources through recommended scope', async () => {
    const { service, db } = makeService();

    const page = await service.listAvatars('user-1', {
      scope: 'recommended',
      limit: 10,
    });

    expect(page).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
    expect(db.queryAll).not.toHaveBeenCalled();
  });

  it('lists only current-user voice resources even when scope all is requested', async () => {
    const { service, db } = makeService();
    (service as unknown as { seeded: boolean }).seeded = true;
    db.queryAll.mockResolvedValueOnce([
      voiceRow({
        id: 'voice-mine',
        user_id: 'user-1',
        is_recommended: 0,
        name: 'Mine voice',
        audio_url: '/api/v1/resources/voice-files/voice-mine.wav/stream',
      }),
    ]);

    const page = await service.listVoices('user-1', {
      scope: 'all',
      limit: 10,
    });

    expect(page.items.map((item) => item.id)).toEqual(['voice-mine']);
    expect(db.queryAll).toHaveBeenCalledTimes(1);
    const [sql, args] = db.queryAll.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE user_id = ?');
    expect(sql).not.toContain('is_recommended = 1');
    expect(args).toEqual([
      'user-1',
      'rec-voice-female',
      'rec-voice-male',
      'rec-voice-narration',
      'rec-voice-bright-young-female',
      11,
    ]);
  });

  it('returns empty voice list for recommended scope', async () => {
    const { service, db } = makeService();

    const page = await service.listVoices('user-1', {
      scope: 'recommended',
      limit: 10,
    });

    expect(page).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
    expect(db.queryAll).not.toHaveBeenCalled();
  });

  it('marks local-upload voice as unavailable when managed sample file is missing', async () => {
    const voiceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-sample-'));
    try {
      const { service, db } = makeService({ VOICE_SAMPLE_DIR: voiceDir });
      (service as unknown as { seeded: boolean }).seeded = true;
      db.queryAll.mockResolvedValueOnce([
        voiceRow({
          id: 'voice-local-missing',
          user_id: 'user-1',
          is_recommended: 0,
          provider_voice: null,
          audio_url:
            '/api/v1/resources/voice-files/voice-sample_missing.wav/stream',
          clone_status: 'ready',
        }),
      ]);

      const page = await service.listVoices('user-1', {
        scope: 'all',
        limit: 10,
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: 'voice-local-missing',
        sampleMissing: true,
        audioUrl: '',
        canUseForRender: false,
        renderUnavailableReason: 'voice sample file not found',
        renderMode: 'sample-audio',
      });
    } finally {
      await fs.rm(voiceDir, { recursive: true, force: true });
    }
  });

  it('keeps provider voice renderable when managed sample file is missing', async () => {
    const voiceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-sample-'));
    try {
      const { service, db } = makeService({ VOICE_SAMPLE_DIR: voiceDir });
      (service as unknown as { seeded: boolean }).seeded = true;
      db.queryAll.mockResolvedValueOnce([
        voiceRow({
          id: 'voice-provider-missing',
          user_id: 'user-1',
          is_recommended: 0,
          provider_voice: 'provider-voice-1',
          audio_url:
            '/api/v1/resources/voice-files/voice-sample_missing.wav/stream',
          clone_status: 'ready',
        }),
      ]);

      const page = await service.listVoices('user-1', {
        scope: 'all',
        limit: 10,
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: 'voice-provider-missing',
        sampleMissing: true,
        audioUrl: '',
        canUseForRender: true,
        renderUnavailableReason: null,
        renderMode: 'tts',
        supportsDynamicTts: true,
      });
    } finally {
      await fs.rm(voiceDir, { recursive: true, force: true });
    }
  });

  it('marks OSS managed sample as missing when object head lookup fails', async () => {
    const { service, db } = makeService({ VOICE_SAMPLE_STORAGE: 'oss' });
    const internals = service as unknown as VoiceSampleStreamInternals;
    internals.voiceSampleOssClient = {
      put: jest.fn(),
      get: jest.fn(),
      getStream: jest.fn(),
      head: jest.fn().mockRejectedValue(new Error('NoSuchKey')),
      delete: jest.fn(),
      signatureUrl: jest.fn(),
    };
    (service as unknown as { seeded: boolean }).seeded = true;
    db.queryAll.mockResolvedValueOnce([
      voiceRow({
        id: 'voice-oss-missing',
        user_id: 'user-1',
        is_recommended: 0,
        provider_voice: null,
        audio_url:
          '/api/v1/resources/voice-files/voice-sample_oss_missing.wav/stream',
        clone_status: 'ready',
      }),
    ]);

    const page = await service.listVoices('user-1', {
      scope: 'all',
      limit: 10,
    });

    expect(internals.voiceSampleOssClient.head).toHaveBeenCalledWith(
      'voice-samples/voice-sample_oss_missing.wav',
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'voice-oss-missing',
      sampleMissing: true,
      audioUrl: '',
      canUseForRender: false,
      renderUnavailableReason: 'voice sample file not found',
    });
  });

  it('rejects shared avatar detail access', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce(
      avatarRow({
        id: 'rec-avatar-business',
        user_id: null,
        is_recommended: 1,
        source_video_url: 'https://cdn.example.com/shared-avatar.mp4',
      }),
    );

    await expect(
      service.getAvatar('user-1', 'rec-avatar-business'),
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
      signatureUrl: jest.fn(),
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

  it('creates signed upload url and persists upload grant metadata', async () => {
    const { service, db } = makeService({
      ALI_OSS_UPLOAD_PREFIX: 'runtime-assets',
    });
    const internals = service as unknown as VoiceSampleStreamInternals;
    internals.voiceSampleOssClient = {
      put: jest.fn(),
      get: jest.fn(),
      getStream: jest.fn(),
      delete: jest.fn(),
      signatureUrl: jest
        .fn()
        .mockReturnValue('https://oss.example.com/signed-put-url'),
    };

    const result = await service.createSignedUploadUrl('user-1', {
      purpose: 'source-video',
      fileName: 'demo.mp4',
      contentType: 'video/mp4',
      fileSize: 1024,
    });

    expect(result.uploadId.startsWith('upload_')).toBe(true);
    expect(result.purpose).toBe('source-video');
    expect(result.method).toBe('PUT');
    expect(result.uploadUrl).toBe('https://oss.example.com/signed-put-url');
    expect(result.objectKey).toMatch(
      /^runtime-assets\/source-video\/user-1\/\d{4}-\d{2}-\d{2}\/upload_[0-9a-f-]+\.mp4$/,
    );
    expect(result.requiredHeaders).toEqual({ 'Content-Type': 'video/mp4' });
    expect(internals.voiceSampleOssClient.signatureUrl).toHaveBeenCalledWith(
      result.objectKey,
      expect.objectContaining({
        method: 'PUT',
        'Content-Type': 'video/mp4',
      }),
    );
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO oss_upload_grants'),
      expect.arrayContaining([
        result.uploadId,
        'user-1',
        'source-video',
        result.objectKey,
        'video/mp4',
        1024,
        'pending',
      ]),
    );
  });

  it('rejects signed upload request when content type is not allowed for purpose', async () => {
    const { service } = makeService();
    await expect(
      service.createSignedUploadUrl('user-1', {
        purpose: 'cover',
        fileName: 'cover.gif',
        contentType: 'image/gif',
        fileSize: 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('streams owned avatar upload videos with byte ranges', async () => {
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-video-'));
    try {
      const fileName = 'avatar-upload_1234567890_test.mp4';
      await fs.writeFile(
        path.join(videoDir, fileName),
        Buffer.from('0123456789'),
      );
      const { db, service } = makeService({
        VIDEO_SAVE_DIR: videoDir,
        JWT_SECRET: 'test-avatar-preview-secret',
      });
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
      const { db, service } = makeService({
        VIDEO_SAVE_DIR: videoDir,
        JWT_SECRET: 'test-avatar-preview-secret',
      });
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
      });
      expect(metadata.previewUrl).toMatch(
        new RegExp(
          `^/api/v1/resources/avatar-video-files/${fileName}/preview-stream\\?`,
        ),
      );
      expect(metadata.metadataUrl).toMatch(
        new RegExp(
          `^/api/v1/resources/avatar-video-files/${fileName}/preview-metadata\\?`,
        ),
      );
      expect(typeof metadata.mtime).toBe('string');
    } finally {
      await fs.rm(videoDir, { recursive: true, force: true });
    }
  });

  it('returns signed preview urls from avatar upload videos list', async () => {
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-video-'));
    try {
      const fileName = 'avatar-upload_1234567890_test.mp4';
      await fs.writeFile(
        path.join(videoDir, fileName),
        Buffer.from('0123456789'),
      );
      const { db, service } = makeService({
        VIDEO_SAVE_DIR: videoDir,
        JWT_SECRET: 'avatar-preview-secret',
      });
      db.queryAll.mockResolvedValueOnce([
        {
          id: 'avatar-1',
          name: 'avatar',
          source_video_url: fileName,
          updated_at: '2026-05-21T00:00:00.000Z',
        },
      ]);

      const items = await service.listAvatarUploadVideos('user-1', 10);
      expect(items).toHaveLength(1);
      expect(items[0].previewUrl).toMatch(
        new RegExp(
          `^/api/v1/resources/avatar-video-files/${fileName}/preview-stream\\?`,
        ),
      );
      expect(items[0].metadataUrl).toMatch(
        new RegExp(
          `^/api/v1/resources/avatar-video-files/${fileName}/preview-metadata\\?`,
        ),
      );
      expect(items[0].previewUrl).not.toBe(
        `/api/v1/resources/avatar-video-files/${fileName}/stream`,
      );
    } finally {
      await fs.rm(videoDir, { recursive: true, force: true });
    }
  });

  it('opens signed avatar upload preview stream for valid token', async () => {
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-video-'));
    const previousSecret = process.env.AVATAR_VIDEO_STREAM_SECRET;
    process.env.AVATAR_VIDEO_STREAM_SECRET = 'test-avatar-preview-secret';
    try {
      const fileName = 'avatar-upload_1234567890_test.mp4';
      await fs.writeFile(
        path.join(videoDir, fileName),
        Buffer.from('0123456789'),
      );
      const { db, service } = makeService({ VIDEO_SAVE_DIR: videoDir });
      db.queryOne.mockResolvedValue({ id: 'avatar-1', name: 'avatar' });
      db.queryAll.mockResolvedValue([{ id: 'user-1' }]);

      const preview = (
        service as unknown as {
          createSignedAvatarVideoPreviewUrls: (
            userId: string,
            fileName: string,
          ) => { previewUrl: string };
        }
      ).createSignedAvatarVideoPreviewUrls('user-1', fileName);
      const previewUrl = new URL(preview.previewUrl, 'http://localhost');
      const token = previewUrl.searchParams.get('token') ?? undefined;
      const expires = previewUrl.searchParams.get('expires') ?? undefined;
      expect(token).toBeTruthy();
      expect(expires).toBeTruthy();

      const stream = await service.openSignedAvatarVideoStreamOrThrow(
        fileName,
        token,
        expires,
        'bytes=1-3',
      );
      const chunks: Buffer[] = [];
      for await (const chunk of stream.stream as AsyncIterable<
        Buffer | Uint8Array | string
      >) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      expect(stream.range).toEqual({ start: 1, end: 3 });
      expect(Buffer.concat(chunks).toString('utf8')).toBe('123');
    } finally {
      process.env.AVATAR_VIDEO_STREAM_SECRET = previousSecret;
      await fs.rm(videoDir, { recursive: true, force: true });
    }
  });

  it('rejects signed avatar upload preview stream for forged token', async () => {
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-video-'));
    const previousSecret = process.env.AVATAR_VIDEO_STREAM_SECRET;
    process.env.AVATAR_VIDEO_STREAM_SECRET = 'test-avatar-preview-secret';
    try {
      const fileName = 'avatar-upload_1234567890_test.mp4';
      await fs.writeFile(
        path.join(videoDir, fileName),
        Buffer.from('0123456789'),
      );
      const { db, service } = makeService({ VIDEO_SAVE_DIR: videoDir });
      db.queryAll.mockResolvedValue([{ id: 'user-1' }]);

      await expect(
        service.openSignedAvatarVideoStreamOrThrow(
          fileName,
          'deadbeef',
          String(Date.now() + 60_000),
          undefined,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      process.env.AVATAR_VIDEO_STREAM_SECRET = previousSecret;
      await fs.rm(videoDir, { recursive: true, force: true });
    }
  });

  it('rejects signed avatar upload preview stream for non-hex token suffix', async () => {
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-video-'));
    const previousSecret = process.env.AVATAR_VIDEO_STREAM_SECRET;
    process.env.AVATAR_VIDEO_STREAM_SECRET = 'test-avatar-preview-secret';
    try {
      const fileName = 'avatar-upload_1234567890_test.mp4';
      await fs.writeFile(
        path.join(videoDir, fileName),
        Buffer.from('0123456789'),
      );
      const { db, service } = makeService({ VIDEO_SAVE_DIR: videoDir });
      db.queryOne.mockResolvedValue({ id: 'avatar-1', name: 'avatar' });
      db.queryAll.mockResolvedValue([{ id: 'user-1' }]);

      const preview = (
        service as unknown as {
          createSignedAvatarVideoPreviewUrls: (
            userId: string,
            fileName: string,
          ) => { previewUrl: string };
        }
      ).createSignedAvatarVideoPreviewUrls('user-1', fileName);
      const previewUrl = new URL(preview.previewUrl, 'http://localhost');
      const token = previewUrl.searchParams.get('token') ?? '';
      const expires = previewUrl.searchParams.get('expires') ?? '';

      await expect(
        service.openSignedAvatarVideoStreamOrThrow(
          fileName,
          `${token}x`,
          expires,
          undefined,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      process.env.AVATAR_VIDEO_STREAM_SECRET = previousSecret;
      await fs.rm(videoDir, { recursive: true, force: true });
    }
  });

  it('rejects malformed signed avatar upload preview tokens', async () => {
    const videoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'avatar-video-'));
    const previousSecret = process.env.AVATAR_VIDEO_STREAM_SECRET;
    process.env.AVATAR_VIDEO_STREAM_SECRET = 'test-avatar-preview-secret';
    try {
      const fileName = 'avatar-upload_1234567890_test.mp4';
      await fs.writeFile(
        path.join(videoDir, fileName),
        Buffer.from('0123456789'),
      );
      const { db, service } = makeService({ VIDEO_SAVE_DIR: videoDir });
      db.queryOne.mockResolvedValue({ id: 'avatar-1', name: 'avatar' });
      db.queryAll.mockResolvedValue([{ id: 'user-1' }]);

      const preview = (
        service as unknown as {
          createSignedAvatarVideoPreviewUrls: (
            userId: string,
            fileName: string,
          ) => { previewUrl: string; metadataUrl: string };
        }
      ).createSignedAvatarVideoPreviewUrls('user-1', fileName);
      const previewUrl = new URL(preview.previewUrl, 'http://localhost');
      const token = previewUrl.searchParams.get('token') ?? '';
      const expires = previewUrl.searchParams.get('expires') ?? '';

      const malformed = [
        `x${token}`,
        `${token}x`,
        token.slice(0, 63),
        `${token}00`,
      ];
      for (const badToken of malformed) {
        await expect(
          service.openSignedAvatarVideoStreamOrThrow(
            fileName,
            badToken,
            expires,
            undefined,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }

      const metadataUrl = new URL(preview.metadataUrl, 'http://localhost');
      const metadataExpires = metadataUrl.searchParams.get('expires') ?? '';
      await expect(
        service.getSignedAvatarVideoMetadataOrThrow(
          fileName,
          `${token}x`,
          metadataExpires,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      process.env.AVATAR_VIDEO_STREAM_SECRET = previousSecret;
      await fs.rm(videoDir, { recursive: true, force: true });
    }
  });

  it('rejects provider voice stream token with non-hex suffix', async () => {
    const { service } = makeService({
      VOICE_PROVIDER_STREAM_SECRET: 'provider-secret',
    });
    const fileName = 'voice-sample_1234abcd.wav';
    const expires = String(Date.now() + 60_000);
    const token = (
      service as unknown as {
        signProviderVoiceSample: (
          fileName: string,
          expires: string,
          secret: string,
        ) => string;
      }
    ).signProviderVoiceSample(fileName, expires, 'provider-secret');

    await expect(
      service.openProviderVoiceSampleStreamOrThrow(
        fileName,
        `${token}x`,
        expires,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects malformed provider voice stream tokens', async () => {
    const { service } = makeService({
      VOICE_PROVIDER_STREAM_SECRET: 'provider-secret',
    });
    const fileName = 'voice-sample_1234abcd.wav';
    const expires = String(Date.now() + 60_000);
    const token = (
      service as unknown as {
        signProviderVoiceSample: (
          fileName: string,
          expires: string,
          secret: string,
        ) => string;
      }
    ).signProviderVoiceSample(fileName, expires, 'provider-secret');

    const malformed = [
      `x${token}`,
      `${token}x`,
      token.slice(0, 63),
      `${token}00`,
    ];
    for (const badToken of malformed) {
      await expect(
        service.openProviderVoiceSampleStreamOrThrow(
          fileName,
          badToken,
          expires,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
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
    expect(result.provider).toBe('local-upload');
  });

  it('copies recommended subtitle template into editable user template with baseTemplateId', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce(
      subtitleRow({
        id: 'rec-subtitle-a',
        user_id: null,
        is_recommended: 1,
        style_json: JSON.stringify({
          color: '#FFFFFF',
          stroke: '#000000',
          size: 46,
        }),
      }),
    );

    const result = await service.copySubtitleTemplate(
      'user-1',
      'rec-subtitle-a',
    );

    expect(result.owner).toBe('mine');
    expect(result.recommended).toBe(false);
    expect(result.editable).toBe(true);
    expect(result.baseTemplateId).toBe('rec-subtitle-a');
    expect(result.coverUrl.startsWith('data:')).toBe(false);
    expect(result.previewCoverUrl.startsWith('data:')).toBe(false);
    expect(
      (result.styleConfig.subtitle as Record<string, unknown>)?.style,
    ).toEqual(expect.objectContaining({ color: '#FFFFFF', size: 46 }));
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO subtitle_template_resources'),
      expect.arrayContaining(['user-1', 'rec-subtitle-a']),
    );
  });

  it('sanitizes copied subtitle template asset urls when source row has data-image payload', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce(
      subtitleRow({
        id: 'rec-subtitle-data-inline',
        user_id: null,
        is_recommended: 1,
        cover_url: 'data:image/svg+xml;base64,AAA',
        preview_url: 'data:image/svg+xml;base64,BBB',
      }),
    );

    const result = await service.copySubtitleTemplate(
      'user-1',
      'rec-subtitle-data-inline',
    );

    expect(result.coverUrl).toMatch(/^\/template-previews\//);
    expect(result.previewCoverUrl).toMatch(/^\/template-previews\//);
    expect(result.coverUrl.startsWith('data:')).toBe(false);
    expect(result.previewCoverUrl.startsWith('data:')).toBe(false);

    const insertCall = (
      db.execute.mock.calls as Array<[string, unknown[]]>
    ).find(([sql]) => sql.includes('INSERT INTO subtitle_template_resources'));
    expect(insertCall).toBeDefined();
    expect(String(insertCall?.[1]?.[4])).toMatch(/^\/template-previews\//);
    expect(String(insertCall?.[1]?.[5])).toMatch(/^\/template-previews\//);
  });

  it('rejects copying subtitle template from another user', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce(
      subtitleRow({
        id: 'subtitle-user-2',
        user_id: 'user-2',
        is_recommended: 0,
      }),
    );

    await expect(
      service.copySubtitleTemplate('user-1', 'subtitle-user-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updates subtitle template with styleConfig and keeps style_json compatibility', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce(
      subtitleRow({
        id: 'subtitle-user-1',
        user_id: 'user-1',
        is_recommended: 0,
        style_json: JSON.stringify({
          color: '#FFFFFF',
          stroke: '#000000',
          size: 46,
        }),
      }),
    );

    const result = await service.updateSubtitleTemplate(
      'user-1',
      'subtitle-user-1',
      {
        name: '我的模板A',
        styleConfig: {
          aspectRatio: '1:1',
          subtitle: {
            style: {
              color: '#00FF66',
              stroke: '#000000',
              size: 52,
            },
          },
        },
      },
    );

    expect(result.editable).toBe(true);
    expect(result.baseTemplateId).toBeNull();
    expect(result.styleJson).toEqual(
      expect.objectContaining({ color: '#00FF66', size: 52 }),
    );
    expect(result.styleConfig.aspectRatio).toBe('1:1');
    expect(
      (result.styleConfig.subtitle as Record<string, unknown>)?.style,
    ).toEqual(expect.objectContaining({ color: '#00FF66', size: 52 }));

    const updateCall = (
      db.execute.mock.calls as Array<[string, unknown[]]>
    ).find(([sql]) => sql.includes('UPDATE subtitle_template_resources'));
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]?.[3]).toEqual(expect.stringContaining('#00FF66'));
    expect(updateCall?.[1]?.[4]).toEqual(
      expect.stringContaining('"aspectRatio":"1:1"'),
    );
  });

  it('allows deleting own subtitle template and rejects deleting public template', async () => {
    const { service, db } = makeService();
    db.queryOne
      .mockResolvedValueOnce(
        subtitleRow({
          id: 'subtitle-user-1',
          user_id: 'user-1',
          is_recommended: 0,
        }),
      )
      .mockResolvedValueOnce(
        subtitleRow({
          id: 'rec-subtitle-a',
          user_id: null,
          is_recommended: 1,
        }),
      );

    const deleted = await service.deleteSubtitleTemplate(
      'user-1',
      'subtitle-user-1',
    );
    expect(deleted).toEqual({ deletedIds: ['subtitle-user-1'] });

    await expect(
      service.deleteSubtitleTemplate('user-1', 'rec-subtitle-a'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('appends A-J recommended subtitle template seeds', async () => {
    const { service, db } = makeService();
    const serviceAny = service as unknown as {
      findRow: (
        table: string,
        id: string,
      ) => Promise<Record<string, unknown> | null>;
      upsertRecommendedSubtitleTemplates: (now: string) => Promise<void>;
    };
    const legacyIds = new Set([
      'rec-subtitle-minimal',
      'rec-subtitle-yellow',
      'rec-subtitle-card',
      'rec-subtitle-night',
    ]);
    const newIds = [
      'rec-subtitle-a-classic-white-yellow',
      'rec-subtitle-b-white-green-tech',
      'rec-subtitle-c-white-red-impact',
      'rec-subtitle-d-black-yellow-alert',
      'rec-subtitle-e-white-blue-pro',
      'rec-subtitle-f-white-orange-commerce',
      'rec-subtitle-g-ivory-gold-brand',
      'rec-subtitle-h-white-purple-trend',
      'rec-subtitle-i-cyan-white-fresh',
      'rec-subtitle-j-white-pink-lifestyle',
    ];

    jest.spyOn(serviceAny, 'findRow').mockImplementation(async (table, id) => {
      if (table !== 'subtitle_template_resources') return null;
      if (legacyIds.has(id)) {
        return { id };
      }
      return null;
    });

    await serviceAny.upsertRecommendedSubtitleTemplates(
      '2026-05-21T00:00:00.000Z',
    );

    const subtitleInserts = (
      db.execute.mock.calls as Array<[string, unknown[]]>
    )
      .filter(([sql]) =>
        sql.includes('INSERT INTO subtitle_template_resources'),
      )
      .map(([, args]) => String(args[0]));

    expect(subtitleInserts).toEqual(expect.arrayContaining(newIds));
    for (const legacyId of legacyIds) {
      expect(subtitleInserts).not.toContain(legacyId);
    }

    const subtitleAssetCalls = (
      db.execute.mock.calls as Array<[string, unknown[]]>
    ).filter(
      ([sql]) =>
        sql.includes('subtitle_template_resources') &&
        (sql.includes('INSERT INTO subtitle_template_resources') ||
          sql.includes('UPDATE subtitle_template_resources')),
    );
    for (const [sql, args] of subtitleAssetCalls) {
      const isInsert = sql.includes('INSERT INTO subtitle_template_resources');
      const coverUrl = isInsert ? String(args[2] ?? '') : String(args[1] ?? '');
      const previewUrl = isInsert
        ? String(args[3] ?? '')
        : String(args[2] ?? '');
      expect(coverUrl.startsWith('data:')).toBe(false);
      expect(previewUrl.startsWith('data:')).toBe(false);
      expect(coverUrl).toContain('/template-previews/');
      expect(previewUrl).toContain('/template-previews/');
    }
  });
});
