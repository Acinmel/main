import { TitleAssetsController } from './title-assets.controller';

describe('TitleAssetsController', () => {
  it('sets no-store headers for render task polling', async () => {
    const service = {
      getRenderTask: jest.fn().mockResolvedValue({
        taskId: 'title_task_1',
        status: 'processing',
      }),
      createRenderTask: jest.fn(),
    };
    const controller = new TitleAssetsController(service as never);
    const req = { userId: 'user-1' };
    const res = { setHeader: jest.fn() };

    const data = await controller.renderTask(
      req as never,
      'title_task_1',
      res as never,
    );

    expect(data).toEqual({
      code: 0,
      message: 'ok',
      data: {
        taskId: 'title_task_1',
        status: 'processing',
      },
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
    expect(service.getRenderTask).toHaveBeenCalledWith(
      'user-1',
      'title_task_1',
    );
  });
});
