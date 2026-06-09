import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { StagedWorkflowService } from './staged-workflow.service';

function makeService(config: Record<string, unknown> = {}) {
  return new StagedWorkflowService(
    new ConfigService(config),
    {
      execute: jest.fn(),
      queryOne: jest.fn(),
      queryAll: jest.fn(),
    } as never,
    {
      synthesizeAudio: jest.fn(),
    } as never,
    {
      transcribeMedia: jest.fn(),
    } as never,
    {
      getSubtitleTemplate: jest.fn(),
      getVoice: jest.fn(),
      getAvatar: jest.fn(),
    } as never,
    {
      muxVideoAndAudio: jest.fn(),
      normalizeVideoForRenderMode: jest.fn(),
      burnAss: jest.fn(),
      overlayTimedAssets: jest.fn(),
      probeDurationSeconds: jest.fn(),
    } as never,
    {
      listActiveSuccessAssetsForVideo: jest.fn(),
    } as never,
  );
}

describe('StagedWorkflowService', () => {
  it('creates runtime temp root before package render mkdtemp', async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'staged-tmp-'));
    const tempRoot = path.join(parent, 'uploads', 'tmp');
    const service = makeService({ TEMP_DIR: tempRoot }) as never as {
      createRuntimeTempDir: (prefix: string) => Promise<string>;
    };

    try {
      const created = await service.createRuntimeTempDir('package-render-');
      const stat = await fs.stat(created);

      expect(created.startsWith(path.join(tempRoot, 'package-render-'))).toBe(
        true,
      );
      expect(stat.isDirectory()).toBe(true);
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  it('prefers styleConfig.subtitle.style over legacy styleJson', () => {
    const service = makeService() as never as {
      getTemplateSubtitleStyle: (
        template: Record<string, unknown>,
      ) => Record<string, unknown>;
    };
    const style = service.getTemplateSubtitleStyle({
      styleJson: { color: '#FFFFFF', size: 33 },
      styleConfig: {
        subtitle: {
          style: { color: '#00FF66', size: 46 },
        },
      },
    });
    expect(style).toEqual(
      expect.objectContaining({
        color: '#00FF66',
        size: 46,
      }),
    );
  });

  it('maps template aspect ratio to package render mode', () => {
    const service = makeService() as never as {
      resolveRenderModeFromTemplate: (
        template: Record<string, unknown> | null,
      ) => string | null;
    };
    expect(
      service.resolveRenderModeFromTemplate({
        styleConfig: { aspectRatio: '9:16' },
      }),
    ).toBe('1080x1920');
    expect(
      service.resolveRenderModeFromTemplate({
        styleConfig: { aspectRatio: '16:9' },
      }),
    ).toBe('adaptive');
    expect(
      service.resolveRenderModeFromTemplate({
        styleConfig: { aspectRatio: 'abc' },
      }),
    ).toBeNull();
  });

  it('clamps invalid subtitle visual style values', () => {
    const service = makeService() as never as {
      sanitizeSubtitleVisualStyle: (
        style: Record<string, unknown>,
      ) => Record<string, unknown> | undefined;
    };
    const sanitized = service.sanitizeSubtitleVisualStyle({
      normalColor: 'not-a-color',
      highlightColor: '#00FF66',
      fontSize: 200,
      fontWeight: 1200,
      layout: {
        xPct: 200,
        yPct: -30,
        anchor: 'invalid-anchor',
        safeAreaPct: 60,
      },
    });
    expect(sanitized).toEqual(
      expect.objectContaining({
        highlightColor: '#00FF66',
        fontSize: 80,
        fontWeight: 900,
      }),
    );
    const layout = sanitized?.layout as
      | {
          xPct?: number;
          yPct?: number;
          anchor?: string;
          safeAreaPct?: number;
        }
      | undefined;
    expect(layout?.xPct).toBe(76);
    expect(layout?.yPct).toBe(24);
    expect(layout?.anchor).toBe('bottom-center');
    expect(layout?.safeAreaPct).toBe(24);
    expect(sanitized).not.toHaveProperty('normalColor');
  });

  it('saves stage state by user + project isolation key', async () => {
    const service = makeService();
    const db = (service as unknown as { db: unknown }).db as
      | {
          queryOne: jest.Mock;
          execute: jest.Mock;
        }
      | undefined;
    const serviceWithDb = service as never as {
      db: { queryOne: jest.Mock; execute: jest.Mock };
      saveProjectStageState: (
        userId: string,
        projectId: string,
        body: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
    };
    serviceWithDb.db.queryOne
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(null);

    const result = await serviceWithDb.saveProjectStageState('user-1', 'p1', {
      scriptHash: 'hash_1',
      audioAssetId: null,
    });

    expect(result).toEqual(
      expect.objectContaining({
        projectId: 'p1',
        scriptHash: 'hash_1',
      }),
    );
    expect(serviceWithDb.db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO video_project_stage_states'),
      expect.any(Array),
    );
    expect(db).toBeDefined();
  });

  it('persists avatarResourceId in stage-state and reads same value back', async () => {
    const serviceWithDb = makeService() as never as {
      db: { queryOne: jest.Mock; execute: jest.Mock };
      resources: { getAvatar: jest.Mock };
      saveProjectStageState: (
        userId: string,
        projectId: string,
        body: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
      getProjectStageState: (
        userId: string,
        projectId: string,
      ) => Promise<Record<string, unknown>>;
    };
    serviceWithDb.resources.getAvatar.mockResolvedValue({
      id: 'avatar_1',
      userId: 'user-1',
    });
    serviceWithDb.db.queryOne
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce({
        id: 'stage_1',
        user_id: 'user-1',
        project_id: 'p1',
        script_hash: null,
        audio_asset_id: null,
        subtitle_track_id: null,
        avatar_resource_id: 'avatar_1',
        render_mode: 'preserveSourceAspect',
        lipsync_task_id: null,
        digital_human_video_asset_id: null,
        video_url: null,
        created_at: '2026-05-27T00:00:00.000Z',
        updated_at: '2026-05-27T00:00:00.000Z',
      });

    const saved = await serviceWithDb.saveProjectStageState('user-1', 'p1', {
      avatarResourceId: 'avatar_1',
      renderMode: 'preserveSourceAspect',
    });
    const loaded = await serviceWithDb.getProjectStageState('user-1', 'p1');

    expect(saved).toEqual(
      expect.objectContaining({
        projectId: 'p1',
        avatarResourceId: 'avatar_1',
      }),
    );
    expect(loaded).toEqual(
      expect.objectContaining({
        projectId: 'p1',
        avatarResourceId: 'avatar_1',
      }),
    );
    expect(serviceWithDb.resources.getAvatar).toHaveBeenCalledWith(
      'user-1',
      'avatar_1',
    );
  });

  it('rejects stage-state save when avatarResourceId does not exist', async () => {
    const serviceWithDeps = makeService() as never as {
      db: { queryOne: jest.Mock; execute: jest.Mock };
      resources: { getAvatar: jest.Mock };
      saveProjectStageState: (
        userId: string,
        projectId: string,
        body: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
    };
    serviceWithDeps.db.queryOne
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(null);
    serviceWithDeps.resources.getAvatar.mockRejectedValue(
      new NotFoundException('avatar not found'),
    );

    await expect(
      serviceWithDeps.saveProjectStageState('user-1', 'p1', {
        avatarResourceId: 'avatar_not_exists',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(serviceWithDeps.db.execute).not.toHaveBeenCalled();
  });

  it('rejects stage-state save when avatarResourceId belongs to another user', async () => {
    const serviceWithDeps = makeService() as never as {
      db: { queryOne: jest.Mock; execute: jest.Mock };
      resources: { getAvatar: jest.Mock };
      saveProjectStageState: (
        userId: string,
        projectId: string,
        body: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
    };
    serviceWithDeps.db.queryOne
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce(null);
    serviceWithDeps.resources.getAvatar.mockRejectedValue(
      new ForbiddenException('forbidden'),
    );

    await expect(
      serviceWithDeps.saveProjectStageState('user-1', 'p1', {
        avatarResourceId: 'avatar_of_other_user',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(serviceWithDeps.db.execute).not.toHaveBeenCalled();
  });

  it('resolves latest reusable lipsync asset by fingerprint', async () => {
    const serviceWithDb = makeService() as never as {
      db: {
        queryOne: jest.Mock;
      };
      resolveLatestLipSyncAsset: (
        userId: string,
        projectId: string,
        query: {
          audioAssetId: string;
          avatarResourceId: string;
          renderMode: 'adaptive';
        },
      ) => Promise<Record<string, unknown>>;
    };
    serviceWithDb.db.queryOne
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce({
        id: 'dvh_1',
        user_id: 'user-1',
        project_id: 'p1',
        avatar_resource_id: 'avatar_1',
        audio_asset_id: 'audio_1',
        render_mode: 'adaptive',
        source_task_id: null,
        video_url: 'http://localhost:3000/uploads/output/lipsync.mp4',
        video_path: null,
        duration_seconds: 73.8,
        status: 'succeeded',
        error_message: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:01:00.000Z',
      });

    const result = await serviceWithDb.resolveLatestLipSyncAsset(
      'user-1',
      'p1',
      {
        audioAssetId: 'audio_1',
        avatarResourceId: 'avatar_1',
        renderMode: 'adaptive',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        projectId: 'p1',
        digitalHumanVideoAssetId: 'dvh_1',
        videoUrl: 'http://localhost:3000/uploads/output/lipsync.mp4',
      }),
    );
  });

  it('does not return reusable lipsync asset when source task status is failed', async () => {
    const serviceWithDb = makeService() as never as {
      db: {
        queryOne: jest.Mock;
      };
      resolveLatestLipSyncAsset: (
        userId: string,
        projectId: string,
        query: {
          audioAssetId: string;
          avatarResourceId: string;
          renderMode: 'adaptive';
        },
      ) => Promise<Record<string, unknown>>;
    };
    serviceWithDb.db.queryOne
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce({
        id: 'dvh_2',
        user_id: 'user-1',
        project_id: 'p1',
        avatar_resource_id: 'avatar_1',
        audio_asset_id: 'audio_1',
        render_mode: 'adaptive',
        source_task_id: 'lipsync_task_2',
        video_url: 'http://localhost:3000/uploads/output/lipsync-2.mp4',
        video_path: null,
        duration_seconds: 64.2,
        status: 'succeeded',
        error_message: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:01:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 'lipsync_task_2',
        kind: 'video-lipsync',
        status: 'failed',
      });

    const result = await serviceWithDb.resolveLatestLipSyncAsset(
      'user-1',
      'p1',
      {
        audioAssetId: 'audio_1',
        avatarResourceId: 'avatar_1',
        renderMode: 'adaptive',
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        projectId: 'p1',
        digitalHumanVideoAssetId: null,
        videoUrl: null,
      }),
    );
  });

  it('caches repeated resolve requests and avoids duplicate db lookups', async () => {
    const serviceWithDb = makeService() as never as {
      db: { queryOne: jest.Mock };
      resolveLatestLipSyncAsset: (
        userId: string,
        projectId: string,
        query: {
          audioAssetId: string;
          avatarResourceId: string;
          renderMode: 'adaptive';
        },
      ) => Promise<Record<string, unknown>>;
    };
    serviceWithDb.db.queryOne
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce({
        id: 'dvh_3',
        user_id: 'user-1',
        project_id: 'p1',
        avatar_resource_id: 'avatar_1',
        audio_asset_id: 'audio_1',
        render_mode: 'adaptive',
        source_task_id: null,
        video_url: 'http://localhost:3000/uploads/output/lipsync-3.mp4',
        video_path: null,
        duration_seconds: 70.1,
        status: 'succeeded',
        error_message: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:01:00.000Z',
      });

    const q = {
      audioAssetId: 'audio_1',
      avatarResourceId: 'avatar_1',
      renderMode: 'adaptive' as const,
    };
    const first = await serviceWithDb.resolveLatestLipSyncAsset(
      'user-1',
      'p1',
      q,
    );
    const second = await serviceWithDb.resolveLatestLipSyncAsset(
      'user-1',
      'p1',
      q,
    );

    expect(first).toEqual(
      expect.objectContaining({
        digitalHumanVideoAssetId: 'dvh_3',
      }),
    );
    expect(second).toEqual(first);
    expect(serviceWithDb.db.queryOne).toHaveBeenCalledTimes(2);
  });

  it('rejects stage-state read when project is not owned by current user', async () => {
    const serviceWithDb = makeService() as never as {
      db: { queryOne: jest.Mock };
      getProjectStageState: (
        userId: string,
        projectId: string,
      ) => Promise<Record<string, unknown>>;
    };
    serviceWithDb.db.queryOne.mockResolvedValueOnce(null);

    await expect(
      serviceWithDb.getProjectStageState('user-1', 'project_other_user'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('defaults persisted digital human asset render_mode to preserveSourceAspect when omitted', async () => {
    const serviceWithDb = makeService() as never as {
      db: { queryOne: jest.Mock; execute: jest.Mock };
      createDigitalHumanVideoAsset: (params: {
        userId: string;
        projectId: string;
        avatarResourceId: string;
        audioAssetId?: string | null;
        renderMode?: '1080x1920' | 'adaptive' | 'preserveSourceAspect' | null;
        sourceTaskId: string;
        videoUrl: string;
        durationSeconds: number;
        metadataJson?: Record<string, unknown> | null;
      }) => Promise<{ digitalHumanVideoAssetId: string }>;
    };
    serviceWithDb.db.queryOne.mockResolvedValueOnce({ id: 'p1' });

    await serviceWithDb.createDigitalHumanVideoAsset({
      userId: 'user-1',
      projectId: 'p1',
      avatarResourceId: 'avatar_1',
      audioAssetId: null,
      sourceTaskId: 'lipsync_1',
      videoUrl: 'http://localhost:3000/uploads/output/a.mp4',
      durationSeconds: 12.3,
      metadataJson: {
        formatContract: {
          restored: false,
        },
      },
    });

    expect(serviceWithDb.db.execute).toHaveBeenCalledTimes(1);
    const call = serviceWithDb.db.execute.mock.calls[0] as [string, unknown[]];
    expect(call[0]).toContain('INSERT INTO digital_human_video_assets');
    expect(call[1][5]).toBe('preserveSourceAspect');
    expect(call[1][10]).toBe(
      JSON.stringify({
        formatContract: {
          restored: false,
        },
      }),
    );
  });

  it('rejects cross-project audio usage for lipsync input resolution', async () => {
    const serviceWithDb = makeService() as never as {
      db: { queryOne: jest.Mock };
      resolveAudioInputForLipSync: (
        userId: string,
        audioAssetId: string,
        opts?: { projectId?: string | null },
      ) => Promise<Record<string, unknown>>;
    };
    serviceWithDb.db.queryOne
      .mockResolvedValueOnce({ id: 'project_a' })
      .mockResolvedValueOnce({
        id: 'audio_1',
        user_id: 'user-1',
        project_id: 'project_b',
        name: 'a.wav',
        source_type: 'upload',
        storage_provider: 'local',
        object_key: null,
        storage_path: '/tmp/a.wav',
        audio_url: null,
        mime_type: 'audio/wav',
        size_bytes: 1,
        duration_seconds: 1.1,
        status: 'succeeded',
        error_message: null,
        subtitle_track_id: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      });

    await expect(
      serviceWithDb.resolveAudioInputForLipSync('user-1', 'audio_1', {
        projectId: 'project_a',
      }),
    ).rejects.toThrow(/does not belong to current project/);
  });

  it('rejects oversized subtitle cues payload', async () => {
    const serviceWithDb = makeService() as never as {
      db: { queryOne: jest.Mock; execute: jest.Mock };
      updateSubtitleTrackCues: (
        userId: string,
        subtitleTrackId: string,
        cuesRaw: unknown,
      ) => Promise<unknown>;
    };
    serviceWithDb.db.queryOne.mockResolvedValueOnce({
      id: 'track_1',
      user_id: 'user-1',
      project_id: 'p1',
      audio_asset_id: 'audio_1',
      source: 'manual',
      language: 'zh-CN',
      duration_seconds: 10,
      cues_json: '[]',
      words_json: null,
      status: 'succeeded',
      error_message: null,
      created_at: '2026-05-25T00:00:00.000Z',
      updated_at: '2026-05-25T00:00:00.000Z',
    });
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      startTime: i,
      endTime: i + 0.5,
      text: `line-${i}`,
    }));

    await expect(
      serviceWithDb.updateSubtitleTrackCues('user-1', 'track_1', tooMany),
    ).rejects.toThrow(/too many subtitle cues/);
    expect(serviceWithDb.db.execute).not.toHaveBeenCalled();
  });

  it('rejects too complex subtitle visual style before package render assets query', async () => {
    const serviceWithDb = makeService() as never as {
      db: { queryOne: jest.Mock };
      packageRenderFromAssets: (
        userId: string,
        projectId: string,
        body: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    serviceWithDb.db.queryOne.mockResolvedValueOnce({ id: 'p1' });
    const huge = {
      nodes: Array.from({ length: 500 }, (_, i) => ({ i, k: `v-${i}` })),
    };

    await expect(
      serviceWithDb.packageRenderFromAssets('user-1', 'p1', {
        digitalHumanVideoAssetId: 'dvh_1',
        audioAssetId: 'audio_1',
        subtitleTrackId: 'track_1',
        subtitleTemplateId: 'tpl_1',
        subtitleVisualStyle: huge,
      }),
    ).rejects.toThrow(/subtitleVisualStyle is too complex/);
    expect(serviceWithDb.db.queryOne).toHaveBeenCalledTimes(1);
  });

  it('rejects package render when subtitle track does not match current audio asset', async () => {
    const serviceWithDeps = makeService() as never as {
      db: { queryOne: jest.Mock };
      packageRenderFromAssets: (
        userId: string,
        projectId: string,
        body: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    serviceWithDeps.db.queryOne
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce({
        id: 'dvh_1',
        user_id: 'user-1',
        project_id: 'p1',
        avatar_resource_id: 'avatar_1',
        audio_asset_id: 'audio_1',
        render_mode: 'preserveSourceAspect',
        source_task_id: 'lipsync_1',
        video_url: 'http://localhost:3000/uploads/output/lipsync.mp4',
        video_path: null,
        duration_seconds: 12,
        status: 'succeeded',
        error_message: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 'audio_1',
        user_id: 'user-1',
        project_id: 'p1',
        name: 'a.wav',
        source_type: 'upload',
        storage_provider: 'local',
        object_key: null,
        storage_path: '/tmp/a.wav',
        audio_url: null,
        mime_type: 'audio/wav',
        size_bytes: 1,
        duration_seconds: 12,
        status: 'succeeded',
        error_message: null,
        subtitle_track_id: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 'track_1',
        user_id: 'user-1',
        project_id: 'p1',
        audio_asset_id: 'audio_other',
        source: 'tts_alignment',
        language: 'zh-CN',
        duration_seconds: 12,
        cues_json: '[]',
        words_json: null,
        status: 'succeeded',
        error_message: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      });

    await expect(
      serviceWithDeps.packageRenderFromAssets('user-1', 'p1', {
        digitalHumanVideoAssetId: 'dvh_1',
        audioAssetId: 'audio_1',
        subtitleTrackId: 'track_1',
        subtitleTemplateId: 'tpl_1',
      }),
    ).rejects.toThrow(/subtitleTrackId does not belong to current audioAssetId/);
  });

  it('rejects package render when digital human video asset audio mismatches current audio asset', async () => {
    const serviceWithDeps = makeService() as never as {
      db: { queryOne: jest.Mock };
      packageRenderFromAssets: (
        userId: string,
        projectId: string,
        body: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    serviceWithDeps.db.queryOne
      .mockResolvedValueOnce({ id: 'p1' })
      .mockResolvedValueOnce({
        id: 'dvh_1',
        user_id: 'user-1',
        project_id: 'p1',
        avatar_resource_id: 'avatar_1',
        audio_asset_id: 'audio_old',
        render_mode: 'preserveSourceAspect',
        source_task_id: 'lipsync_1',
        video_url: 'http://localhost:3000/uploads/output/lipsync.mp4',
        video_path: null,
        duration_seconds: 12,
        status: 'succeeded',
        error_message: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 'audio_1',
        user_id: 'user-1',
        project_id: 'p1',
        name: 'a.wav',
        source_type: 'upload',
        storage_provider: 'local',
        object_key: null,
        storage_path: '/tmp/a.wav',
        audio_url: null,
        mime_type: 'audio/wav',
        size_bytes: 1,
        duration_seconds: 12,
        status: 'succeeded',
        error_message: null,
        subtitle_track_id: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      })
      .mockResolvedValueOnce({
        id: 'track_1',
        user_id: 'user-1',
        project_id: 'p1',
        audio_asset_id: 'audio_1',
        source: 'tts_alignment',
        language: 'zh-CN',
        duration_seconds: 12,
        cues_json: '[]',
        words_json: null,
        status: 'succeeded',
        error_message: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      });

    await expect(
      serviceWithDeps.packageRenderFromAssets('user-1', 'p1', {
        digitalHumanVideoAssetId: 'dvh_1',
        audioAssetId: 'audio_1',
        subtitleTrackId: 'track_1',
        subtitleTemplateId: 'tpl_1',
      }),
    ).rejects.toThrow(
      /digitalHumanVideoAssetId does not match current audioAssetId/,
    );
  });

  it('builds subtitle cues by script segments when ASR has only 2 segments', () => {
    const service = makeService() as never as {
      buildSubtitleCuesFromScriptSegments: (
        scriptSegments: string[],
        asrSegments: Array<{ startMs: number; endMs: number; text: string }>,
        fallbackDurationSeconds: number,
      ) => Array<{ startTime: number; endTime: number; text: string }>;
    };
    const cues = service.buildSubtitleCuesFromScriptSegments(
      ['第一段', '第二段', '第三段', '第四段'],
      [
        { startMs: 0, endMs: 5_000, text: '前半段' },
        { startMs: 5_000, endMs: 10_000, text: '后半段' },
      ],
      10,
    );

    expect(cues).toHaveLength(4);
    for (let i = 0; i < cues.length; i += 1) {
      expect(cues[i].endTime).toBeGreaterThan(cues[i].startTime);
      if (i > 0) {
        expect(cues[i].startTime).toBeGreaterThanOrEqual(cues[i - 1].endTime);
      }
    }
    expect(cues[cues.length - 1].endTime).toBeGreaterThanOrEqual(10);
  });

  it('rejects subtitle track creation when audio asset does not belong to current project', async () => {
    const serviceWithDb = makeService() as never as {
      db: { queryOne: jest.Mock };
      createSubtitleTrackForAudioAsset: (
        userId: string,
        audioAssetId: string,
        opts?: { projectId?: string | null },
      ) => Promise<unknown>;
    };
    serviceWithDb.db.queryOne
      .mockResolvedValueOnce({
        id: 'audio_1',
        user_id: 'user-1',
        project_id: 'project_b',
        name: 'a.wav',
        source_type: 'upload',
        storage_provider: 'local',
        object_key: null,
        storage_path: '/tmp/a.wav',
        audio_url: null,
        mime_type: 'audio/wav',
        size_bytes: 1,
        duration_seconds: 1.1,
        status: 'succeeded',
        error_message: null,
        subtitle_track_id: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      })
      .mockResolvedValueOnce({ id: 'project_a' });

    await expect(
      serviceWithDb.createSubtitleTrackForAudioAsset('user-1', 'audio_1', {
        projectId: 'project_a',
      }),
    ).rejects.toThrow(/does not belong to current project/);
  });

  it('returns tts_alignment track when explicit scriptSegments are provided', async () => {
    const serviceWithDeps = makeService() as never as {
      db: { queryOne: jest.Mock; execute: jest.Mock };
      transcription: { transcribeMedia: jest.Mock };
      readAudioBinaryFromAsset: jest.Mock;
      createSubtitleTrackForAudioAsset: (
        userId: string,
        audioAssetId: string,
        opts?: {
          projectId?: string | null;
          scriptSegments?: string[] | null;
        },
      ) => Promise<{
        source: string;
        subtitles: Array<{ text: string }>;
      }>;
    };
    const inserted: {
      id?: string;
      source?: string;
      cuesJson?: string;
      durationSeconds?: number;
      language?: string;
      createdAt?: string;
      updatedAt?: string;
    } = {};
    const audioRow = {
      id: 'audio_1',
      user_id: 'user-1',
      project_id: 'studio-current',
      name: 'a.wav',
      source_type: 'upload',
      storage_provider: 'local',
      object_key: null,
      storage_path: '/tmp/a.wav',
      audio_url: null,
      mime_type: 'audio/wav',
      size_bytes: 1,
      duration_seconds: 12,
      status: 'succeeded',
      error_message: null,
      subtitle_track_id: null,
      created_at: '2026-05-25T00:00:00.000Z',
      updated_at: '2026-05-25T00:00:00.000Z',
    };
    serviceWithDeps.db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM audio_assets')) {
        return audioRow;
      }
      if (sql.includes('FROM subtitle_tracks')) {
        return {
          id: inserted.id || 'track_x',
          user_id: 'user-1',
          project_id: 'studio-current',
          audio_asset_id: 'audio_1',
          source: inserted.source || 'tts_alignment',
          language: inserted.language || 'zh-CN',
          duration_seconds: inserted.durationSeconds || 12,
          cues_json: inserted.cuesJson || '[]',
          words_json: null,
          status: 'succeeded',
          error_message: null,
          created_at: inserted.createdAt || '2026-05-25T00:00:00.000Z',
          updated_at: inserted.updatedAt || '2026-05-25T00:00:00.000Z',
        };
      }
      return null;
    });
    serviceWithDeps.db.execute.mockImplementation(
      async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO subtitle_tracks')) {
          inserted.id = params[0] as string;
          inserted.source = params[4] as string;
          inserted.durationSeconds = params[6] as number;
          inserted.cuesJson = params[7] as string;
          inserted.language = params[5] as string;
          inserted.createdAt = params[11] as string;
          inserted.updatedAt = params[12] as string;
        }
      },
    );
    serviceWithDeps.readAudioBinaryFromAsset = jest.fn().mockResolvedValue({
      buffer: Buffer.from('audio'),
      mimeType: 'audio/wav',
      fileName: 'a.wav',
      localPath: null,
      sourceUrl: null,
      objectKey: null,
      storageProvider: 'local',
    });
    serviceWithDeps.transcription.transcribeMedia.mockResolvedValue({
      transcriptId: 'tr_1',
      fullText: 'asr raw',
      language: 'zh-CN',
      provider: 'asr-api',
      segments: [
        { startMs: 0, endMs: 3000, text: '第一段' },
        { startMs: 3000, endMs: 6000, text: '第二段' },
      ],
    });

    const result = await serviceWithDeps.createSubtitleTrackForAudioAsset(
      'user-1',
      'audio_1',
      {
        scriptSegments: ['一', '二', '三'],
      },
    );

    expect(result.source).toBe('tts_alignment');
    expect(result.subtitles).toHaveLength(3);
    expect(serviceWithDeps.db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE video_project_stage_states'),
      expect.any(Array),
    );
  });

  it('keeps auto subtitle-track creation as asr source when no scriptSegments provided', async () => {
    const serviceWithDeps = makeService() as never as {
      db: { queryOne: jest.Mock; execute: jest.Mock };
      transcription: { transcribeMedia: jest.Mock };
      readAudioBinaryFromAsset: jest.Mock;
      createSubtitleTrackForAudioAsset: (
        userId: string,
        audioAssetId: string,
      ) => Promise<{
        source: string;
        subtitles: Array<{ text: string }>;
      }>;
    };
    const inserted: { source?: string; cuesJson?: string; id?: string } = {};
    const audioRow = {
      id: 'audio_2',
      user_id: 'user-1',
      project_id: 'studio-current',
      name: 'a.wav',
      source_type: 'upload',
      storage_provider: 'local',
      object_key: null,
      storage_path: '/tmp/a.wav',
      audio_url: null,
      mime_type: 'audio/wav',
      size_bytes: 1,
      duration_seconds: 8,
      status: 'succeeded',
      error_message: null,
      subtitle_track_id: null,
      created_at: '2026-05-25T00:00:00.000Z',
      updated_at: '2026-05-25T00:00:00.000Z',
    };
    serviceWithDeps.db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM audio_assets')) {
        return audioRow;
      }
      if (sql.includes('FROM subtitle_tracks')) {
        return {
          id: inserted.id || 'track_y',
          user_id: 'user-1',
          project_id: 'studio-current',
          audio_asset_id: 'audio_2',
          source: inserted.source || 'asr',
          language: 'zh-CN',
          duration_seconds: 8,
          cues_json: inserted.cuesJson || '[]',
          words_json: null,
          status: 'succeeded',
          error_message: null,
          created_at: '2026-05-25T00:00:00.000Z',
          updated_at: '2026-05-25T00:00:00.000Z',
        };
      }
      return null;
    });
    serviceWithDeps.db.execute.mockImplementation(
      async (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO subtitle_tracks')) {
          inserted.id = params[0] as string;
          inserted.source = params[4] as string;
          inserted.cuesJson = params[7] as string;
        }
      },
    );
    serviceWithDeps.readAudioBinaryFromAsset = jest.fn().mockResolvedValue({
      buffer: Buffer.from('audio'),
      mimeType: 'audio/wav',
      fileName: 'a.wav',
      localPath: null,
      sourceUrl: null,
      objectKey: null,
      storageProvider: 'local',
    });
    serviceWithDeps.transcription.transcribeMedia.mockResolvedValue({
      transcriptId: 'tr_2',
      fullText: '第一段 第二段',
      language: 'zh-CN',
      provider: 'asr-api',
      segments: [
        { startMs: 0, endMs: 3000, text: '第一段' },
        { startMs: 3000, endMs: 8000, text: '第二段' },
      ],
    });

    const result = await serviceWithDeps.createSubtitleTrackForAudioAsset(
      'user-1',
      'audio_2',
    );

    expect(result.source).toBe('asr');
    expect(result.subtitles).toHaveLength(2);
  });

  it('rejects explicit subtitle-track creation when scriptSegments is missing', async () => {
    const serviceWithDb = makeService() as never as {
      db: { queryOne: jest.Mock };
      createSubtitleTrackForAudioAsset: (
        userId: string,
        audioAssetId: string,
        opts?: {
          projectId?: string | null;
          requireScriptSegments?: boolean;
        },
      ) => Promise<unknown>;
    };
    serviceWithDb.db.queryOne
      .mockResolvedValueOnce({
        id: 'audio_3',
        user_id: 'user-1',
        project_id: 'studio-current',
        name: 'a.wav',
        source_type: 'upload',
        storage_provider: 'local',
        object_key: null,
        storage_path: '/tmp/a.wav',
        audio_url: null,
        mime_type: 'audio/wav',
        size_bytes: 1,
        duration_seconds: 8,
        status: 'succeeded',
        error_message: null,
        subtitle_track_id: null,
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      })
      .mockResolvedValueOnce(null);

    await expect(
      serviceWithDb.createSubtitleTrackForAudioAsset('user-1', 'audio_3', {
        requireScriptSegments: true,
      }),
    ).rejects.toThrow(/scriptSegments is required/);
  });
});
