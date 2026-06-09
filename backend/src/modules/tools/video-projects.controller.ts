import {
  Body,
  Controller,
  Get,
  Patch,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { VideoProjectRenderService } from './video-project-render.service';
import { VideoProjectsService } from './video-projects.service';
import type {
  ArchiveVideoProjectBody,
  CreateLipSyncTaskBody,
  CreateVideoProjectBody,
  ListVideoProjectsQuery,
  PackageRenderTaskBody,
  CreatePdEventTaskBody,
  DetectCutPointsBody,
  RenderFinalBody,
  ProjectStageStateBody,
  ResolveLipSyncAssetQuery,
  UpdateVideoProjectBody,
} from './video-project-render.types';

@Controller('v1')
export class VideoProjectsController {
  private static readonly RENDER_TASK_POLL_INTERVAL_MS = 5000;

  constructor(
    private readonly videoProjectRender: VideoProjectRenderService,
    private readonly videoProjects: VideoProjectsService,
  ) {}

  @Post('video-projects')
  createProject(@Req() req: Request, @Body() body: CreateVideoProjectBody) {
    return this.videoProjects.createProject(req.userId!, body);
  }

  @Get('video-projects')
  listProjects(@Req() req: Request, @Query() query: ListVideoProjectsQuery) {
    return this.videoProjects.listProjects(req.userId!, query);
  }

  @Get('video-projects/:projectId')
  getProject(@Req() req: Request, @Param('projectId') projectId: string) {
    return this.videoProjects.getProject(req.userId!, projectId);
  }

  @Patch('video-projects/:projectId')
  renameProject(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: UpdateVideoProjectBody,
  ) {
    return this.videoProjects.renameProject(req.userId!, projectId, body);
  }

  @Post('video-projects/:projectId/archive')
  archiveProject(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: ArchiveVideoProjectBody,
  ) {
    return this.videoProjects.archiveProject(req.userId!, projectId, body);
  }

  @Post('video-projects/:projectId/detect-cut-points')
  detectCutPoints(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: DetectCutPointsBody,
  ) {
    return this.videoProjectRender.detectCutPoints(
      req.userId!,
      projectId,
      body,
    );
  }

  @Post('video-projects/:projectId/render-final')
  renderFinal(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: RenderFinalBody,
  ) {
    return this.videoProjectRender.createFinalRenderTask(
      req.userId!,
      projectId,
      this.mergeIdempotencyKey(req, body),
    );
  }

  @Post('video-projects/:projectId/lipsync-tasks')
  createLipSyncTask(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: CreateLipSyncTaskBody,
  ) {
    return this.videoProjectRender.createLipSyncTask(
      req.userId!,
      projectId,
      this.mergeIdempotencyKey(req, body),
    );
  }

  @Post('video-projects/:projectId/package-render-tasks')
  createPackageRenderTask(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: PackageRenderTaskBody,
  ) {
    return this.videoProjectRender.createPackageRenderTask(
      req.userId!,
      projectId,
      this.mergeIdempotencyKey(req, body),
    );
  }

  @Post('video-projects/:projectId/pd-events')
  createPdEventTask(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: CreatePdEventTaskBody,
  ) {
    return this.videoProjectRender.createPdEventTask(
      req.userId!,
      projectId,
      this.mergeIdempotencyKey(req, body),
    );
  }

  @Get('video-projects/:projectId/stage-state')
  getProjectStageState(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader(
      'Cache-Control',
      'private, no-store, no-cache, must-revalidate, max-age=0',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    return this.videoProjectRender.getProjectStageState(req.userId!, projectId);
  }

  @Put('video-projects/:projectId/stage-state')
  saveProjectStageState(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Body() body: ProjectStageStateBody,
  ) {
    return this.videoProjectRender.saveProjectStageState(
      req.userId!,
      projectId,
      body,
    );
  }

  @Get('video-projects/:projectId/lipsync-assets/resolve')
  resolveLipSyncAsset(
    @Req() req: Request,
    @Param('projectId') projectId: string,
    @Query() query: ResolveLipSyncAssetQuery,
  ) {
    return this.videoProjectRender.resolveLipSyncAsset(
      req.userId!,
      projectId,
      query,
    );
  }

  @Get('render-tasks/:taskId')
  getRenderTask(
    @Req() req: Request,
    @Param('taskId') taskId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader(
      'Cache-Control',
      'private, no-store, no-cache, must-revalidate, max-age=0',
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader(
      'X-Poll-Interval-Ms',
      String(VideoProjectsController.RENDER_TASK_POLL_INTERVAL_MS),
    );
    res.setHeader(
      'Retry-After',
      String(VideoProjectsController.RENDER_TASK_POLL_INTERVAL_MS / 1000),
    );
    return this.videoProjectRender.getRenderTask(req.userId!, taskId);
  }

  private mergeIdempotencyKey<
    T extends {
      idempotencyKey?: string;
    },
  >(req: Request, body: T): T {
    const headerKey = req.get('idempotency-key')?.trim();
    if (!headerKey || body.idempotencyKey?.trim()) {
      return body;
    }
    return {
      ...body,
      idempotencyKey: headerKey,
    };
  }
}
