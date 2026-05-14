process.env.REGISTRATION_DEFAULT_ACCOUNT_STATUS = 'active';
process.env.AI_MOCK_FALLBACK = 'true';
process.env.ALI_VIDEORETALK_USE_TEMP_UPLOAD = 'false';

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureHttpApp } from '../src/app.config';
import { AppModule } from '../src/app.module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * 口播转写链路 HTTP 自检（不跑真实 ASR 推理）。
 * 需能加载 backend/.env（ConfigModule.forRoot 默认从 cwd 读 .env）。
 *
 * 若已配置可用的 ASR / OpenAI 密钥，可设环境变量强制断言 ASR 健康检查通过：
 *   LIVE_ASR_ASSERT=1 npm run test:e2e -- tools-pipeline
 */
describe('Tools transcribe pipeline (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication<App>;
  let authToken: string;
  let tmpDir: string;
  let videoDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shuziren-tools-e2e-'));
    videoDir = path.join(tmpDir, 'videos');
    process.env.SQLITE_PATH = path.join(tmpDir, 'tools-e2e.db');
    process.env.JWT_SECRET = 'tools-e2e-secret';
    process.env.VIDEO_SAVE_DIR = videoDir;

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
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it('GET /api/v1/tools/asr-health returns JSON shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tools/asr-health')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body).toMatchObject({
      ok: expect.any(Boolean),
      transcribeUrlConfigured: expect.any(Boolean),
      healthUrl: expect.any(String),
      latencyMs: expect.any(Number),
    });
    if (process.env.LIVE_ASR_ASSERT === '1') {
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
      asr: expect.objectContaining({
        ok: expect.any(Boolean),
        transcribeUrlConfigured: expect.any(Boolean),
        healthUrl: expect.any(String),
        latencyMs: expect.any(Number),
      }),
      dyCookieConfigured: expect.any(Boolean),
    });
    if (process.env.LIVE_ASR_ASSERT === '1') {
      expect(res.body.asr.ok).toBe(true);
      expect(res.body.ffmpeg.ok).toBe(true);
    }
  });

  it('POST /api/v1/tools/transcribe returns mock transcript when no ASR key is configured', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tools/transcribe')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', Buffer.from('fake wav payload'), {
        filename: 'sample.wav',
        contentType: 'audio/wav',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      transcriptId: expect.any(String),
      fullText: expect.stringContaining('模拟口播原文稿'),
      language: 'zh-CN',
      segments: expect.any(Array),
      provider: 'asr-api',
    });
    expect(res.body.segments.length).toBeGreaterThan(0);
  });

  it('POST /api/v1/tools/optimize-oral-script returns hooked oral script shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tools/optimize-oral-script')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sourceText:
          '今天我们聊一个很实用的话题，就是怎么把原始转写内容整理成更适合短视频口播的文案。',
      })
      .expect(201);

    expect(res.body).toMatchObject({
      hook3s: expect.any(String),
      hook10s: expect.any(String),
      optimizedScript: expect.any(String),
      strategyId: expect.any(String),
      strategyLabel: expect.any(String),
      llmUsed: expect.any(Boolean),
    });
    expect(res.body.hook3s.length).toBeGreaterThan(0);
    expect(res.body.hook10s.length).toBeGreaterThan(0);
    expect(res.body.optimizedScript.length).toBeGreaterThan(0);
  });

  it('POST /api/v1/tools/lip-sync-preview fails fast when VideoReTalk public media URL is unavailable', async () => {
    fs.mkdirSync(videoDir, { recursive: true });
    const localVideoName = 'avatar-source.mp4';
    fs.writeFileSync(path.join(videoDir, localVideoName), Buffer.from('fake mp4 payload'));

    const avatar = await request(app.getHttpServer())
      .post('/api/v1/resources/avatars')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: '测试视频素材',
        originalVideoUrl: localVideoName,
      })
      .expect(201);

    const voice = await request(app.getHttpServer())
      .post('/api/v1/resources/voices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: '测试音色' })
      .expect(201);

    const preview = await request(app.getHttpServer())
      .post('/api/v1/tools/lip-sync-preview')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        script: '这是用于联调的测试文案。',
        avatarResourceId: avatar.body.id,
        voiceResourceId: voice.body.id,
      })
      .expect(400);

    expect(preview.body.message).toContain('VideoReTalk');
    expect(preview.body.message).toContain('PUBLIC_BASE_URL');
  });

  it('POST /api/v1/tools/subtitle-workflow-preview requires VideoReTalk readiness', async () => {
    fs.mkdirSync(videoDir, { recursive: true });
    const sourcePath = path.join(videoDir, 'workflow-source.mp4');
    fs.writeFileSync(sourcePath, Buffer.from('fake mp4 payload'));

    const avatar = await request(app.getHttpServer())
      .post('/api/v1/resources/avatars')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: '字幕流程测试视频',
        originalVideoUrl: path.basename(sourcePath),
      })
      .expect(201);

    const voice = await request(app.getHttpServer())
      .post('/api/v1/resources/voices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: '测试音色' })
      .expect(201);

    const subtitleTemplates = await request(app.getHttpServer())
      .get('/api/v1/resources/subtitle-templates?scope=all&limit=20')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const templateId = subtitleTemplates.body.items?.[0]?.id as string | undefined;
    expect(templateId).toBeTruthy();

    const preview = await request(app.getHttpServer())
      .post('/api/v1/tools/subtitle-workflow-preview')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        script: '这是新的字幕流程联调文案，用来验证预览、时间轴和最终成片。',
        avatarResourceId: avatar.body.id,
        voiceResourceId: voice.body.id,
        subtitleTemplateId: templateId,
        previewSeconds: 5,
      })
      .expect(400);

    expect(preview.body.message).toContain('VideoReTalk');
    expect(preview.body.message).toContain('PUBLIC_BASE_URL');
  });
});
