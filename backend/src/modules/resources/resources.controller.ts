import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Express, Request, Response } from 'express';
import { diskStorage } from 'multer';
import { ResourcesService } from './resources.service';
import { Public } from '../auth/public.decorator';
import type { ResourceScope } from './resources.types';

const AVATAR_VIDEO_MAX_BYTES = 500 * 1024 * 1024;
const AVATAR_UPLOAD_TMP_DIR = path.join(
  path.resolve(process.env.TEMP_DIR || process.env.TMP_DIR || os.tmpdir()),
  'shuziren-avatar-uploads',
);
const avatarUploadStorage = diskStorage({
  destination: (_req, _file, cb) => {
    mkdirSync(AVATAR_UPLOAD_TMP_DIR, { recursive: true });
    cb(null, AVATAR_UPLOAD_TMP_DIR);
  },
  filename: (_req, file, cb) => {
    const ext =
      path.extname(file.originalname || '').toLowerCase() || '.upload';
    cb(null, `${Date.now()}_${randomUUID()}${ext}`);
  },
});

class RenameResourceDto {
  name?: string;
}

class BatchDeleteDto {
  ids?: string[];
}

function scopeOf(value?: string): ResourceScope {
  return value === 'mine' || value === 'recommended' ? value : 'all';
}

function limitOf(value?: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

@Controller('v1/resources')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get('avatars')
  listAvatars(
    @Req() req: Request,
    @Query('scope') scope?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.resources.listAvatars(req.userId!, {
      scope: scopeOf(scope),
      cursor,
      limit: limitOf(limit),
    });
  }

  @Post('avatars')
  createAvatar(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.resources.createAvatar(req.userId!, body ?? {});
  }

  @Post('avatars/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: avatarUploadStorage,
      limits: { fileSize: AVATAR_VIDEO_MAX_BYTES },
    }),
  )
  createAvatarFromUpload(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.resources.createAvatarFromUpload(
      req.userId!,
      file!,
      body ?? {},
    );
  }

  @Get('avatars/upload-videos')
  listAvatarUploadVideos(@Req() req: Request, @Query('limit') limit?: string) {
    const n = Number(limit);
    return this.resources.listAvatarUploadVideos(
      req.userId!,
      Number.isFinite(n) ? n : undefined,
    );
  }

  @Get('avatar-video-files/:fileName/stream')
  async streamAvatarUploadVideo(
    @Req() req: Request,
    @Param('fileName') fileName: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.resources.openOwnedAvatarVideoStreamOrThrow(
      req.userId!,
      fileName,
      range,
    );
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.setHeader('Accept-Ranges', 'bytes');
    if (file.rangeNotSatisfiable) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${file.totalSize}`);
    } else if (file.range) {
      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${file.range.start}-${file.range.end}/${file.totalSize}`,
      );
    }
    res.setHeader('Content-Length', String(file.contentLength));
    return new StreamableFile(file.stream);
  }

  @Get('avatar-video-files/:fileName/metadata')
  getAvatarUploadVideoMetadata(
    @Req() req: Request,
    @Param('fileName') fileName: string,
  ) {
    return this.resources.getOwnedAvatarVideoMetadataOrThrow(
      req.userId!,
      fileName,
    );
  }

  @Patch('avatars/:id')
  renameAvatar(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RenameResourceDto,
  ) {
    return this.resources.rename(
      'avatar_resources',
      req.userId!,
      id,
      body?.name,
    );
  }

  @Delete('avatars/:id')
  deleteAvatar(@Req() req: Request, @Param('id') id: string) {
    return this.resources.deleteOne('avatar_resources', req.userId!, id);
  }

  @Post('avatars/batch-delete')
  batchDeleteAvatars(@Req() req: Request, @Body() body: BatchDeleteDto) {
    return this.resources.deleteMany(
      'avatar_resources',
      req.userId!,
      body?.ids,
    );
  }

  @Get('voices')
  listVoices(
    @Req() req: Request,
    @Query('scope') scope?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.resources.listVoices(req.userId!, {
      scope: scopeOf(scope),
      cursor,
      limit: limitOf(limit),
    });
  }

  @Post('voices')
  createVoice(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.resources.createVoice(req.userId!, body ?? {});
  }

  @Post('voices/clone')
  cloneVoice(@Req() req: Request, @Body() body: Record<string, unknown>) {
    return this.resources.cloneVoice(req.userId!, body ?? {});
  }

  @Post('voices/clone-upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  cloneVoiceFromUpload(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.resources.createVoiceFromUpload(req.userId!, file!, body ?? {});
  }

  @Patch('voices/:id')
  renameVoice(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: RenameResourceDto,
  ) {
    return this.resources.rename(
      'voice_resources',
      req.userId!,
      id,
      body?.name,
    );
  }

  @Delete('voices/:id')
  deleteVoice(@Req() req: Request, @Param('id') id: string) {
    return this.resources.deleteOne('voice_resources', req.userId!, id);
  }

  @Post('voices/batch-delete')
  batchDeleteVoices(@Req() req: Request, @Body() body: BatchDeleteDto) {
    return this.resources.deleteMany('voice_resources', req.userId!, body?.ids);
  }

  @Get('voice-files/:fileName/stream')
  async streamVoiceFile(
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.resources.openVoiceSampleStreamOrThrow(fileName);
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (typeof file.contentLength === 'number') {
      res.setHeader('Content-Length', String(file.contentLength));
    }
    if (file.etag) {
      res.setHeader('ETag', file.etag);
    }
    return new StreamableFile(file.stream);
  }

  @Public()
  @Get('voice-files/:fileName/provider-stream')
  async streamProviderVoiceFile(
    @Param('fileName') fileName: string,
    @Query('token') token: string | undefined,
    @Query('expires') expires: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.resources.openProviderVoiceSampleStreamOrThrow(
      fileName,
      token,
      expires,
    );
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Cache-Control', 'private, max-age=60');
    if (typeof file.contentLength === 'number') {
      res.setHeader('Content-Length', String(file.contentLength));
    }
    if (file.etag) {
      res.setHeader('ETag', file.etag);
    }
    return new StreamableFile(file.stream);
  }

  @Get('subtitle-templates')
  listSubtitleTemplates(
    @Req() req: Request,
    @Query('scope') scope?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.resources.listSubtitleTemplates(req.userId!, {
      scope: scopeOf(scope),
      cursor,
      limit: limitOf(limit),
    });
  }

  @Post('subtitle-templates')
  createSubtitleTemplate(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    return this.resources.createSubtitleTemplate(req.userId!, body ?? {});
  }

  @Post('subtitle-templates/:id/copy')
  copySubtitleTemplate(@Req() req: Request, @Param('id') id: string) {
    return this.resources.copySubtitleTemplate(req.userId!, id);
  }

  @Patch('subtitle-templates/:id')
  updateSubtitleTemplate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.resources.updateSubtitleTemplate(req.userId!, id, body ?? {});
  }

  @Delete('subtitle-templates/:id')
  deleteSubtitleTemplate(@Req() req: Request, @Param('id') id: string) {
    return this.resources.deleteOne(
      'subtitle_template_resources',
      req.userId!,
      id,
    );
  }

  @Post('subtitle-templates/batch-delete')
  batchDeleteSubtitleTemplates(
    @Req() req: Request,
    @Body() body: BatchDeleteDto,
  ) {
    return this.resources.deleteMany(
      'subtitle_template_resources',
      req.userId!,
      body?.ids,
    );
  }
}
