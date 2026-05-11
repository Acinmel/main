import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'mysql2/promise';
import mysql from 'mysql2/promise';

/**
 * 持久化：优先 MySQL（线上/商业化推荐），未配置 MYSQL_DATABASE 时回退 SQLite（本地零依赖）。
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private sqlite: Database.Database | null = null;
  private mysqlPool: Pool | null = null;

  constructor(private readonly config: ConfigService) {}

  private useMysql(): boolean {
    return Boolean(this.config.get<string>('MYSQL_DATABASE')?.trim());
  }

  async onModuleInit(): Promise<void> {
    if (this.useMysql()) {
      const host = this.config.get<string>('MYSQL_HOST')?.trim() || '127.0.0.1';
      const port = Number(this.config.get<string>('MYSQL_PORT') || '3306') || 3306;
      const user = this.config.get<string>('MYSQL_USER')?.trim() || 'root';
      const password = this.config.get<string>('MYSQL_PASSWORD') ?? '';
      const database = this.config.get<string>('MYSQL_DATABASE')!.trim();

      this.mysqlPool = mysql.createPool({
        host,
        port,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        charset: 'utf8mb4',
      });
      await this.migrateMysql();
      await this.ensureGovernanceMysql();
      this.logger.log(`MySQL 已就绪：${user}@${host}:${port}/${database}`);
      return;
    }

    const dbPath =
      this.config.get<string>('SQLITE_PATH')?.trim() ||
      path.join(process.cwd(), 'data', 'app.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.migrateSqlite();
    this.ensureGovernanceSqlite();
    this.logger.log(`SQLite 已就绪：${dbPath}`);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.mysqlPool?.end();
    } catch {
      /* noop */
    }
    try {
      this.sqlite?.close();
    } catch {
      /* noop */
    }
  }

  /** 单行查询；无结果返回 null */
  async queryOne<T extends object>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (this.mysqlPool) {
      const [rows] = await this.mysqlPool.query(sql, params);
      const arr = rows as T[];
      return arr[0] ?? null;
    }
    const row = this.sqlite!
      .prepare(sql)
      .get(...params) as T | undefined;
    return row ?? null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    if (this.mysqlPool) {
      await this.mysqlPool.execute(sql, params as (string | number | Buffer | null)[]);
      return;
    }
    this.sqlite!.prepare(sql).run(...params);
  }

  /** 多行查询 */
  async queryAll<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this.mysqlPool) {
      const [rows] = await this.mysqlPool.query(sql, params);
      return rows as T[];
    }
    return this.sqlite!.prepare(sql).all(...params) as T[];
  }

  private migrateSqlite(): void {
    this.sqlite!.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS digital_human_templates (
        user_id TEXT PRIMARY KEY NOT NULL,
        style_id TEXT NOT NULL,
        output_relative_path TEXT NOT NULL,
        selfie_relative_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS user_works (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT,
        transcript_text TEXT,
        rewrite_text TEXT,
        source_video_url TEXT NOT NULL DEFAULT '',
        output_video_url TEXT,
        digital_human_style_id TEXT,
        status TEXT NOT NULL,
        task_payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_works_user ON user_works(user_id);

      CREATE TABLE IF NOT EXISTS avatar_resources (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        name TEXT NOT NULL,
        is_recommended INTEGER NOT NULL DEFAULT 0,
        cover_url TEXT,
        source_video_url TEXT,
        style_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_avatar_resources_user ON avatar_resources(user_id);
      CREATE INDEX IF NOT EXISTS idx_avatar_resources_updated ON avatar_resources(updated_at, id);

      CREATE TABLE IF NOT EXISTS voice_resources (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        name TEXT NOT NULL,
        is_recommended INTEGER NOT NULL DEFAULT 0,
        audio_url TEXT,
        clone_status TEXT NOT NULL DEFAULT 'ready',
        provider TEXT,
        provider_voice TEXT,
        provider_model TEXT,
        sample_duration_ms INTEGER,
        clone_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_voice_resources_user ON voice_resources(user_id);
      CREATE INDEX IF NOT EXISTS idx_voice_resources_updated ON voice_resources(updated_at, id);

      CREATE TABLE IF NOT EXISTS subtitle_template_resources (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        name TEXT NOT NULL,
        is_recommended INTEGER NOT NULL DEFAULT 0,
        cover_url TEXT,
        preview_url TEXT,
        style_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_subtitle_template_resources_user ON subtitle_template_resources(user_id);
      CREATE INDEX IF NOT EXISTS idx_subtitle_template_resources_updated ON subtitle_template_resources(updated_at, id);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        ip TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
    `);
  }

  private ensureGovernanceSqlite(): void {
    const db = this.sqlite!;
    const cols = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('role')) {
      db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
    }
    if (!names.has('account_status')) {
      db.exec(
        `ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'`,
      );
    }

    const voiceCols = db
      .prepare(`PRAGMA table_info(voice_resources)`)
      .all() as { name: string }[];
    const voiceNames = new Set(voiceCols.map((c) => c.name));
    if (!voiceNames.has('provider')) {
      db.exec(`ALTER TABLE voice_resources ADD COLUMN provider TEXT`);
    }
    if (!voiceNames.has('provider_voice')) {
      db.exec(`ALTER TABLE voice_resources ADD COLUMN provider_voice TEXT`);
    }
    if (!voiceNames.has('provider_model')) {
      db.exec(`ALTER TABLE voice_resources ADD COLUMN provider_model TEXT`);
    }
    if (!voiceNames.has('sample_duration_ms')) {
      db.exec(`ALTER TABLE voice_resources ADD COLUMN sample_duration_ms INTEGER`);
    }
    if (!voiceNames.has('clone_error')) {
      db.exec(`ALTER TABLE voice_resources ADD COLUMN clone_error TEXT`);
    }
  }

  private async migrateMysql(): Promise<void> {
    const pool = this.mysqlPool!;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        UNIQUE KEY uq_users_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS digital_human_templates (
        user_id VARCHAR(36) NOT NULL PRIMARY KEY,
        style_id VARCHAR(128) NOT NULL,
        output_relative_path VARCHAR(1024) NOT NULL,
        selfie_relative_path VARCHAR(1024) NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        CONSTRAINT fk_dh_templates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_works (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        title VARCHAR(512) NOT NULL DEFAULT '',
        content TEXT NULL,
        transcript_text LONGTEXT NULL,
        rewrite_text LONGTEXT NULL,
        source_video_url VARCHAR(2048) NOT NULL DEFAULT '',
        output_video_url VARCHAR(2048) NULL,
        digital_human_style_id VARCHAR(128) NULL,
        status VARCHAR(32) NOT NULL,
        task_payload_json LONGTEXT NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_user_works_user (user_id),
        CONSTRAINT fk_user_works_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS avatar_resources (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NULL,
        name VARCHAR(255) NOT NULL,
        is_recommended TINYINT NOT NULL DEFAULT 0,
        cover_url VARCHAR(2048) NULL,
        source_video_url VARCHAR(2048) NULL,
        style_id VARCHAR(128) NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_avatar_resources_user (user_id),
        INDEX idx_avatar_resources_updated (updated_at, id),
        CONSTRAINT fk_avatar_resources_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS voice_resources (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NULL,
        name VARCHAR(255) NOT NULL,
        is_recommended TINYINT NOT NULL DEFAULT 0,
        audio_url VARCHAR(2048) NULL,
        clone_status VARCHAR(32) NOT NULL DEFAULT 'ready',
        provider VARCHAR(64) NULL,
        provider_voice VARCHAR(255) NULL,
        provider_model VARCHAR(128) NULL,
        sample_duration_ms INT NULL,
        clone_error TEXT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_voice_resources_user (user_id),
        INDEX idx_voice_resources_updated (updated_at, id),
        CONSTRAINT fk_voice_resources_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subtitle_template_resources (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NULL,
        name VARCHAR(255) NOT NULL,
        is_recommended TINYINT NOT NULL DEFAULT 0,
        cover_url VARCHAR(2048) NULL,
        preview_url VARCHAR(2048) NULL,
        style_json LONGTEXT NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_subtitle_template_resources_user (user_id),
        INDEX idx_subtitle_template_resources_updated (updated_at, id),
        CONSTRAINT fk_subtitle_template_resources_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  private async ensureGovernanceMysql(): Promise<void> {
    const pool = this.mysqlPool!;
    const hasCol = async (table: string, column: string): Promise<boolean> => {
      const [pkt] = await pool.query<any[]>(
        `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column],
      );
      const first = pkt[0];
      const c =
        typeof first?.c === 'number'
          ? first.c
          : typeof first?.C === 'number'
            ? first.C
            : 0;
      return c > 0;
    };

    if (!(await hasCol('users', 'role'))) {
      await pool.query(`ALTER TABLE users ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user'`);
    }
    if (!(await hasCol('users', 'account_status'))) {
      await pool.query(
        `ALTER TABLE users ADD COLUMN account_status VARCHAR(16) NOT NULL DEFAULT 'active'`,
      );
    }
    if (!(await hasCol('voice_resources', 'provider'))) {
      await pool.query(`ALTER TABLE voice_resources ADD COLUMN provider VARCHAR(64) NULL`);
    }
    if (!(await hasCol('voice_resources', 'provider_voice'))) {
      await pool.query(
        `ALTER TABLE voice_resources ADD COLUMN provider_voice VARCHAR(255) NULL`,
      );
    }
    if (!(await hasCol('voice_resources', 'provider_model'))) {
      await pool.query(
        `ALTER TABLE voice_resources ADD COLUMN provider_model VARCHAR(128) NULL`,
      );
    }
    if (!(await hasCol('voice_resources', 'sample_duration_ms'))) {
      await pool.query(
        `ALTER TABLE voice_resources ADD COLUMN sample_duration_ms INT NULL`,
      );
    }
    if (!(await hasCol('voice_resources', 'clone_error'))) {
      await pool.query(`ALTER TABLE voice_resources ADD COLUMN clone_error TEXT NULL`);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        action VARCHAR(64) NOT NULL,
        detail VARCHAR(8192) NULL,
        ip VARCHAR(64) NULL,
        created_at VARCHAR(64) NOT NULL,
        INDEX idx_audit_logs_user (user_id),
        INDEX idx_audit_logs_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }
}
