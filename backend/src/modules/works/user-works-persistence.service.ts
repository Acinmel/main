import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import type { TaskInternal, TaskStatus, TaskSummaryDto } from '../tasks/tasks.types';

function deriveTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `口播任务 · ${u.hostname}`;
  } catch {
    return '口播任务';
  }
}

/**
 * 用户作品持久化：每条任务对应一行，外键 user_id → users(id)。
 * 所有按 id 的写操作均带 user_id 条件，与 JWT 中的用户绑定（权限在应用层 + 外键约束）。
 */
@Injectable()
export class UserWorksPersistenceService {
  private readonly logger = new Logger(UserWorksPersistenceService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * 列出当前用户的作品摘要（仅本人数据）。
   */
  async listSummaries(userId: string): Promise<TaskSummaryDto[]> {
    const rows = await this.db.queryAll<{
      id: string;
      status: TaskStatus;
      source_video_url: string;
      created_at: string;
      updated_at: string;
      title: string;
    }>(
      `SELECT id, status, source_video_url, created_at, updated_at, title
       FROM user_works WHERE user_id = ? ORDER BY updated_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      sourceVideoUrl: r.source_video_url,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      title: r.title || deriveTitleFromUrl(r.source_video_url),
    }));
  }

  /**
   * 按 id + user_id 加载完整任务快照（鉴权后调用）。
   */
  async findTaskForUser(
    taskId: string,
    userId: string,
  ): Promise<TaskInternal | null> {
    const row = await this.db.queryOne<{ task_payload_json: string }>(
      'SELECT task_payload_json FROM user_works WHERE id = ? AND user_id = ?',
      [taskId, userId],
    );
    if (!row?.task_payload_json) return null;
    return this.parsePayload(row.task_payload_json);
  }

  /**
   * 流水线内部按 id 恢复任务（无 user 上下文时仅用于已存在任务的续跑）。
   */
  async findTaskById(taskId: string): Promise<TaskInternal | null> {
    const row = await this.db.queryOne<{ task_payload_json: string }>(
      'SELECT task_payload_json FROM user_works WHERE id = ?',
      [taskId],
    );
    if (!row?.task_payload_json) return null;
    return this.parsePayload(row.task_payload_json);
  }

  async upsertFromTask(
    task: TaskInternal,
    digitalHumanStyleId: string | null,
  ): Promise<void> {
    const title =
      (task.title && task.title.trim()) || deriveTitleFromUrl(task.sourceVideoUrl);
    const transcriptText = task.transcript?.fullText ?? null;
    const rewriteText = task.rewrite?.text ?? null;
    const outputVideoUrl = task.output?.mp4Url ?? null;
    let payloadJson: string;
    try {
      payloadJson = JSON.stringify(task);
    } catch (e) {
      this.logger.error(`任务 ${task.id} JSON 序列化失败`);
      throw e;
    }

    const exists = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM user_works WHERE id = ? AND user_id = ?',
      [task.id, task.userId],
    );

    if (exists) {
      await this.db.execute(
        `UPDATE user_works SET
          title = ?, content = ?, transcript_text = ?, rewrite_text = ?,
          source_video_url = ?, output_video_url = ?, digital_human_style_id = ?,
          status = ?, task_payload_json = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [
          title,
          task.content ?? null,
          transcriptText,
          rewriteText,
          task.sourceVideoUrl,
          outputVideoUrl,
          digitalHumanStyleId,
          task.status,
          payloadJson,
          task.updatedAt,
          task.id,
          task.userId,
        ],
      );
      return;
    }

    await this.db.execute(
      `INSERT INTO user_works (
        id, user_id, title, content, transcript_text, rewrite_text,
        source_video_url, output_video_url, digital_human_style_id,
        status, task_payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id,
        task.userId,
        title,
        task.content ?? null,
        transcriptText,
        rewriteText,
        task.sourceVideoUrl,
        outputVideoUrl,
        digitalHumanStyleId,
        task.status,
        payloadJson,
        task.createdAt,
        task.updatedAt,
      ],
    );
  }

  private parsePayload(json: string): TaskInternal | null {
    try {
      return JSON.parse(json) as TaskInternal;
    } catch {
      this.logger.warn('task_payload_json 解析失败');
      return null;
    }
  }
}
