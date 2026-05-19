import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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

/** 后台 /v1/admin/* 仅固定管理员邮箱可访问，使用独立 SQLite 文件避免污染本地 data/app.db。 */
describe('Admin access (e2e)', () => {
  let app: INestApplication<App>;
  let sqlitePath: string;

  beforeAll(() => {
    const dir = path.join(os.tmpdir(), 'shuziren-admin-e2e');
    fs.mkdirSync(dir, { recursive: true });
    sqlitePath = path.join(dir, `${randomUUID()}.db`);
    process.env.SQLITE_PATH = sqlitePath;
  });

  afterAll(() => {
    try {
      fs.unlinkSync(sqlitePath);
    } catch {
      /* noop */
    }
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureHttpApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('未携带 JWT 访问 admin 应 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/stats').expect(401);
  });

  it('普通注册用户访问 admin 应 403', async () => {
    const email = `u_${randomUUID().slice(0, 8)}@e2e.local`;
    const password = 'password123';

    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(201);

    const token = readToken(reg.body);
    expect(token).toBeTruthy();

    await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('固定管理员邮箱访问 admin 应 200', async () => {
    const password = 'password123';

    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: '447519854@qq.com', password })
      .expect(201);

    const token = readToken(reg.body);
    expect(token).toBeTruthy();

    await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
