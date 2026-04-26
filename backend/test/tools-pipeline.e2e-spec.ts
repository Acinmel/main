import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureHttpApp } from '../src/app.config';
import { AppModule } from '../src/app.module';

/**
 * 口播转写链路 HTTP 自检（不跑真实 Whisper 推理）。
 * 需能加载 backend/.env（ConfigModule.forRoot 默认从 cwd 读 .env）。
 *
 * 若已启动 backend/whisper-python-service（8010），可设环境变量强制断言 Whisper 可达：
 *   LIVE_WHISPER_ASSERT=1 npm run test:e2e -- tools-pipeline
 */
describe('Tools transcribe pipeline (e2e)', () => {
  jest.setTimeout(30_000);

  let app: INestApplication<App>;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureHttpApp(app);
    await app.init();

    const email = `e2e-pipeline-${Date.now()}@test.local`;
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'password12' });
    expect([200, 201]).toContain(reg.status);
    authToken = reg.body.token as string;
    expect(authToken).toBeTruthy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/tools/whisper-health returns JSON shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tools/whisper-health')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      ok: expect.any(Boolean),
      transcribeUrlConfigured: expect.any(Boolean),
      healthUrl: expect.any(String),
      latencyMs: expect.any(Number),
    });
    if (process.env.LIVE_WHISPER_ASSERT === '1') {
      expect(res.body.ok).toBe(true);
    }
  });

  it('GET /api/v1/tools/transcribe-pipeline-health returns full pipeline shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tools/transcribe-pipeline-health')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      videoSaveDir: expect.objectContaining({
        path: expect.any(String),
        writable: expect.any(Boolean),
      }),
      ffmpeg: expect.objectContaining({
        ok: expect.any(Boolean),
        path: expect.any(String),
      }),
      whisper: expect.objectContaining({
        ok: expect.any(Boolean),
        transcribeUrlConfigured: expect.any(Boolean),
        healthUrl: expect.any(String),
        latencyMs: expect.any(Number),
      }),
      dyCookieConfigured: expect.any(Boolean),
    });
    if (process.env.LIVE_WHISPER_ASSERT === '1') {
      expect(res.body.whisper.ok).toBe(true);
      expect(res.body.ffmpeg.ok).toBe(true);
    }
  });
});
