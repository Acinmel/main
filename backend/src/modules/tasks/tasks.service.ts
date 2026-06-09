import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readPositiveInt } from '../../common/runtime-limits.util';
import { AvatarAiService } from '../../integrations/ai/avatar-ai.service';
import { buildMockSegments } from '../../integrations/ai/ai-mock.util';
import { RewriteAiService } from '../../integrations/ai/rewrite-ai.service';
import { SpeechAiService } from '../../integrations/ai/speech-ai.service';
import { TranscriptionAiService } from '../../integrations/ai/transcription-ai.service';
import { DigitalHumanPersistenceService } from '../digital-human/digital-human-persistence.service';
import { ResourcesService } from '../resources/resources.service';
import { UserWorksPersistenceService } from '../works/user-works-persistence.service';
import type {
  RewritePayloadDto,
  RenderOptionsDto,
  RewriteStyle,
  TaskDetailDto,
  TaskFlagsDto,
  TaskInternal,
  TaskProgressStepDto,
  TaskStatus,
  TaskSummaryDto,
  TranscriptDto,
} from './tasks.types';

const TASK_FLOW: TaskStatus[] = [
  'pending',
  'parsing',
  'transcribing',
  'rewriting',
  'voice_generating',
  'avatar_generating',
  'rendering',
  'success',
];

const TASK_PROGRESS_PERCENT: Record<TaskStatus, number> = {
  pending: 5,
  parsing: 20,
  transcribing: 42,
  rewriting: 58,
  voice_generating: 70,
  avatar_generating: 82,
  rendering: 94,
  success: 100,
  failed: 100,
};

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: '等待中',
  parsing: '下载中',
  transcribing: '抽音频 / 转写中',
  rewriting: '生成中',
  voice_generating: '生成中：配音',
  avatar_generating: '生成中：数字人驱动',
  rendering: '生成中：视频渲染',
  success: '完成',
  failed: '失败',
};

const RETIRED_VOICE_STYLE_IDS = new Set(['neutral_female']);
const RETIRED_VOICE_STYLE_PREFIXES = ['rec-voice-'];

/**
 * 任务流水线 + 作品持久化（user_works）：内存热数据，DB 为权威存储（可跨进程恢复）。
 */
@Injectable()
export class TasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TasksService.name);
  private readonly tasks = new Map<string, TaskInternal>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly transcriptionAi: TranscriptionAiService,
    private readonly rewriteAi: RewriteAiService,
    private readonly speechAi: SpeechAiService,
    private readonly avatarAi: AvatarAiService,
    private readonly userWorks: UserWorksPersistenceService,
    private readonly digitalHumanPersistence: DigitalHumanPersistenceService,
    private readonly resources: ResourcesService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(
      () => {
        this.evictTaskCache();
      },
      readPositiveInt(
        this.config.get('TASK_CACHE_CLEANUP_INTERVAL_MS'),
        10 * 60_000,
      ),
    );
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

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
      metrics: {
        startedAt: now,
        steps: {
          pending: {
            label: TASK_STATUS_LABEL.pending,
            startedAt: now,
          },
        },
      },
      extractStarted: false,
      renderStarted: false,
      output: { mp4Url: null, subtitleUrl: null, scriptUrl: null },
      prefilledTranscript: trimmed && trimmed.length > 0 ? trimmed : undefined,
      title: summarizeTitle(sourceVideoUrl),
    };
    this.tasks.set(id, row);
    this.evictTaskCache();
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

  async retryFailedTask(userId: string, id: string): Promise<TaskDetailDto> {
    const row = await this.loadTask(userId, id);
    this.ensurePhase(row, ['failed'], '仅失败任务可重新执行');
    row.failReason = undefined;

    if (row.renderConfig && row.rewrite) {
      row.renderStarted = true;
      this.transitionTo(row, 'voice_generating');
      await this.persistRow(row);
      setTimeout(() => void this.advanceVoice(id), 300);
      return this.toDetail(row);
    }

    if (row.photo) {
      row.extractStarted = true;
      this.transitionTo(row, 'parsing');
      await this.persistRow(row);
      setTimeout(() => void this.advanceParsing(id), 300);
      return this.toDetail(row);
    }

    row.extractStarted = false;
    row.renderStarted = false;
    this.transitionTo(row, 'pending');
    await this.persistRow(row);
    return this.toDetail(row);
  }

  async attachPhoto(
    userId: string,
    id: string,
    file: {
      originalname: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    },
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
    this.transitionTo(row, 'parsing');
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

    const voiceStyleId = await this.assertRenderableVoiceStyleId(
      userId,
      options.voiceStyleId,
    );
    row.renderConfig = { ...options, voiceStyleId };
    row.renderStarted = true;
    this.transitionTo(row, 'voice_generating');
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

  async listSummaries(
    userId: string,
    opts: { page?: number; limit?: number } = {},
  ): Promise<TaskSummaryDto[]> {
    return this.userWorks.listSummaries(userId, opts);
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
    const row = this.tasks.get(id);
    if (row) {
      this.assertOwner(userId, row);
      return row;
    }
    const loaded = await this.userWorks.findTaskForUser(id, userId);
    if (!loaded) throw new NotFoundException(`task ${id} not found`);
    this.tasks.set(id, loaded);
    this.evictTaskCache();
    return loaded;
  }

  /** 流水线内部：按 id 恢复（用于异步回调、进程内缓存） */
  private async loadTaskPipeline(
    id: string,
  ): Promise<TaskInternal | undefined> {
    const row = this.tasks.get(id);
    if (row) return row;
    const fromDb = await this.userWorks.findTaskById(id);
    if (!fromDb) return undefined;
    this.tasks.set(id, fromDb);
    this.evictTaskCache();
    return fromDb;
  }

  private async advanceParsing(id: string): Promise<void> {
    const row = await this.loadTaskPipeline(id);
    if (!row || row.status !== 'parsing') return;
    this.transitionTo(row, 'transcribing');
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
        this.transitionTo(row, 'rewriting');
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
        this.transitionTo(row, 'rewriting');
      }
    } catch (e) {
      row.failReason = e instanceof Error ? e.message : '转写失败';
      this.transitionTo(row, 'failed', row.failReason);
    }
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
      const voiceStyleId = await this.assertRenderableVoiceStyleId(
        row.userId,
        row.renderConfig?.voiceStyleId,
      );
      await this.speechAi.synthesizeWithPlaceholder({
        taskId: id,
        text,
        voiceStyleId,
      });
      this.transitionTo(row, 'avatar_generating');
      await this.persistRow(row);
      setTimeout(() => void this.advanceAvatarAsync(id), 600);
    } catch (e) {
      row.failReason = e instanceof Error ? e.message : '配音阶段失败';
      this.transitionTo(row, 'failed', row.failReason);
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
      this.transitionTo(row, 'rendering');
      await this.persistRow(row);
      setTimeout(() => void this.finishRender(id), 700);
    } catch (e) {
      row.failReason = e instanceof Error ? e.message : '口型驱动阶段失败';
      this.transitionTo(row, 'failed', row.failReason);
      await this.persistRow(row);
    }
  }

  private async finishRender(id: string): Promise<void> {
    const row = await this.loadTaskPipeline(id);
    if (!row || row.status !== 'rendering') return;

    const demoMp4 =
      'https://download.blender.org/demo/movies/BBB/bbb_sunflower_1080p_30fps_normal.mp4';

    row.output = {
      mp4Url: demoMp4,
      subtitleUrl: `/api/v1/tasks/${id}/download/subtitle`,
      scriptUrl: `/api/v1/tasks/${id}/download/script`,
    };
    this.transitionTo(row, 'success');
    await this.persistRow(row);
  }

  private transitionTo(
    row: TaskInternal,
    nextStatus: TaskStatus,
    error?: string,
  ): void {
    const previousStatus = row.status;
    const now = new Date().toISOString();
    const metrics = this.ensureMetrics(row);
    const previousStep = metrics.steps[previousStatus];

    if (
      previousStep?.startedAt &&
      !previousStep.endedAt &&
      previousStatus !== nextStatus
    ) {
      previousStep.endedAt = now;
      previousStep.durationMs = Math.max(
        0,
        Date.parse(now) - Date.parse(previousStep.startedAt),
      );
    }
    if (error && previousStep) {
      previousStep.error = error;
    }

    row.status = nextStatus;
    row.updatedAt = now;

    const nextStep = metrics.steps[nextStatus] ?? {
      label: TASK_STATUS_LABEL[nextStatus],
    };
    if (!nextStep.startedAt) {
      nextStep.startedAt = now;
    }
    if (nextStatus === 'success' || nextStatus === 'failed') {
      nextStep.endedAt = now;
      nextStep.durationMs = Math.max(
        0,
        Date.parse(now) - Date.parse(nextStep.startedAt),
      );
      metrics.completedAt = now;
    }
    if (error) {
      nextStep.error = error;
    }
    metrics.steps[nextStatus] = nextStep;

    this.logger.log(
      `task_step id=${row.id} status=${nextStatus} progress=${TASK_PROGRESS_PERCENT[nextStatus]} durationMs=${previousStep?.durationMs ?? 0}`,
    );
  }

  private ensureMetrics(
    row: TaskInternal,
  ): NonNullable<TaskInternal['metrics']> {
    const startedAt = row.createdAt || new Date().toISOString();
    if (!row.metrics) {
      row.metrics = {
        startedAt,
        steps: {},
      };
    }
    const current = row.metrics.steps[row.status];
    if (!current) {
      row.metrics.steps[row.status] = {
        label: TASK_STATUS_LABEL[row.status],
        startedAt: row.updatedAt || startedAt,
      };
    } else if (!current.label) {
      current.label = TASK_STATUS_LABEL[row.status];
    }
    return row.metrics;
  }

  private ensurePhase(row: TaskInternal, allowed: TaskStatus[], msg: string) {
    if (!allowed.includes(row.status)) {
      throw new BadRequestException(msg);
    }
  }

  private normalizeVoiceStyleId(value?: string): string {
    return (value ?? '').trim();
  }

  private isRetiredVoiceStyleId(voiceStyleId: string): boolean {
    if (RETIRED_VOICE_STYLE_IDS.has(voiceStyleId)) return true;
    return RETIRED_VOICE_STYLE_PREFIXES.some((prefix) =>
      voiceStyleId.startsWith(prefix),
    );
  }

  private async assertRenderableVoiceStyleId(
    userId: string,
    voiceStyleIdRaw?: string,
  ): Promise<string> {
    const voiceStyleId = this.normalizeVoiceStyleId(voiceStyleIdRaw);
    if (!voiceStyleId) {
      throw new BadRequestException(
        'voiceStyleId 缺失，请重新选择你上传或克隆的音色',
      );
    }
    if (this.isRetiredVoiceStyleId(voiceStyleId)) {
      throw new BadRequestException(
        '不支持内置/推荐音色，请选择你上传或克隆的音色',
      );
    }

    let voice:
      | {
          owner: 'mine' | 'recommended';
          canUseForRender: boolean;
          renderUnavailableReason: string | null;
        }
      | undefined;
    try {
      voice = await this.resources.getVoice(userId, voiceStyleId);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw new BadRequestException(
          '音色不可用，请重新选择你上传或克隆的音色',
        );
      }
      throw error;
    }

    if (!voice || voice.owner !== 'mine') {
      throw new BadRequestException('仅支持当前账号下的音色，请重新选择');
    }
    if (!voice.canUseForRender) {
      throw new BadRequestException(
        voice.renderUnavailableReason || '音色暂不可用，请重新选择',
      );
    }
    return voiceStyleId;
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
      progress: this.buildProgress(row),
      photo: row.photo ?? null,
      flags,
      transcriptPreview: row.transcript
        ? {
            fullText: row.transcript.fullText,
            language: row.transcript.language,
          }
        : undefined,
      rewrite: row.rewrite ?? null,
      renderConfig: row.renderConfig ?? null,
      output: row.output ?? {
        mp4Url: null,
        subtitleUrl: null,
        scriptUrl: null,
      },
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

  private buildProgress(row: TaskInternal): TaskDetailDto['progress'] {
    const metrics = this.ensureMetrics(row);
    const currentFlowIndex = TASK_FLOW.indexOf(
      row.status === 'failed' ? this.lastActiveStatus(metrics) : row.status,
    );
    const steps: TaskProgressStepDto[] = TASK_FLOW.map((status, index) => {
      const metric = metrics.steps[status];
      const isFailedCurrent =
        row.status === 'failed' && index === Math.max(0, currentFlowIndex);
      const state =
        row.status === 'failed'
          ? isFailedCurrent
            ? 'failed'
            : index < currentFlowIndex
              ? 'done'
              : 'waiting'
          : row.status === status
            ? 'running'
            : index < currentFlowIndex
              ? 'done'
              : 'waiting';
      return {
        key: status,
        label: TASK_STATUS_LABEL[status],
        status: state,
        startedAt: metric?.startedAt,
        endedAt: metric?.endedAt,
        durationMs: metric?.durationMs,
        error: metric?.error,
      };
    });

    return {
      percentage: TASK_PROGRESS_PERCENT[row.status],
      label:
        row.status === 'failed' && row.failReason
          ? `${TASK_STATUS_LABEL.failed}：${row.failReason}`
          : TASK_STATUS_LABEL[row.status],
      steps,
    };
  }

  private lastActiveStatus(
    metrics: NonNullable<TaskInternal['metrics']>,
  ): TaskStatus {
    const active = [...TASK_FLOW]
      .reverse()
      .find((status) => Boolean(metrics.steps[status]?.startedAt));
    return active ?? 'pending';
  }

  private evictTaskCache(): void {
    const ttlMs = readPositiveInt(
      this.config.get('TASK_CACHE_TTL_MS'),
      6 * 60 * 60_000,
    );
    const max = readPositiveInt(this.config.get('TASK_CACHE_MAX'), 1000);
    const now = Date.now();

    for (const [id, task] of this.tasks.entries()) {
      const terminal = task.status === 'success' || task.status === 'failed';
      const updatedAt = Date.parse(task.updatedAt || task.createdAt);
      if (terminal && Number.isFinite(updatedAt) && now - updatedAt > ttlMs) {
        this.tasks.delete(id);
      }
    }

    if (this.tasks.size <= max) return;
    const removable = [...this.tasks.entries()]
      .filter(
        ([, task]) => task.status === 'success' || task.status === 'failed',
      )
      .sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt));
    for (const [id] of removable) {
      if (this.tasks.size <= max) return;
      this.tasks.delete(id);
    }
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
  return ['1', '00:00:00,000 --> 00:00:04,000', safe, ''].join('\n');
}
