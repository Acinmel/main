import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ResourcesService } from './resources.service';
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
    return this.resources.createVoice(req.userId!, body ?? {});
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
