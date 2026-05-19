import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { Request } from 'express';
import { DatabaseService } from '../../database/database.service';
import { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';

const execFileAsync = promisify(execFile);

type HealthCheck = {
  ok: boolean;
  path?: string;
  value?: string;
  error?: string;
  details?: unknown;
};

type BuildInfo = {
  buildTime?: string;
  gitCommit?: string;
  version?: string;
  includedFiles?: string[];
};

type DeepCheckSet = {
  database: HealthCheck;
  storage: HealthCheck;
  asrScript: HealthCheck;
  python: HealthCheck;
  ffmpeg: HealthCheck;
  ytdlp: HealthCheck;
  schema: HealthCheck;
};

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly ffmpegAudio: FfmpegAudioService,
  ) {}

  basic() {
    return {
      ok: true,
      app: 'shuziren-api',
      version: this.resolveVersion(),
    };
  }

  async deep(options?: { detailed?: boolean }) {
    const detailed = options?.detailed === true;
    const [database, storage, asrScript, python, ffmpeg, ytdlp, schema] =
      await Promise.all([
        this.checkDatabase(),
        Promise.resolve(this.checkStorage()),
        Promise.resolve(this.checkAsrScript()),
        this.checkCommand(this.resolvePythonBin(), ['--version']),
        this.checkFfmpeg(),
        this.checkCommand(this.resolveYtdlpBin(), ['--version']),
        this.checkDatabaseSchema(),
      ]);

    const checks: DeepCheckSet = {
      database,
      storage,
      asrScript,
      python,
      ffmpeg,
      ytdlp,
      schema,
    };
    const ok = Object.values(checks).every((item) => item.ok);
    const summaryChecks = this.toSummaryChecks(checks);

    if (!detailed) {
      return {
        ok,
        app: 'shuziren-api',
        version: this.resolveVersion(),
        checks: summaryChecks,
      };
    }

    return {
      ok,
      app: 'shuziren-api',
      version: this.resolveVersion(),
      nodeEnv: process.env.NODE_ENV || 'development',
      build: this.readBuildInfo(),
      checks,
    };
  }

  allowDetailedHealth(req: Request): boolean {
    const expectedToken = this.config.get<string>('HEALTH_DEEP_TOKEN')?.trim();
    const headerValue = req.headers['x-health-token'];
    const providedToken = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue;
    if (expectedToken && providedToken === expectedToken) {
      return true;
    }
    return (
      this.isLoopbackIp(req.ip) || this.isLoopbackIp(req.socket.remoteAddress)
    );
  }

  private async checkDatabase(): Promise<HealthCheck> {
    try {
      const row = await this.db.queryOne<{ ok: number }>('SELECT 1 AS ok');
      return { ok: row?.ok === 1, details: row };
    } catch (e) {
      return { ok: false, error: this.errorMessage(e) };
    }
  }

  private async checkDatabaseSchema(): Promise<HealthCheck> {
    if (this.isMysqlDatabase()) {
      return this.checkMysqlDatabaseSchema();
    }
    return this.checkSqliteDatabaseSchema();
  }

  private async checkMysqlDatabaseSchema(): Promise<HealthCheck> {
    const expected = [
      'digital_human_templates.output_relative_path',
      'digital_human_templates.selfie_relative_path',
      'user_works.content',
      'user_works.transcript_text',
      'user_works.rewrite_text',
      'user_works.source_video_url',
      'user_works.output_video_url',
      'user_works.task_payload_json',
      'task_statuses.payload_json',
      'task_statuses.result_json',
      'task_statuses.error',
      'avatar_resources.cover_url',
      'avatar_resources.source_video_url',
      'voice_resources.audio_url',
      'voice_resources.clone_error',
      'subtitle_template_resources.cover_url',
      'subtitle_template_resources.preview_url',
      'subtitle_template_resources.style_json',
      'audit_logs.detail',
    ];

    try {
      const rows = await this.db.queryAll<{
        tableName: string;
        columnName: string;
        dataType: string;
      }>(
        `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND CONCAT(TABLE_NAME, '.', COLUMN_NAME) IN (${expected.map(() => '?').join(',')})`,
        expected,
      );
      const mismatches = rows
        .filter((row) => row.dataType?.toLowerCase() !== 'longtext')
        .map((row) => `${row.tableName}.${row.columnName}:${row.dataType}`);
      return {
        ok: rows.length === expected.length && mismatches.length === 0,
        details: {
          dialect: 'mysql',
          expected: expected.length,
          found: rows.length,
          mismatches,
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: this.errorMessage(e),
        details: 'failed to validate mysql schema by information_schema',
      };
    }
  }

  private async checkSqliteDatabaseSchema(): Promise<HealthCheck> {
    const expected: Record<string, string[]> = {
      digital_human_templates: ['output_relative_path', 'selfie_relative_path'],
      user_works: [
        'content',
        'transcript_text',
        'rewrite_text',
        'source_video_url',
        'output_video_url',
        'task_payload_json',
      ],
      task_statuses: ['payload_json', 'result_json', 'error'],
      avatar_resources: ['cover_url', 'source_video_url'],
      voice_resources: ['audio_url', 'clone_error'],
      subtitle_template_resources: ['cover_url', 'preview_url', 'style_json'],
      audit_logs: ['detail'],
    };

    try {
      const missing: string[] = [];
      const mismatches: string[] = [];
      for (const [table, columns] of Object.entries(expected)) {
        const rows = await this.db.queryAll<{
          name?: string;
          type?: string;
        }>(`PRAGMA table_info(${table})`);
        const byName = new Map(
          rows
            .filter((row) => typeof row.name === 'string')
            .map((row) => [String(row.name).toLowerCase(), row]),
        );
        for (const column of columns) {
          const meta = byName.get(column.toLowerCase());
          if (!meta) {
            missing.push(`${table}.${column}`);
            continue;
          }
          const sqliteType = String(meta.type ?? '').toUpperCase();
          if (
            sqliteType &&
            !sqliteType.includes('TEXT') &&
            !sqliteType.includes('CHAR') &&
            !sqliteType.includes('CLOB')
          ) {
            mismatches.push(`${table}.${column}:${sqliteType}`);
          }
        }
      }

      return {
        ok: missing.length === 0 && mismatches.length === 0,
        details: {
          dialect: 'sqlite',
          missing,
          mismatches,
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: this.errorMessage(e),
        details: 'failed to validate sqlite schema',
      };
    }
  }

  private checkStorage(): HealthCheck {
    const dirs = [
      ['TEMP_DIR', this.config.get<string>('TEMP_DIR') || '/tmp'],
      ['UPLOAD_DIR', this.config.get<string>('UPLOAD_DIR') || 'uploads'],
      [
        'VIDEO_SAVE_DIR',
        this.config.get<string>('VIDEO_SAVE_DIR') ||
          path.join(process.cwd(), 'data', 'download-video'),
      ],
      [
        'PREVIEW_VIDEO_SAVE_DIR',
        this.config.get<string>('PREVIEW_VIDEO_SAVE_DIR') ||
          path.join(process.cwd(), 'data', 'preview-videos'),
      ],
      [
        'PREVIEW_AUDIO_SAVE_DIR',
        this.config.get<string>('PREVIEW_AUDIO_SAVE_DIR') ||
          path.join(process.cwd(), 'data', 'preview-audios'),
      ],
      [
        'DIGITAL_HUMAN_STORAGE_DIR',
        this.config.get<string>('DIGITAL_HUMAN_STORAGE_DIR') ||
          path.join(process.cwd(), 'data', 'digital-humans'),
      ],
      [
        'LIP_SYNC_PUBLIC_MEDIA_DIR',
        this.config.get<string>('LIP_SYNC_PUBLIC_MEDIA_DIR') ||
          path.join(process.cwd(), 'data', 'lip-sync-public'),
      ],
      [
        'VOICE_SAMPLE_DIR',
        this.config.get<string>('VOICE_SAMPLE_DIR') ||
          path.join(process.cwd(), 'data', 'voice-samples'),
      ],
    ];
    const results = dirs.map(([name, raw]) => {
      const dir = path.resolve(String(raw));
      const ok = this.canWrite(dir);
      return { name, path: dir, ok };
    });
    return {
      ok: results.every((item) => item.ok),
      details: results,
    };
  }

  private checkAsrScript(): HealthCheck {
    const script = this.resolveAsrScript();
    return {
      ok: Boolean(script && existsSync(script)),
      path: script,
      error: script && existsSync(script) ? undefined : 'ASR script not found',
    };
  }

  private async checkCommand(
    command: string,
    args: string[],
  ): Promise<HealthCheck> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        timeout: 10_000,
        windowsHide: true,
      });
      const value = `${stdout || stderr}`.split('\n')[0]?.trim();
      return { ok: true, path: command, value };
    } catch (e) {
      return { ok: false, path: command, error: this.errorMessage(e) };
    }
  }

  private async checkFfmpeg(): Promise<HealthCheck> {
    const result = await this.ffmpegAudio.probeBinary();
    return {
      ok: result.ok,
      path: result.path,
      value: result.versionHint,
      error: result.error,
    };
  }

  private resolveAsrScript(): string {
    const fromEnv = this.config.get<string>('ASR_FUNASR_SCRIPT')?.trim();
    if (fromEnv) return path.resolve(fromEnv);
    const candidates = [
      path.join(process.cwd(), 'scripts', 'dashscope_funasr_transcribe.py'),
      path.join(
        process.cwd(),
        'backend',
        'scripts',
        'dashscope_funasr_transcribe.py',
      ),
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        'scripts',
        'dashscope_funasr_transcribe.py',
      ),
    ];
    return (
      candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
    );
  }

  private resolvePythonBin(): string {
    return (
      this.config.get<string>('ASR_PYTHON_BIN')?.trim() ||
      this.config.get<string>('PYTHON_BIN')?.trim() ||
      (process.platform === 'win32' ? 'py' : 'python3')
    );
  }

  private resolveYtdlpBin(): string {
    return this.config.get<string>('YTDLP_BIN')?.trim() || 'yt-dlp';
  }

  private isMysqlDatabase(): boolean {
    return Boolean(this.config.get<string>('MYSQL_DATABASE')?.trim());
  }

  private resolveVersion(): string {
    return this.readBuildInfo().version?.trim() || 'unknown';
  }

  private toSummaryChecks(
    checks: DeepCheckSet,
  ): Record<keyof DeepCheckSet, { ok: boolean }> {
    return {
      database: { ok: checks.database.ok },
      storage: { ok: checks.storage.ok },
      asrScript: { ok: checks.asrScript.ok },
      python: { ok: checks.python.ok },
      ffmpeg: { ok: checks.ffmpeg.ok },
      ytdlp: { ok: checks.ytdlp.ok },
      schema: { ok: checks.schema.ok },
    };
  }

  private readBuildInfo(): BuildInfo {
    const candidates = [
      path.join(process.cwd(), 'BUILD_INFO.json'),
      path.join(process.cwd(), 'backend', 'BUILD_INFO.json'),
      path.join(__dirname, '..', '..', '..', 'BUILD_INFO.json'),
    ];
    for (const candidate of candidates) {
      try {
        if (!existsSync(candidate)) continue;
        return JSON.parse(readFileSync(candidate, 'utf8')) as BuildInfo;
      } catch {
        continue;
      }
    }
    return {
      buildTime: process.env.BUILD_TIME_UTC,
      gitCommit: process.env.GIT_COMMIT,
      version: process.env.APP_VERSION,
    };
  }

  private canWrite(dir: string): boolean {
    try {
      accessSync(dir, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  private errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  private isLoopbackIp(value?: string | null): boolean {
    if (!value) return false;
    const normalized = value.replace(/^::ffff:/, '');
    return normalized === '127.0.0.1' || normalized === '::1';
  }
}
