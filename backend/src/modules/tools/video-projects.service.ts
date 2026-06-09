import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service';
import type {
  ArchiveVideoProjectBody,
  CreateVideoProjectBody,
  ListVideoProjectsQuery,
  UpdateVideoProjectBody,
  VideoProjectDto,
  VideoProjectListDto,
} from './video-project-render.types';

type VideoProjectRow = {
  id: string;
  user_id: string;
  name: string;
  status: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class VideoProjectsService {
  constructor(private readonly db: DatabaseService) {}

  async createProject(
    userId: string,
    body: CreateVideoProjectBody,
  ): Promise<VideoProjectDto> {
    const now = new Date().toISOString();
    const projectId = `project_${randomUUID()}`;
    const name = this.normalizeName(body?.name, {
      allowDefault: true,
    });
    await this.db.execute(
      `INSERT INTO video_projects
       (id, user_id, name, status, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, 'active', NULL, ?, ?)`,
      [projectId, userId, name, now, now],
    );
    const row = await this.requireOwnedProject(userId, projectId);
    return this.toDto(row);
  }

  async listProjects(
    userId: string,
    query: ListVideoProjectsQuery,
  ): Promise<VideoProjectListDto> {
    const limit = this.normalizeLimit(query?.limit);
    const offset = this.normalizeOffset(query?.offset);
    const scope = this.normalizeScope(query?.scope);
    const { whereSql, whereArgs } = this.buildScopeWhere(userId, scope);

    const totalRow = await this.db.queryOne<{ c?: unknown; C?: unknown }>(
      `SELECT COUNT(1) AS c FROM video_projects ${whereSql}`,
      whereArgs,
    );
    const total = this.readCount(totalRow?.c ?? totalRow?.C);

    const rows = await this.db.queryAll<VideoProjectRow>(
      `SELECT id, user_id, name, status, archived_at, created_at, updated_at
       FROM video_projects
       ${whereSql}
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...whereArgs, limit, offset],
    );
    const items = rows.map((row) => this.toDto(row));
    return {
      items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  }

  async getProject(
    userId: string,
    projectId: string,
  ): Promise<VideoProjectDto> {
    const row = await this.requireOwnedProject(userId, projectId);
    return this.toDto(row);
  }

  async renameProject(
    userId: string,
    projectId: string,
    body: UpdateVideoProjectBody,
  ): Promise<VideoProjectDto> {
    const nextName = this.normalizeName(body?.name, {
      allowDefault: false,
    });
    const existing = await this.requireOwnedProject(userId, projectId);
    if (existing.name === nextName) {
      return this.toDto(existing);
    }

    await this.db.execute(
      `UPDATE video_projects
       SET name = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [nextName, new Date().toISOString(), projectId, userId],
    );
    return this.getProject(userId, projectId);
  }

  async archiveProject(
    userId: string,
    projectId: string,
    body: ArchiveVideoProjectBody,
  ): Promise<VideoProjectDto> {
    const archived = body?.archived !== false;
    const now = new Date().toISOString();
    await this.requireOwnedProject(userId, projectId);
    await this.db.execute(
      `UPDATE video_projects
       SET status = ?, archived_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        archived ? 'archived' : 'active',
        archived ? now : null,
        now,
        projectId,
        userId,
      ],
    );
    return this.getProject(userId, projectId);
  }

  private normalizeName(
    raw: unknown,
    options: { allowDefault: boolean },
  ): string {
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
      if (options.allowDefault) return '未命名任务';
      throw new BadRequestException('任务名称不能为空');
    }
    if (text.length > 80) {
      throw new BadRequestException('任务名称长度不能超过 80 个字符');
    }
    return text;
  }

  private normalizeLimit(raw: unknown): number {
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw)
          : NaN;
    if (!Number.isFinite(value)) return 20;
    const n = Math.floor(value);
    if (n < 1) return 1;
    if (n > 50) return 50;
    return n;
  }

  private normalizeOffset(raw: unknown): number {
    const value =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw)
          : NaN;
    if (!Number.isFinite(value)) return 0;
    const n = Math.floor(value);
    if (n < 0) return 0;
    if (n > 1_000_000) return 1_000_000;
    return n;
  }

  private normalizeScope(raw: unknown): 'active' | 'archived' | 'all' {
    const scope = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (scope === 'active' || scope === 'archived' || scope === 'all') {
      return scope;
    }
    return 'active';
  }

  private buildScopeWhere(
    userId: string,
    scope: 'active' | 'archived' | 'all',
  ): {
    whereSql: string;
    whereArgs: unknown[];
  } {
    if (scope === 'all') {
      return {
        whereSql: 'WHERE user_id = ?',
        whereArgs: [userId],
      };
    }
    return {
      whereSql: 'WHERE user_id = ? AND status = ?',
      whereArgs: [userId, scope],
    };
  }

  private readCount(raw: unknown): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.max(0, Math.floor(raw));
    }
    if (typeof raw === 'string') {
      const n = Number(raw);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }
    return 0;
  }

  private async requireOwnedProject(
    userId: string,
    projectIdRaw: string,
  ): Promise<VideoProjectRow> {
    const projectId = projectIdRaw.trim();
    if (!projectId) {
      throw new BadRequestException('projectId 不能为空');
    }
    const row = await this.db.queryOne<VideoProjectRow>(
      `SELECT id, user_id, name, status, archived_at, created_at, updated_at
       FROM video_projects
       WHERE id = ? AND user_id = ?`,
      [projectId, userId],
    );
    if (!row) {
      throw new NotFoundException('创作任务不存在');
    }
    return row;
  }

  private toDto(row: VideoProjectRow): VideoProjectDto {
    return {
      projectId: row.id,
      name: row.name,
      archived: row.status === 'archived',
      archivedAt: row.archived_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
