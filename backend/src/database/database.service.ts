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
import { resolveConfiguredDir } from '../common/resource-paths.util';

const SQLITE_STATEMENT_CACHE_LIMIT = 250;

type MysqlColumnMetadata = {
  dataType?: unknown;
  isNullable?: unknown;
  characterMaximumLength?: unknown;
};

type MysqlCountRow = {
  c?: unknown;
  C?: unknown;
};

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * 持久化：优先 MySQL（线上/商业化推荐），未配置 MYSQL_DATABASE 时回退 SQLite（本地零依赖）。
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private sqlite: Database.Database | null = null;
  private readonly sqliteStatementCache = new Map<string, Database.Statement>();
  private mysqlPool: Pool | null = null;

  constructor(private readonly config: ConfigService) {}

  private useMysql(): boolean {
    return Boolean(this.config.get<string>('MYSQL_DATABASE')?.trim());
  }

  async onModuleInit(): Promise<void> {
    if (this.useMysql()) {
      const host = this.config.get<string>('MYSQL_HOST')?.trim() || '127.0.0.1';
      const port =
        Number(this.config.get<string>('MYSQL_PORT') || '3306') || 3306;
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
        connectionLimit: positiveInt(
          this.config.get<string>('MYSQL_CONNECTION_LIMIT'),
          10,
        ),
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
      path.join(resolveConfiguredDir(null), 'app.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('busy_timeout = 5000');
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
      this.sqliteStatementCache.clear();
      this.sqlite?.close();
    } catch {
      /* noop */
    }
  }

  /** 单行查询；无结果返回 null */
  async queryOne<T extends object>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    if (this.mysqlPool) {
      const [rows] = await this.mysqlPool.query(sql, params);
      const arr = rows as T[];
      return arr[0] ?? null;
    }
    const row = this.getSqliteStatement(sql).get(...params) as T | undefined;
    return row ?? null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    if (this.mysqlPool) {
      await this.mysqlPool.execute(
        sql,
        params as (string | number | Buffer | null)[],
      );
      return;
    }
    this.getSqliteStatement(sql).run(...params);
  }

  /** 多行查询 */
  async queryAll<T extends object>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    if (this.mysqlPool) {
      const [rows] = await this.mysqlPool.query(sql, params);
      return rows as T[];
    }
    return this.getSqliteStatement(sql).all(...params) as T[];
  }

  private getSqliteStatement(sql: string): Database.Statement {
    const cached = this.sqliteStatementCache.get(sql);
    if (cached) {
      this.sqliteStatementCache.delete(sql);
      this.sqliteStatementCache.set(sql, cached);
      return cached;
    }

    const statement = this.sqlite!.prepare(sql);
    this.sqliteStatementCache.set(sql, statement);
    if (this.sqliteStatementCache.size > SQLITE_STATEMENT_CACHE_LIMIT) {
      const oldest = this.sqliteStatementCache.keys().next();
      if (!oldest.done) {
        this.sqliteStatementCache.delete(oldest.value);
      }
    }
    return statement;
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
      CREATE INDEX IF NOT EXISTS idx_user_works_user_updated ON user_works(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_user_works_updated ON user_works(updated_at, id);

      CREATE TABLE IF NOT EXISTS task_statuses (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT,
        result_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_task_statuses_user_updated ON task_statuses(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_task_statuses_status_updated ON task_statuses(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_task_statuses_expires ON task_statuses(expires_at);

      CREATE TABLE IF NOT EXISTS avatar_resources (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT,
        name TEXT NOT NULL,
        is_recommended INTEGER NOT NULL DEFAULT 0,
        cover_url TEXT,
        source_video_url TEXT,
        style_id TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_avatar_resources_user ON avatar_resources(user_id);
      CREATE INDEX IF NOT EXISTS idx_avatar_resources_updated ON avatar_resources(updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_avatar_resources_user_updated ON avatar_resources(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_avatar_resources_rec_updated ON avatar_resources(is_recommended, updated_at, id);

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
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_voice_resources_user ON voice_resources(user_id);
      CREATE INDEX IF NOT EXISTS idx_voice_resources_updated ON voice_resources(updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_voice_resources_user_updated ON voice_resources(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_voice_resources_rec_updated ON voice_resources(is_recommended, updated_at, id);

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
      CREATE INDEX IF NOT EXISTS idx_subtitle_template_resources_user_updated ON subtitle_template_resources(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_subtitle_template_resources_rec_updated ON subtitle_template_resources(is_recommended, updated_at, id);

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        ip TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recent_extractions (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        cover_url TEXT NOT NULL DEFAULT '',
        video_url TEXT NOT NULL DEFAULT '',
        extracted_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, source_url),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS saved_videos (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL DEFAULT 0,
        mime_type TEXT NOT NULL DEFAULT '',
        source_video_url TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, file_name),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action ON audit_logs(user_id, action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_recent_extractions_user_extracted ON recent_extractions(user_id, extracted_at, id);
      CREATE INDEX IF NOT EXISTS idx_recent_extractions_user_updated ON recent_extractions(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_saved_videos_user_updated ON saved_videos(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_saved_videos_user_created ON saved_videos(user_id, created_at, id);
      CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
      CREATE INDEX IF NOT EXISTS idx_dh_templates_updated ON digital_human_templates(updated_at);
    `);
  }

  private ensureGovernanceSqlite(): void {
    const db = this.sqlite!;
    const cols = db.prepare(`PRAGMA table_info(users)`).all() as {
      name: string;
    }[];
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
      db.exec(
        `ALTER TABLE voice_resources ADD COLUMN sample_duration_ms INTEGER`,
      );
    }
    if (!voiceNames.has('clone_error')) {
      db.exec(`ALTER TABLE voice_resources ADD COLUMN clone_error TEXT`);
    }

    const avatarCols = db
      .prepare(`PRAGMA table_info(avatar_resources)`)
      .all() as { name: string }[];
    const avatarNames = new Set(avatarCols.map((c) => c.name));
    if (!avatarNames.has('expires_at')) {
      db.exec(`ALTER TABLE avatar_resources ADD COLUMN expires_at TEXT`);
    }
    if (!voiceNames.has('expires_at')) {
      db.exec(`ALTER TABLE voice_resources ADD COLUMN expires_at TEXT`);
    }
    const subtitleCols = db
      .prepare(`PRAGMA table_info(subtitle_template_resources)`)
      .all() as { name: string }[];
    const subtitleNames = new Set(subtitleCols.map((c) => c.name));
    if (!subtitleNames.has('cover_url')) {
      db.exec(
        `ALTER TABLE subtitle_template_resources ADD COLUMN cover_url TEXT`,
      );
    }
    if (!subtitleNames.has('preview_url')) {
      db.exec(
        `ALTER TABLE subtitle_template_resources ADD COLUMN preview_url TEXT`,
      );
    }
    if (!subtitleNames.has('style_json')) {
      db.exec(
        `ALTER TABLE subtitle_template_resources ADD COLUMN style_json TEXT NOT NULL DEFAULT '{}'`,
      );
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_avatar_resources_expires ON avatar_resources(expires_at)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_voice_resources_expires ON voice_resources(expires_at)`,
    );
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
      CREATE INDEX IF NOT EXISTS idx_user_works_user_updated ON user_works(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_user_works_updated ON user_works(updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_dh_templates_updated ON digital_human_templates(updated_at);
      CREATE INDEX IF NOT EXISTS idx_avatar_resources_user_updated ON avatar_resources(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_avatar_resources_rec_updated ON avatar_resources(is_recommended, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_voice_resources_user_updated ON voice_resources(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_voice_resources_rec_updated ON voice_resources(is_recommended, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_subtitle_template_resources_user_updated ON subtitle_template_resources(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_subtitle_template_resources_rec_updated ON subtitle_template_resources(is_recommended, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_action ON audit_logs(user_id, action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_task_statuses_user_updated ON task_statuses(user_id, updated_at, id);
      CREATE INDEX IF NOT EXISTS idx_task_statuses_status_updated ON task_statuses(status, updated_at);
      CREATE INDEX IF NOT EXISTS idx_task_statuses_expires ON task_statuses(expires_at);
    `);
  }

  private async migrateMysql(): Promise<void> {
    const pool = this.mysqlPool!;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        UNIQUE KEY uq_users_email (email),
        INDEX idx_users_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS digital_human_templates (
        user_id VARCHAR(36) NOT NULL PRIMARY KEY,
        style_id VARCHAR(128) NOT NULL,
        output_relative_path LONGTEXT NOT NULL,
        selfie_relative_path LONGTEXT NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_dh_templates_updated (updated_at),
        CONSTRAINT fk_dh_templates_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_works (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        title VARCHAR(512) NOT NULL DEFAULT '',
        content LONGTEXT NULL,
        transcript_text LONGTEXT NULL,
        rewrite_text LONGTEXT NULL,
        source_video_url LONGTEXT NOT NULL,
        output_video_url LONGTEXT NULL,
        digital_human_style_id VARCHAR(128) NULL,
        status VARCHAR(32) NOT NULL,
        task_payload_json LONGTEXT NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_user_works_user (user_id),
        INDEX idx_user_works_user_updated (user_id, updated_at, id),
        INDEX idx_user_works_updated (updated_at, id),
        CONSTRAINT fk_user_works_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_statuses (
        id VARCHAR(128) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        kind VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        progress INT NOT NULL DEFAULT 0,
        payload_json LONGTEXT NULL,
        result_json LONGTEXT NULL,
        error LONGTEXT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        expires_at VARCHAR(64) NULL,
        INDEX idx_task_statuses_user_updated (user_id, updated_at, id),
        INDEX idx_task_statuses_status_updated (status, updated_at),
        INDEX idx_task_statuses_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS avatar_resources (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NULL,
        name VARCHAR(255) NOT NULL,
        is_recommended TINYINT NOT NULL DEFAULT 0,
        cover_url LONGTEXT NULL,
        source_video_url LONGTEXT NULL,
        style_id VARCHAR(128) NULL,
        expires_at VARCHAR(64) NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_avatar_resources_user (user_id),
        INDEX idx_avatar_resources_updated (updated_at, id),
        INDEX idx_avatar_resources_user_updated (user_id, updated_at, id),
        INDEX idx_avatar_resources_rec_updated (is_recommended, updated_at, id),
        INDEX idx_avatar_resources_expires (expires_at),
        CONSTRAINT fk_avatar_resources_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS voice_resources (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NULL,
        name VARCHAR(255) NOT NULL,
        is_recommended TINYINT NOT NULL DEFAULT 0,
        audio_url LONGTEXT NULL,
        clone_status VARCHAR(32) NOT NULL DEFAULT 'ready',
        provider VARCHAR(64) NULL,
        provider_voice VARCHAR(255) NULL,
        provider_model VARCHAR(128) NULL,
        sample_duration_ms INT NULL,
        clone_error LONGTEXT NULL,
        expires_at VARCHAR(64) NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_voice_resources_user (user_id),
        INDEX idx_voice_resources_updated (updated_at, id),
        INDEX idx_voice_resources_user_updated (user_id, updated_at, id),
        INDEX idx_voice_resources_rec_updated (is_recommended, updated_at, id),
        INDEX idx_voice_resources_expires (expires_at),
        CONSTRAINT fk_voice_resources_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subtitle_template_resources (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NULL,
        name VARCHAR(255) NOT NULL,
        is_recommended TINYINT NOT NULL DEFAULT 0,
        cover_url LONGTEXT NULL,
        preview_url LONGTEXT NULL,
        style_json LONGTEXT NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        INDEX idx_subtitle_template_resources_user (user_id),
        INDEX idx_subtitle_template_resources_updated (updated_at, id),
        INDEX idx_subtitle_template_resources_user_updated (user_id, updated_at, id),
        INDEX idx_subtitle_template_resources_rec_updated (is_recommended, updated_at, id),
        CONSTRAINT fk_subtitle_template_resources_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recent_extractions (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        source_url VARCHAR(512) NOT NULL,
        platform VARCHAR(32) NOT NULL DEFAULT '',
        title VARCHAR(140) NOT NULL DEFAULT '',
        summary VARCHAR(280) NOT NULL DEFAULT '',
        cover_url LONGTEXT NULL,
        video_url LONGTEXT NULL,
        extracted_at VARCHAR(64) NOT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        UNIQUE KEY uq_recent_extractions_user_source (user_id, source_url),
        INDEX idx_recent_extractions_user_extracted (user_id, extracted_at, id),
        INDEX idx_recent_extractions_user_updated (user_id, updated_at, id),
        CONSTRAINT fk_recent_extractions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saved_videos (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_size BIGINT NOT NULL DEFAULT 0,
        mime_type VARCHAR(128) NOT NULL DEFAULT '',
        source_video_url LONGTEXT NULL,
        created_at VARCHAR(64) NOT NULL,
        updated_at VARCHAR(64) NOT NULL,
        UNIQUE KEY uq_saved_videos_user_file (user_id, file_name),
        INDEX idx_saved_videos_user_updated (user_id, updated_at, id),
        INDEX idx_saved_videos_user_created (user_id, created_at, id),
        CONSTRAINT fk_saved_videos_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  private async ensureGovernanceMysql(): Promise<void> {
    const pool = this.mysqlPool!;
    const getCol = async (
      table: string,
      column: string,
    ): Promise<MysqlColumnMetadata | null> => {
      const [rows] = await pool.query(
        `SELECT DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column],
      );
      const pkt = rows as MysqlColumnMetadata[];
      return pkt[0] ?? null;
    };
    const hasCol = async (table: string, column: string): Promise<boolean> => {
      return Boolean(await getCol(table, column));
    };
    const hasIndex = async (
      table: string,
      indexName: string,
    ): Promise<boolean> => {
      const [rows] = await pool.query(
        `SELECT COUNT(1) AS c FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, indexName],
      );
      const pkt = rows as MysqlCountRow[];
      const first = pkt[0];
      const rawCount = first?.c ?? first?.C ?? 0;
      const c =
        typeof rawCount === 'number'
          ? rawCount
          : typeof rawCount === 'string'
            ? Number(rawCount)
            : 0;
      return c > 0;
    };
    const ensureIndex = async (
      table: string,
      indexName: string,
      ddl: string,
    ): Promise<void> => {
      if (!(await hasIndex(table, indexName))) {
        await pool.query(ddl);
      }
    };
    const ensureLongTextColumn = async (
      table: string,
      column: string,
      nullable: boolean,
    ): Promise<void> => {
      const nullability = nullable ? 'NULL' : 'NOT NULL';
      const col = await getCol(table, column);
      if (!col) {
        await pool.query(
          `ALTER TABLE ${table} ADD COLUMN ${column} LONGTEXT ${nullability}`,
        );
        return;
      }
      const dataType =
        typeof col.dataType === 'string' ? col.dataType.toLowerCase() : '';
      const isNullable =
        typeof col.isNullable === 'string' &&
        col.isNullable.toUpperCase() === 'YES';
      if (dataType !== 'longtext' || isNullable !== nullable) {
        await pool.query(
          `ALTER TABLE ${table} MODIFY COLUMN ${column} LONGTEXT ${nullability}`,
        );
      }
    };

    if (!(await hasCol('users', 'role'))) {
      await pool.query(
        `ALTER TABLE users ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'user'`,
      );
    }
    if (!(await hasCol('users', 'account_status'))) {
      await pool.query(
        `ALTER TABLE users ADD COLUMN account_status VARCHAR(16) NOT NULL DEFAULT 'active'`,
      );
    }
    if (!(await hasCol('voice_resources', 'provider'))) {
      await pool.query(
        `ALTER TABLE voice_resources ADD COLUMN provider VARCHAR(64) NULL`,
      );
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
      await pool.query(
        `ALTER TABLE voice_resources ADD COLUMN clone_error LONGTEXT NULL`,
      );
    }
    if (!(await hasCol('avatar_resources', 'expires_at'))) {
      await pool.query(
        `ALTER TABLE avatar_resources ADD COLUMN expires_at VARCHAR(64) NULL`,
      );
    }
    if (!(await hasCol('voice_resources', 'expires_at'))) {
      await pool.query(
        `ALTER TABLE voice_resources ADD COLUMN expires_at VARCHAR(64) NULL`,
      );
    }
    await ensureLongTextColumn(
      'subtitle_template_resources',
      'cover_url',
      true,
    );
    await ensureLongTextColumn(
      'subtitle_template_resources',
      'preview_url',
      true,
    );
    if (!(await hasCol('subtitle_template_resources', 'style_json'))) {
      await pool.query(
        `ALTER TABLE subtitle_template_resources ADD COLUMN style_json LONGTEXT NULL`,
      );
    }
    await pool.query(
      `UPDATE subtitle_template_resources SET style_json = '{}' WHERE style_json IS NULL`,
    );
    await ensureLongTextColumn(
      'subtitle_template_resources',
      'style_json',
      false,
    );
    await ensureLongTextColumn(
      'digital_human_templates',
      'output_relative_path',
      false,
    );
    await ensureLongTextColumn(
      'digital_human_templates',
      'selfie_relative_path',
      false,
    );
    await ensureLongTextColumn('user_works', 'content', true);
    await ensureLongTextColumn('user_works', 'transcript_text', true);
    await ensureLongTextColumn('user_works', 'rewrite_text', true);
    await ensureLongTextColumn('user_works', 'source_video_url', false);
    await ensureLongTextColumn('user_works', 'output_video_url', true);
    await ensureLongTextColumn('user_works', 'task_payload_json', false);
    await ensureLongTextColumn('task_statuses', 'payload_json', true);
    await ensureLongTextColumn('task_statuses', 'result_json', true);
    await ensureLongTextColumn('task_statuses', 'error', true);
    await ensureLongTextColumn('avatar_resources', 'cover_url', true);
    await ensureLongTextColumn('avatar_resources', 'source_video_url', true);
    await ensureLongTextColumn('voice_resources', 'audio_url', true);
    await ensureLongTextColumn('voice_resources', 'clone_error', true);
    if (!(await hasIndex('avatar_resources', 'idx_avatar_resources_expires'))) {
      await pool.query(
        `ALTER TABLE avatar_resources ADD INDEX idx_avatar_resources_expires (expires_at)`,
      );
    }
    if (!(await hasIndex('voice_resources', 'idx_voice_resources_expires'))) {
      await pool.query(
        `ALTER TABLE voice_resources ADD INDEX idx_voice_resources_expires (expires_at)`,
      );
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        action VARCHAR(64) NOT NULL,
        detail LONGTEXT NULL,
        ip VARCHAR(64) NULL,
        created_at VARCHAR(64) NOT NULL,
        INDEX idx_audit_logs_user (user_id),
        INDEX idx_audit_logs_user_action (user_id, action),
        INDEX idx_audit_logs_action (action),
        INDEX idx_audit_logs_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await ensureLongTextColumn('audit_logs', 'detail', true);
    await ensureIndex(
      'users',
      'idx_users_created',
      `ALTER TABLE users ADD INDEX idx_users_created (created_at)`,
    );
    await ensureIndex(
      'user_works',
      'idx_user_works_user_updated',
      `ALTER TABLE user_works ADD INDEX idx_user_works_user_updated (user_id, updated_at, id)`,
    );
    await ensureIndex(
      'user_works',
      'idx_user_works_updated',
      `ALTER TABLE user_works ADD INDEX idx_user_works_updated (updated_at, id)`,
    );
    await ensureIndex(
      'digital_human_templates',
      'idx_dh_templates_updated',
      `ALTER TABLE digital_human_templates ADD INDEX idx_dh_templates_updated (updated_at)`,
    );
    await ensureIndex(
      'avatar_resources',
      'idx_avatar_resources_user_updated',
      `ALTER TABLE avatar_resources ADD INDEX idx_avatar_resources_user_updated (user_id, updated_at, id)`,
    );
    await ensureIndex(
      'avatar_resources',
      'idx_avatar_resources_rec_updated',
      `ALTER TABLE avatar_resources ADD INDEX idx_avatar_resources_rec_updated (is_recommended, updated_at, id)`,
    );
    await ensureIndex(
      'voice_resources',
      'idx_voice_resources_user_updated',
      `ALTER TABLE voice_resources ADD INDEX idx_voice_resources_user_updated (user_id, updated_at, id)`,
    );
    await ensureIndex(
      'voice_resources',
      'idx_voice_resources_rec_updated',
      `ALTER TABLE voice_resources ADD INDEX idx_voice_resources_rec_updated (is_recommended, updated_at, id)`,
    );
    await ensureIndex(
      'subtitle_template_resources',
      'idx_subtitle_template_resources_user_updated',
      `ALTER TABLE subtitle_template_resources ADD INDEX idx_subtitle_template_resources_user_updated (user_id, updated_at, id)`,
    );
    await ensureIndex(
      'subtitle_template_resources',
      'idx_subtitle_template_resources_rec_updated',
      `ALTER TABLE subtitle_template_resources ADD INDEX idx_subtitle_template_resources_rec_updated (is_recommended, updated_at, id)`,
    );
    await ensureIndex(
      'audit_logs',
      'idx_audit_logs_user_action',
      `ALTER TABLE audit_logs ADD INDEX idx_audit_logs_user_action (user_id, action)`,
    );
    await ensureIndex(
      'audit_logs',
      'idx_audit_logs_action',
      `ALTER TABLE audit_logs ADD INDEX idx_audit_logs_action (action)`,
    );
    await ensureIndex(
      'task_statuses',
      'idx_task_statuses_user_updated',
      `ALTER TABLE task_statuses ADD INDEX idx_task_statuses_user_updated (user_id, updated_at, id)`,
    );
    await ensureIndex(
      'task_statuses',
      'idx_task_statuses_status_updated',
      `ALTER TABLE task_statuses ADD INDEX idx_task_statuses_status_updated (status, updated_at)`,
    );
    await ensureIndex(
      'task_statuses',
      'idx_task_statuses_expires',
      `ALTER TABLE task_statuses ADD INDEX idx_task_statuses_expires (expires_at)`,
    );
  }
}
