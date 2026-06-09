import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { AliLipSyncRunningTimeoutError } from '../../integrations/ai/ali-lip-sync.service';
import { VideoProjectRenderService } from './video-project-render.service';

type RenderServiceInternals = {
  persistTask: (task: unknown) => Promise<void>;
  runFinalRenderTask: (taskId: string, body: unknown) => Promise<void>;
  runLipSyncTask: (taskId: string, body: unknown) => Promise<void>;
  recoverLipSyncTask: (taskId: string) => Promise<void>;
};

function makeService(configOverride: Record<string, string> = {}) {
  const subtitleWorkflow = {
    detectCutPoints: jest.fn(),
    renderFinalSmartClip: jest.fn(),
    createLipSyncAsset: jest.fn(),
    recoverLipSyncAsset: jest.fn(),
  };
  const stagedWorkflow = {
    resolveAudioInputForLipSync: jest.fn(),
    createDigitalHumanVideoAsset: jest.fn(),
    packageRenderFromAssets: jest.fn(),
    saveProjectStageState: jest.fn().mockResolvedValue(undefined),
  };
  const db = {
    queryOne: jest.fn().mockResolvedValue({ id: 'project-1' }),
    queryAll: jest.fn().mockResolvedValue([]),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const videoScript = {
    getOptionalByVideoId: jest.fn().mockResolvedValue(null),
  };
  const config = new ConfigService({
    TASK_STATUS_TTL_MS: '86400000',
    VIDEO_TASK_PER_USER_CONCURRENCY: '2',
    ...configOverride,
  });
  const service = new VideoProjectRenderService(
    subtitleWorkflow as never,
    stagedWorkflow as never,
    db as never,
    cache as never,
    config,
    videoScript as never,
  );
  return { service, db, cache, subtitleWorkflow, stagedWorkflow };
}

describe('VideoProjectRenderService', () => {
  it('loads render task status by lightweight read-only query', async () => {
    const { service, db, cache } = makeService();
    cache.get.mockResolvedValueOnce(null);
    db.queryOne.mockResolvedValueOnce({
      id: 'render_1',
      user_id: 'user-1',
      kind: 'video-render',
      status: 'processing',
      progress: 55,
      payload_json: '{}',
      result_json: JSON.stringify({
        outputUrl: 'https://cdn.example.com/output.mp4',
        duration: 66.2,
      }),
      error: null,
      created_at: '2026-05-25T00:00:00.000Z',
      updated_at: '2026-05-25T00:00:00.000Z',
    });

    const dto = await service.getRenderTask('user-1', 'render_1');

    expect(dto).toEqual(
      expect.objectContaining({
        taskId: 'render_1',
        status: 'processing',
        progress: 55,
        outputUrl: 'https://cdn.example.com/output.mp4',
      }),
    );
    expect(db.execute).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('creates render task with full uuid id and schedules async runner', async () => {
    const { service } = makeService();
    const internals = service as unknown as RenderServiceInternals;
    const persistSpy = jest
      .spyOn(internals, 'persistTask')
      .mockResolvedValue(undefined);
    const runSpy = jest
      .spyOn(internals, 'runFinalRenderTask')
      .mockResolvedValue(undefined);

    const task = await service.createFinalRenderTask(
      'user-1',
      'project-1',
      {} as never,
    );

    await Promise.resolve();
    expect(task.taskId).toMatch(
      /^render_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(persistSpy).toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalledWith(task.taskId, {});
  });

  it('reuses active lipsync task for duplicated request', async () => {
    const { service } = makeService();
    const internals = service as unknown as RenderServiceInternals;
    const persistSpy = jest
      .spyOn(internals, 'persistTask')
      .mockResolvedValue(undefined);
    const runSpy = jest
      .spyOn(internals, 'runLipSyncTask')
      .mockResolvedValue(undefined);
    const body = {
      avatarResourceId: 'avatar_1',
      audioAssetId: 'audio_1',
      voiceResourceId: 'voice_1',
      script: 'hello',
    };

    const first = await service.createLipSyncTask('user-1', 'project-1', body);
    const second = await service.createLipSyncTask('user-1', 'project-1', body);

    await Promise.resolve();
    expect(second.taskId).toBe(first.taskId);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it('reuses active lipsync task even when forceRetry is true', async () => {
    const { service } = makeService();
    const internals = service as unknown as RenderServiceInternals;
    const loggerLog = jest
      .spyOn(
        (service as { logger: { log: (message: string) => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    jest.spyOn(internals, 'persistTask').mockResolvedValue(undefined);
    jest.spyOn(internals, 'runLipSyncTask').mockResolvedValue(undefined);
    const body = {
      avatarResourceId: 'avatar_1',
      audioAssetId: 'audio_1',
      voiceResourceId: 'voice_1',
      script: 'hello',
      forceRetry: true,
    };

    const first = await service.createLipSyncTask('user-1', 'project-1', body);
    const second = await service.createLipSyncTask('user-1', 'project-1', body);

    expect(second.taskId).toBe(first.taskId);
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining('active-dedupe-hit'),
    );
  });

  it('bypasses completed lipsync reuse and clears stage state when regenerationKey is provided', async () => {
    const { service, db, stagedWorkflow } = makeService({
      LIPSYNC_COMPLETED_DEDUPE_WINDOW_MS: '1800000',
    });
    const loggerLog = jest
      .spyOn(
        (service as { logger: { log: (message: string) => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    const now = new Date().toISOString();
    db.queryAll.mockResolvedValueOnce([
      {
        id: 'lipsync_done_legacy',
        user_id: 'user-1',
        kind: 'video-lipsync',
        status: 'completed',
        progress: 100,
        payload_json: JSON.stringify({
          projectId: 'project-1',
          dedupeKey: 'idemp:video-lipsync:idem-regen',
        }),
        result_json: JSON.stringify({
          outputUrl: 'https://cdn.example.com/legacy.mp4',
          duration: 42,
          digitalHumanVideoAssetId: 'dvh_legacy',
        }),
        error: null,
        created_at: now,
        updated_at: now,
      },
    ]);
    const internals = service as unknown as RenderServiceInternals;
    jest.spyOn(internals, 'persistTask').mockResolvedValue(undefined);
    jest.spyOn(internals, 'runLipSyncTask').mockResolvedValue(undefined);

    const task = await service.createLipSyncTask('user-1', 'project-1', {
      avatarResourceId: 'avatar_1',
      audioAssetId: 'audio_1',
      script: 'hello',
      idempotencyKey: 'idem-regen',
      regenerationKey: 'regen-2026-05-27-01',
    });

    expect(task.taskId).toMatch(/^lipsync_/);
    expect(task.taskId).not.toBe('lipsync_done_legacy');
    expect(stagedWorkflow.saveProjectStageState).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      {
        lipsyncTaskId: null,
        digitalHumanVideoAssetId: null,
        videoUrl: null,
      },
    );
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining('force-retry-new-task'),
    );
  });

  it('reuses recent completed lipsync task by dedupe key', async () => {
    const { service, db } = makeService({
      LIPSYNC_COMPLETED_DEDUPE_WINDOW_MS: '1800000',
    });
    const loggerLog = jest
      .spyOn(
        (service as { logger: { log: (message: string) => void } }).logger,
        'log',
      )
      .mockImplementation(() => undefined);
    const now = new Date().toISOString();
    db.queryAll
      .mockResolvedValueOnce([
        {
          id: 'lipsync_done_1',
          user_id: 'user-1',
          kind: 'video-lipsync',
          status: 'completed',
          progress: 100,
          payload_json: JSON.stringify({
            projectId: 'project-1',
            dedupeKey: 'idemp:video-lipsync:idem-001',
          }),
          result_json: JSON.stringify({
            outputUrl: 'https://cdn.example.com/lipsync.mp4',
            duration: 73.8,
            digitalHumanVideoAssetId: 'dvh_1',
          }),
          error: null,
          created_at: now,
          updated_at: now,
        },
      ])
      .mockResolvedValueOnce([]);

    const task = await service.createLipSyncTask('user-1', 'project-1', {
      avatarResourceId: 'avatar_1',
      audioAssetId: 'audio_1',
      voiceResourceId: 'voice_1',
      script: 'hello',
      idempotencyKey: 'idem-001',
    });

    expect(task.taskId).toBe('lipsync_done_1');
    expect(task.status).toBe('completed');
    expect(task.outputUrl).toBe('https://cdn.example.com/lipsync.mp4');
    expect(loggerLog).toHaveBeenCalledWith(
      expect.stringContaining('completed-dedupe-hit'),
    );
  });

  it('does not reuse old completed lipsync task outside dedupe window', async () => {
    const { service, db } = makeService({
      LIPSYNC_COMPLETED_DEDUPE_WINDOW_MS: '1000',
    });
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    db.queryAll.mockResolvedValueOnce([
      {
        id: 'lipsync_done_old',
        user_id: 'user-1',
        kind: 'video-lipsync',
        status: 'completed',
        progress: 100,
        payload_json: JSON.stringify({
          projectId: 'project-1',
          dedupeKey: 'idemp:video-lipsync:idem-002',
        }),
        result_json: JSON.stringify({
          outputUrl: 'https://cdn.example.com/old.mp4',
          duration: 60,
          digitalHumanVideoAssetId: 'dvh_old',
        }),
        error: null,
        created_at: old,
        updated_at: old,
      },
    ]);
    const internals = service as unknown as RenderServiceInternals;
    jest.spyOn(internals, 'persistTask').mockResolvedValue(undefined);
    jest.spyOn(internals, 'runLipSyncTask').mockResolvedValue(undefined);

    const task = await service.createLipSyncTask('user-1', 'project-1', {
      avatarResourceId: 'avatar_1',
      audioAssetId: 'audio_1',
      voiceResourceId: 'voice_1',
      script: 'hello',
      idempotencyKey: 'idem-002',
    });

    expect(task.taskId).not.toBe('lipsync_done_old');
    expect(task.taskId).toMatch(/^lipsync_/);
  });

  it('defaults runLipSyncTask renderMode to preserveSourceAspect when request omits renderMode', async () => {
    const { service, stagedWorkflow, subtitleWorkflow } = makeService();
    const internals = service as unknown as RenderServiceInternals;
    jest.spyOn(internals, 'persistTask').mockResolvedValue(undefined);
    subtitleWorkflow.createLipSyncAsset.mockResolvedValue({
      videoUrl: 'http://localhost:3000/uploads/output/lipsync-default.mp4',
      duration: 9.2,
      hint: 'ok',
      metadataJson: { formatContract: { restored: false } },
    });
    stagedWorkflow.createDigitalHumanVideoAsset.mockResolvedValue({
      digitalHumanVideoAssetId: 'dvh_1',
    });

    const created = await service.createLipSyncTask('user-1', 'project-1', {
      avatarResourceId: 'avatar_1',
      script: 'hello',
    });
    await internals.runLipSyncTask(created.taskId, {
      avatarResourceId: 'avatar_1',
      script: 'hello',
    });

    expect(subtitleWorkflow.createLipSyncAsset).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        renderMode: 'preserveSourceAspect',
      }),
      expect.any(Object),
    );
    expect(stagedWorkflow.createDigitalHumanVideoAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceTaskId: created.taskId,
        renderMode: 'preserveSourceAspect',
        metadataJson: { formatContract: { restored: false } },
      }),
    );
  });

  it('marks task as provider_running when aliyun keeps RUNNING past local budget', async () => {
    const { service, subtitleWorkflow, stagedWorkflow } = makeService();
    const internals = service as unknown as RenderServiceInternals;
    jest.spyOn(internals, 'persistTask').mockResolvedValue(undefined);
    subtitleWorkflow.createLipSyncAsset.mockRejectedValue(
      new AliLipSyncRunningTimeoutError('timeout', {
        name: 'aliyun-videoretalk',
        taskId: 'ali_task_1',
        taskStatus: 'RUNNING',
        recoverUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    subtitleWorkflow.recoverLipSyncAsset.mockRejectedValue(
      new AliLipSyncRunningTimeoutError('timeout', {
        name: 'aliyun-videoretalk',
        taskId: 'ali_task_1',
        taskStatus: 'RUNNING',
        recoverUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    const created = await service.createLipSyncTask('user-1', 'project-1', {
      avatarResourceId: 'avatar_1',
      script: 'hello',
    });
    await internals.runLipSyncTask(created.taskId, {
      avatarResourceId: 'avatar_1',
      script: 'hello',
    });

    const dto = await service.getRenderTask('user-1', created.taskId);
    expect(dto.status).toBe('provider_running');
    expect(dto.progress).toBeGreaterThanOrEqual(90);
    expect(dto.digitalHumanVideoAssetId).toBeUndefined();
    expect(stagedWorkflow.createDigitalHumanVideoAsset).not.toHaveBeenCalled();
    expect(dto.provider).toEqual(
      expect.objectContaining({
        taskId: 'ali_task_1',
        taskStatus: 'RUNNING',
      }),
    );
  });

  it('treats legacy aliyun RUNNING timeout error text as provider_running', async () => {
    const { service, subtitleWorkflow, stagedWorkflow } = makeService({
      ALI_VIDEORETALK_RECOVER_WINDOW_MS: '60000',
    });
    const internals = service as unknown as RenderServiceInternals;
    jest.spyOn(internals, 'persistTask').mockResolvedValue(undefined);
    subtitleWorkflow.createLipSyncAsset.mockRejectedValue(
      new Error(
        'Aliyun VideoRetalk task timed out after 900s: {"request_id":"req_legacy","output":{"task_id":"ali_task_legacy","task_status":"RUNNING"}}',
      ),
    );
    subtitleWorkflow.recoverLipSyncAsset.mockRejectedValue(
      new AliLipSyncRunningTimeoutError('timeout', {
        name: 'aliyun-videoretalk',
        taskId: 'ali_task_legacy',
        taskStatus: 'RUNNING',
        recoverUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
    );

    const created = await service.createLipSyncTask('user-1', 'project-1', {
      avatarResourceId: 'avatar_1',
      script: 'hello',
    });
    await internals.runLipSyncTask(created.taskId, {
      avatarResourceId: 'avatar_1',
      script: 'hello',
    });

    const dto = await service.getRenderTask('user-1', created.taskId);
    expect(dto.status).toBe('provider_running');
    expect(dto.progress).toBeGreaterThanOrEqual(90);
    expect(dto.digitalHumanVideoAssetId).toBeUndefined();
    expect(stagedWorkflow.createDigitalHumanVideoAsset).not.toHaveBeenCalled();
    expect(dto.provider).toEqual(
      expect.objectContaining({
        requestId: 'req_legacy',
        taskId: 'ali_task_legacy',
        taskStatus: 'RUNNING',
      }),
    );
  });

  it('revives failed lipsync row to provider_running when persisted provider state is still RUNNING', async () => {
    const { service, db, cache } = makeService();
    cache.get.mockResolvedValueOnce(null);
    db.queryOne.mockResolvedValueOnce({
      id: 'lipsync_failed_1',
      user_id: 'user-1',
      kind: 'video-lipsync',
      status: 'failed',
      progress: 88,
      payload_json: JSON.stringify({
        projectId: 'project-1',
        dedupeKey: 'auto:video-lipsync:abc',
        avatarResourceId: 'avatar_1',
        renderMode: 'preserveSourceAspect',
      }),
      result_json: JSON.stringify({
        provider: {
          name: 'aliyun-videoretalk',
          taskId: 'ali_task_row_1',
          taskStatus: 'RUNNING',
        },
      }),
      error: 'Aliyun timeout legacy wrapper',
      created_at: '2026-05-27T00:00:00.000Z',
      updated_at: '2026-05-27T00:01:00.000Z',
    });

    const dto = await service.getRenderTask('user-1', 'lipsync_failed_1');

    expect(dto.status).toBe('provider_running');
    expect(dto.progress).toBeGreaterThanOrEqual(92);
    expect(dto.provider).toEqual(
      expect.objectContaining({
        taskId: 'ali_task_row_1',
        taskStatus: 'RUNNING',
      }),
    );
  });

  it('recovers provider_running lipsync task to completed without resubmitting provider task', async () => {
    const { service, subtitleWorkflow, stagedWorkflow } = makeService();
    const internals = service as unknown as RenderServiceInternals;
    jest.spyOn(internals, 'persistTask').mockResolvedValue(undefined);
    stagedWorkflow.resolveAudioInputForLipSync.mockResolvedValue({
      audioAssetId: 'audio_1',
      inputAudioPath: 'C:/tmp/audio_1.wav',
    });
    subtitleWorkflow.createLipSyncAsset.mockRejectedValue(
      new AliLipSyncRunningTimeoutError('timeout', {
        name: 'aliyun-videoretalk',
        taskId: 'ali_task_2',
        taskStatus: 'RUNNING',
        recoverUntil: new Date(Date.now() + 120_000).toISOString(),
      }),
    );
    subtitleWorkflow.recoverLipSyncAsset.mockResolvedValue({
      videoUrl: 'https://cdn.example.com/recovered.mp4',
      duration: 18.3,
      hint: 'recovered',
      metadataJson: { formatContract: { restored: true } },
    });
    stagedWorkflow.createDigitalHumanVideoAsset.mockResolvedValue({
      digitalHumanVideoAssetId: 'dvh_recovered',
    });

    const created = await service.createLipSyncTask('user-1', 'project-1', {
      avatarResourceId: 'avatar_1',
      audioAssetId: 'audio_1',
      script: 'hello',
    });
    await internals.runLipSyncTask(created.taskId, {
      avatarResourceId: 'avatar_1',
      audioAssetId: 'audio_1',
      script: 'hello',
    });
    await internals.recoverLipSyncTask(created.taskId);

    const dto = await service.getRenderTask('user-1', created.taskId);
    expect(dto.status).toBe('completed');
    expect(dto.outputUrl).toBe('https://cdn.example.com/recovered.mp4');
    expect(dto.digitalHumanVideoAssetId).toBe('dvh_recovered');
    expect(subtitleWorkflow.recoverLipSyncAsset).toHaveBeenCalled();
    expect(stagedWorkflow.saveProjectStageState).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      expect.objectContaining({
        lipsyncTaskId: created.taskId,
        digitalHumanVideoAssetId: 'dvh_recovered',
      }),
    );
  });

  it('rejects creation when user active task limit is reached', async () => {
    const { service, db } = makeService({
      VIDEO_TASK_PER_USER_CONCURRENCY: '1',
    });
    db.queryAll.mockResolvedValue([
      {
        id: 'existing_pending_task_1',
      },
    ]);

    await expect(
      service.createPackageRenderTask('user-1', 'project-1', {
        digitalHumanVideoAssetId: 'dvh_1',
        audioAssetId: 'audio_1',
        subtitleTrackId: 'track_1',
        subtitleTemplateId: 'tpl_1',
      }),
    ).rejects.toThrow(/Too many active tasks/);
  });

  it('falls back to update when initial task insert hits duplicate key', async () => {
    const { service, db, cache } = makeService();
    const internals = service as unknown as RenderServiceInternals;
    db.execute
      .mockRejectedValueOnce({
        code: 'ER_DUP_ENTRY',
        message: "Duplicate entry 'render_dup' for key 'PRIMARY'",
      })
      .mockResolvedValueOnce(undefined);
    db.queryOne.mockResolvedValue({
      id: 'render_dup',
      user_id: 'user-1',
      kind: 'video-render',
    });

    await internals.persistTask({
      taskId: 'render_dup',
      userId: 'user-1',
      projectId: 'project-1',
      taskKind: 'video-render',
      payload: { includeTitleAssets: false },
      status: 'processing',
      progress: 35,
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:01.000Z',
    });

    expect(db.execute).toHaveBeenCalledTimes(2);
    const firstCall = db.execute.mock.calls[0] as unknown[] | undefined;
    const secondCall = db.execute.mock.calls[1] as unknown[] | undefined;
    const firstSql = typeof firstCall?.[0] === 'string' ? firstCall[0] : '';
    const secondSql = typeof secondCall?.[0] === 'string' ? secondCall[0] : '';
    expect(firstSql).toContain('INSERT INTO task_statuses');
    expect(secondSql).toContain('UPDATE task_statuses');
    expect(cache.set).toHaveBeenCalledWith(
      'render_dup',
      expect.objectContaining({ userId: 'user-1' }),
    );
  });

  it('rejects package task creation for non-owned project before dedupe/persist', async () => {
    const { service, db } = makeService();
    const internals = service as unknown as RenderServiceInternals;
    const persistSpy = jest.spyOn(internals, 'persistTask');
    const runSpy = jest.spyOn(internals, 'runFinalRenderTask');
    db.queryOne.mockResolvedValueOnce(null);

    await expect(
      service.createPackageRenderTask('user-2', 'project-user1', {
        digitalHumanVideoAssetId: 'dvh_1',
        audioAssetId: 'audio_1',
        subtitleTrackId: 'track_1',
        subtitleTemplateId: 'tpl_1',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(db.queryAll).not.toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('checks owned project first for all project-scoped long-task entrypoints', async () => {
    const { service, db } = makeService();
    db.queryOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    await expect(
      service.createFinalRenderTask('user-x', 'project-a', {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createLipSyncTask('user-x', 'project-b', {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.createPdEventTask('user-x', 'project-c', {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.detectCutPoints('user-x', 'project-d', {} as never),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(db.queryOne).toHaveBeenCalledTimes(4);
    const queryOneCalls = db.queryOne.mock.calls as unknown[][];
    for (const call of queryOneCalls) {
      const sql = typeof call[0] === 'string' ? call[0] : '';
      expect(sql).toContain('FROM video_projects');
    }
  });
});
