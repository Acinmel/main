import type { Request } from 'express';
import { VideoScriptController } from './video-script.controller';

function makeController() {
  const videoScript = {
    save: jest.fn(),
    markTitle: jest.fn(),
    getOptionalByVideoId: jest.fn(),
  };
  const controller = new VideoScriptController(videoScript as never);
  const req = { userId: 'user-1' } as Request;
  return { controller, videoScript, req };
}

describe('VideoScriptController', () => {
  it('returns null data instead of 404 when optional script config is missing', async () => {
    const { controller, videoScript, req } = makeController();
    videoScript.getOptionalByVideoId.mockResolvedValueOnce(null);

    const result = await controller.detail(req, 'project-1');

    expect(videoScript.getOptionalByVideoId).toHaveBeenCalledWith(
      'user-1',
      'project-1',
    );
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: null,
    });
  });
});
