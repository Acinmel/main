import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { DatabaseService } from '../../database/database.service';

/**
 * 审计：写入 audit_logs（用户维度操作与耗时资源统计）。
 * action：task_create · render_submit 等常量见 Admin 文档。
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  static clientIp(req: Request): string {
    const xff = req.headers?.['x-forwarded-for'];
    const xf = typeof xff === 'string' ? xff.split(',')[0]?.trim() : '';
    const raw =
      xf ||
      (
        typeof req.socket?.remoteAddress === 'string'
          ? req.socket.remoteAddress
          : ''
      ).trim();
    return raw.length > 0 ? raw.slice(0, 64) : '';
  }

  async log(
    userId: string,
    action: string,
    detail?: string,
    req?: Request,
  ): Promise<void> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const ip = req ? AuditService.clientIp(req) : '';
    const d =
      detail && detail.length > 8000 ? `${detail.slice(0, 7997)}...` : detail;
    await this.db.execute(
      `INSERT INTO audit_logs (id, user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, action, d ?? null, ip || null, now],
    );
  }
}
