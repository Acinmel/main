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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

describe('Tools transcribe pipeline (e2e)', () => {
  jest.setTimeout(120_000);

  let app: INestApplication<App>;
  let authToken = '';
  let tmpDir = '';
  let videoDir = '';

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

    const email = '447519854@qq.com';
    const phoneTail = String(Date.now() % 1_000_000_000).padStart(9, '0');
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'password12',
        phoneNumber: `13${phoneTail}`,
        idCardNumber: '11010519491231002X',
      });
    expect([200, 201]).toContain(reg.status);
    authToken = readString(asRecord(reg.body), 'token') || '';
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

    const body = asRecord(res.body);
    expect(typeof readBoolean(body, 'ok')).toBe('boolean');
    expect(typeof readBoolean(body, 'transcribeUrlConfigured')).toBe('boolean');
    expect(typeof readString(body, 'healthUrl')).toBe('string');
    expect(typeof body.latencyMs).toBe('number');

    if (process.env.LIVE_ASR_ASSERT === '1') {
      expect(readBoolean(body, 'ok')).toBe(true);
    }
  });

  it('GET /api/v1/tools/digital-human-env exposes only capability booleans', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tools/digital-human-env')
      .expect(200);

    const body = asRecord(res.body);
    expect(typeof readBoolean(body, 'arkConfigured')).toBe('boolean');
    expect(typeof readBoolean(body, 'seedreamConfigured')).toBe('boolean');
    expect(typeof readBoolean(body, 'remoteConfigured')).toBe('boolean');
    expect(Object.prototype.hasOwnProperty.call(body, 'arkKeyLength')).toBe(
      false,
    );
  });

  it('GET /api/v1/tools/transcribe-pipeline-health returns full pipeline shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/tools/transcribe-pipeline-health')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const body = asRecord(res.body);
    const videoSaveDir = asRecord(body.videoSaveDir);
    const ffmpeg = asRecord(body.ffmpeg);
    const asr = asRecord(body.asr);
    expect(typeof readString(videoSaveDir, 'path')).toBe('string');
    expect(typeof readBoolean(videoSaveDir, 'writable')).toBe('boolean');
    expect(typeof readBoolean(ffmpeg, 'ok')).toBe('boolean');
    expect(typeof readString(ffmpeg, 'path')).toBe('string');
    expect(typeof readBoolean(asr, 'ok')).toBe('boolean');
    expect(typeof readBoolean(asr, 'transcribeUrlConfigured')).toBe('boolean');
    expect(typeof readString(asr, 'healthUrl')).toBe('string');
    expect(typeof asr.latencyMs).toBe('number');
    expect(typeof readBoolean(body, 'dyCookieConfigured')).toBe('boolean');

    if (process.env.LIVE_ASR_ASSERT === '1') {
      expect(readBoolean(asRecord(body.asr), 'ok')).toBe(true);
      expect(readBoolean(asRecord(body.ffmpeg), 'ok')).toBe(true);
    }
  });

  it('POST /api/v1/tools/transcribe returns transcript shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tools/transcribe')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', Buffer.from('fake wav payload'), {
        filename: 'sample.wav',
        contentType: 'audio/wav',
      })
      .expect(201);

    const body = asRecord(res.body);
    expect(typeof readString(body, 'transcriptId')).toBe('string');
    expect(typeof readString(body, 'fullText')).toBe('string');
    expect(readString(body, 'language')).toBe('zh-CN');
    expect(readString(body, 'provider')).toBe('asr-api');
    const segments = body.segments;
    expect(Array.isArray(segments)).toBe(true);
    expect((segments as unknown[]).length).toBeGreaterThan(0);
  });

  it('POST /api/v1/tools/optimize-oral-script returns shape', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/tools/optimize-oral-script')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sourceText:
          'This is a test source text for optimize oral script endpoint.',
      })
      .expect(201);

    const body = asRecord(res.body);
    expect(typeof readString(body, 'hook3s')).toBe('string');
    expect(typeof readString(body, 'hook10s')).toBe('string');
    expect(typeof readString(body, 'optimizedScript')).toBe('string');
    expect(typeof readString(body, 'strategyId')).toBe('string');
    expect(typeof readString(body, 'strategyLabel')).toBe('string');
    expect(typeof readBoolean(body, 'llmUsed')).toBe('boolean');
  });

  it('GET/POST /api/v1/tools/recent-extractions stores current user records', async () => {
    const initial = await request(app.getHttpServer())
      .get('/api/v1/tools/recent-extractions?limit=6')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const initialBody = asRecord(initial.body);
    expect(Array.isArray(initialBody.items)).toBe(true);

    const sourceUrl = `https://example.com/video-${Date.now()}`;
    const saved = await request(app.getHttpServer())
      .post('/api/v1/tools/recent-extractions')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        sourceUrl,
        platform: 'e2e',
        title: 'Recent extraction e2e',
        summary: 'saved from e2e',
      })
      .expect(201);

    const savedItem = asRecord(asRecord(saved.body).item);
    expect(readString(savedItem, 'sourceUrl')).toBe(sourceUrl);
    expect(readString(savedItem, 'title')).toBe('Recent extraction e2e');

    const listed = await request(app.getHttpServer())
      .get('/api/v1/tools/recent-extractions?limit=6')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const items = asRecord(listed.body).items;
    expect(Array.isArray(items)).toBe(true);
    expect(
      (items as unknown[]).some(
        (item) => readString(asRecord(item), 'sourceUrl') === sourceUrl,
      ),
    ).toBe(true);
  });

  it('legacy high-risk tools endpoints are disabled by default', async () => {
    const endpoints = [
      '/api/v1/tools/generate-video-preview',
      '/api/v1/tools/seedance-i2v-async',
      '/api/v1/tools/ark-i2v-task',
      '/api/v1/tools/upload-video',
      '/api/v1/tools/upload-audio',
      '/api/v1/tools/generate-lip-sync-video',
      '/api/v1/tools/ali-lip-sync',
      '/api/v1/tools/lip-sync-preview',
      '/api/v1/tools/voice-preview',
    ];
    for (const endpoint of endpoints) {
      const res = await request(app.getHttpServer())
        .post(endpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(410);
      const body = asRecord(res.body);
      expect(readString(body, 'code')).toBe('LEGACY_ENDPOINT_DISABLED');
      expect(readString(body, 'enableFlag')).toBe(
        'ENABLE_LEGACY_TOOLS_ENDPOINTS',
      );
    }
  });

  it('legacy v1 tasks/works mutating endpoints are disabled by default', async () => {
    const endpoints: Array<{ method: 'post' | 'patch'; path: string }> = [
      { method: 'post', path: '/api/v1/tasks' },
      { method: 'post', path: '/api/v1/tasks/legacy-id/photo' },
      { method: 'post', path: '/api/v1/tasks/legacy-id/extract' },
      { method: 'post', path: '/api/v1/tasks/legacy-id/retry' },
      { method: 'post', path: '/api/v1/tasks/legacy-id/rewrite/suggest' },
      { method: 'post', path: '/api/v1/tasks/legacy-id/rewrite' },
      { method: 'post', path: '/api/v1/tasks/legacy-id/render' },
      { method: 'patch', path: '/api/v1/works/legacy-id' },
    ];

    for (const endpoint of endpoints) {
      const reqBuilder = request(app.getHttpServer())[endpoint.method](
        endpoint.path,
      )
        .set('Authorization', `Bearer ${authToken}`)
        .send({});
      const res = await reqBuilder.expect(410);
      const body = asRecord(res.body);
      expect(readString(body, 'code')).toBe('LEGACY_ENDPOINT_DISABLED');
      expect(readString(body, 'enableFlag')).toBe(
        'ENABLE_LEGACY_TASKS_ENDPOINTS',
      );
    }
  });

  it('core project-scoped audio + subtitle timeline flow works and is not blocked by legacy kill-switch', async () => {
    const projectCreate = await request(app.getHttpServer())
      .post('/api/v1/video-projects')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: `core-flow-${Date.now()}`,
      });
    expect([200, 201]).toContain(projectCreate.status);
    const projectBody = asRecord(projectCreate.body);
    const projectId =
      readString(projectBody, 'projectId') ?? readString(projectBody, 'id');
    expect(projectId).toBeTruthy();

    const audioGenerate = await request(app.getHttpServer())
      .post('/api/v1/audio-assets/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        text: '这里是核心流程联调用的音频生成文案。',
        voiceRate: 1.05,
      });
    expect([200, 201]).toContain(audioGenerate.status);
    const audioBody = asRecord(audioGenerate.body);
    expect(readString(audioBody, 'code')).not.toBe('LEGACY_ENDPOINT_DISABLED');
    const audioAssetId = readString(audioBody, 'audioAssetId');
    expect(audioAssetId).toBeTruthy();

    const scriptSegments = ['这里是核心流程联调', '用于字幕时间轴', '必须按分段返回'];
    const subtitleCreate = await request(app.getHttpServer())
      .post(
        `/api/v1/audio-assets/${encodeURIComponent(
          audioAssetId as string,
        )}/subtitle-track`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        projectId,
        scriptText: scriptSegments.join('，'),
        scriptSegments,
      });
    expect([200, 201]).toContain(subtitleCreate.status);
    const subtitleBody = asRecord(subtitleCreate.body);
    expect(readString(subtitleBody, 'source')).toBe('tts_alignment');
    const subtitles = subtitleBody.subtitles as unknown;
    expect(Array.isArray(subtitles)).toBe(true);
    expect((subtitles as unknown[]).length).toBe(scriptSegments.length);
    const subtitleTrackId = readString(subtitleBody, 'subtitleTrackId');
    expect(subtitleTrackId).toBeTruthy();

    const stageState = await request(app.getHttpServer())
      .get(
        `/api/v1/video-projects/${encodeURIComponent(
          projectId as string,
        )}/stage-state`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const stageBody = asRecord(stageState.body);
    expect(readString(stageBody, 'audioAssetId')).toBe(audioAssetId);
    expect(readString(stageBody, 'subtitleTrackId')).toBe(subtitleTrackId);
  });

  it('POST /api/v1/tools/subtitle-workflow-preview is guarded and fails safely', async () => {
    const preview = await request(app.getHttpServer())
      .post('/api/v1/tools/subtitle-workflow-preview')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        script: 'test script for subtitle-workflow-preview',
        avatarResourceId: 'missing-avatar',
        voiceResourceId: 'missing-voice',
        subtitleTemplateId: 'missing-template',
        previewSeconds: 5,
      });

    expect([400, 403, 404]).toContain(preview.status);
  });
});
