import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../../database/database.service';

export type UserRole = 'user' | 'admin';
export type AccountStatus = 'pending' | 'active' | 'disabled';

export const FIXED_ADMIN_EMAIL = '447519854@qq.com';

export interface AuthUserRow {
  id: string;
  email: string;
}

export interface AuthUserGovernanceRow extends AuthUserRow {
  role: UserRole;
  account_status: AccountStatus;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.bootstrapConfigWarnings();
    void this.applyAdminEmailsFromEnv();
  }

  private bootstrapConfigWarnings(): void {
    const s = this.config.get<string>('JWT_SECRET')?.trim();
    if (!s) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET is required when NODE_ENV=production');
      }
      this.logger.warn(
        'JWT_SECRET 未配置，使用内置开发密钥；生产环境请务必设置 JWT_SECRET',
      );
    }
  }

  /** 固定后台管理员账号：只有该邮箱可访问 /v1/admin/*。 */
  private async applyAdminEmailsFromEnv(): Promise<void> {
    try {
      await this.db.execute(
        `UPDATE users SET role = 'admin', account_status = 'active' WHERE email = ?`,
        [FIXED_ADMIN_EMAIL],
      );
    } catch (e) {
      this.logger.warn(`固定管理员账号同步失败 ${FIXED_ADMIN_EMAIL}: ${e}`);
    }
  }

  private getJwtSecret(): string {
    const secret = this.config.get<string>('JWT_SECRET')?.trim();
    if (secret) {
      return secret;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET is required when NODE_ENV=production');
    }
    return 'dev-only-jwt-secret-change-in-production';
  }

  private signAccessToken(user: { id: string; email: string }): string {
    return jwt.sign({ sub: user.id, email: user.email }, this.getJwtSecret(), {
      expiresIn: '30d',
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private validateEmail(email: string): void {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('邮箱格式无效');
    }
  }

  private validatePassword(password: string): void {
    if (password.length < 8) {
      throw new BadRequestException('密码至少 8 位');
    }
  }

  private bcryptRounds(): number {
    const raw = this.config.get<string>('BCRYPT_ROUNDS')?.trim();
    const n = raw ? Number(raw) : 10;
    if (!Number.isFinite(n)) return 10;
    return Math.min(12, Math.max(4, Math.floor(n)));
  }

  private registrationDefaultAccountStatus(): AccountStatus {
    const v = this.config
      .get<string>('REGISTRATION_DEFAULT_ACCOUNT_STATUS')
      ?.trim()
      .toLowerCase();
    if (v === 'pending') {
      return 'pending';
    }
    return 'active';
  }

  private mapEffectiveRole(
    email: string,
    raw: string | null | undefined,
  ): UserRole {
    if (this.normalizeEmail(email) === FIXED_ADMIN_EMAIL && raw === 'admin') {
      return 'admin';
    }
    return 'user';
  }

  private mapAccountStatus(raw: string | null | undefined): AccountStatus {
    if (raw === 'disabled' || raw === 'pending' || raw === 'active') {
      return raw;
    }
    return 'active';
  }

  async register(
    emailRaw: string,
    password: string,
  ): Promise<{
    token: string;
    user: {
      id: string;
      email: string;
      role: UserRole;
      accountStatus: AccountStatus;
    };
  }> {
    if (!emailRaw?.trim() || !password) {
      throw new BadRequestException('请填写邮箱和密码');
    }
    const email = this.normalizeEmail(emailRaw);
    this.validateEmail(email);
    this.validatePassword(password);

    const exists = await this.db.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = ?',
      [email],
    );
    if (exists) {
      throw new ConflictException('该邮箱已注册');
    }

    const id = randomUUID();
    const passwordHash = await bcrypt.hash(password, this.bcryptRounds());
    const now = new Date().toISOString();
    const accountStatus = this.registrationDefaultAccountStatus();
    await this.db.execute(
      `INSERT INTO users (id, email, password_hash, created_at, role, account_status) VALUES (?, ?, ?, ?, 'user', ?)`,
      [id, email, passwordHash, now, accountStatus],
    );

    await this.applyAdminEmailsFromEnv();

    const gov = await this.findUserGovById(id);
    const token = this.signAccessToken({ id, email });
    return {
      token,
      user: {
        id,
        email,
        role: gov?.role ?? 'user',
        accountStatus: gov?.account_status ?? accountStatus,
      },
    };
  }

  async login(
    emailRaw: string,
    password: string,
  ): Promise<{
    token: string;
    user: {
      id: string;
      email: string;
      role: UserRole;
      accountStatus: AccountStatus;
    };
  }> {
    if (!emailRaw?.trim() || !password) {
      throw new BadRequestException('请填写邮箱和密码');
    }
    const email = this.normalizeEmail(emailRaw);
    const row = await this.db.queryOne<{
      id: string;
      email: string;
      password_hash: string;
      role: string | null;
      account_status: string | null;
    }>(
      'SELECT id, email, password_hash, role, account_status FROM users WHERE email = ?',
      [email],
    );
    if (!row) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    if (this.mapAccountStatus(row.account_status) === 'disabled') {
      throw new ForbiddenException('账号已停用，请联系管理员');
    }
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    await this.applyAdminEmailsFromEnv();
    const refreshed = await this.findUserGovById(row.id);
    const role = this.mapEffectiveRole(row.email, refreshed?.role ?? row.role);
    const accountStatus = this.mapAccountStatus(
      refreshed?.account_status ?? row.account_status,
    );
    const token = this.signAccessToken({ id: row.id, email: row.email });
    return {
      token,
      user: {
        id: row.id,
        email: row.email,
        role,
        accountStatus,
      },
    };
  }

  async findUserById(id: string): Promise<AuthUserRow | null> {
    const row = await this.db.queryOne<AuthUserRow>(
      'SELECT id, email FROM users WHERE id = ?',
      [id],
    );
    return row;
  }

  async findUserGovById(id: string): Promise<AuthUserGovernanceRow | null> {
    const row = await this.db.queryOne<{
      id: string;
      email: string;
      role: string | null;
      account_status: string | null;
    }>(`SELECT id, email, role, account_status FROM users WHERE id = ?`, [id]);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      email: row.email,
      role: this.mapEffectiveRole(row.email, row.role),
      account_status: this.mapAccountStatus(row.account_status),
    };
  }

  async isAdmin(userId: string): Promise<boolean> {
    const r = await this.findUserGovById(userId);
    return this.normalizeEmail(r?.email ?? '') === FIXED_ADMIN_EMAIL;
  }

  async assertAccountUsable(userId: string): Promise<void> {
    const row = await this.findUserGovById(userId);
    if (!row) {
      throw new UnauthorizedException('用户不存在');
    }
    if (row.account_status === 'disabled') {
      throw new ForbiddenException('账号已停用，请联系管理员');
    }
    if (row.role === 'admin') {
      return;
    }
    if (row.account_status === 'pending') {
      throw new ForbiddenException(
        '账号待审核开通，请等待管理员处理后再使用数字人、口播与任务功能',
      );
    }
  }
}
