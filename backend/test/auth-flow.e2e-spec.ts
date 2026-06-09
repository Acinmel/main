import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureHttpApp } from '../src/app.config';
import { AppModule } from '../src/app.module';

function readToken(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const token = (body as { token?: unknown }).token;
  return typeof token === 'string' ? token : '';
}

function readUserEmail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const user = (body as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return '';
  const email = (user as { email?: unknown }).email;
  return typeof email === 'string' ? email : '';
}

function readUserId(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const user = (body as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return '';
  const id = (user as { id?: unknown }).id;
  return typeof id === 'string' ? id : '';
}

function readAccountStatus(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const user = (body as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return '';
  const status = (user as { accountStatus?: unknown }).accountStatus;
  return typeof status === 'string' ? status : '';
}

function readMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message) && typeof message[0] === 'string') {
    return message[0];
  }
  return '';
}

function phoneFromSeed(seed: number): string {
  const tail = String(Math.abs(seed % 1_000_000_000)).padStart(9, '0');
  return `13${tail}`;
}

function registerPayload(email: string, password: string, seed: number) {
  return {
    email,
    password,
    phoneNumber: phoneFromSeed(seed),
    idCardNumber: '11010519491231002X',
  };
}

describe('Auth flow (e2e)', () => {
  let app: INestApplication<App>;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shuziren-auth-e2e-'));
    const dbPath = path.join(tmpDir, 'e2e.db');
    process.env.SQLITE_PATH = dbPath;
    process.env.JWT_SECRET = 'e2e-jwt-secret-fixed';
    process.env.ID_CARD_HASH_SECRET = 'e2e-id-card-secret';
    process.env.REGISTRATION_DEFAULT_ACCOUNT_STATUS = 'pending';
    process.env.DIGITAL_HUMAN_STORAGE_DIR = path.join(tmpDir, 'digital-humans');
    process.env.AUTH_RESET_WINDOW_MS = '600000';
    process.env.AUTH_RESET_MAX_ATTEMPTS_PER_IP = '20';
    process.env.AUTH_RESET_MAX_ATTEMPTS_PER_ACCOUNT = '6';
    process.env.AUTH_RESET_MAX_FAILURES_PER_IP = '10';
    process.env.AUTH_RESET_MAX_FAILURES_PER_ACCOUNT = '5';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureHttpApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('register -> login -> me；pending 用户不能访问业务接口', async () => {
    const email = `u${Date.now()}@test.local`;
    const password = 'password12';

    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload(email, password, Date.now()));
    expect([200, 201]).toContain(reg.status);
    const token = readToken(reg.body);
    expect(token).toBeTruthy();

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(readUserEmail(res.body)).toBe(email.toLowerCase());
      });

    await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });
    expect([200, 201]).toContain(login.status);
    const loginToken = readToken(login.body);
    expect(loginToken).toBeTruthy();

    await request(app.getHttpServer())
      .get('/api/v1/tools/digital-human-template')
      .set('Authorization', `Bearer ${loginToken}`)
      .expect(403);
  });

  it('pending 账号在管理员开通前被拦截，disabled 后再次拦截', async () => {
    const seed = Date.now();
    const userEmail = `pending_${seed}@test.local`;
    const userPassword = 'password12';

    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload(userEmail, userPassword, seed))
      .expect(201);
    const userId = readUserId(reg.body);
    const pendingToken = readToken(reg.body);
    expect(userId).toBeTruthy();
    expect(pendingToken).toBeTruthy();
    expect(readAccountStatus(reg.body)).toBe('pending');

    await request(app.getHttpServer())
      .get('/api/v1/resources/avatars?scope=all&limit=10')
      .set('Authorization', `Bearer ${pendingToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${pendingToken}`)
      .send({ sourceVideoUrl: 'https://example.com/demo' })
      .expect(410);

    const adminReg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload('447519854@qq.com', 'password12', seed + 1))
      .expect(201);
    const adminToken = readToken(adminReg.body);
    expect(adminToken).toBeTruthy();
    expect(readAccountStatus(adminReg.body)).toBe('active');

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ accountStatus: 'active' })
      .expect(200);

    const activeLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userEmail, password: userPassword })
      .expect(201);
    const activeToken = readToken(activeLogin.body);
    expect(activeToken).toBeTruthy();
    expect(readAccountStatus(activeLogin.body)).toBe('active');

    await request(app.getHttpServer())
      .get('/api/v1/resources/avatars?scope=all&limit=10')
      .set('Authorization', `Bearer ${activeToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${userId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ accountStatus: 'disabled' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: userEmail, password: userPassword })
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/resources/avatars?scope=all&limit=10')
      .set('Authorization', `Bearer ${activeToken}`)
      .expect(403);
  });

  it('登录态改密成功，旧密码失效，新密码生效，pending 状态不变', async () => {
    const seed = Date.now();
    const email = `cp_${seed}@test.local`;
    const password = 'password12';
    const nextPassword = 'password99';

    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload(email, password, seed))
      .expect(201);
    const token = readToken(reg.body);
    expect(token).toBeTruthy();
    expect(readAccountStatus(reg.body)).toBe('pending');

    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: nextPassword })
      .expect(201)
      .expect(({ body }) => {
        expect(body.ok).toBe(true);
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(401);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: nextPassword })
      .expect(201);
    expect(readAccountStatus(login.body)).toBe('pending');
  });

  it('忘记密码重置成功：三因子匹配后可重置，旧密码失效', async () => {
    const seed = Date.now();
    const email = `rp_${seed}@test.local`;
    const password = 'password12';
    const newPassword = 'password77';
    const payload = registerPayload(email, password, seed);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(201);

    const reset = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({
        email,
        phoneNumber: payload.phoneNumber,
        idCardNumber: payload.idCardNumber,
        newPassword,
      });
    expect([200, 201]).toContain(reset.status);
    expect(reset.body.ok).toBe(true);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: newPassword })
      .expect(201);
  });

  it('忘记密码失败返回统一错误信息（防枚举）', async () => {
    const seed = Date.now();
    const email = `uf_${seed}@test.local`;
    const payload = registerPayload(email, 'password12', seed);

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(201);

    const mismatch = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({
        email,
        phoneNumber: '13900000000',
        idCardNumber: payload.idCardNumber,
        newPassword: 'password55',
      })
      .expect(400);

    const notExists = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({
        email: `none_${seed}@test.local`,
        phoneNumber: payload.phoneNumber,
        idCardNumber: payload.idCardNumber,
        newPassword: 'password55',
      })
      .expect(400);

    const messageA = readMessage(mismatch.body);
    const messageB = readMessage(notExists.body);
    expect(messageA).toBeTruthy();
    expect(messageA).toBe(messageB);
  });

  it('注册必须包含手机号和身份证号', async () => {
    const email = `missing_${Date.now()}@test.local`;
    const password = 'password12';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(400);
  });

  it('重复注册同一邮箱返回 409', async () => {
    const seed = Date.now();
    const email = `dup${seed}@test.local`;
    const password = 'password12';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload(email, password, seed))
      .expect((res) => {
        expect([200, 201]).toContain(res.status);
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload(email, password, seed + 1))
      .expect(409);
  });

  it('错误密码登录返回 401', async () => {
    const seed = Date.now();
    const email = `bad${seed}@test.local`;
    const password = 'password12';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload(email, password, seed))
      .expect((res) => {
        expect([200, 201]).toContain(res.status);
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrongpass1' })
      .expect(401);
  });

  it('匿名 register/login 不应被 403 拦截', async () => {
    const seed = Date.now();
    const email = `anon_${seed}@test.local`;
    const password = 'password12';

    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registerPayload(email, password, seed));
    expect(register.status).toBe(201);
    expect(register.status).not.toBe(403);
    expect(readToken(register.body)).toBeTruthy();
    expect(readAccountStatus(register.body)).toBe('pending');

    const wrongPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrongpass1' });
    expect(wrongPassword.status).toBe(401);
    expect(wrongPassword.status).not.toBe(403);

    const missingPayload = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({});
    expect(missingPayload.status).toBe(400);
    expect(missingPayload.status).not.toBe(403);
  });

  it('auth preflight requests should not be blocked by auth guards', async () => {
    const registerPreflight = await request(app.getHttpServer())
      .options('/api/v1/auth/register')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(registerPreflight.status).not.toBe(401);
    expect(registerPreflight.status).not.toBe(403);

    const loginPreflight = await request(app.getHttpServer())
      .options('/api/v1/auth/login')
      .set('Origin', 'http://127.0.0.1:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(loginPreflight.status).not.toBe(401);
    expect(loginPreflight.status).not.toBe(403);
  });
});
