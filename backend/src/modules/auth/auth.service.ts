import {
  BadRequestException,
  ConflictException,
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

export interface AuthUserRow {
  id: string;
  email: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const s = this.config.get<string>('JWT_SECRET')?.trim();
    if (!s) {
      this.logger.warn(
        'JWT_SECRET 未配置，使用内置开发密钥；生产环境请务必设置 JWT_SECRET',
      );
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

  /** bcrypt 轮数：高则更安全但更吃 CPU/内存；2GB 小机 Docker 建议 .env 设 BCRYPT_ROUNDS=8 */
  private bcryptRounds(): number {
    const raw = this.config.get<string>('BCRYPT_ROUNDS')?.trim();
    const n = raw ? Number(raw) : 10;
    if (!Number.isFinite(n)) return 10;
    return Math.min(12, Math.max(4, Math.floor(n)));
  }

  async register(
    emailRaw: string,
    password: string,
  ): Promise<{ token: string; user: { id: string; email: string } }> {
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
    await this.db.execute(
      'INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
      [id, email, passwordHash, now],
    );

    const token = this.signAccessToken({ id, email });
    return { token, user: { id, email } };
  }

  async login(
    emailRaw: string,
    password: string,
  ): Promise<{ token: string; user: { id: string; email: string } }> {
    if (!emailRaw?.trim() || !password) {
      throw new BadRequestException('请填写邮箱和密码');
    }
    const email = this.normalizeEmail(emailRaw);
    const row = await this.db.queryOne<{
      id: string;
      email: string;
      password_hash: string;
    }>('SELECT id, email, password_hash FROM users WHERE email = ?', [email]);
    if (!row) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    const token = this.signAccessToken({ id: row.id, email: row.email });
    return { token, user: { id: row.id, email: row.email } };
  }

  async findUserById(id: string): Promise<AuthUserRow | null> {
    const row = await this.db.queryOne<AuthUserRow>(
      'SELECT id, email FROM users WHERE id = ?',
      [id],
    );
    return row;
  }
}
