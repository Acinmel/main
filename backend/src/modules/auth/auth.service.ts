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
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import { DatabaseService } from '../../database/database.service';

export type UserRole = 'user' | 'admin';
export type AccountStatus = 'pending' | 'active' | 'disabled';

export const FIXED_ADMIN_EMAIL = '447519854@qq.com';
const RESET_PASSWORD_UNIFIED_ERROR = '账号信息校验失败或请求受限，请稍后重试';
const SYSTEM_AUDIT_USER_ID = '00000000-0000-0000-0000-000000000000';

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
  private idCardSecretWarned = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.bootstrapConfigWarnings();
    void this.applyAdminEmailsFromEnv();
  }

  private bootstrapConfigWarnings(): void {
    const jwtSecret = this.config.get<string>('JWT_SECRET')?.trim();
    if (!jwtSecret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET is required when NODE_ENV=production');
      }
      this.logger.warn(
        'JWT_SECRET 未配置，当前使用开发默认值；生产环境必须配置 JWT_SECRET',
      );
    }
  }

  /** 固定后台管理员账号：只有该邮箱可访问 /v1/admin/* */
  private async applyAdminEmailsFromEnv(): Promise<void> {
    try {
      await this.db.execute(
        `UPDATE users SET role = 'admin', account_status = 'active' WHERE email = ?`,
        [FIXED_ADMIN_EMAIL],
      );
    } catch (e) {
      this.logger.warn(
        `固定管理员账号同步失败 ${FIXED_ADMIN_EMAIL}: ${String(e)}`,
      );
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

  private normalizePhoneNumber(phoneNumberRaw: string): string {
    const digits = phoneNumberRaw.replace(/\D+/g, '');
    const normalized =
      digits.length === 13 && digits.startsWith('86')
        ? digits.slice(2)
        : digits;
    if (!/^1\d{10}$/.test(normalized)) {
      throw new BadRequestException('手机号格式无效');
    }
    return normalized;
  }

  private normalizeIdCardNumber(idCardNumberRaw: string): string {
    const normalized = idCardNumberRaw.trim().toUpperCase().replace(/\s+/g, '');
    if (!/^\d{17}[\dX]$/.test(normalized)) {
      throw new BadRequestException('身份证号格式无效');
    }
    return normalized;
  }

  private getIdCardHashSecret(): string {
    const secret = this.config.get<string>('ID_CARD_HASH_SECRET')?.trim();
    if (secret) {
      return secret;
    }
    const fallback = this.getJwtSecret();
    if (!this.idCardSecretWarned) {
      this.logger.warn(
        'ID_CARD_HASH_SECRET 未配置，当前回退使用 JWT_SECRET 作为身份证哈希密钥',
      );
      this.idCardSecretWarned = true;
    }
    return fallback;
  }

  private hashIdCardNumber(normalizedIdCardNumber: string): string {
    return createHmac('sha256', this.getIdCardHashSecret())
      .update(normalizedIdCardNumber)
      .digest('hex');
  }

  private idCardLast4(normalizedIdCardNumber: string): string {
    return normalizedIdCardNumber.slice(-4);
  }

  private equalsIdCardHash(
    storedHash: string | null | undefined,
    normalizedIdCardNumber: string,
  ): boolean {
    if (!storedHash || storedHash.length < 8) {
      return false;
    }
    const expectedHash = this.hashIdCardNumber(normalizedIdCardNumber);
    const left = Buffer.from(storedHash);
    const right = Buffer.from(expectedHash);
    if (left.length !== right.length) {
      return false;
    }
    try {
      return timingSafeEqual(left, right);
    } catch {
      return false;
    }
  }

  private readPositiveInt(name: string, fallback: number): number {
    const raw = this.config.get<string>(name)?.trim();
    const parsed = raw ? Number(raw) : fallback;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private authResetWindowMs(): number {
    return this.readPositiveInt('AUTH_RESET_WINDOW_MS', 15 * 60 * 1000);
  }

  private authResetMaxAttemptsPerIp(): number {
    return this.readPositiveInt('AUTH_RESET_MAX_ATTEMPTS_PER_IP', 20);
  }

  private authResetMaxAttemptsPerAccount(): number {
    return this.readPositiveInt('AUTH_RESET_MAX_ATTEMPTS_PER_ACCOUNT', 6);
  }

  private authResetMaxFailuresPerIp(): number {
    return this.readPositiveInt('AUTH_RESET_MAX_FAILURES_PER_IP', 10);
  }

  private authResetMaxFailuresPerAccount(): number {
    return this.readPositiveInt('AUTH_RESET_MAX_FAILURES_PER_ACCOUNT', 5);
  }

  private registrationDefaultAccountStatus(): AccountStatus {
    const v = this.config
      .get<string>('REGISTRATION_DEFAULT_ACCOUNT_STATUS')
      ?.trim()
      .toLowerCase();
    if (v === 'active') {
      return 'active';
    }
    if (v === 'pending') {
      return 'pending';
    }
    return 'pending';
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

  private async countAuditLogsInWindow(params: {
    actions: readonly string[];
    sinceIso: string;
    ip?: string | null;
    userId?: string | null;
  }): Promise<number> {
    const conditions = ['created_at >= ?'];
    const sqlArgs: unknown[] = [params.sinceIso];
    if (params.actions.length > 0) {
      conditions.push(`action IN (${params.actions.map(() => '?').join(',')})`);
      sqlArgs.push(...params.actions);
    }
    if (params.ip && params.ip.trim()) {
      conditions.push(`ip = ?`);
      sqlArgs.push(params.ip.trim());
    }
    if (params.userId && params.userId.trim()) {
      conditions.push(`user_id = ?`);
      sqlArgs.push(params.userId.trim());
    }
    const row = await this.db.queryOne<{ c: number }>(
      `SELECT COUNT(1) AS c FROM audit_logs WHERE ${conditions.join(' AND ')}`,
      sqlArgs,
    );
    return Number(row?.c ?? 0);
  }

  private async writeAudit(
    userId: string,
    action: string,
    detail?: string,
    ip?: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const trimmedDetail =
      detail && detail.length > 8000 ? `${detail.slice(0, 7997)}...` : detail;
    const normalizedIp = ip?.trim() ? ip.trim().slice(0, 64) : null;
    await this.db.execute(
      `INSERT INTO audit_logs (id, user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, action, trimmedDetail ?? null, normalizedIp, now],
    );
  }

  private throwResetPasswordUnifiedFailure(): never {
    throw new BadRequestException(RESET_PASSWORD_UNIFIED_ERROR);
  }

  async register(
    emailRaw: string,
    password: string,
    phoneNumberRaw: string,
    idCardNumberRaw: string,
  ): Promise<{
    token: string;
    user: {
      id: string;
      email: string;
      role: UserRole;
      accountStatus: AccountStatus;
    };
  }> {
    if (
      !emailRaw?.trim() ||
      !password ||
      !phoneNumberRaw?.trim() ||
      !idCardNumberRaw?.trim()
    ) {
      throw new BadRequestException('请填写邮箱、密码、手机号和身份证号');
    }
    const email = this.normalizeEmail(emailRaw);
    const phoneNumber = this.normalizePhoneNumber(phoneNumberRaw);
    const normalizedIdCard = this.normalizeIdCardNumber(idCardNumberRaw);
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
      `INSERT INTO users (id, email, password_hash, phone_number, id_card_hash, id_card_last4, created_at, role, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?)`,
      [
        id,
        email,
        passwordHash,
        phoneNumber,
        this.hashIdCardNumber(normalizedIdCard),
        this.idCardLast4(normalizedIdCard),
        now,
        accountStatus,
      ],
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

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    reqIp?: string,
  ): Promise<{ ok: true }> {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('请填写当前密码和新密码');
    }
    this.validatePassword(newPassword);

    const row = await this.db.queryOne<{
      id: string;
      password_hash: string;
      account_status: string | null;
    }>(`SELECT id, password_hash, account_status FROM users WHERE id = ?`, [
      userId,
    ]);
    if (!row) {
      throw new UnauthorizedException('用户不存在或已失效');
    }
    if (this.mapAccountStatus(row.account_status) === 'disabled') {
      throw new ForbiddenException('账号已停用，请联系管理员');
    }

    const matches = await bcrypt.compare(currentPassword, row.password_hash);
    if (!matches) {
      await this.writeAudit(
        userId,
        'auth_change_password_failed',
        'reason=current_password_mismatch',
        reqIp,
      );
      throw new UnauthorizedException('当前密码错误');
    }

    const nextHash = await bcrypt.hash(newPassword, this.bcryptRounds());
    await this.db.execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [
      nextHash,
      userId,
    ]);
    await this.writeAudit(
      userId,
      'auth_change_password_success',
      undefined,
      reqIp,
    );
    return { ok: true };
  }

  async resetPassword(params: {
    emailRaw: string;
    phoneNumberRaw: string;
    idCardNumberRaw: string;
    newPassword: string;
    reqIp?: string;
  }): Promise<{ ok: true }> {
    const email = this.normalizeEmail(params.emailRaw ?? '');
    const phoneNumber = this.normalizePhoneNumber(params.phoneNumberRaw ?? '');
    const idCardNumber = this.normalizeIdCardNumber(
      params.idCardNumberRaw ?? '',
    );
    this.validateEmail(email);
    this.validatePassword(params.newPassword);

    const row = await this.db.queryOne<{
      id: string;
      phone_number: string | null;
      id_card_hash: string | null;
      account_status: string | null;
    }>(
      `SELECT id, phone_number, id_card_hash, account_status
         FROM users
        WHERE email = ?`,
      [email],
    );
    const targetUserId = row?.id ?? SYSTEM_AUDIT_USER_ID;
    const ip = params.reqIp?.trim() || '';
    const sinceIso = new Date(
      Date.now() - this.authResetWindowMs(),
    ).toISOString();
    const attemptActions = [
      'auth_reset_password_success',
      'auth_reset_password_failed',
      'auth_reset_password_blocked',
    ] as const;
    const failureActions = [
      'auth_reset_password_failed',
      'auth_reset_password_blocked',
    ] as const;

    const [ipAttemptCount, ipFailureCount] = await Promise.all([
      this.countAuditLogsInWindow({
        actions: attemptActions,
        sinceIso,
        ip,
      }),
      this.countAuditLogsInWindow({
        actions: failureActions,
        sinceIso,
        ip,
      }),
    ]);
    if (
      ipAttemptCount >= this.authResetMaxAttemptsPerIp() ||
      ipFailureCount >= this.authResetMaxFailuresPerIp()
    ) {
      await this.writeAudit(
        targetUserId,
        'auth_reset_password_blocked',
        'reason=ip_rate_limited',
        ip,
      );
      this.throwResetPasswordUnifiedFailure();
    }

    if (row) {
      const [accountAttemptCount, accountFailureCount] = await Promise.all([
        this.countAuditLogsInWindow({
          actions: attemptActions,
          sinceIso,
          userId: row.id,
        }),
        this.countAuditLogsInWindow({
          actions: failureActions,
          sinceIso,
          userId: row.id,
        }),
      ]);
      if (
        accountAttemptCount >= this.authResetMaxAttemptsPerAccount() ||
        accountFailureCount >= this.authResetMaxFailuresPerAccount()
      ) {
        await this.writeAudit(
          row.id,
          'auth_reset_password_blocked',
          'reason=account_rate_limited',
          ip,
        );
        this.throwResetPasswordUnifiedFailure();
      }
    }

    const status = this.mapAccountStatus(row?.account_status);
    const verifySuccess =
      Boolean(row) &&
      status !== 'disabled' &&
      Boolean(row?.phone_number) &&
      Boolean(row?.id_card_hash) &&
      row?.phone_number === phoneNumber &&
      this.equalsIdCardHash(row?.id_card_hash, idCardNumber);

    if (!verifySuccess || !row) {
      await this.writeAudit(
        targetUserId,
        'auth_reset_password_failed',
        'reason=identity_mismatch_or_disabled',
        ip,
      );
      this.throwResetPasswordUnifiedFailure();
    }

    const nextHash = await bcrypt.hash(params.newPassword, this.bcryptRounds());
    await this.db.execute(`UPDATE users SET password_hash = ? WHERE id = ?`, [
      nextHash,
      row.id,
    ]);
    await this.writeAudit(row.id, 'auth_reset_password_success', undefined, ip);
    return { ok: true };
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

  private bcryptRounds(): number {
    const raw = this.config.get<string>('BCRYPT_ROUNDS')?.trim();
    const n = raw ? Number(raw) : 10;
    if (!Number.isFinite(n)) {
      return 10;
    }
    return Math.min(12, Math.max(4, Math.floor(n)));
  }
}
