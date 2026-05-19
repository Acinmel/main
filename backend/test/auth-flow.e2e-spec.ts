import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
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

describe('Auth flow (e2e)', () => {
  let app: INestApplication<App>;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shuziren-auth-e2e-'));
    const dbPath = path.join(tmpDir, 'e2e.db');
    process.env.SQLITE_PATH = dbPath;
    process.env.JWT_SECRET = 'e2e-jwt-secret-fixed';
    process.env.REGISTRATION_DEFAULT_ACCOUNT_STATUS = 'pending';
    process.env.DIGITAL_HUMAN_STORAGE_DIR = path.join(tmpDir, 'digital-humans');

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

  it('register → login → me；待审核用户不可访问 digital-human-template', async () => {
    const email = `u${Date.now()}@test.local`;
    const password = 'password12';

    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password });
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

  it('重复注册同一邮箱返回 409', async () => {
    const email = `dup${Date.now()}@test.local`;
    const password = 'password12';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect((res) => {
        expect([200, 201]).toContain(res.status);
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(409);
  });

  it('错误密码登录返回 401', async () => {
    const email = `bad${Date.now()}@test.local`;
    const password = 'password12';

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect((res) => {
        expect([200, 201]).toContain(res.status);
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrongpass1' })
      .expect(401);
  });
});
