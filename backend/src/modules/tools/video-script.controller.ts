import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { VideoScriptService } from './video-script.service';

class SaveVideoScriptDto {
  videoId!: string | number;
  scriptText!: string;
  subtitleTemplateId!: string;
  subtitleVisualStyle?: unknown;
  highlights?: unknown[];
}

class MarkTitleDto {
  videoId!: string | number;
  start!: number;
  end!: number;
  text?: string;
  templateId?: string;
  themeId?: string;
  position?: 'center' | 'top' | 'bottom';
  layout?: {
    xPct: number;
    yPct: number;
    anchor?:
      | 'center'
      | 'top-center'
      | 'bottom-center'
      | 'top-left'
      | 'top-right'
      | 'bottom-left'
      | 'bottom-right'
      | 'left-center'
      | 'right-center';
    scale?: number;
    safeAreaPct?: number;
    maxWidthPct?: number;
  };
  duration?: number;
}

@Controller()
export class VideoScriptController {
  constructor(private readonly videoScript: VideoScriptService) {}

  @Post(['v1/video-script/save', 'video-script/save'])
  async save(@Req() req: Request, @Body() body: SaveVideoScriptDto) {
    const data = await this.videoScript.save(req.userId!, body);
    return {
      code: 0,
      message: '保存成功',
      data: {
        videoId: data.videoId,
        scriptText: data.scriptText,
        subtitleTemplateId: data.subtitleTemplateId,
        subtitleVisualStyle: data.subtitleVisualStyle,
        highlights: data.highlights.map((item) => ({
          id: item.id,
          start: item.start,
          end: item.end,
          text: item.text,
          style: item.style,
        })),
        marks: data.marks,
      },
    };
  }

  @Post('v1/video-script/mark-title')
  async markTitle(@Req() req: Request, @Body() body: MarkTitleDto) {
    const mark = await this.videoScript.markTitle(req.userId!, body);
    return {
      code: 0,
      message: 'ok',
      data: mark,
    };
  }

  @Get(['v1/video-script/:videoId', 'video-script/:videoId'])
  async detail(@Req() req: Request, @Param('videoId') videoId: string) {
    const data = await this.videoScript.getOptionalByVideoId(
      req.userId!,
      videoId,
    );
    return {
      code: 0,
      message: 'ok',
      data,
    };
  }
}
