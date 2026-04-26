import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TasksService } from '../tasks/tasks.service';

class UpdateWorkMetaDto {
  /** 作品标题 */
  title?: string;
  /** 备注 / 说明 */
  content?: string;
}

/**
 * 我的作品：列表与元数据（数据行 user_works，外键 user_id → users）
 */
@Controller('v1/works')
export class WorksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  async list(@Req() req: Request) {
    const userId = req.userId!;
    const items = await this.tasks.listSummaries(userId);
    return { items };
  }

  /** 更新作品标题、备注（仅本人） */
  @Patch(':id')
  async updateMeta(
    @Param('id') id: string,
    @Body() body: UpdateWorkMetaDto,
    @Req() req: Request,
  ) {
    const userId = req.userId!;
    return this.tasks.updateWorkMeta(userId, id, {
      title: body.title,
      content: body.content,
    });
  }
}
