import { StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { ResourcesController } from './resources.controller';
import type { ResourcesService } from './resources.service';

function makeController() {
  const resources = {
    openOwnedAvatarVideoStreamOrThrow: jest.fn(),
    getOwnedAvatarVideoMetadataOrThrow: jest.fn(),
    openSignedAvatarVideoStreamOrThrow: jest.fn(),
    getSignedAvatarVideoMetadataOrThrow: jest.fn(),
    createSignedUploadUrl: jest.fn(),
    createDigitalHumanAsset: jest.fn(),
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

  it('uses signed preview stream route with token and range', async () => {
    const { controller, resources, res, setHeaderMock, statusMock } =
      makeController();
    resources.openSignedAvatarVideoStreamOrThrow.mockResolvedValue({
      stream: Readable.from(Buffer.from('2345')),
      originalname: 'avatar-upload_1.mp4',
      mimetype: 'video/mp4',
      contentLength: 4,
      totalSize: 10,
      range: { start: 2, end: 5 },
    });

    const result = await controller.streamSignedAvatarUploadVideo(
      'avatar-upload_1.mp4',
      'token-1',
      '1234567890',
      'bytes=2-5',
      res,
    );

    expect(result).toBeInstanceOf(StreamableFile);
    expect(resources.openSignedAvatarVideoStreamOrThrow).toHaveBeenCalledWith(
      'avatar-upload_1.mp4',
      'token-1',
      '1234567890',
      'bytes=2-5',
    );
    expect(statusMock).toHaveBeenCalledWith(206);
    expect(setHeaderMock).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(setHeaderMock).toHaveBeenCalledWith('Content-Range', 'bytes 2-5/10');
    expect(setHeaderMock).toHaveBeenCalledWith('Content-Length', '4');
  });

  it('uses signed preview metadata route with token', async () => {
    const { controller, resources } = makeController();
    resources.getSignedAvatarVideoMetadataOrThrow.mockResolvedValue({
      avatarId: 'avatar-1',
      avatarName: 'avatar',
      fileName: 'avatar-upload_1.mp4',
      fileSize: 10,
      mimeType: 'video/mp4',
      mtime: '2026-05-19T00:00:00.000Z',
      previewUrl: '/preview-stream',
      metadataUrl: '/preview-metadata',
    });

    const result = await controller.getSignedAvatarUploadVideoMetadata(
      'avatar-upload_1.mp4',
      'token-1',
      '1234567890',
    );

    expect(resources.getSignedAvatarVideoMetadataOrThrow).toHaveBeenCalledWith(
      'avatar-upload_1.mp4',
      'token-1',
      '1234567890',
    );
    expect(result).toMatchObject({
      avatarId: 'avatar-1',
      fileName: 'avatar-upload_1.mp4',
    });
  });

  it('creates signed upload url with current user id', async () => {
    const { controller, resources, req } = makeController();
    resources.createSignedUploadUrl.mockResolvedValue({
      uploadId: 'upload_1',
      purpose: 'source-video',
      objectKey: 'runtime-assets/source-video/user-1/2026-05-23/upload_1.mp4',
      uploadUrl: 'https://oss.example.com/put',
      method: 'PUT',
      requiredHeaders: { 'Content-Type': 'video/mp4' },
      expiresAt: '2026-05-23T00:00:00.000Z',
    });

    const payload = {
      purpose: 'source-video',
      fileName: 'demo.mp4',
      contentType: 'video/mp4',
      fileSize: 1024,
    };
    const result = await controller.createSignedUploadUrl(req, payload);

    expect(resources.createSignedUploadUrl).toHaveBeenCalledWith(
      'user-1',
      payload,
    );
    expect(result).toMatchObject({
      uploadId: 'upload_1',
      method: 'PUT',
    });
  });

  it('creates digital-human asset with current user id', async () => {
    const { controller, resources, req } = makeController();
    resources.createDigitalHumanAsset.mockResolvedValue({
      id: 'avatar-dh-1',
      name: 'My digital human',
    });
    const payload = {
      name: 'My digital human',
      videoPath: 'avatar-upload_123.mp4',
      videoDurationSeconds: 6.2,
    };

    const result = await controller.createDigitalHumanAsset(req, payload);

    expect(resources.createDigitalHumanAsset).toHaveBeenCalledWith(
      'user-1',
      payload,
    );
    expect(result).toMatchObject({ id: 'avatar-dh-1' });
  });
});
