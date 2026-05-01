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
    void this.bootstrapConfigWarnings();
    void this.applyAdminEmailsFromEnv();
  }

  private async bootstrapConfigWarnings(): Promise<void> {
    const s = this.config.get<string>('JWT_SECRET')?.trim();
    if (!s) {
      this.logger.warn(
        'JWT_SECRET 未配置，使用内置开发密钥；生产环境请务必设置 JWT_SECRET',
      );
    }
  }

  /** 将 ADMIN_EMAILS 中的邮箱设为管理员并开通（.env 逗号分隔，启动时执行） */
  private async applyAdminEmailsFromEnv(): Promise<void> {
    const raw = this.config.get<string>('ADMIN_EMAILS')?.trim();
    if (!raw) {
      return;
    }
    const emails = raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    for (const email of emails) {
      try {
        await this.db.execute(
          `UPDATE users SET role = 'admin', account_status = 'active' WHERE email = ?`,
          [email],
        );
      } catch (e) {
        this.logger.warn(`ADMIN_EMAILS 同步失败 ${email}: ${e}`);
      }
    }
  }

  private getJwtSecret(): string {
    return (
      this.config.get<string>('JWT_SECRET')?.trim() ||
      'dev-only-jwt-secret-change-in-production'
    );
  }

  private signAccessToken(user: { id: string; email: string }): string {
    return jwt.sign(
      { sub: user.id, email: user.email },
      this.getJwtSecret(),
      { expiresIn: '30d' },
    );
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
    if (v === 'active') {
      return 'active';
    }
    return 'pending';
  }

  private mapRole(raw: string | null | undefined): UserRole {
    return raw === 'admin' ? 'admin' : 'user';
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
    const role = this.mapRole(refreshed?.role ?? row.role);
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
    }>(
      `SELECT id, email, role, account_status FROM users WHERE id = ?`,
      [id],
    );
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      email: row.email,
      role: this.mapRole(row.role),
      account_status: this.mapAccountStatus(row.account_status),
    };
  }

  async isAdmin(userId: string): Promise<boolean> {
    const r = await this.findUserGovById(userId);
    return r?.role === 'admin';
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
