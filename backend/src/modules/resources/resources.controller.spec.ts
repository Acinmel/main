import { StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { ResourcesController } from './resources.controller';
import type { ResourcesService } from './resources.service';

function makeController() {
  const resources = {
    openOwnedAvatarVideoStreamOrThrow: jest.fn(),
    getOwnedAvatarVideoMetadataOrThrow: jest.fn(),
  };
  const controller = new ResourcesController(
    resources as unknown as ResourcesService,
  );
  const req = { userId: 'user-1' } as Request;
  const setHeaderMock = jest.fn();
  const statusMock = jest.fn().mockReturnThis();
  const res = {
    setHeader: setHeaderMock,
    status: statusMock,
  } as unknown as Response;
  return { controller, resources, req, res, setHeaderMock, statusMock };
}

describe('ResourcesController avatar upload video stream', () => {
  it('sets 206 range headers for partial avatar video streams', async () => {
    const { controller, resources, req, res, setHeaderMock, statusMock } =
      makeController();
    resources.openOwnedAvatarVideoStreamOrThrow.mockResolvedValue({
      stream: Readable.from(Buffer.from('2345')),
      originalname: 'avatar-upload_1.mp4',
      mimetype: 'video/mp4',
      contentLength: 4,
      totalSize: 10,
      range: { start: 2, end: 5 },
    });

    const result = await controller.streamAvatarUploadVideo(
      req,
      'avatar-upload_1.mp4',
      'bytes=2-5',
      res,
    );

    expect(result).toBeInstanceOf(StreamableFile);
    expect(resources.openOwnedAvatarVideoStreamOrThrow).toHaveBeenCalledWith(
      'user-1',
      'avatar-upload_1.mp4',
      'bytes=2-5',
    );
    expect(statusMock).toHaveBeenCalledWith(206);
    expect(setHeaderMock).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(setHeaderMock).toHaveBeenCalledWith('Content-Range', 'bytes 2-5/10');
    expect(setHeaderMock).toHaveBeenCalledWith('Content-Length', '4');
  });

  it('sets 416 headers for unsatisfiable avatar video ranges', async () => {
    const { controller, resources, req, res, setHeaderMock, statusMock } =
      makeController();
    resources.openOwnedAvatarVideoStreamOrThrow.mockResolvedValue({
      stream: Readable.from([]),
      originalname: 'avatar-upload_1.mp4',
      mimetype: 'video/mp4',
      contentLength: 0,
      totalSize: 10,
      rangeNotSatisfiable: true,
    });

    await controller.streamAvatarUploadVideo(
      req,
      'avatar-upload_1.mp4',
      'bytes=99-100',
      res,
    );

    expect(statusMock).toHaveBeenCalledWith(416);
    expect(setHeaderMock).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(setHeaderMock).toHaveBeenCalledWith('Content-Range', 'bytes */10');
    expect(setHeaderMock).toHaveBeenCalledWith('Content-Length', '0');
  });
});
