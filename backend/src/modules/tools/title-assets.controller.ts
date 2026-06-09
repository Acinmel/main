import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TitleAssetsService } from './title-assets.service';

class RenderTitleAssetDto {
  videoId!: string | number;
  markId!: string;
}

@Controller('v1/title-assets')
export class TitleAssetsController {
  private static readonly RENDER_TASK_POLL_INTERVAL_MS = 5000;

  constructor(private readonly titleAssets: TitleAssetsService) {}

  @Post('render')
  async render(@Req() req: Request, @Body() body: RenderTitleAssetDto) {
    const data = await this.titleAssets.createRenderTask(req.userId!, body);
    return {
      code: 0,
      message: 'ok',
      data,
    };
  }

  @Get('render-tasks/:taskId')
  async renderTask(
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
      String(TitleAssetsController.RENDER_TASK_POLL_INTERVAL_MS),
    );
    res.setHeader(
      'Retry-After',
      String(TitleAssetsController.RENDER_TASK_POLL_INTERVAL_MS / 1000),
    );
    const data = await this.titleAssets.getRenderTask(req.userId!, taskId);
    return {
      code: 0,
      message: 'ok',
      data,
    };
  }
}
