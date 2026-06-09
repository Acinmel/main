import { ConfigService } from '@nestjs/config';
import { TitleAssetsService } from './title-assets.service';

type TitleAssetsServiceInternals = {
  processPendingTasks: () => Promise<void>;
  runRenderTask: (taskId: string) => Promise<void>;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeService() {
  const db = {
    queryOne: jest.fn(),
    queryAll: jest.fn(),
    execute: jest.fn(),
  };
  const cache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
  };
  const videoScript = {
    getTitleMark: jest.fn(),
  };
  const ffmpeg = {
    renderTransparentTitleCardWebm: jest.fn(),
    probeVideoPixelFormat: jest.fn(),
    probeVideoAlphaInfo: jest.fn(),
    buildPreviewMp4FromTransparentWebm: jest.fn(),
    renderTitleFallbackPngFrame: jest.fn(),
    overlayTimedVideoAssets: jest.fn(),
  };
  const config = new ConfigService({ TASK_STATUS_TTL_MS: '86400000' });
  const service = new TitleAssetsService(
    db as never,
    cache as never,
    config,
    videoScript as never,
    ffmpeg as never,
  );
  return { service, db, cache, videoScript, ffmpeg };
}

describe('TitleAssetsService', () => {
  it('creates pending render task and persists asset row', async () => {
    const { service, db, videoScript } = makeService();
    jest
      .spyOn(
        service as unknown as Pick<
          TitleAssetsServiceInternals,
          'runRenderTask'
        >,
        'runRenderTask',
      )
      .mockResolvedValue(undefined);
    videoScript.getTitleMark.mockResolvedValue({
      id: 'mark_1',
      type: 'title_effect',
      start: 4,
      end: 6,
      text: 'AI',
      effect: {
        templateId: 'tech_card_pop',
        themeId: 'tech_green',
        position: 'center',
        duration: 1.8,
        enterAnimation: 'pop',
        exitAnimation: 'fade',
      },
      startTime: 0.8,
      endTime: 2.6,
    });
    db.queryOne
      .mockResolvedValueOnce(null) // find active asset
      .mockResolvedValueOnce(null); // find existing task row

    const result = await service.createRenderTask('user-1', {
      videoId: '1001',
      markId: 'mark_1',
    });

    expect(result.status).toBe('pending');
    expect(result.taskId).toMatch(/^title_task_/);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO video_title_asset'),
      expect.any(Array),
    );
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO task_statuses'),
      expect.any(Array),
    );
  });

  it('reads task status with resolved asset urls', async () => {
    const { service, db, ffmpeg, videoScript } = makeService();
    db.queryOne.mockResolvedValueOnce({
      id: 'title_task_1',
      user_id: 'user-1',
      kind: 'title-asset-render',
      status: 'success',
      payload_json: JSON.stringify({ assetId: 'vta_1' }),
      result_json: JSON.stringify({
        assetId: 'vta_1',
        assetStatus: 'success',
        assetUrl: 'https://cdn.example.com/title.webm',
        previewUrl: 'https://cdn.example.com/title-preview.mp4',
      }),
      error: null,
      created_at: '2026-05-21T00:00:00.000Z',
      updated_at: '2026-05-21T00:00:00.000Z',
    });

    const data = await service.getRenderTask('user-1', 'title_task_1');
    expect(data.status).toBe('success');
    expect(data.assetUrl).toBe('https://cdn.example.com/title.webm');
    expect(data.previewUrl).toBe('https://cdn.example.com/title-preview.mp4');
    expect(db.queryOne).toHaveBeenCalledTimes(1);
    expect(db.execute).not.toHaveBeenCalled();
    expect(ffmpeg.renderTransparentTitleCardWebm).not.toHaveBeenCalled();
    expect(videoScript.getTitleMark).not.toHaveBeenCalled();
  });

  it('poller dispatches pending tasks only', async () => {
    const { service, db } = makeService();
    const internals = service as unknown as TitleAssetsServiceInternals;
    const runSpy = jest
      .spyOn(internals, 'runRenderTask')
      .mockResolvedValue(undefined);

    db.queryAll
      .mockResolvedValueOnce([]) // failTimedOutProcessingTasks -> processing rows
      .mockResolvedValueOnce([{ id: 'title_task_pending_1' }]); // pending rows

    await internals.processPendingTasks();

    expect(db.queryAll).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("status = 'pending'"),
      [],
    );
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith('title_task_pending_1');
  });

  it('keeps same taskId mutually exclusive while running', async () => {
    const { service, db } = makeService();
    const internals = service as unknown as TitleAssetsServiceInternals;
    const gate = deferred<{
      id: string;
      user_id: string;
      kind: string;
      status: 'pending' | 'processing' | 'success' | 'failed';
      payload_json: string | null;
      result_json: string | null;
      error: string | null;
      created_at: string;
      updated_at: string;
    } | null>();

    db.queryOne.mockImplementationOnce(() => gate.promise);

    const firstRun = internals.runRenderTask('title_task_lock_1');
    const secondRun = internals.runRenderTask('title_task_lock_1');

    await Promise.resolve();
    expect(db.queryOne).toHaveBeenCalledTimes(1);

    gate.resolve({
      id: 'title_task_lock_1',
      user_id: 'user-1',
      kind: 'title-asset-render',
      status: 'processing',
      payload_json: JSON.stringify({ assetId: 'vta_1' }),
      result_json: '{}',
      error: null,
      created_at: '2026-05-21T00:00:00.000Z',
      updated_at: '2026-05-21T00:00:00.000Z',
    });

    await Promise.all([firstRun, secondRun]);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('fails stale processing tasks during poll sweep', async () => {
    const { service, db } = makeService();
    const internals = service as unknown as TitleAssetsServiceInternals;

    db.queryAll
      .mockResolvedValueOnce([
        {
          id: 'title_task_stale_1',
          user_id: 'user-1',
          payload_json: JSON.stringify({ assetId: 'vta_stale_1' }),
          created_at: '2026-05-20T00:00:00.000Z',
          updated_at: '2026-05-20T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([]);
    db.queryOne.mockResolvedValue({ id: 'title_task_stale_1' });

    await internals.processPendingTasks();

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE video_title_asset'),
      expect.arrayContaining(['failed', null, null]),
    );
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE task_statuses'),
      expect.arrayContaining([
        'failed',
        100,
        expect.any(String),
        expect.any(String),
        'Title asset render timeout after 30000ms',
      ]),
    );
  });
});
