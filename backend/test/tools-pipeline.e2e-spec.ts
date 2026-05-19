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

    const email = `e2e-pipeline-${Date.now()}@test.local`;
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'password12' });
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

  it('POST /api/v1/tools/lip-sync-preview fails fast when VideoReTalk public media URL is unavailable', async () => {
    fs.mkdirSync(videoDir, { recursive: true });
    const localVideoName = 'avatar-source.mp4';
    fs.writeFileSync(
      path.join(videoDir, localVideoName),
      Buffer.from('fake mp4 payload'),
    );

    const avatarRes = await request(app.getHttpServer())
      .post('/api/v1/resources/avatars')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'test-avatar', originalVideoUrl: localVideoName })
      .expect(201);
    const avatarId = readString(asRecord(avatarRes.body), 'id') || '';
    expect(avatarId).toBeTruthy();

    const voiceRes = await request(app.getHttpServer())
      .post('/api/v1/resources/voices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'test-voice',
        provider: 'aliyun-qwen-vc',
        providerVoice: 'e2e-provider-voice',
        providerModel: 'e2e-provider-model',
      })
      .expect(201);
    const voiceId = readString(asRecord(voiceRes.body), 'id') || '';
    expect(voiceId).toBeTruthy();

    const preview = await request(app.getHttpServer())
      .post('/api/v1/tools/lip-sync-preview')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        script: 'test script for lip-sync-preview',
        avatarResourceId: avatarId,
        voiceResourceId: voiceId,
      })
      .expect(400);

    const message = readString(asRecord(preview.body), 'message') || '';
    expect(message).toContain('VideoReTalk');
    expect(message).toContain('PUBLIC_BASE_URL');
  });

  it('POST /api/v1/tools/subtitle-workflow-preview requires VideoReTalk readiness', async () => {
    fs.mkdirSync(videoDir, { recursive: true });
    const sourcePath = path.join(videoDir, 'workflow-source.mp4');
    fs.writeFileSync(sourcePath, Buffer.from('fake mp4 payload'));

    const avatarRes = await request(app.getHttpServer())
      .post('/api/v1/resources/avatars')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'workflow-avatar',
        originalVideoUrl: path.basename(sourcePath),
      })
      .expect(201);
    const avatarId = readString(asRecord(avatarRes.body), 'id') || '';
    expect(avatarId).toBeTruthy();

    const voiceRes = await request(app.getHttpServer())
      .post('/api/v1/resources/voices')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        name: 'workflow-voice',
        provider: 'aliyun-qwen-vc',
        providerVoice: 'e2e-provider-voice',
        providerModel: 'e2e-provider-model',
      })
      .expect(201);
    const voiceId = readString(asRecord(voiceRes.body), 'id') || '';
    expect(voiceId).toBeTruthy();

    const subtitleTemplates = await request(app.getHttpServer())
      .get('/api/v1/resources/subtitle-templates?scope=all&limit=20')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    const subtitleBody = asRecord(subtitleTemplates.body);
    const items = Array.isArray(subtitleBody.items)
      ? (subtitleBody.items as unknown[])
      : [];
    const templateId = readString(
      items.length > 0 ? asRecord(items[0]) : {},
      'id',
    );
    expect(templateId).toBeTruthy();

    const preview = await request(app.getHttpServer())
      .post('/api/v1/tools/subtitle-workflow-preview')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        script: 'test script for subtitle-workflow-preview',
        avatarResourceId: avatarId,
        voiceResourceId: voiceId,
        subtitleTemplateId: templateId,
        previewSeconds: 5,
      })
      .expect(400);

    const message = readString(asRecord(preview.body), 'message') || '';
    expect(message).toContain('VideoReTalk');
    expect(message).toContain('PUBLIC_BASE_URL');
  });
});
