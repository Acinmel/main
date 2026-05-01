import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AccountStatus, UserRole } from '../auth/auth.service';
import { DatabaseService } from '../../database/database.service';

export type AdminUserDto = {
  id: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
  createdAt: string;
  auditCounts?: Record<string, number>;
  /** 与前台口播 /「我的作品」同源：user_works、digital_human_templates */
  koubo: {
    worksCount: number;
    lastWorkAt: string | null;
    digitalHumanConfigured: boolean;
  };
};

@Injectable()
export class AdminService {
  constructor(private readonly db: DatabaseService) {}

  async listAuditLogs(opts: {
    limit: number;
    offset: number;
    q?: string;
  }): Promise<{
    items: {
      id: string;
      userId: string;
      email: string;
      /** users.created_at — 账号注册时间 */
      userRegisteredAt: string;
      action: string;
      detail: string | null;
      ip: string | null;
      createdAt: string;
    }[];
    total: number;
  }> {
    const limit = Math.min(500, Math.max(1, opts.limit));
    const offset = Math.max(0, opts.offset);
    const qq = opts.q?.trim();
    let where = '';
    const args: unknown[] = [];
    if (qq) {
      where =
        'WHERE al.action LIKE ? OR al.detail LIKE ? OR u.email LIKE ? OR al.ip LIKE ?';
      const wild = `%${qq}%`;
      args.push(wild, wild, wild, wild);
    }
    const countRow = await this.db.queryOne<{ c: number }>(
      `SELECT COUNT(1) AS c FROM audit_logs al JOIN users u ON u.id = al.user_id ${where}`,
      args,
    );
    const rows = await this.db.queryAll<{
      id: string;
      user_id: string;
      email: string;
      user_registered_at: string;
      action: string;
      detail: string | null;
      ip: string | null;
      created_at: string;
    }>(
      `
      SELECT al.id, al.user_id, u.email, u.created_at AS user_registered_at,
             al.action, al.detail, al.ip, al.created_at
      FROM audit_logs al JOIN users u ON u.id = al.user_id
      ${where}
      ORDER BY al.created_at DESC LIMIT ? OFFSET ?
      `,
      [...args, limit, offset],
    );
    return {
      total: countRow?.c ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        email: r.email,
        userRegisteredAt: r.user_registered_at,
        action: r.action,
        detail: r.detail,
        ip: r.ip,
        createdAt: r.created_at,
      })),
    };
  }

  async listUsers(opts: {
    q?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: AdminUserDto[]; total: number }> {
    const limit = Math.min(500, Math.max(1, opts.limit));
    const offset = Math.max(0, opts.offset);
    const qq = opts.q?.trim();
    let where = '';
    const args: unknown[] = [];
    if (qq) {
      where = 'WHERE email LIKE ? OR id LIKE ?';
      args.push(`%${qq}%`, `%${qq}%`);
    }
    const countRow = await this.db.queryOne<{ c: number }>(
      `SELECT COUNT(1) AS c FROM users ${where}`,
      args,
    );
    const rows = await this.db.queryAll<{
      id: string;
      email: string;
      role: string | null;
      account_status: string | null;
      created_at: string;
    }>(
      `SELECT id, email, role, account_status, created_at FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...args, limit, offset],
    );

    /** 每个用户每种 action 的计数（按需合并进列表） */
    const stats = await this.db.queryAll<{
      user_id: string;
      action: string;
      c: number;
    }>(
      `SELECT user_id, action, COUNT(1) AS c FROM audit_logs GROUP BY user_id, action`,
    );
    const byUser = new Map<string, Record<string, number>>();
    for (const s of stats) {
      const prev = byUser.get(s.user_id) ?? {};
      prev[s.action] = s.c;
      byUser.set(s.user_id, prev);
    }

    const ids = rows.map((r) => r.id);
    const workMeta = new Map<
      string,
      { work_count: number; last_work_at: string | null }
    >();
    const dhConfigured = new Set<string>();
    if (ids.length > 0) {
      const ph = ids.map(() => '?').join(',');
      const workAgg = await this.db.queryAll<{
        user_id: string;
        work_count: number;
        last_work_at: string | null;
      }>(
        `SELECT user_id, COUNT(1) AS work_count, MAX(updated_at) AS last_work_at
         FROM user_works WHERE user_id IN (${ph}) GROUP BY user_id`,
        [...ids],
      );
      for (const w of workAgg) {
        workMeta.set(w.user_id, {
          work_count: Number(w.work_count),
          last_work_at: w.last_work_at,
        });
      }
      const dhRows = await this.db.queryAll<{ user_id: string }>(
        `SELECT user_id FROM digital_human_templates WHERE user_id IN (${ph})`,
        [...ids],
      );
      for (const d of dhRows) {
        dhConfigured.add(d.user_id);
      }
    }

    const items: AdminUserDto[] = rows.map((r) => {
      const wm = workMeta.get(r.id);
      return {
        id: r.id,
        email: r.email,
        role: (r.role === 'admin' ? 'admin' : 'user') as UserRole,
        accountStatus: ['pending', 'active', 'disabled'].includes(
          String(r.account_status),
        )
          ? (r.account_status as AccountStatus)
          : 'active',
        createdAt: r.created_at,
        auditCounts: byUser.get(r.id),
        koubo: {
          worksCount: wm?.work_count ?? 0,
          lastWorkAt: wm?.last_work_at ?? null,
          digitalHumanConfigured: dhConfigured.has(r.id),
        },
      };
    });
    return { items, total: countRow?.c ?? 0 };
  }

  /** 口播作品明细：user_works + 用户邮箱 */
  async listUserWorks(opts: {
    limit: number;
    offset: number;
    q?: string;
  }): Promise<{
    total: number;
    items: {
      id: string;
      userId: string;
      email: string;
      title: string;
      status: string;
      sourceVideoUrl: string;
      createdAt: string;
      updatedAt: string;
    }[];
  }> {
    const limit = Math.min(200, Math.max(1, opts.limit));
    const offset = Math.max(0, opts.offset);
    const qq = opts.q?.trim();
    let where = '';
    const args: unknown[] = [];
    if (qq) {
      where =
        'WHERE u.email LIKE ? OR uw.title LIKE ? OR uw.id LIKE ? OR uw.user_id LIKE ?';
      const wild = `%${qq}%`;
      args.push(wild, wild, wild, wild);
    }
    const countRow = await this.db.queryOne<{ c: number }>(
      `SELECT COUNT(1) AS c FROM user_works uw JOIN users u ON u.id = uw.user_id ${where}`,
      args,
    );
    const rows = await this.db.queryAll<{
      id: string;
      user_id: string;
      email: string;
      title: string;
      status: string;
      source_video_url: string;
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT uw.id, uw.user_id, u.email, uw.title, uw.status, uw.source_video_url,
             uw.created_at, uw.updated_at
      FROM user_works uw
      JOIN users u ON u.id = uw.user_id
      ${where}
      ORDER BY uw.updated_at DESC
      LIMIT ? OFFSET ?
      `,
      [...args, limit, offset],
    );
    return {
      total: countRow?.c ?? 0,
      items: rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        email: r.email,
        title: r.title,
        status: r.status,
        sourceVideoUrl: r.source_video_url ?? '',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  /** 专属数字人模板明细：digital_human_templates + 用户邮箱 */
  async listDigitalHumanTemplates(opts: {
    limit: number;
    offset: number;
    q?: string;
  }): Promise<{
    total: number;
    items: {
      userId: string;
      email: string;
      styleId: string;
      outputRelativePath: string;
      selfieRelativePath: string;
      createdAt: string;
      updatedAt: string;
    }[];
  }> {
    const limit = Math.min(200, Math.max(1, opts.limit));
    const offset = Math.max(0, opts.offset);
    const qq = opts.q?.trim();
    let where = '';
    const args: unknown[] = [];
    if (qq) {
      where = 'WHERE u.email LIKE ? OR d.user_id LIKE ? OR d.style_id LIKE ?';
      const wild = `%${qq}%`;
      args.push(wild, wild, wild);
    }
    const countRow = await this.db.queryOne<{ c: number }>(
      `SELECT COUNT(1) AS c FROM digital_human_templates d JOIN users u ON u.id = d.user_id ${where}`,
      args,
    );
    const rows = await this.db.queryAll<{
      user_id: string;
      email: string;
      style_id: string;
      output_relative_path: string;
      selfie_relative_path: string;
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT d.user_id, u.email, d.style_id, d.output_relative_path, d.selfie_relative_path,
             d.created_at, d.updated_at
      FROM digital_human_templates d
      JOIN users u ON u.id = d.user_id
      ${where}
      ORDER BY d.updated_at DESC
      LIMIT ? OFFSET ?
      `,
      [...args, limit, offset],
    );
    return {
      total: countRow?.c ?? 0,
      items: rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        styleId: r.style_id,
        outputRelativePath: r.output_relative_path ?? '',
        selfieRelativePath: r.selfie_relative_path ?? '',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  }

  async globalStats(): Promise<{
    userCount: number;
    auditsTotal: number;
    byAction: { action: string; count: number }[];
    /** 口播流水线产生的作品行数（user_works），与「我的作品」同源 */
    kouboWorksTotal: number;
    /** 已在 digital_human_templates 配置的账号数 */
    digitalHumanUsers: number;
  }> {
    const ur = await this.db.queryOne<{ c: number }>(
      `SELECT COUNT(1) AS c FROM users`,
    );
    const ar = await this.db.queryOne<{ c: number }>(
      `SELECT COUNT(1) AS c FROM audit_logs`,
    );
    const byAct = await this.db.queryAll<{ action: string; c: number }>(
      `SELECT action, COUNT(1) AS c FROM audit_logs GROUP BY action ORDER BY c DESC`,
    );
    const kw = await this.db.queryOne<{ c: number }>(
      `SELECT COUNT(1) AS c FROM user_works`,
    );
    const dh = await this.db.queryOne<{ c: number }>(
      `SELECT COUNT(1) AS c FROM digital_human_templates`,
    );
    return {
      userCount: ur?.c ?? 0,
      auditsTotal: ar?.c ?? 0,
      byAction: byAct.map((a) => ({ action: a.action, count: a.c })),
      kouboWorksTotal: kw?.c ?? 0,
      digitalHumanUsers: dh?.c ?? 0,
    };
  }

  async updateUser(id: string, body: Partial<{ role: UserRole; accountStatus: AccountStatus }>) {
    if (!id?.trim()) {
      throw new BadRequestException('id 不能为空');
    }
    const exists = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM users WHERE id = ?`,
      [id],
    );
    if (!exists) {
      throw new NotFoundException('用户不存在');
    }

    const role = body.role;
    const accountStatus = body.accountStatus;
    if (role === undefined && accountStatus === undefined) {
      throw new BadRequestException('至少提供 role 或 accountStatus 之一');
    }
    if (
      role !== undefined &&
      role !== 'user' &&
      role !== 'admin'
    ) {
      throw new BadRequestException('role 必须为 user 或 admin');
    }
    if (
      accountStatus !== undefined &&
      accountStatus !== 'pending' &&
      accountStatus !== 'active' &&
      accountStatus !== 'disabled'
    ) {
      throw new BadRequestException('accountStatus 非法');
    }

    if (role !== undefined && accountStatus !== undefined) {
      await this.db.execute(
        `UPDATE users SET role = ?, account_status = ? WHERE id = ?`,
        [role, accountStatus, id],
      );
      return { ok: true as const };
    }
    if (role !== undefined) {
      await this.db.execute(`UPDATE users SET role = ? WHERE id = ?`, [role, id]);
    }
    if (accountStatus !== undefined) {
      await this.db.execute(`UPDATE users SET account_status = ? WHERE id = ?`, [
        accountStatus,
        id,
      ]);
    }
    return { ok: true as const };
  }
}
