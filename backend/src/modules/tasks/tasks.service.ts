import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AvatarAiService } from '../../integrations/ai/avatar-ai.service';
import { buildMockSegments } from '../../integrations/ai/ai-mock.util';
import { RewriteAiService } from '../../integrations/ai/rewrite-ai.service';
import { SpeechAiService } from '../../integrations/ai/speech-ai.service';
import { TranscriptionAiService } from '../../integrations/ai/transcription-ai.service';
import { DigitalHumanPersistenceService } from '../digital-human/digital-human-persistence.service';
import { UserWorksPersistenceService } from '../works/user-works-persistence.service';
import type {
  RewritePayloadDto,
  RenderOptionsDto,
  RewriteStyle,
  TaskDetailDto,
  TaskFlagsDto,
  TaskInternal,
  TaskStatus,
  TaskSummaryDto,
  TranscriptDto,
} from './tasks.types';

/**
 * 任务流水线 + 作品持久化（user_works）：内存热数据，DB 为权威存储（可跨进程恢复）。
 */
@Injectable()
export class TasksService {
  private readonly tasks = new Map<string, TaskInternal>();

  constructor(
    private readonly transcriptionAi: TranscriptionAiService,
    private readonly rewriteAi: RewriteAiService,
    private readonly speechAi: SpeechAiService,
    private readonly avatarAi: AvatarAiService,
    private readonly userWorks: UserWorksPersistenceService,
    private readonly digitalHumanPersistence: DigitalHumanPersistenceService,
  ) {}

  async createTask(
    userId: string,
    sourceVideoUrl: string,
    prefilledTranscript?: string,
  ): Promise<TaskDetailDto> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const trimmed = prefilledTranscript?.trim();
    const row: TaskInternal = {
      id,
      userId,
      status: 'pending',
      sourceVideoUrl,
      createdAt: now,
      updatedAt: now,
      extractStarted: false,
      renderStarted: false,
      output: { mp4Url: null, subtitleUrl: null, scriptUrl: null },
      prefilledTranscript: trimmed && trimmed.length > 0 ? trimmed : undefined,
      title: summarizeTitle(sourceVideoUrl),
    };
    this.tasks.set(id, row);
    await this.persistRow(row);
    return this.toDetail(row);
  }

  assertOwner(userId: string, row: TaskInternal) {
    if (row.userId !== userId) {
      throw new ForbiddenException('无权访问该任务');
    }
  }

  async getTask(userId: string, id: string): Promise<TaskDetailDto> {
    const row = await this.loadTask(userId, id);
    return this.toDetail(row);
  }

  async attachPhoto(
    userId: string,
    id: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<{ photo: TaskInternal['photo'] }> {
    const row = await this.loadTask(userId, id);
    this.ensurePhase(row, ['pending'], '仅「待处理」任务可上传照片');

    const mime = file.mimetype;
    if (mime !== 'image/jpeg' && mime !== 'image/png') {
      throw new BadRequestException('仅支持 JPG/PNG');
    }
    const max = 8 * 1024 * 1024;
    if (file.size <= 0 || file.size > max) {
      throw new BadRequestException('图片大小需在 1B～8MB');
    }

    row.photo = {
      originalName: file.originalname,
      mimeType: mime,
      byteLength: file.size,
    };
    void file.buffer;
    row.updatedAt = new Date().toISOString();
    await this.persistRow(row);
    return { photo: row.photo };
  }

  async startExtract(userId: string, id: string): Promise<{ accepted: true }> {
    const row = await this.loadTask(userId, id);
    if (!row.photo) throw new BadRequestException('请先上传照片后再抽取口播');
    if (row.extractStarted) {
      return { accepted: true };
    }
    row.extractStarted = true;
    row.status = 'parsing';
    row.updatedAt = new Date().toISOString();
    await this.persistRow(row);

    setTimeout(() => void this.advanceParsing(id), 600);
    return { accepted: true };
  }

  async getTranscript(userId: string, id: string): Promise<TranscriptDto> {
    const row = await this.loadTask(userId, id);
    if (!row.transcript) {
      throw new BadRequestException('转写尚未完成或不可用');
    }
    return row.transcript;
  }

  async suggestRewrite(
    userId: string,
    id: string,
    style: RewriteStyle,
  ): Promise<{ text: string }> {
    const row = await this.loadTask(userId, id);
    const base = row.transcript?.fullText;
    if (!base) throw new BadRequestException('暂无原文案，无法生成改写建议');
    const text = await this.rewriteAi.suggest({
      source: base,
      style,
      sourceVideoUrl: row.sourceVideoUrl,
    });
    return { text };
  }

  async saveRewrite(
    userId: string,
    id: string,
    payload: RewritePayloadDto,
  ): Promise<{ ok: true }> {
    const row = await this.loadTask(userId, id);
    this.ensurePhase(row, ['rewriting'], '当前阶段不可提交改写');
    if (!row.transcript) throw new BadRequestException('缺少转写结果');
    if (!payload.text || payload.text.trim().length < 8) {
      throw new BadRequestException('改写结果过短，请补充内容或贴近原文案');
    }
    row.rewrite = { text: payload.text.trim(), style: payload.style };
    row.updatedAt = new Date().toISOString();
    await this.persistRow(row);
    return { ok: true as const };
  }

  async submitRender(
    userId: string,
    id: string,
    options: RenderOptionsDto,
  ): Promise<{ ok: true; jobId: string }> {
    const row = await this.loadTask(userId, id);
    this.ensurePhase(row, ['rewriting'], '仅在「改写」阶段可提交生成设置');
    if (!row.rewrite) throw new BadRequestException('请先确认改写文案');
    if (row.renderStarted) {
      throw new BadRequestException('已提交过生成任务');
    }

    row.renderConfig = { ...options };
    row.renderStarted = true;
    row.status = 'voice_generating';
    row.updatedAt = new Date().toISOString();
    await this.persistRow(row);

    setTimeout(() => void this.advanceVoice(id), 500);
    return { ok: true as const, jobId: `job_${id}` };
  }

  async getResult(userId: string, id: string) {
    const row = await this.loadTask(userId, id);
    if (row.status !== 'success') {
      throw new BadRequestException('成片尚未完成');
    }
    return {
      taskId: id,
      mp4Url: row.output?.mp4Url ?? null,
      subtitleUrl: row.output?.subtitleUrl ?? null,
      scriptUrl: row.output?.scriptUrl ?? null,
    };
  }

  async listSummaries(userId: string): Promise<TaskSummaryDto[]> {
    return this.userWorks.listSummaries(userId);
  }

  /** 更新作品标题、备注（仅本人，写入 user_works） */
  async updateWorkMeta(
    userId: string,
    id: string,
    patch: { title?: string; content?: string },
  ): Promise<{ ok: true }> {
    const row = await this.loadTask(userId, id);
    if (patch.title !== undefined) {
      const t = patch.title.trim();
      if (t.length > 0) row.title = t;
    }
    if (patch.content !== undefined) {
      row.content = patch.content.trim() || undefined;
    }
    row.updatedAt = new Date().toISOString();
    await this.persistRow(row);
    return { ok: true as const };
  }

  async buildSubtitleDownload(userId: string, id: string): Promise<Buffer> {
    const row = await this.loadTask(userId, id);
    const text = row.rewrite?.text ?? row.transcript?.fullText ?? '';
    if (!text) throw new BadRequestException('暂无可导出的字幕内容');
    const body = buildMockSrt(text);
    return Buffer.from(body, 'utf-8');
  }

  async buildScriptDownload(userId: string, id: string): Promise<Buffer> {
    const row = await this.loadTask(userId, id);
    const text = row.rewrite?.text ?? row.transcript?.fullText ?? '';
    if (!text) throw new BadRequestException('暂无可导出的文案');
    return Buffer.from(`${text}\n`, 'utf-8');
  }

  private async persistRow(row: TaskInternal): Promise<void> {
    const dh = await this.digitalHumanPersistence.findByUserId(row.userId);
    await this.userWorks.upsertFromTask(row, dh?.style_id ?? null);
  }

  /** 鉴权后加载任务：内存优先，否则从 DB（仅本人行） */
  private async loadTask(userId: string, id: string): Promise<TaskInternal> {
    let row = this.tasks.get(id);
    if (row) {
      this.assertOwner(userId, row);
      return row;
    }
    const loaded = await this.userWorks.findTaskForUser(id, userId);
    if (!loaded) throw new NotFoundException(`task ${id} not found`);
    this.tasks.set(id, loaded);
    return loaded;
  }

  /** 流水线内部：按 id 恢复（用于异步回调、进程内缓存） */
  private async loadTaskPipeline(id: string): Promise<TaskInternal | undefined> {
    let row = this.tasks.get(id);
    if (row) return row;
    const fromDb = await this.userWorks.findTaskById(id);
    if (!fromDb) return undefined;
    this.tasks.set(id, fromDb);
    return fromDb;
  }

  private async advanceParsing(id: string): Promise<void> {
    const row = await this.loadTaskPipeline(id);
    if (!row || row.status !== 'parsing') return;
    row.status = 'transcribing';
    row.updatedAt = new Date().toISOString();
    await this.persistRow(row);
    setTimeout(() => void this.finishTranscribeAsync(id), 800);
  }

  private async finishTranscribeAsync(id: string): Promise<void> {
    const row = await this.loadTaskPipeline(id);
    if (!row || row.status !== 'transcribing') return;
    try {
      const pre = row.prefilledTranscript?.trim();
      if (pre) {
        const segments = buildMockSegments(pre);
        row.transcript = {
          taskId: id,
          language: 'zh-CN',
          fullText: pre,
          segments,
        };
        row.status = 'rewriting';
        row.prefilledTranscript = undefined;
      } else {
        const { fullText, language } = await this.transcriptionAi.transcribe({
          taskId: id,
          sourceVideoUrl: row.sourceVideoUrl,
        });
        const segments = buildMockSegments(fullText);
        row.transcript = {
          taskId: id,
          language,
          fullText,
          segments,
        };
        row.status = 'rewriting';
      }
    } catch (e) {
      row.status = 'failed';
      row.failReason = e instanceof Error ? e.message : '转写失败';
    }
    row.updatedAt = new Date().toISOString();
    await this.persistRow(row);
  }

  private advanceVoice(id: string) {
    void this.advanceVoiceAsync(id);
  }

  private async advanceVoiceAsync(id: string): Promise<void> {
    const row = await this.loadTaskPipeline(id);
    if (!row || row.status !== 'voice_generating') return;
    try {
      const text = row.rewrite?.text ?? '';
      const voiceStyleId = row.renderConfig?.voiceStyleId ?? 'neutral_female';
      await this.speechAi.synthesizeWithPlaceholder({
        taskId: id,
        text,
        voiceStyleId,
      });
      row.status = 'avatar_generating';
      row.updatedAt = new Date().toISOString();
      await this.persistRow(row);
      setTimeout(() => void this.advanceAvatarAsync(id), 600);
    } catch (e) {
      row.status = 'failed';
      row.failReason = e instanceof Error ? e.message : '配音阶段失败';
      row.updatedAt = new Date().toISOString();
      await this.persistRow(row);
    }
  }

  private async advanceAvatarAsync(id: string): Promise<void> {
    const row = await this.loadTaskPipeline(id);
    if (!row || row.status !== 'avatar_generating') return;
    try {
      const script = row.rewrite?.text ?? '';
      const mode = row.renderConfig?.mode ?? 'virtual_bg';
      const aspect = row.renderConfig?.aspect ?? '9:16';
      await this.avatarAi.driveWithPlaceholder({
        taskId: id,
        script,
        mode,
        aspect,
      });
      row.status = 'rendering';
      row.updatedAt = new Date().toISOString();
      await this.persistRow(row);
      setTimeout(() => void this.finishRender(id), 700);
    } catch (e) {
      row.status = 'failed';
      row.failReason = e instanceof Error ? e.message : '口型驱动阶段失败';
      row.updatedAt = new Date().toISOString();
      await this.persistRow(row);
    }
  }

  private async finishRender(id: string): Promise<void> {
    const row = await this.loadTaskPipeline(id);
    if (!row || row.status !== 'rendering') return;

    const demoMp4 =
      'https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4';

    row.status = 'success';
    row.output = {
      mp4Url: demoMp4,
      subtitleUrl: `/api/v1/tasks/${id}/download/subtitle`,
      scriptUrl: `/api/v1/tasks/${id}/download/script`,
    };
    row.updatedAt = new Date().toISOString();
    await this.persistRow(row);
  }

  private ensurePhase(row: TaskInternal, allowed: TaskStatus[], msg: string) {
    if (!allowed.includes(row.status)) {
      throw new BadRequestException(msg);
    }
  }

  private toDetail(row: TaskInternal): TaskDetailDto {
    const flags = this.buildFlags(row);
    return {
      id: row.id,
      userId: row.userId,
      status: row.status,
      sourceVideoUrl: row.sourceVideoUrl,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      failReason: row.failReason,
      photo: row.photo ?? null,
      flags,
      transcriptPreview: row.transcript
        ? { fullText: row.transcript.fullText, language: row.transcript.language }
        : undefined,
      rewrite: row.rewrite ?? null,
      renderConfig: row.renderConfig ?? null,
      output: row.output ?? { mp4Url: null, subtitleUrl: null, scriptUrl: null },
    };
  }

  private buildFlags(row: TaskInternal): TaskFlagsDto {
    return {
      hasPhoto: Boolean(row.photo),
      transcriptAvailable: Boolean(row.transcript),
      rewriteSaved: Boolean(row.rewrite),
      renderStarted: row.renderStarted,
      outputReady: row.status === 'success',
    };
  }
}

function summarizeTitle(url: string): string {
  try {
    const u = new URL(url);
    return `口播任务 · ${u.hostname}`;
  } catch {
    return '口播任务';
  }
}

function buildMockSrt(text: string): string {
  const safe = text.replace(/\r/g, '').trim().slice(0, 800);
  return [
    '1',
    '00:00:00,000 --> 00:00:04,000',
    safe,
    '',
  ].join('\n');
}
