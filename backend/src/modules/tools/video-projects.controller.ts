import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { VideoProjectRenderService } from './video-project-render.service';
import type {
  DetectCutPointsBody,
  RenderFinalBody,
} from './video-project-render.types';

@Controller('v1')
export class VideoProjectsController {
  constructor(private readonly videoProjectRender: VideoProjectRenderService) {}

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
      body,
    );
  }

  @Get('render-tasks/:taskId')
  getRenderTask(@Req() req: Request, @Param('taskId') taskId: string) {
    return this.videoProjectRender.getRenderTask(req.userId!, taskId);
  }
}
