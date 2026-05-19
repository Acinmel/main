import * as os from 'node:os';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { DatabaseService } from '../../database/database.service';
import type { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import { HealthService } from './health.service';

type ConfigMap = Record<string, string | undefined>;

function makeConfig(values: ConfigMap): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function makeHealthService(options?: {
  config?: ConfigMap;
  ffmpeg?: { ok: boolean; path: string; versionHint?: string; error?: string };
  mysqlRows?: Array<{
    tableName: string;
    columnName: string;
    dataType: string;
  }>;
}): {
  service: HealthService;
  db: {
    queryOne: jest.Mock;
    queryAll: jest.Mock;
  };
} {
  const sqliteSchema: Record<string, Array<{ name: string; type: string }>> = {
    digital_human_templates: [
      { name: 'output_relative_path', type: 'TEXT' },
      { name: 'selfie_relative_path', type: 'TEXT' },
    ],
    user_works: [
      { name: 'content', type: 'TEXT' },
      { name: 'transcript_text', type: 'TEXT' },
      { name: 'rewrite_text', type: 'TEXT' },
      { name: 'source_video_url', type: 'TEXT' },
      { name: 'output_video_url', type: 'TEXT' },
      { name: 'task_payload_json', type: 'TEXT' },
    ],
    task_statuses: [
      { name: 'payload_json', type: 'TEXT' },
      { name: 'result_json', type: 'TEXT' },
      { name: 'error', type: 'TEXT' },
    ],
    avatar_resources: [
      { name: 'cover_url', type: 'TEXT' },
      { name: 'source_video_url', type: 'TEXT' },
    ],
    voice_resources: [
      { name: 'audio_url', type: 'TEXT' },
      { name: 'clone_error', type: 'TEXT' },
    ],
    subtitle_template_resources: [
      { name: 'cover_url', type: 'TEXT' },
      { name: 'preview_url', type: 'TEXT' },
      { name: 'style_json', type: 'TEXT' },
    ],
    audit_logs: [{ name: 'detail', type: 'TEXT' }],
  };

  const db = {
    queryOne: jest.fn(() => Promise.resolve({ ok: 1 })),
    queryAll: jest.fn((sql: string) => {
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return Promise.resolve(options?.mysqlRows ?? []);
      }
      const match = sql.match(/PRAGMA table_info\(([^)]+)\)/i);
      const table = match?.[1]?.trim();
      return Promise.resolve(table ? (sqliteSchema[table] ?? []) : []);
    }),
  };

  const config = makeConfig({
    TEMP_DIR: os.tmpdir(),
    UPLOAD_DIR: os.tmpdir(),
    VIDEO_SAVE_DIR: os.tmpdir(),
    PREVIEW_VIDEO_SAVE_DIR: os.tmpdir(),
    PREVIEW_AUDIO_SAVE_DIR: os.tmpdir(),
    DIGITAL_HUMAN_STORAGE_DIR: os.tmpdir(),
    LIP_SYNC_PUBLIC_MEDIA_DIR: os.tmpdir(),
    VOICE_SAMPLE_DIR: os.tmpdir(),
    ASR_FUNASR_SCRIPT: __filename,
    ...options?.config,
  });

  const ffmpegAudio = {
    probeBinary: jest.fn(() =>
      Promise.resolve({
        ok: options?.ffmpeg?.ok ?? true,
        path: options?.ffmpeg?.path ?? 'ffmpeg',
        versionHint: options?.ffmpeg?.versionHint ?? 'ffmpeg version test',
        error: options?.ffmpeg?.error,
      }),
    ),
  };

  const service = new HealthService(
    config,
    db as unknown as DatabaseService,
    ffmpegAudio as unknown as FfmpegAudioService,
  );
  jest
    .spyOn(
      service as unknown as { checkCommand: HealthService['deep'] },
      'checkCommand',
    )
    .mockResolvedValue({ ok: true, path: 'bin' });

  return { service, db };
}

describe('HealthService deep checks', () => {
  it('returns minimal fields for public basic health', () => {
    const { service } = makeHealthService();

    const result = service.basic();

    expect(result.ok).toBe(true);
    expect(result.app).toBe('shuziren-api');
    expect(typeof result.version).toBe('string');
  });

  it('passes sqlite schema validation without INFORMATION_SCHEMA', async () => {
    const { service, db } = makeHealthService();

    const result = await service.deep();

    expect(result.checks.ffmpeg.ok).toBe(true);
    expect(result.checks.ffmpeg).toEqual({ ok: true });
    expect(result.checks.schema.ok).toBe(true);
    expect(result).not.toHaveProperty('build');
    expect(result).not.toHaveProperty('nodeEnv');
    expect(result.ok).toBe(true);
    expect(db.queryAll).toHaveBeenCalledWith(
      expect.stringMatching(/^PRAGMA table_info\(/),
    );
  });

  it('validates mysql schema with information_schema and reports mismatches', async () => {
    const { service } = makeHealthService({
      config: { MYSQL_DATABASE: 'shuziren' },
      mysqlRows: [
        {
          tableName: 'voice_resources',
          columnName: 'audio_url',
          dataType: 'text',
        },
      ],
    });

    const result = await service.deep();

    expect(result.checks.schema.ok).toBe(false);
    expect(result.checks.schema).toEqual({ ok: false });
  });

  it('returns detailed deep health only when detailed option is enabled', async () => {
    const { service } = makeHealthService();

    const result = await service.deep({ detailed: true });

    expect(result).toHaveProperty('build');
    expect(result).toHaveProperty('nodeEnv');
    expect(result.checks.ffmpeg.path).toBe('ffmpeg');
  });

  it('allows detailed health by token or loopback request', () => {
    const { service } = makeHealthService({
      config: { HEALTH_DEEP_TOKEN: 'token-123' },
    });

    const tokenReq = {
      headers: { 'x-health-token': 'token-123' },
      ip: '10.0.0.9',
      socket: { remoteAddress: '10.0.0.9' },
    } as unknown as Request;
    const loopbackReq = {
      headers: {},
      ip: '::1',
      socket: { remoteAddress: '::1' },
    } as unknown as Request;
    const deniedReq = {
      headers: {},
      ip: '10.0.0.9',
      socket: { remoteAddress: '10.0.0.9' },
    } as unknown as Request;

    expect(service.allowDetailedHealth(tokenReq)).toBe(true);
    expect(service.allowDetailedHealth(loopbackReq)).toBe(true);
    expect(service.allowDetailedHealth(deniedReq)).toBe(false);
  });
});
