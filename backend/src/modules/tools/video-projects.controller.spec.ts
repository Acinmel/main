import { VideoProjectsController } from './video-projects.controller';

describe('VideoProjectsController', () => {
  function makeProjectServiceMock() {
    return {
      createProject: jest.fn(),
      listProjects: jest.fn(),
      getProject: jest.fn(),
      renameProject: jest.fn(),
      archiveProject: jest.fn(),
    };
  }

  it('sets no-store headers for render task polling', async () => {
    const renderService = {
      getRenderTask: jest.fn().mockResolvedValue({
        taskId: 'render_1',
        status: 'processing',
        progress: 20,
      }),
      detectCutPoints: jest.fn(),
      createFinalRenderTask: jest.fn(),
      createPackageRenderTask: jest.fn().mockReturnValue({ taskId: 'pkg_1' }),
      getProjectStageState: jest.fn(),
      saveProjectStageState: jest.fn(),
      resolveLipSyncAsset: jest.fn(),
    };
    const controller = new VideoProjectsController(
      renderService as never,
      makeProjectServiceMock() as never,
    );
    const req = { userId: 'user-1', get: jest.fn().mockReturnValue(undefined) };
    const res = { setHeader: jest.fn() };

    const data = await controller.getRenderTask(
      req as never,
      'render_1',
      res as never,
    );

    expect(data).toEqual({
      taskId: 'render_1',
      status: 'processing',
      progress: 20,
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, no-cache, must-revalidate, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Expires', '0');
    expect(res.setHeader).toHaveBeenCalledWith('Surrogate-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('X-Poll-Interval-Ms', '5000');
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    expect(renderService.getRenderTask).toHaveBeenCalledWith(
      'user-1',
      'render_1',
    );
  });

  it('creates lipsync/pd-event tasks through render service', async () => {
    const renderService = {
      getRenderTask: jest.fn(),
      detectCutPoints: jest.fn(),
      createFinalRenderTask: jest.fn(),
      createLipSyncTask: jest.fn().mockResolvedValue({ taskId: 'lipsync_1' }),
      createPdEventTask: jest.fn().mockResolvedValue({ taskId: 'pdevent_1' }),
      createPackageRenderTask: jest.fn().mockResolvedValue({ taskId: 'pkg_1' }),
      getProjectStageState: jest.fn(),
      saveProjectStageState: jest.fn(),
      resolveLipSyncAsset: jest.fn(),
    };
    const controller = new VideoProjectsController(
      renderService as never,
      makeProjectServiceMock() as never,
    );
    const req = {
      userId: 'user-1',
      get: jest.fn().mockReturnValue(undefined),
    };

    const lipsync = await controller.createLipSyncTask(req as never, 'p1', {
      digitalHumanId: 'avatar-1',
      voiceResourceId: 'voice-1',
      script: 'test',
    });
    const pdEvent = await controller.createPdEventTask(req as never, 'p1', {
      avatarResourceId: 'avatar-1',
      voiceResourceId: 'voice-1',
      script: 'test',
      subtitleTemplateId: 'classic_yellow',
    });
    const packageTask = await controller.createPackageRenderTask(
      req as never,
      'p1',
      {
        digitalHumanVideoAssetId: 'dvh_1',
        audioAssetId: 'audio_1',
        subtitleTrackId: 'track_1',
      },
    );

    expect(renderService.createLipSyncTask).toHaveBeenCalledWith(
      'user-1',
      'p1',
      expect.objectContaining({ digitalHumanId: 'avatar-1' }),
    );
    expect(renderService.createPdEventTask).toHaveBeenCalledWith(
      'user-1',
      'p1',
      expect.objectContaining({ subtitleTemplateId: 'classic_yellow' }),
    );
    expect(lipsync).toEqual({ taskId: 'lipsync_1' });
    expect(pdEvent).toEqual({ taskId: 'pdevent_1' });
    expect(renderService.createPackageRenderTask).toHaveBeenCalledWith(
      'user-1',
      'p1',
      expect.objectContaining({ digitalHumanVideoAssetId: 'dvh_1' }),
    );
    expect(packageTask).toEqual({ taskId: 'pkg_1' });
  });

  it('passes idempotency key from request header when body has none', async () => {
    const renderService = {
      getRenderTask: jest.fn(),
      detectCutPoints: jest.fn(),
      createFinalRenderTask: jest.fn(),
      createLipSyncTask: jest.fn().mockResolvedValue({ taskId: 'lipsync_2' }),
      createPdEventTask: jest.fn().mockResolvedValue({ taskId: 'pdevent_2' }),
      createPackageRenderTask: jest.fn().mockResolvedValue({ taskId: 'pkg_2' }),
      getProjectStageState: jest.fn(),
      saveProjectStageState: jest.fn(),
      resolveLipSyncAsset: jest.fn(),
    };
    const controller = new VideoProjectsController(
      renderService as never,
      makeProjectServiceMock() as never,
    );
    const req = {
      userId: 'user-1',
      get: jest.fn().mockImplementation((name: string) => {
        return name === 'idempotency-key' ? 'idem-001' : undefined;
      }),
    };

    await controller.createLipSyncTask(req as never, 'p1', {
      avatarResourceId: 'avatar-1',
    });

    expect(renderService.createLipSyncTask).toHaveBeenCalledWith(
      'user-1',
      'p1',
      expect.objectContaining({
        avatarResourceId: 'avatar-1',
        idempotencyKey: 'idem-001',
      }),
    );
  });

  it('gets/saves stage state and resolves reusable lipsync assets', async () => {
    const renderService = {
      getRenderTask: jest.fn(),
      detectCutPoints: jest.fn(),
      createFinalRenderTask: jest.fn(),
      createLipSyncTask: jest.fn(),
      createPdEventTask: jest.fn(),
      createPackageRenderTask: jest.fn(),
      getProjectStageState: jest.fn().mockResolvedValue({
        projectId: 'p1',
        audioAssetId: 'audio_1',
      }),
      saveProjectStageState: jest.fn().mockResolvedValue({
        projectId: 'p1',
        audioAssetId: 'audio_2',
      }),
      resolveLipSyncAsset: jest.fn().mockResolvedValue({
        projectId: 'p1',
        digitalHumanVideoAssetId: 'dvh_1',
      }),
    };
    const controller = new VideoProjectsController(
      renderService as never,
      makeProjectServiceMock() as never,
    );
    const req = {
      userId: 'user-1',
      get: jest.fn().mockReturnValue(undefined),
    };
    const res = { setHeader: jest.fn() };

    const stage = await controller.getProjectStageState(
      req as never,
      'p1',
      res as never,
    );
    const saved = await controller.saveProjectStageState(req as never, 'p1', {
      audioAssetId: 'audio_2',
    });
    const resolved = await controller.resolveLipSyncAsset(req as never, 'p1', {
      audioAssetId: 'audio_2',
      avatarResourceId: 'avatar_1',
      renderMode: 'adaptive',
    });

    expect(stage).toEqual(expect.objectContaining({ projectId: 'p1' }));
    expect(saved).toEqual(expect.objectContaining({ audioAssetId: 'audio_2' }));
    expect(resolved).toEqual(
      expect.objectContaining({ digitalHumanVideoAssetId: 'dvh_1' }),
    );
    expect(renderService.getProjectStageState).toHaveBeenCalledWith(
      'user-1',
      'p1',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store, no-cache, must-revalidate, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Expires', '0');
    expect(res.setHeader).toHaveBeenCalledWith('Surrogate-Control', 'no-store');
    expect(renderService.saveProjectStageState).toHaveBeenCalledWith(
      'user-1',
      'p1',
      expect.objectContaining({ audioAssetId: 'audio_2' }),
    );
    expect(renderService.resolveLipSyncAsset).toHaveBeenCalledWith(
      'user-1',
      'p1',
      expect.objectContaining({
        audioAssetId: 'audio_2',
        avatarResourceId: 'avatar_1',
        renderMode: 'adaptive',
      }),
    );
  });

  it('delegates video project CRUD to service with current user scope', async () => {
    const renderService = {
      getRenderTask: jest.fn(),
      detectCutPoints: jest.fn(),
      createFinalRenderTask: jest.fn(),
      createLipSyncTask: jest.fn(),
      createPdEventTask: jest.fn(),
      createPackageRenderTask: jest.fn(),
      getProjectStageState: jest.fn(),
      saveProjectStageState: jest.fn(),
      resolveLipSyncAsset: jest.fn(),
    };
    const projectService = makeProjectServiceMock();
    projectService.createProject.mockResolvedValue({
      projectId: 'project_1',
      name: '任务A',
      archived: false,
      archivedAt: null,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    });
    projectService.listProjects.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
    projectService.getProject.mockResolvedValue({
      projectId: 'project_1',
      name: '任务A',
      archived: false,
      archivedAt: null,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    });
    projectService.renameProject.mockResolvedValue({
      projectId: 'project_1',
      name: '任务B',
      archived: false,
      archivedAt: null,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:10:00.000Z',
    });
    projectService.archiveProject.mockResolvedValue({
      projectId: 'project_1',
      name: '任务B',
      archived: true,
      archivedAt: '2026-05-25T00:20:00.000Z',
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:20:00.000Z',
    });

    const controller = new VideoProjectsController(
      renderService as never,
      projectService as never,
    );
    const req = {
      userId: 'user-1',
      get: jest.fn().mockReturnValue(undefined),
    };

    await controller.createProject(req as never, { name: '任务A' });
    await controller.listProjects(req as never, { scope: 'active', limit: 20 });
    await controller.getProject(req as never, 'project_1');
    await controller.renameProject(req as never, 'project_1', {
      name: '任务B',
    });
    await controller.archiveProject(req as never, 'project_1', {
      archived: true,
    });

    expect(projectService.createProject).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ name: '任务A' }),
    );
    expect(projectService.listProjects).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ scope: 'active', limit: 20 }),
    );
    expect(projectService.getProject).toHaveBeenCalledWith(
      'user-1',
      'project_1',
    );
    expect(projectService.renameProject).toHaveBeenCalledWith(
      'user-1',
      'project_1',
      expect.objectContaining({ name: '任务B' }),
    );
    expect(projectService.archiveProject).toHaveBeenCalledWith(
      'user-1',
      'project_1',
      expect.objectContaining({ archived: true }),
    );
  });
});
