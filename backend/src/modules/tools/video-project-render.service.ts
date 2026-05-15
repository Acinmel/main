import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SubtitleWorkflowService } from './subtitle-workflow.service';
import type {
  DetectCutPointsBody,
  RenderFinalBody,
  RenderTaskDto,
} from './video-project-render.types';

type InternalRenderTask = RenderTaskDto & {
  userId: string;
  projectId: string;
  createdAt: string;
  hint?: string;
};

@Injectable()
export class VideoProjectRenderService {
  private readonly tasks = new Map<string, InternalRenderTask>();

  constructor(private readonly subtitleWorkflow: SubtitleWorkflowService) {}

  detectCutPoints(userId: string, _projectId: string, body: DetectCutPointsBody) {
    return this.subtitleWorkflow.detectCutPoints(userId, body);
  }

  createFinalRenderTask(
    userId: string,
    projectId: string,
    body: RenderFinalBody,
  ): RenderTaskDto {
    const taskId = `render_${randomUUID().slice(0, 12)}`;
    const task: InternalRenderTask = {
      taskId,
      userId,
      projectId,
      status: 'pending',
      progress: 0,
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, task);
    void this.runFinalRenderTask(taskId, body);
    return this.toDto(task);
  }

  getRenderTask(userId: string, taskId: string): RenderTaskDto {
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId) {
      throw new NotFoundException('生成任务不存在');
    }
    return this.toDto(task);
  }

  private async runFinalRenderTask(taskId: string, body: RenderFinalBody) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.updateTask(taskId, { status: 'processing', progress: 3 });
    try {
      const result = await this.subtitleWorkflow.renderFinalSmartClip(task.userId, body, {
        onProgress: (progress) => this.updateTask(taskId, { progress }),
      });
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
    this.tasks.set(taskId, {
      ...task,
      ...patch,
      progress: nextProgress,
    });
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
}
