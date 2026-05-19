import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  readPositiveInt,
  runWithRuntimeLimit,
} from '../../common/runtime-limits.util';
import { DatabaseService } from '../../database/database.service';
import { SubtitleWorkflowService } from './subtitle-workflow.service';
import { TaskStatusCacheService } from './task-status-cache.service';
import type {
  DetectCutPointsBody,
  RenderFinalBody,
  RenderTaskDto,
} from './video-project-render.types';

type InternalRenderTask = RenderTaskDto & {
  userId: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  hint?: string;
};

type TaskStatusRow = {
  id: string;
  user_id: string;
  kind: string;
  status: RenderTaskDto['status'];
  progress: number;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class VideoProjectRenderService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(VideoProjectRenderService.name);
  private readonly tasks = new Map<string, InternalRenderTask>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly subtitleWorkflow: SubtitleWorkflowService,
    private readonly db: DatabaseService,
    private readonly cache: TaskStatusCacheService,
    private readonly config: ConfigService,
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

  detectCutPoints(
    userId: string,
    _projectId: string,
    body: DetectCutPointsBody,
  ) {
    return this.subtitleWorkflow.detectCutPoints(userId, body);
  }

  createFinalRenderTask(
    userId: string,
    projectId: string,
    body: RenderFinalBody,
  ): RenderTaskDto {
    const now = new Date().toISOString();
    const taskId = `render_${randomUUID().slice(0, 12)}`;
    const task: InternalRenderTask = {
      taskId,
      userId,
      projectId,
      status: 'pending',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);
    void this.persistTask(task);
    this.trimInMemoryTasks();
    void this.runFinalRenderTask(taskId, body);
    return this.toDto(task);
  }

  async getRenderTask(userId: string, taskId: string): Promise<RenderTaskDto> {
    const task = this.tasks.get(taskId);
    if (task?.userId === userId) return this.toDto(task);

    const cached = await this.cache.get<{ userId: string; dto: RenderTaskDto }>(
      taskId,
    );
    if (cached?.userId === userId) return cached.dto;

    const row = await this.db.queryOne<TaskStatusRow>(
      `SELECT id, user_id, kind, status, progress, result_json, error, created_at, updated_at
       FROM task_statuses WHERE id = ? AND user_id = ?`,
      [taskId, userId],
    );
    if (!row) throw new NotFoundException('生成任务不存在');
    return this.rowToDto(row);
  }

  private async runFinalRenderTask(taskId: string, body: RenderFinalBody) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.updateTask(taskId, { status: 'processing', progress: 3 });
    try {
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
          this.subtitleWorkflow.renderFinalSmartClip(task.userId, body, {
            onProgress: (progress) => this.updateTask(taskId, { progress }),
          }),
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
        error: error instanceof Error ? error.message : String(error),
      });
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
    return {
      taskId: task.taskId,
      status: task.status,
      progress: task.progress,
      outputUrl: task.outputUrl,
      duration: task.duration,
      error: task.error,
    };
  }

  private rowToDto(row: TaskStatusRow): RenderTaskDto {
    const parsed = this.parseResult(row.result_json);
    return {
      taskId: row.id,
      status: row.status,
      progress: Number(row.progress) || 0,
      outputUrl: parsed.outputUrl,
      duration: parsed.duration,
      error: row.error ?? undefined,
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
    });
    const payloadJson = JSON.stringify({ projectId: task.projectId });

    try {
      const exists = await this.db.queryOne<{ id: string }>(
        `SELECT id FROM task_statuses WHERE id = ?`,
        [task.taskId],
      );
      if (exists) {
        await this.db.execute(
          `UPDATE task_statuses
           SET status = ?, progress = ?, payload_json = ?, result_json = ?, error = ?, updated_at = ?, expires_at = ?
           WHERE id = ?`,
          [
            task.status,
            task.progress,
            payloadJson,
            resultJson,
            task.error ?? null,
            now,
            expiresAt,
            task.taskId,
          ],
        );
      } else {
        await this.db.execute(
          `INSERT INTO task_statuses
           (id, user_id, kind, status, progress, payload_json, result_json, error, created_at, updated_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            task.taskId,
            task.userId,
            'video-render',
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

  private parseResult(value: string | null): {
    outputUrl?: string;
    duration?: number;
  } {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as {
        outputUrl?: unknown;
        duration?: unknown;
      };
      return {
        outputUrl:
          typeof parsed.outputUrl === 'string' ? parsed.outputUrl : undefined,
        duration:
          typeof parsed.duration === 'number' ? parsed.duration : undefined,
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
