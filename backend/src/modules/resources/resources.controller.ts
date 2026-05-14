import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
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
import { createReadStream, existsSync } from 'node:fs';
import * as path from 'node:path';
import type { Express, Request, Response } from 'express';
import { ResourcesService } from './resources.service';
import { Public } from '../auth/public.decorator';
import type { ResourceScope } from './resources.types';

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

function guessAudioMimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.webm': 'audio/webm',
  };
  return map[ext] ?? 'application/octet-stream';
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
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 300 * 1024 * 1024 } }))
  createAvatarFromUpload(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.resources.createAvatarFromUpload(req.userId!, file!, body ?? {});
  }

  @Patch('avatars/:id')
  renameAvatar(@Req() req: Request, @Param('id') id: string, @Body() body: RenameResourceDto) {
    return this.resources.rename('avatar_resources', req.userId!, id, body?.name);
  }

  @Delete('avatars/:id')
  deleteAvatar(@Req() req: Request, @Param('id') id: string) {
    return this.resources.deleteOne('avatar_resources', req.userId!, id);
  }

  @Post('avatars/batch-delete')
  batchDeleteAvatars(@Req() req: Request, @Body() body: BatchDeleteDto) {
    return this.resources.deleteMany('avatar_resources', req.userId!, body?.ids);
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
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  cloneVoiceFromUpload(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.resources.createVoiceFromUpload(req.userId!, file!, body ?? {});
  }

  @Patch('voices/:id')
  renameVoice(@Req() req: Request, @Param('id') id: string, @Body() body: RenameResourceDto) {
    return this.resources.rename('voice_resources', req.userId!, id, body?.name);
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
  streamVoiceFile(
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const full = this.resources.resolveVoiceSamplePathOrThrow(fileName);
    if (!existsSync(full)) {
      throw new NotFoundException('音频样本不存在');
    }
    res.setHeader('Content-Type', guessAudioMimeFromFilename(full));
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(createReadStream(full));
  }

  @Public()
  @Get('voice-files/:fileName/provider-stream')
  streamProviderVoiceFile(
    @Param('fileName') fileName: string,
    @Query('token') token: string | undefined,
    @Query('expires') expires: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const full = this.resources.resolveProviderVoiceSamplePathOrThrow(fileName, token, expires);
    if (!existsSync(full)) {
      throw new NotFoundException('音频样本不存在');
    }
    res.setHeader('Content-Type', guessAudioMimeFromFilename(full));
    res.setHeader('Cache-Control', 'private, max-age=60');
    return new StreamableFile(createReadStream(full));
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
  createSubtitleTemplate(@Req() req: Request, @Body() body: Record<string, unknown>) {
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
    return this.resources.deleteOne('subtitle_template_resources', req.userId!, id);
  }

  @Post('subtitle-templates/batch-delete')
  batchDeleteSubtitleTemplates(@Req() req: Request, @Body() body: BatchDeleteDto) {
    return this.resources.deleteMany('subtitle_template_resources', req.userId!, body?.ids);
  }
}
