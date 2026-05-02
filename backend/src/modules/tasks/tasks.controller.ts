import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express, Request } from 'express';
import { normalizeSourceVideoUrl } from '../../common/douyin-share-url.util';
import { AuditService } from '../audit/audit.service';
import { TasksService } from './tasks.service';
import type {
  RenderOptionsDto,
  RewritePayloadDto,
  RewriteStyle,
} from './tasks.types';

class CreateTaskDto {
  sourceVideoUrl!: string;
  /** 首页解析后用户编辑过的口播文案；有值时任务抽取阶段将跳过千问 ASR，直接使用该文本 */
  initialTranscript?: string;
}

class RewriteSuggestDto {
  style!: RewriteStyle;
}

/**
 * 任务 API（v1）
 *
 * 典型调用顺序：
 * 1) POST /v1/tasks
 * 2) POST /v1/tasks/:id/photo  (multipart field: file)
 * 3) POST /v1/tasks/:id/extract
 * 4) 轮询 GET /v1/tasks/:id  至 flags.transcriptAvailable
 * 5) GET /v1/tasks/:id/transcript
 * 6) POST /v1/tasks/:id/rewrite/suggest（可选） + POST /v1/tasks/:id/rewrite
 * 7) POST /v1/tasks/:id/render
 * 8) 轮询 GET /v1/tasks/:id  至 status=success
 * 9) GET /v1/tasks/:id/result + 下载链接
 */
@Controller('v1/tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  async create(@Body() body: CreateTaskDto, @Req() req: Request) {
    if (!body?.sourceVideoUrl?.trim()) {
      throw new BadRequestException('sourceVideoUrl 不能为空');
    }
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '无法识别有效的视频链接。抖音请使用「复制链接」并粘贴含 v.douyin.com 短链或 www.douyin.com/video 的文案。',
      );
    }
    const initialRaw = body.initialTranscript?.trim();
    if (initialRaw && initialRaw.length > 50_000) {
      throw new BadRequestException('initialTranscript 过长（上限 50000 字符）');
    }
    const initial = initialRaw && initialRaw.length > 0 ? initialRaw : undefined;
    const userId = req.userId!;
    const out = await this.tasks.createTask(userId, normalized, initial);
    void this.audit.log(userId, 'task_create', `task_id=${out.id}`, req);
    return out;
  }

  /** 更具体的路径优先注册，避免被 :id 误匹配 */
  @Get(':id/download/subtitle')
  async downloadSubtitle(@Param('id') id: string, @Req() req: Request) {
    const userId = req.userId!;
    const buf = await this.tasks.buildSubtitleDownload(userId, id);
    return new StreamableFile(buf, {
      type: 'text/plain; charset=utf-8',
      disposition: `attachment; filename="task-${id}.srt"`,
    });
  }

  @Get(':id/download/script')
  async downloadScript(@Param('id') id: string, @Req() req: Request) {
    const userId = req.userId!;
    const buf = await this.tasks.buildScriptDownload(userId, id);
    return new StreamableFile(buf, {
      type: 'text/plain; charset=utf-8',
      disposition: `attachment; filename="task-${id}-script.txt"`,
    });
  }

  @Get(':id/transcript')
  async transcript(@Param('id') id: string, @Req() req: Request) {
    const userId = req.userId!;
    return this.tasks.getTranscript(userId, id);
  }

  @Get(':id/result')
  async result(@Param('id') id: string, @Req() req: Request) {
    const userId = req.userId!;
    return this.tasks.getResult(userId, id);
  }

  @Post(':id/photo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }),
  )
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('缺少 multipart 字段 file');
    const userId = req.userId!;
    return this.tasks.attachPhoto(userId, id, {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    });
  }

  @Post(':id/extract')
  async extract(@Param('id') id: string, @Req() req: Request) {
    const userId = req.userId!;
    return this.tasks.startExtract(userId, id);
  }

  @Post(':id/rewrite/suggest')
  suggestRewrite(
    @Param('id') id: string,
    @Body() body: RewriteSuggestDto,
    @Req() req: Request,
  ) {
    if (!body?.style) throw new BadRequestException('style 不能为空');
    const userId = req.userId!;
    return this.tasks.suggestRewrite(userId, id, body.style);
  }

  @Post(':id/rewrite')
  async saveRewrite(
    @Param('id') id: string,
    @Body() body: RewritePayloadDto,
    @Req() req: Request,
  ) {
    const userId = req.userId!;
    return this.tasks.saveRewrite(userId, id, body);
  }

  @Post(':id/render')
  async submitRender(
    @Param('id') id: string,
    @Body() body: RenderOptionsDto,
    @Req() req: Request,
  ) {
    if (!body?.mode || !body?.aspect || !body?.voiceStyleId || !body?.subtitleStyleId) {
      throw new BadRequestException('mode/aspect/voiceStyleId/subtitleStyleId 均为必填');
    }
    const userId = req.userId!;
    const out = await this.tasks.submitRender(userId, id, body);
    void this.audit.log(userId, 'render_submit', `task_id=${id}`, req);
    return out;
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: Request) {
    const userId = req.userId!;
    return this.tasks.getTask(userId, id);
  }
}
