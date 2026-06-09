import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { StagedWorkflowService } from './staged-workflow.service';

class CreateAudioAssetUploadCompleteDto {
  projectId?: string;
  name?: string;
  audioPath?: string;
  audioUrl?: string;
  objectKey?: string;
}

class CreateAudioAssetFromTtsDto {
  projectId?: string;
  name?: string;
  idempotencyKey?: string;
  forceRetry?: boolean;
  text!: string;
  voiceResourceId?: string;
  voiceLanguage?: string;
  voiceRate?: number;
}

class UpdateSubtitleTrackCuesDto {
  subtitles!: unknown[];
}

class CreateSubtitleTrackDto {
  projectId?: string;
  scriptText?: string;
  scriptSegments?: string[];
}

@Controller('v1')
export class StagedWorkflowController {
  private static readonly LEGACY_PROJECT_ID = 'studio-current';

  constructor(private readonly stagedWorkflow: StagedWorkflowService) {}

  @Post('audio-assets/upload-complete')
  async createAudioAssetFromUploadComplete(
    @Req() req: Request,
    @Body() body: CreateAudioAssetUploadCompleteDto,
  ) {
    const asset = await this.stagedWorkflow.createAudioAssetFromUploadComplete(
      req.userId!,
      body as unknown as Record<string, unknown>,
    );
    if (asset.subtitleTrackId) {
      return asset;
    }
    const track = await this.stagedWorkflow.createSubtitleTrackForAudioAsset(
      req.userId!,
      asset.audioAssetId,
      { projectId: asset.projectId },
    );
    return {
      ...asset,
      subtitleTrackId: track.subtitleTrackId,
    };
  }

  @Post('audio-assets/generate')
  async createAudioAssetFromTts(
    @Req() req: Request,
    @Body() body: CreateAudioAssetFromTtsDto,
  ) {
    const projectId = this.requireProjectScopedId(body.projectId);
    const asset = await this.stagedWorkflow.createAudioAssetFromTts(
      req.userId!,
      this.mergeIdempotencyKey(req, {
        ...(body as unknown as Record<string, unknown>),
        projectId,
      }),
    );
    if (asset.subtitleTrackId) {
      return asset;
    }
    const track = await this.stagedWorkflow.createSubtitleTrackForAudioAsset(
      req.userId!,
      asset.audioAssetId,
      { projectId: asset.projectId },
    );
    return {
      ...asset,
      subtitleTrackId: track.subtitleTrackId,
    };
  }

  @Get('audio-assets/:id')
  getAudioAsset(@Req() req: Request, @Param('id') id: string) {
    return this.stagedWorkflow.getAudioAsset(req.userId!, id);
  }

  @Post('audio-assets/:id/subtitle-track')
  createSubtitleTrack(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: CreateSubtitleTrackDto,
  ) {
    const projectId = this.requireProjectScopedId(body?.projectId);
    return this.stagedWorkflow.createSubtitleTrackForAudioAsset(
      req.userId!,
      id,
      {
        projectId,
        scriptText: body?.scriptText,
        scriptSegments: body?.scriptSegments,
        requireScriptSegments: true,
      },
    );
  }

  private requireProjectScopedId(projectIdRaw: unknown): string {
    if (typeof projectIdRaw !== 'string' || !projectIdRaw.trim()) {
      throw new BadRequestException('projectId is required.');
    }
    const projectId = projectIdRaw.trim();
    if (projectId === StagedWorkflowController.LEGACY_PROJECT_ID) {
      throw new BadRequestException(
        'studio-current is not allowed for this endpoint. Use a real projectId.',
      );
    }
    return projectId;
  }

  @Get('subtitle-tracks/:id')
  getSubtitleTrack(@Req() req: Request, @Param('id') id: string) {
    return this.stagedWorkflow.getSubtitleTrack(req.userId!, id);
  }

  @Patch('subtitle-tracks/:id/cues')
  updateSubtitleTrackCues(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateSubtitleTrackCuesDto,
  ) {
    return this.stagedWorkflow.updateSubtitleTrackCues(
      req.userId!,
      id,
      body.subtitles,
    );
  }

  private mergeIdempotencyKey(
    req: Request,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const headerKey = req.get('idempotency-key')?.trim();
    const bodyKey =
      typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (!headerKey || bodyKey) {
      return body;
    }
    return {
      ...body,
      idempotencyKey: headerKey,
    };
  }
}
