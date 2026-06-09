import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import {
  AliLipSyncRunningTimeoutError,
  type AliLipSyncProviderState,
} from '../../integrations/ai/ali-lip-sync.service';
import {
  readPositiveInt,
  runWithRuntimeLimit,
} from '../../common/runtime-limits.util';
import { DatabaseService } from '../../database/database.service';
import { SubtitleWorkflowService } from './subtitle-workflow.service';
import { TaskStatusCacheService } from './task-status-cache.service';
import { VideoScriptService } from './video-script.service';
import { StagedWorkflowService } from './staged-workflow.service';
import type {
  CreateLipSyncTaskBody,
  PackageRenderTaskBody,
  CreatePdEventTaskBody,
  DetectCutPointsBody,
  ProjectStageStateBody,
  ProjectStageStateDto,
  ResolveLipSyncAssetQuery,
  ResolvedLipSyncAssetDto,
  RenderFinalBody,
  RenderTaskDto,
} from './video-project-render.types';

type InternalRenderTask = RenderTaskDto & {
  userId: string;
  projectId: string;
  taskKind: 'video-render' | 'video-lipsync' | 'pd-event' | 'video-package';
  payload: Record<string, unknown> & {
    dedupeKey: string;
  };
  createdAt: string;
  updatedAt: string;
  hint?: string;
  provider?: AliLipSyncProviderState | null;
};

type TaskStatusRow = {
  id: string;
  user_id: string;
  kind: string;
  status: RenderTaskDto['status'];
  progress: number;
  payload_json?: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type TaskKind = InternalRenderTask['taskKind'];

@Injectable()
export class VideoProjectRenderService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(VideoProjectRenderService.name);
  private readonly tasks = new Map<string, InternalRenderTask>();
  private readonly recoveringLipSyncTasks = new Set<string>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly subtitleWorkflow: SubtitleWorkflowService,
    private readonly stagedWorkflow: StagedWorkflowService,
    private readonly db: DatabaseService,
    private readonly cache: TaskStatusCacheService,
    private readonly config: ConfigService,
    private readonly videoScript: VideoScriptService,
  ) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(
      () => {
        void this.cleanupExpiredStatuses();
      },
      readPositiveInt(
        this.config.get('TASK_STATUS_CLEANUP_INTERVAL_MS'),
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

  async detectCutPoints(
    userId: string,
    projectId: string,
    body: DetectCutPointsBody,
  ) {
    await this.assertOwnedProject(userId, projectId);
    return this.subtitleWorkflow.detectCutPoints(userId, body);
  }

  getProjectStageState(
    userId: string,
    projectId: string,
  ): Promise<ProjectStageStateDto> {
    return this.stagedWorkflow.getProjectStageState(userId, projectId);
  }

  saveProjectStageState(
    userId: string,
    projectId: string,
    body: ProjectStageStateBody,
  ): Promise<ProjectStageStateDto> {
    return this.stagedWorkflow.saveProjectStageState(userId, projectId, body);
  }

  resolveLipSyncAsset(
    userId: string,
    projectId: string,
    query: ResolveLipSyncAssetQuery,
  ): Promise<ResolvedLipSyncAssetDto> {
    return this.stagedWorkflow.resolveLatestLipSyncAsset(
      userId,
      projectId,
      query,
    );
  }

  async createFinalRenderTask(
    userId: string,
    projectId: string,
    body: RenderFinalBody,
  ): Promise<RenderTaskDto> {
    await this.assertOwnedProject(userId, projectId);
    const payload = {
      includeTitleAssets: body.includeTitleAssets === true,
      script: body.script?.trim() || null,
      subtitleTemplateId: body.subtitleTemplateId?.trim() || null,
      avatarResourceId: body.avatarResourceId?.trim() || null,
      voiceResourceId: body.voiceResourceId?.trim() || null,
      idempotencyKey: this.sanitizeIdempotencyKey(body.idempotencyKey),
    };
    const dedupeKey = this.buildDedupeKey(
      'video-render',
      projectId,
      payload,
      body.idempotencyKey,
    );
    const existing = await this.findReusableActiveTask(
      userId,
      projectId,
      'video-render',
      dedupeKey,
      body.forceRetry === true,
    );
    if (existing) return existing;

    await this.assertUserTaskConcurrency(userId);
    const now = new Date().toISOString();
    const taskId = `render_${randomUUID()}`;
    const task: InternalRenderTask = {
      taskId,
      userId,
      projectId,
      taskKind: 'video-render',
      payload: {
        ...payload,
        dedupeKey,
      },
      status: 'pending',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);
    this.trimInMemoryTasks();
    void this.persistTask(task).finally(() => {
      void this.runFinalRenderTask(taskId, body);
    });
    return this.toDto(task);
  }

  async createLipSyncTask(
    userId: string,
    projectId: string,
    body: CreateLipSyncTaskBody,
  ): Promise<RenderTaskDto> {
    await this.assertOwnedProject(userId, projectId);
    const regenerationKey = this.sanitizeRegenerationKey(body.regenerationKey);
    const explicitRegeneration =
      body.forceRetry === true || regenerationKey !== null;
    const payload = {
      avatarResourceId:
        body.avatarResourceId?.trim() || body.digitalHumanId?.trim() || null,
      audioAssetId: body.audioAssetId?.trim() || null,
      voiceResourceId:
        body.voiceResourceId?.trim() || body.inputVoiceId?.trim() || null,
      inputAudioUrl: body.inputAudioUrl?.trim() || null,
      inputAudioPath: body.inputAudioPath?.trim() || null,
      script: body.script?.trim() || null,
      renderMode: body.renderMode ?? 'preserveSourceAspect',
      voiceTuning: body.voiceTuning ?? null,
      regenerationKey,
      idempotencyKey: this.sanitizeIdempotencyKey(body.idempotencyKey),
    };
    if (explicitRegeneration) {
      await this.stagedWorkflow.saveProjectStageState(userId, projectId, {
        lipsyncTaskId: null,
        digitalHumanVideoAssetId: null,
        videoUrl: null,
      });
    }
    const dedupeKey = this.buildDedupeKey(
      'video-lipsync',
      projectId,
      payload,
      body.idempotencyKey,
    );
    const existing = await this.findReusableActiveTask(
      userId,
      projectId,
      'video-lipsync',
      dedupeKey,
      explicitRegeneration,
    );
    if (existing) return existing;
    if (explicitRegeneration) {
      this.logger.log(
        `[lipsync-dedupe] force-retry-new-task projectId=${projectId} dedupeKey=${dedupeKey}`,
      );
    }

    await this.assertUserTaskConcurrency(userId);
    const now = new Date().toISOString();
    const taskId = `lipsync_${randomUUID()}`;
    const task: InternalRenderTask = {
      taskId,
      userId,
      projectId,
      taskKind: 'video-lipsync',
      payload: {
        ...payload,
        dedupeKey,
      },
      status: 'pending',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);
    this.trimInMemoryTasks();
    void this.persistTask(task).finally(() => {
      void this.runLipSyncTask(taskId, body);
    });
    return this.toDto(task);
  }

  async createPackageRenderTask(
    userId: string,
    projectId: string,
    body: PackageRenderTaskBody,
  ): Promise<RenderTaskDto> {
    await this.assertOwnedProject(userId, projectId);
    const payload = {
      digitalHumanVideoAssetId: body.digitalHumanVideoAssetId?.trim() || null,
      audioAssetId: body.audioAssetId?.trim() || null,
      subtitleTrackId: body.subtitleTrackId?.trim() || null,
      subtitleTemplateId: body.subtitleTemplateId?.trim() || null,
      includeTitleAssets: body.includeTitleAssets === true,
      subtitleVisualStyle: body.subtitleVisualStyle ?? null,
      titleLayout: body.titleLayout ?? null,
      renderOptions: body.renderOptions ?? null,
      idempotencyKey: this.sanitizeIdempotencyKey(body.idempotencyKey),
    };
    const dedupeKey = this.buildDedupeKey(
      'video-package',
      projectId,
      payload,
      body.idempotencyKey,
    );
    const existing = await this.findReusableActiveTask(
      userId,
      projectId,
      'video-package',
      dedupeKey,
      body.forceRetry === true,
    );
    if (existing) return existing;

    await this.assertUserTaskConcurrency(userId);
    const now = new Date().toISOString();
    const taskId = `pkg_${randomUUID()}`;
    const task: InternalRenderTask = {
      taskId,
      userId,
      projectId,
      taskKind: 'video-package',
      payload: {
        ...payload,
        dedupeKey,
      },
      status: 'pending',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);
    this.trimInMemoryTasks();
    void this.persistTask(task).finally(() => {
      void this.runPackageRenderTask(taskId, body);
    });
    return this.toDto(task);
  }

  async createPdEventTask(
    userId: string,
    projectId: string,
    body: CreatePdEventTaskBody,
  ): Promise<RenderTaskDto> {
    await this.assertOwnedProject(userId, projectId);
    const payload = {
      lipsyncTaskId: body.lipsyncTaskId?.trim() || null,
      includeTitleAssets: body.includeTitleAssets === true,
      script: body.script?.trim() || null,
      subtitleTemplateId: body.subtitleTemplateId?.trim() || null,
      avatarResourceId:
        body.avatarResourceId?.trim() || body.digitalHumanId?.trim() || null,
      voiceResourceId: body.voiceResourceId?.trim() || null,
      idempotencyKey: this.sanitizeIdempotencyKey(body.idempotencyKey),
    };
    const dedupeKey = this.buildDedupeKey(
      'pd-event',
      projectId,
      payload,
      body.idempotencyKey,
    );
    const existing = await this.findReusableActiveTask(
      userId,
      projectId,
      'pd-event',
      dedupeKey,
      body.forceRetry === true,
    );
    if (existing) return existing;

    await this.assertUserTaskConcurrency(userId);
    const now = new Date().toISOString();
    const taskId = `pdevent_${randomUUID()}`;
    const task: InternalRenderTask = {
      taskId,
      userId,
      projectId,
      taskKind: 'pd-event',
      payload: {
        ...payload,
        dedupeKey,
      },
      status: 'pending',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);
    this.trimInMemoryTasks();
    void this.persistTask(task).finally(() => {
      void this.runPdEventTask(taskId, body);
    });
    return this.toDto(task);
  }

  async getRenderTask(userId: string, taskId: string): Promise<RenderTaskDto> {
    const task = this.tasks.get(taskId);
    if (task?.userId === userId) {
      if (
        task.taskKind === 'video-lipsync' &&
        task.status === 'provider_running'
      ) {
        this.triggerLipSyncRecovery(task.taskId);
      }
      return this.toDto(task);
    }

    const cached = await this.cache.get<{ userId: string; dto: RenderTaskDto }>(
      taskId,
    );
    if (cached?.userId === userId) return cached.dto;

    const row = await this.db.queryOne<TaskStatusRow>(
      `SELECT id, user_id, kind, status, progress, payload_json, result_json, error, created_at, updated_at
       FROM task_statuses WHERE id = ? AND user_id = ?`,
      [taskId, userId],
    );
    if (!row) throw new NotFoundException('生成任务不存在');
    if (
      row.kind === 'video-lipsync' &&
      row.status === 'failed' &&
      (await this.tryReviveFailedLipSyncRow(row))
    ) {
      const revived = this.tasks.get(row.id);
      if (revived?.userId === userId) {
        return this.toDto(revived);
      }
    }
    if (row.kind === 'video-lipsync' && row.status === 'provider_running') {
      this.triggerLipSyncRecoveryFromRow(row);
    }
    return this.rowToDto(row);
  }

  private sanitizeIdempotencyKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 120) : null;
  }

  private sanitizeRegenerationKey(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 120) : null;
  }

  private async assertOwnedProject(
    userId: string,
    projectIdRaw: string,
  ): Promise<void> {
    const projectId = projectIdRaw?.trim();
    if (!projectId) {
      throw new BadRequestException('projectId is invalid.');
    }
    const row = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM video_projects WHERE id = ? AND user_id = ? LIMIT 1`,
      [projectId, userId],
    );
    if (!row) {
      throw new NotFoundException('Project not found.');
    }
  }

  private buildDedupeKey(
    taskKind: TaskKind,
    projectId: string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ): string {
    const fromHeader = this.sanitizeIdempotencyKey(idempotencyKey);
    if (fromHeader) {
      return `idemp:${taskKind}:${fromHeader}`;
    }
    const normalized = this.normalizeForDedupe(payload);
    const raw = JSON.stringify({
      taskKind,
      projectId,
      payload: normalized,
    });
    const hash = createHash('sha256').update(raw).digest('hex');
    return `auto:${taskKind}:${hash}`;
  }

  private normalizeForDedupe(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeForDedupe(item));
    }
    if (!value || typeof value !== 'object') return value;
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source)
      .filter((key) => key !== 'forceRetry')
      .sort();
    const normalized: Record<string, unknown> = {};
    for (const key of keys) {
      normalized[key] = this.normalizeForDedupe(source[key]);
    }
    return normalized;
  }

  private isActiveTaskStatus(status: string): boolean {
    return (
      status === 'pending' ||
      status === 'processing' ||
      status === 'provider_running'
    );
  }

  private isCompletedTaskStatus(status: string): boolean {
    return status === 'completed';
  }

  private readLipsyncCompletedReuseWindowMs(): number {
    return readPositiveInt(
      this.config.get('LIPSYNC_COMPLETED_DEDUPE_WINDOW_MS'),
      30 * 60_000,
    );
  }

  private isWithinReuseWindow(updatedAt: string, windowMs: number): boolean {
    const updatedMs = Date.parse(updatedAt);
    if (!Number.isFinite(updatedMs)) return false;
    return Date.now() - updatedMs <= windowMs;
  }

  private extractDedupeKeyFromPayload(
    payloadJson?: string | null,
  ): string | null {
    if (!payloadJson) return null;
    try {
      const parsed = JSON.parse(payloadJson) as { dedupeKey?: unknown };
      return typeof parsed.dedupeKey === 'string' && parsed.dedupeKey.trim()
        ? parsed.dedupeKey.trim()
        : null;
    } catch {
      return null;
    }
  }

  private extractProjectIdFromPayload(
    payloadJson?: string | null,
  ): string | null {
    if (!payloadJson) return null;
    try {
      const parsed = JSON.parse(payloadJson) as { projectId?: unknown };
      return typeof parsed.projectId === 'string' && parsed.projectId.trim()
        ? parsed.projectId.trim()
        : null;
    } catch {
      return null;
    }
  }

  private parsePayload(payloadJson?: string | null): Record<string, unknown> {
    if (!payloadJson) return {};
    try {
      const parsed = JSON.parse(payloadJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private readDateMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  private resolveRenderMode(
    value: string | null,
  ): '1080x1920' | 'adaptive' | 'preserveSourceAspect' {
    if (value === '1080x1920') return value;
    if (value === 'adaptive') return value;
    return 'preserveSourceAspect';
  }

  private async findReusableActiveTask(
    userId: string,
    projectId: string,
    taskKind: TaskKind,
    dedupeKey: string,
    forceRetry: boolean,
  ): Promise<RenderTaskDto | null> {
    const allowCompletedReuse = taskKind === 'video-lipsync';
    const allowCompletedReuseForCurrentRequest =
      allowCompletedReuse && !forceRetry;
    const completedReuseWindowMs = this.readLipsyncCompletedReuseWindowMs();
    for (const task of this.tasks.values()) {
      const isActiveMatch =
        task.userId === userId &&
        task.projectId === projectId &&
        task.taskKind === taskKind &&
        this.isActiveTaskStatus(task.status) &&
        task.payload?.dedupeKey === dedupeKey;
      if (isActiveMatch) {
        if (taskKind === 'video-lipsync') {
          this.logger.log(
            `[lipsync-dedupe] active-dedupe-hit taskId=${task.taskId} projectId=${projectId}`,
          );
        }
        return this.toDto(task);
      }
      if (
        task.userId === userId &&
        task.projectId === projectId &&
        task.taskKind === taskKind &&
        allowCompletedReuseForCurrentRequest &&
        this.isCompletedTaskStatus(task.status) &&
        this.isWithinReuseWindow(task.updatedAt, completedReuseWindowMs) &&
        task.payload?.dedupeKey === dedupeKey
      ) {
        if (taskKind === 'video-lipsync') {
          this.logger.log(
            `[lipsync-dedupe] completed-dedupe-hit taskId=${task.taskId} projectId=${projectId}`,
          );
        }
        return this.toDto(task);
      }
    }

    const sqlStatuses = allowCompletedReuseForCurrentRequest
      ? `'pending', 'processing', 'provider_running', 'completed'`
      : `'pending', 'processing', 'provider_running'`;
    const rows = await this.db.queryAll<TaskStatusRow>(
      `SELECT id, user_id, kind, status, progress, payload_json, result_json, error, created_at, updated_at
       FROM task_statuses
       WHERE user_id = ? AND kind = ? AND status IN (${sqlStatuses})
       ORDER BY updated_at DESC
       LIMIT 50`,
      [userId, taskKind],
    );
    const matched = rows.find((row) => {
      const rowProjectId = this.extractProjectIdFromPayload(row.payload_json);
      const rowDedupeKey = this.extractDedupeKeyFromPayload(row.payload_json);
      const statusOk =
        this.isActiveTaskStatus(row.status) ||
        (allowCompletedReuseForCurrentRequest &&
          this.isCompletedTaskStatus(row.status) &&
          this.isWithinReuseWindow(row.updated_at, completedReuseWindowMs));
      return (
        statusOk && rowProjectId === projectId && rowDedupeKey === dedupeKey
      );
    });
    if (matched && taskKind === 'video-lipsync') {
      if (this.isActiveTaskStatus(matched.status)) {
        this.logger.log(
          `[lipsync-dedupe] active-dedupe-hit taskId=${matched.id} projectId=${projectId}`,
        );
      } else {
        this.logger.log(
          `[lipsync-dedupe] completed-dedupe-hit taskId=${matched.id} projectId=${projectId}`,
        );
      }
    }
    if (
      matched &&
      matched.kind === 'video-lipsync' &&
      matched.status === 'provider_running'
    ) {
      this.triggerLipSyncRecoveryFromRow(matched);
    }
    return matched ? this.rowToDto(matched) : null;
  }

  private async assertUserTaskConcurrency(userId: string): Promise<void> {
    const limit = readPositiveInt(
      this.config.get('VIDEO_TASK_PER_USER_CONCURRENCY'),
      2,
    );
    const activeIds = new Set<string>();
    for (const task of this.tasks.values()) {
      if (task.userId === userId && this.isActiveTaskStatus(task.status)) {
        activeIds.add(task.taskId);
      }
    }
    const rows = await this.db.queryAll<{ id: string }>(
      `SELECT id
       FROM task_statuses
       WHERE user_id = ?
         AND kind IN ('video-render', 'video-lipsync', 'video-package', 'pd-event')
         AND status IN ('pending', 'processing', 'provider_running')
       ORDER BY updated_at DESC
       LIMIT 100`,
      [userId],
    );
    for (const row of rows) {
      activeIds.add(row.id);
    }
    if (activeIds.size >= limit) {
      throw new BadRequestException(
        `Too many active tasks for current user. Please wait and retry. active=${activeIds.size}, limit=${limit}`,
      );
    }
  }

  private resolveErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
      const message = error.message?.trim();
      if (message) return message;
    }
    const raw = typeof error === 'string' ? error.trim() : '';
    return raw || fallback;
  }

  private async runFinalRenderTask(taskId: string, body: RenderFinalBody) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.updateTask(taskId, { status: 'processing', progress: 3 });
    try {
      const resolvedBody = await this.resolveRenderBodyFromSavedScript(
        task.userId,
        task.projectId,
        body,
      );
      const result = await runWithRuntimeLimit(
        'render-final',
        {
          concurrency: readPositiveInt(
            this.config.get('RENDER_QUEUE_CONCURRENCY'),
            1,
          ),
          queueLimit: readPositiveInt(
            this.config.get('RENDER_QUEUE_LIMIT'),
            50,
          ),
        },
        () =>
          this.subtitleWorkflow.renderFinalSmartClip(
            task.userId,
            resolvedBody,
            {
              onProgress: (progress) => this.updateTask(taskId, { progress }),
            },
          ),
      );
      this.updateTask(taskId, {
        status: 'completed',
        progress: 100,
        outputUrl: result.videoUrl,
        duration: result.duration,
        hint: result.hint,
      });
    } catch (error) {
      this.updateTask(taskId, {
        status: 'failed',
        progress: 100,
        error: this.resolveErrorMessage(error, 'Render final task failed'),
      });
    }
  }

  private async runLipSyncTask(taskId: string, body: CreateLipSyncTaskBody) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.updateTask(taskId, { status: 'processing', progress: 4 });
    const effectiveRenderMode = body.renderMode ?? 'preserveSourceAspect';
    const avatarResourceId =
      body.avatarResourceId?.trim() || body.digitalHumanId?.trim() || '';
    const payloadBody: CreateLipSyncTaskBody = {
      ...body,
      renderMode: effectiveRenderMode,
    };
    const onProviderEvent = (state: AliLipSyncProviderState) =>
      this.updateLipSyncProviderState(taskId, state);
    let resolvedAudioAssetId: string | undefined;

    try {
      if (body.audioAssetId?.trim()) {
        const resolved = await this.stagedWorkflow.resolveAudioInputForLipSync(
          task.userId,
          body.audioAssetId.trim(),
          { projectId: task.projectId },
        );
        resolvedAudioAssetId = resolved.audioAssetId;
        if (resolved.inputAudioPath) {
          payloadBody.inputAudioPath = resolved.inputAudioPath;
          delete payloadBody.inputAudioUrl;
        } else if (resolved.inputAudioUrl) {
          payloadBody.inputAudioUrl = resolved.inputAudioUrl;
          delete payloadBody.inputAudioPath;
        }
      }
      const result = await runWithRuntimeLimit(
        'lipsync-task',
        {
          concurrency: readPositiveInt(
            this.config.get('LIPSYNC_QUEUE_CONCURRENCY'),
            1,
          ),
          queueLimit: readPositiveInt(
            this.config.get('LIPSYNC_QUEUE_LIMIT'),
            50,
          ),
        },
        () =>
          this.subtitleWorkflow.createLipSyncAsset(task.userId, payloadBody, {
            onProgress: (progress) => this.updateTask(taskId, { progress }),
            onProviderEvent,
          }),
      );
      await this.finalizeLipSyncTaskSuccess(taskId, {
        avatarResourceId,
        audioAssetId: resolvedAudioAssetId,
        renderMode: effectiveRenderMode,
        videoUrl: result.videoUrl,
        duration: result.duration,
        hint: result.hint,
        metadataJson: result.metadataJson,
      });
    } catch (error) {
      const runningTimeoutState =
        this.resolveAliyunRunningTimeoutProviderState(error);
      if (runningTimeoutState) {
        this.updateLipSyncProviderState(taskId, runningTimeoutState);
        this.updateTask(taskId, {
          status: 'provider_running',
          progress: 92,
          hint: 'Provider is still running. Recovery will continue in background.',
        });
        this.triggerLipSyncRecovery(taskId);
        return;
      }
      this.updateTask(taskId, {
        status: 'failed',
        progress: 100,
        error: this.resolveErrorMessage(error, 'Lip-sync task failed'),
      });
    }
  }

  private async finalizeLipSyncTaskSuccess(
    taskId: string,
    params: {
      avatarResourceId: string;
      audioAssetId?: string;
      renderMode: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
      videoUrl: string;
      duration: number;
      hint: string;
      metadataJson?: Record<string, unknown>;
    },
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const digitalHumanVideoAssetId = params.avatarResourceId
      ? (
          await this.stagedWorkflow.createDigitalHumanVideoAsset({
            userId: task.userId,
            projectId: task.projectId,
            avatarResourceId: params.avatarResourceId,
            audioAssetId: params.audioAssetId ?? null,
            renderMode: params.renderMode,
            sourceTaskId: taskId,
            videoUrl: params.videoUrl,
            durationSeconds: params.duration,
            metadataJson: params.metadataJson,
          })
        ).digitalHumanVideoAssetId
      : undefined;

    this.updateTask(taskId, {
      status: 'completed',
      progress: 100,
      outputUrl: params.videoUrl,
      duration: params.duration,
      hint: params.hint,
      audioAssetId: params.audioAssetId,
      digitalHumanVideoAssetId,
      provider: task.provider ?? undefined,
    });

    try {
      await this.stagedWorkflow.saveProjectStageState(
        task.userId,
        task.projectId,
        {
          avatarResourceId: params.avatarResourceId || null,
          renderMode: params.renderMode,
          lipsyncTaskId: taskId,
          digitalHumanVideoAssetId: digitalHumanVideoAssetId ?? null,
          videoUrl: params.videoUrl,
          audioAssetId: params.audioAssetId ?? null,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Persist stage-state after lipsync success failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private updateLipSyncProviderState(
    taskId: string,
    state: AliLipSyncProviderState,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const merged = {
      ...(task.provider ?? {}),
      ...state,
    } as AliLipSyncProviderState;
    this.updateTask(taskId, { provider: merged });
  }

  private resolveAliyunRunningTimeoutProviderState(
    error: unknown,
  ): AliLipSyncProviderState | null {
    if (error instanceof AliLipSyncRunningTimeoutError) {
      return error.providerState;
    }
    const message = this.resolveErrorMessage(error, '');
    if (!message.includes('Aliyun VideoRetalk task timed out after')) {
      return null;
    }
    const jsonStart = message.indexOf('{');
    if (jsonStart < 0) return null;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(message.slice(jsonStart)) as Record<string, unknown>;
    } catch {
      return null;
    }
    const output =
      parsed.output && typeof parsed.output === 'object'
        ? (parsed.output as Record<string, unknown>)
        : {};
    const taskStatus =
      typeof output.task_status === 'string'
        ? output.task_status.trim().toUpperCase()
        : '';
    if (!['RUNNING', 'PENDING', 'PROCESSING', 'SUBMITTED'].includes(taskStatus)) {
      return null;
    }
    const taskId =
      typeof output.task_id === 'string' ? output.task_id.trim() : '';
    if (!taskId) return null;
    const requestId =
      typeof parsed.request_id === 'string'
        ? parsed.request_id.trim()
        : typeof output.request_id === 'string'
          ? output.request_id.trim()
          : null;
    return {
      name: 'aliyun-videoretalk',
      requestId,
      taskId,
      taskStatus,
      recoverUntil: new Date(
        Date.now() +
          readPositiveInt(
            this.config.get('ALI_VIDEORETALK_RECOVER_WINDOW_MS'),
            24 * 60 * 60_000,
          ),
      ).toISOString(),
      lastPolledAt: new Date().toISOString(),
      lastResponse: parsed,
    };
  }

  private resolveRunningProviderStateFromValue(
    value: unknown,
  ): AliLipSyncProviderState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const raw = value as Record<string, unknown>;
    const taskId =
      typeof raw.taskId === 'string'
        ? raw.taskId.trim()
        : typeof raw.task_id === 'string'
          ? raw.task_id.trim()
          : '';
    if (!taskId) return null;
    const statusRaw =
      typeof raw.taskStatus === 'string'
        ? raw.taskStatus.trim()
        : typeof raw.task_status === 'string'
          ? raw.task_status.trim()
          : '';
    const status = statusRaw.toUpperCase();
    if (!['RUNNING', 'PENDING', 'PROCESSING', 'SUBMITTED'].includes(status)) {
      return null;
    }
    const recoverUntil =
      typeof raw.recoverUntil === 'string' && raw.recoverUntil.trim()
        ? raw.recoverUntil.trim()
        : new Date(
            Date.now() +
              readPositiveInt(
                this.config.get('ALI_VIDEORETALK_RECOVER_WINDOW_MS'),
                24 * 60 * 60_000,
              ),
          ).toISOString();
    return {
      ...(raw as AliLipSyncProviderState),
      name: 'aliyun-videoretalk',
      taskId,
      taskStatus: status,
      recoverUntil,
      lastPolledAt: new Date().toISOString(),
    };
  }

  private async tryReviveFailedLipSyncRow(row: TaskStatusRow): Promise<boolean> {
    const fromError = this.resolveAliyunRunningTimeoutProviderState(
      row.error ?? '',
    );
    const parsed = this.parseResult(row.result_json);
    const fromResult = this.resolveRunningProviderStateFromValue(parsed.provider);
    const provider = fromError ?? fromResult;
    if (!provider) return false;

    const payload = this.parsePayload(row.payload_json);
    const projectId = this.extractProjectIdFromPayload(row.payload_json) ?? '';
    if (!projectId) return false;

    const task: InternalRenderTask = {
      taskId: row.id,
      userId: row.user_id,
      projectId,
      taskKind: 'video-lipsync',
      payload: {
        dedupeKey: this.extractDedupeKeyFromPayload(row.payload_json) ?? '',
        ...payload,
      },
      status: row.status,
      progress: Number(row.progress) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      outputUrl: parsed.outputUrl,
      duration: parsed.duration,
      hint: parsed.hint,
      error: row.error ?? undefined,
      audioAssetId: parsed.audioAssetId,
      subtitleTrackId: parsed.subtitleTrackId,
      digitalHumanVideoAssetId: parsed.digitalHumanVideoAssetId,
      provider,
    };
    this.tasks.set(row.id, task);
    this.updateTask(row.id, {
      status: 'provider_running',
      progress: Math.max(Number(row.progress) || 0, 92),
      hint:
        'Provider is still running. Recovery will continue in background.',
      provider,
      error: undefined,
    });
    this.triggerLipSyncRecovery(row.id);
    this.logger.warn(
      `[lipsync-revive] revived failed task to provider_running taskId=${row.id}`,
    );
    return true;
  }

  private triggerLipSyncRecovery(taskId: string): void {
    if (this.recoveringLipSyncTasks.has(taskId)) return;
    this.recoveringLipSyncTasks.add(taskId);
    const run = async () => {
      try {
        await this.recoverLipSyncTask(taskId);
      } finally {
        this.recoveringLipSyncTasks.delete(taskId);
      }
    };
    setTimeout(() => {
      void run();
    }, 1000).unref?.();
  }

  private triggerLipSyncRecoveryFromRow(row: TaskStatusRow): void {
    if (this.tasks.has(row.id)) {
      this.triggerLipSyncRecovery(row.id);
      return;
    }
    const payload = this.parsePayload(row.payload_json);
    const parsedResult = this.parseResult(row.result_json);
    const task: InternalRenderTask = {
      taskId: row.id,
      userId: row.user_id,
      projectId: this.extractProjectIdFromPayload(row.payload_json) ?? '',
      taskKind: 'video-lipsync',
      payload: {
        dedupeKey: this.extractDedupeKeyFromPayload(row.payload_json) ?? '',
        ...payload,
      },
      status: row.status,
      progress: Number(row.progress) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      outputUrl: parsedResult.outputUrl,
      duration: parsedResult.duration,
      hint: parsedResult.hint,
      error: row.error ?? undefined,
      audioAssetId: parsedResult.audioAssetId,
      subtitleTrackId: parsedResult.subtitleTrackId,
      digitalHumanVideoAssetId: parsedResult.digitalHumanVideoAssetId,
      provider: parsedResult.provider as AliLipSyncProviderState | undefined,
    };
    if (task.projectId) {
      this.tasks.set(row.id, task);
    }
    this.triggerLipSyncRecovery(row.id);
  }

  private async recoverLipSyncTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.taskKind !== 'video-lipsync') return;
    if (task.status !== 'provider_running') return;
    const provider = task.provider;
    const providerTaskId =
      typeof provider?.taskId === 'string' ? provider.taskId.trim() : '';
    if (!providerTaskId) return;
    const avatarResourceId =
      typeof task.payload.avatarResourceId === 'string'
        ? task.payload.avatarResourceId.trim()
        : '';
    if (!avatarResourceId) {
      this.updateTask(taskId, {
        status: 'failed',
        progress: 100,
        error: 'Missing avatarResourceId for provider recovery.',
      });
      return;
    }

    const renderMode = this.resolveRenderMode(
      typeof task.payload.renderMode === 'string'
        ? task.payload.renderMode
        : null,
    );

    try {
      const result = await runWithRuntimeLimit(
        'lipsync-task',
        {
          concurrency: readPositiveInt(
            this.config.get('LIPSYNC_QUEUE_CONCURRENCY'),
            1,
          ),
          queueLimit: readPositiveInt(
            this.config.get('LIPSYNC_QUEUE_LIMIT'),
            50,
          ),
        },
        () =>
          this.subtitleWorkflow.recoverLipSyncAsset(
            task.userId,
            {
              avatarResourceId,
              providerTaskId,
              recoverUntil:
                typeof provider?.recoverUntil === 'string'
                  ? provider.recoverUntil
                  : null,
              renderMode,
            },
            {
              onProgress: (progress) =>
                this.updateTask(taskId, {
                  progress: Math.max(92, Math.min(99, progress)),
                }),
              onProviderEvent: (state) =>
                this.updateLipSyncProviderState(taskId, state),
            },
          ),
      );
      const recoveredAudioAssetId =
        typeof task.payload.audioAssetId === 'string'
          ? task.payload.audioAssetId.trim()
          : undefined;
      await this.finalizeLipSyncTaskSuccess(taskId, {
        avatarResourceId,
        audioAssetId: recoveredAudioAssetId || undefined,
        renderMode,
        videoUrl: result.videoUrl,
        duration: result.duration,
        hint: result.hint,
        metadataJson: result.metadataJson,
      });
      if (result.providerState) {
        this.updateLipSyncProviderState(taskId, result.providerState);
      }
    } catch (error) {
      const runningTimeoutState =
        this.resolveAliyunRunningTimeoutProviderState(error);
      if (runningTimeoutState) {
        this.updateLipSyncProviderState(taskId, runningTimeoutState);
        const recoverUntil = this.readDateMs(runningTimeoutState.recoverUntil);
        if (recoverUntil !== null && Date.now() > recoverUntil) {
          this.updateTask(taskId, {
            status: 'failed',
            progress: 100,
            error:
              'Provider remained running beyond recovery window and was marked failed.',
          });
          return;
        }
        this.updateTask(taskId, {
          status: 'provider_running',
          progress: 94,
          hint: 'Provider is still running. Recovery will retry automatically.',
        });
        this.triggerLipSyncRecovery(taskId);
        return;
      }
      this.updateTask(taskId, {
        status: 'failed',
        progress: 100,
        error: this.resolveErrorMessage(error, 'Lip-sync recovery failed'),
      });
    }
  }

  private async runPackageRenderTask(
    taskId: string,
    body: PackageRenderTaskBody,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.updateTask(taskId, { status: 'processing', progress: 4 });
    try {
      const result = await runWithRuntimeLimit(
        'package-render-task',
        {
          concurrency: readPositiveInt(
            this.config.get('PACKAGE_QUEUE_CONCURRENCY'),
            1,
          ),
          queueLimit: readPositiveInt(
            this.config.get('PACKAGE_QUEUE_LIMIT'),
            50,
          ),
        },
        () =>
          this.stagedWorkflow.packageRenderFromAssets(
            task.userId,
            task.projectId,
            body,
            (progress) => this.updateTask(taskId, { progress }),
          ),
      );
      this.updateTask(taskId, {
        status: 'completed',
        progress: 100,
        outputUrl: result.videoUrl,
        duration: result.duration,
        hint: result.hint,
        audioAssetId: body.audioAssetId?.trim() || undefined,
        subtitleTrackId: body.subtitleTrackId?.trim() || undefined,
        digitalHumanVideoAssetId:
          body.digitalHumanVideoAssetId?.trim() || undefined,
      });
    } catch (error) {
      this.updateTask(taskId, {
        status: 'failed',
        progress: 100,
        error: this.resolveErrorMessage(error, 'Package render task failed'),
      });
    }
  }

  private async runPdEventTask(taskId: string, body: CreatePdEventTaskBody) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.updateTask(taskId, { status: 'processing', progress: 4 });
    try {
      if (body.lipsyncTaskId?.trim()) {
        await this.assertFinishedLipSyncTask(
          task.userId,
          body.lipsyncTaskId.trim(),
        );
      }
      const renderBody: RenderFinalBody = {
        ...body,
        avatarResourceId:
          body.avatarResourceId?.trim() || body.digitalHumanId?.trim() || '',
      };
      const resolvedBody = await this.resolveRenderBodyFromSavedScript(
        task.userId,
        task.projectId,
        renderBody,
      );
      const result = await runWithRuntimeLimit(
        'pd-event-task',
        {
          concurrency: readPositiveInt(
            this.config.get('PD_EVENT_QUEUE_CONCURRENCY'),
            1,
          ),
          queueLimit: readPositiveInt(
            this.config.get('PD_EVENT_QUEUE_LIMIT'),
            50,
          ),
        },
        () =>
          this.subtitleWorkflow.renderFinalSmartClip(
            task.userId,
            resolvedBody,
            {
              onProgress: (progress) => this.updateTask(taskId, { progress }),
            },
          ),
      );
      this.updateTask(taskId, {
        status: 'completed',
        progress: 100,
        outputUrl: result.videoUrl,
        duration: result.duration,
        hint: result.hint,
      });
    } catch (error) {
      this.updateTask(taskId, {
        status: 'failed',
        progress: 100,
        error: this.resolveErrorMessage(error, 'PD event task failed'),
      });
    }
  }

  private async assertFinishedLipSyncTask(
    userId: string,
    lipsyncTaskId: string,
  ): Promise<void> {
    const row = await this.db.queryOne<{
      id: string;
      user_id: string;
      kind: string;
      status: string;
      error: string | null;
    }>(
      `SELECT id, user_id, kind, status, error
       FROM task_statuses WHERE id = ? AND user_id = ?`,
      [lipsyncTaskId, userId],
    );
    if (!row || row.kind !== 'video-lipsync') {
      throw new NotFoundException('口型同步任务不存在');
    }
    if (row.status === 'failed') {
      throw new BadRequestException(
        `口型同步任务失败：${row.error || 'unknown error'}`,
      );
    }
    if (row.status !== 'completed') {
      throw new BadRequestException('口型同步任务尚未完成');
    }
  }

  private async resolveRenderBodyFromSavedScript(
    userId: string,
    projectId: string,
    body: RenderFinalBody,
  ): Promise<RenderFinalBody> {
    const bodyWithVideoId: RenderFinalBody = {
      ...body,
      videoId: body.videoId ?? projectId,
    };
    try {
      const saved = await this.videoScript.getOptionalByVideoId(
        userId,
        projectId,
      );
      if (!saved) return bodyWithVideoId;
      const script = bodyWithVideoId.script?.trim()
        ? bodyWithVideoId.script
        : saved.scriptText;
      const subtitleTemplateId = bodyWithVideoId.subtitleTemplateId?.trim()
        ? bodyWithVideoId.subtitleTemplateId
        : saved.subtitleTemplateId;
      const highlights =
        Array.isArray(bodyWithVideoId.highlights) &&
        bodyWithVideoId.highlights.length > 0
          ? bodyWithVideoId.highlights
          : saved.highlights.map((item) => ({
              id: item.id,
              start: item.start,
              end: item.end,
              text: item.text,
              style: item.style,
            }));
      const subtitleVisualStyle =
        bodyWithVideoId.subtitleVisualStyle &&
        typeof bodyWithVideoId.subtitleVisualStyle === 'object'
          ? bodyWithVideoId.subtitleVisualStyle
          : (saved.subtitleVisualStyle ?? undefined);
      return {
        ...bodyWithVideoId,
        script,
        subtitleTemplateId,
        highlights,
        subtitleVisualStyle,
      };
    } catch (error) {
      this.logger.warn(
        `Resolve saved script failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return bodyWithVideoId;
    }
  }

  private updateTask(taskId: string, patch: Partial<InternalRenderTask>) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const nextProgress =
      typeof patch.progress === 'number'
        ? Math.max(task.progress, Math.min(100, Math.round(patch.progress)))
        : task.progress;
    const next = {
      ...task,
      ...patch,
      progress: nextProgress,
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, next);
    void this.persistTask(next);
    this.trimInMemoryTasks();
  }

  private toDto(task: InternalRenderTask): RenderTaskDto {
    const errorMessage = task.error;
    return {
      taskId: task.taskId,
      status: task.status,
      progress: task.progress,
      errorMessage,
      outputUrl: task.outputUrl,
      duration: task.duration,
      hint: task.hint,
      error: errorMessage,
      audioAssetId: task.audioAssetId,
      subtitleTrackId: task.subtitleTrackId,
      digitalHumanVideoAssetId: task.digitalHumanVideoAssetId,
      provider: task.provider,
    };
  }

  private rowToDto(row: TaskStatusRow): RenderTaskDto {
    const parsed = this.parseResult(row.result_json);
    const errorMessage = row.error ?? undefined;
    return {
      taskId: row.id,
      status: row.status,
      progress: Number(row.progress) || 0,
      errorMessage,
      outputUrl: parsed.outputUrl,
      duration: parsed.duration,
      hint: parsed.hint,
      error: errorMessage,
      audioAssetId: parsed.audioAssetId,
      subtitleTrackId: parsed.subtitleTrackId,
      digitalHumanVideoAssetId: parsed.digitalHumanVideoAssetId,
      provider: parsed.provider,
    };
  }

  private async persistTask(task: InternalRenderTask): Promise<void> {
    const dto = this.toDto(task);
    const now = task.updatedAt || new Date().toISOString();
    const expiresAt = new Date(
      Date.now() +
        readPositiveInt(
          this.config.get('TASK_STATUS_TTL_MS'),
          24 * 60 * 60_000,
        ),
    ).toISOString();
    const resultJson = JSON.stringify({
      outputUrl: task.outputUrl,
      duration: task.duration,
      hint: task.hint,
      audioAssetId: task.audioAssetId,
      subtitleTrackId: task.subtitleTrackId,
      digitalHumanVideoAssetId: task.digitalHumanVideoAssetId,
      provider: task.provider ?? null,
    });
    const payloadJson = JSON.stringify({
      projectId: task.projectId,
      ...(task.payload || {}),
    });

    try {
      try {
        await this.db.execute(
          `INSERT INTO task_statuses
           (id, user_id, kind, status, progress, payload_json, result_json, error, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.taskId,
            task.userId,
            task.taskKind,
            task.status,
            task.progress,
            payloadJson,
            resultJson,
            task.error ?? null,
            task.createdAt,
            now,
            expiresAt,
          ],
        );
      } catch (error) {
        if (!this.isTaskStatusDuplicateKeyError(error)) {
          throw error;
        }
        await this.resolveDuplicateTaskStatusWrite(task, {
          payloadJson,
          resultJson,
          now,
          expiresAt,
        });
      }
      await this.cache.set(task.taskId, { userId: task.userId, dto });
    } catch (error) {
      this.logger.warn(
        `Persist render task status failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private isTaskStatusDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const code =
      'code' in error && typeof error.code === 'string' ? error.code : '';
    if (
      code === 'ER_DUP_ENTRY' ||
      code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
      code === 'SQLITE_CONSTRAINT_UNIQUE'
    ) {
      return true;
    }
    const message =
      'message' in error && typeof error.message === 'string'
        ? error.message
        : '';
    return (
      message.includes('Duplicate entry') ||
      message.includes('UNIQUE constraint failed') ||
      message.includes('SQLITE_CONSTRAINT')
    );
  }

  private async resolveDuplicateTaskStatusWrite(
    task: InternalRenderTask,
    payload: {
      payloadJson: string;
      resultJson: string;
      now: string;
      expiresAt: string;
    },
  ): Promise<void> {
    const existing = await this.db.queryOne<{
      id: string;
      user_id: string;
      kind: string;
    }>(`SELECT id, user_id, kind FROM task_statuses WHERE id = ?`, [
      task.taskId,
    ]);
    if (!existing) {
      throw new Error(
        `Render task duplicate key detected but no existing row found: ${task.taskId}`,
      );
    }
    if (existing.user_id !== task.userId || existing.kind !== task.taskKind) {
      throw new Error(
        `Render task id collision detected: ${task.taskId}, owner=${existing.user_id}, kind=${existing.kind}, expected=${task.taskKind}`,
      );
    }
    await this.db.execute(
      `UPDATE task_statuses
       SET status = ?, progress = ?, payload_json = ?, result_json = ?, error = ?, updated_at = ?, expires_at = ?
       WHERE id = ?`,
      [
        task.status,
        task.progress,
        payload.payloadJson,
        payload.resultJson,
        task.error ?? null,
        payload.now,
        payload.expiresAt,
        task.taskId,
      ],
    );
  }

  private parseResult(value: string | null): {
    outputUrl?: string;
    duration?: number;
    hint?: string;
    audioAssetId?: string;
    subtitleTrackId?: string;
    digitalHumanVideoAssetId?: string;
    provider?: Record<string, unknown>;
  } {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as {
        outputUrl?: unknown;
        duration?: unknown;
        hint?: unknown;
        audioAssetId?: unknown;
        subtitleTrackId?: unknown;
        digitalHumanVideoAssetId?: unknown;
        provider?: unknown;
      };
      return {
        outputUrl:
          typeof parsed.outputUrl === 'string' ? parsed.outputUrl : undefined,
        duration:
          typeof parsed.duration === 'number' ? parsed.duration : undefined,
        hint: typeof parsed.hint === 'string' ? parsed.hint : undefined,
        audioAssetId:
          typeof parsed.audioAssetId === 'string'
            ? parsed.audioAssetId
            : undefined,
        subtitleTrackId:
          typeof parsed.subtitleTrackId === 'string'
            ? parsed.subtitleTrackId
            : undefined,
        digitalHumanVideoAssetId:
          typeof parsed.digitalHumanVideoAssetId === 'string'
            ? parsed.digitalHumanVideoAssetId
            : undefined,
        provider:
          parsed.provider &&
          typeof parsed.provider === 'object' &&
          !Array.isArray(parsed.provider)
            ? (parsed.provider as Record<string, unknown>)
            : undefined,
      };
    } catch {
      return {};
    }
  }

  private trimInMemoryTasks(): void {
    const max = readPositiveInt(this.config.get('RENDER_TASK_MEMORY_MAX'), 500);
    const ttlMs = readPositiveInt(
      this.config.get('RENDER_TASK_MEMORY_TTL_MS'),
      6 * 60 * 60_000,
    );
    const now = Date.now();
    for (const [id, task] of this.tasks.entries()) {
      const done = task.status === 'completed' || task.status === 'failed';
      const updatedMs = Date.parse(task.updatedAt || task.createdAt);
      if (done && Number.isFinite(updatedMs) && now - updatedMs > ttlMs) {
        this.tasks.delete(id);
      }
    }
    if (this.tasks.size <= max) return;

    const completed = [...this.tasks.entries()]
      .filter(
        ([, task]) => task.status === 'completed' || task.status === 'failed',
      )
      .sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt));
    for (const [id] of completed) {
      if (this.tasks.size <= max) return;
      this.tasks.delete(id);
    }
  }

  private async cleanupExpiredStatuses(): Promise<void> {
    this.trimInMemoryTasks();
    try {
      await this.db.execute(
        `DELETE FROM task_statuses WHERE expires_at IS NOT NULL AND expires_at <= ?`,
        [new Date().toISOString()],
      );
    } catch (error) {
      this.logger.warn(
        `Cleanup expired task statuses failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
