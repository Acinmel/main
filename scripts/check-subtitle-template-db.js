#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TABLE = 'subtitle_template_resources';
const REQUIRED_COLUMNS = {
  style_config_json: ['TEXT', 'LONGTEXT'],
  base_template_id: ['TEXT', 'VARCHAR'],
};
const REQUIRED_INDEXES = [
  'idx_subtitle_template_resources_user_updated',
  'idx_subtitle_template_resources_rec_updated',
];

function parseArgs(argv) {
  const args = {
    dialect: process.env.SUBTITLE_TEMPLATE_DB_DIALECT || 'sqlite',
    sqlitePath:
      process.env.SQLITE_PATH || path.join(ROOT, 'backend', 'data', 'app.db'),
    migrate: false,
    backfillUrls: false,
    failOnDataUrls: process.env.SUBTITLE_TEMPLATE_ALLOW_DATA_URLS !== '1',
    json: false,
    baseUrl:
      process.env.PUBLIC_TEMPLATE_PREVIEW_BASE_URL ||
      process.env.TEMPLATE_PREVIEW_BASE_URL ||
      '/template-previews',
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--migrate') args.migrate = true;
    else if (arg === '--backfill-urls') args.backfillUrls = true;
    else if (arg === '--allow-data-urls') args.failOnDataUrls = false;
    else if (arg === '--strict-data-urls') args.failOnDataUrls = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--mysql') args.dialect = 'mysql';
    else if (arg === '--sqlite') args.dialect = 'sqlite';
    else if (arg.startsWith('--dialect=')) args.dialect = arg.split('=')[1];
    else if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.split('=').slice(1).join('=');
    }
    else if (arg.startsWith('--sqlite-path=')) {
      args.sqlitePath = path.resolve(arg.split('=').slice(1).join('='));
    }
  }

  return args;
}

function requireFromBackend(name) {
  try {
    return require(name);
  } catch (_) {
    return require(path.join(ROOT, 'backend', 'node_modules', name));
  }
}

function createResult(dialect) {
  return {
    ok: false,
    dialect,
    migrated: false,
    tableExists: false,
    columns: {},
    indexes: {},
    missingColumns: [],
    incompatibleColumns: [],
    missingIndexes: [],
    recommendedTemplateDataUrls: 0,
    strictDataUrls: false,
    backfilledRows: 0,
  };
}

function finalize(result, args = {}) {
  result.missingColumns = Object.keys(REQUIRED_COLUMNS).filter(
    (name) => !result.columns[name],
  );
  result.incompatibleColumns = Object.entries(REQUIRED_COLUMNS)
    .filter(([name, allowed]) => {
      const actual = result.columns[name];
      if (!actual) return false;
      return !allowed.some((type) => actual.toUpperCase().includes(type));
    })
    .map(([name]) => `${name}=${result.columns[name]}`);
  result.missingIndexes = REQUIRED_INDEXES.filter((name) => !result.indexes[name]);
  result.strictDataUrls = Boolean(args.failOnDataUrls);
  result.ok =
    result.tableExists &&
    result.missingColumns.length === 0 &&
    result.incompatibleColumns.length === 0 &&
    result.missingIndexes.length === 0 &&
    (!result.strictDataUrls || result.recommendedTemplateDataUrls === 0);
  return result;
}

function checkSqlite(args) {
  const result = createResult('sqlite');
  result.sqlitePath = args.sqlitePath;

  if (!fs.existsSync(args.sqlitePath)) {
    result.error = `SQLite database not found: ${args.sqlitePath}`;
    return result;
  }

  const Database = requireFromBackend('better-sqlite3');
  const db = new Database(args.sqlitePath);
  try {
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(TABLE);
    result.tableExists = Boolean(table);
    if (!result.tableExists) return finalize(result, args);

    if (args.migrate) {
      const columns = db.prepare(`PRAGMA table_info(${TABLE})`).all();
      const names = new Set(columns.map((column) => column.name));
      db.transaction(() => {
        if (!names.has('style_config_json')) {
          db.prepare(`ALTER TABLE ${TABLE} ADD COLUMN style_config_json TEXT`).run();
        }
        if (!names.has('base_template_id')) {
          db.prepare(`ALTER TABLE ${TABLE} ADD COLUMN base_template_id TEXT`).run();
        }
        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_subtitle_template_resources_user_updated
           ON ${TABLE}(user_id, updated_at, id)`,
        ).run();
        db.prepare(
          `CREATE INDEX IF NOT EXISTS idx_subtitle_template_resources_rec_updated
           ON ${TABLE}(is_recommended, updated_at, id)`,
        ).run();
      })();
      result.migrated = true;
    }

    if (args.backfillUrls) {
      const rows = db
        .prepare(
          `SELECT id, cover_url, preview_url
           FROM ${TABLE}
           WHERE is_recommended = 1`,
        )
        .all();
      const now = new Date().toISOString();
      const update = db.prepare(
        `UPDATE ${TABLE}
         SET cover_url = ?, preview_url = ?, updated_at = ?
         WHERE id = ?`,
      );
      const backfill = db.transaction(() => {
        for (const row of rows) {
          const seed = normalizeSeed(row.id);
          const coverFallback = buildFallbackUrl(args.baseUrl, seed, 'cover');
          const previewFallback = buildFallbackUrl(args.baseUrl, seed, 'preview');
          const nextCover = sanitizeUrl(row.cover_url, coverFallback);
          const nextPreview = sanitizeUrl(
            row.preview_url || row.cover_url,
            previewFallback,
          );
          if (nextCover === row.cover_url && nextPreview === row.preview_url) {
            continue;
          }
          update.run(nextCover, nextPreview, now, row.id);
          result.backfilledRows += 1;
        }
      });
      backfill();
    }

    for (const column of db.prepare(`PRAGMA table_info(${TABLE})`).all()) {
      result.columns[column.name] = column.type || 'TEXT';
    }
    for (const index of db.prepare(`PRAGMA index_list(${TABLE})`).all()) {
      result.indexes[index.name] = true;
    }
    const dataUrlRow = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM ${TABLE}
         WHERE is_recommended = 1
           AND (cover_url LIKE 'data:%' OR preview_url LIKE 'data:%')`,
      )
      .get();
    result.recommendedTemplateDataUrls = Number(dataUrlRow?.count || 0);
    return finalize(result, args);
  } finally {
    db.close();
  }
}

async function checkMysql(args) {
  const result = createResult('mysql');
  const mysql = requireFromBackend('mysql2/promise');
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  try {
    if (args.migrate) {
      throw new Error(
        '--migrate is only supported for SQLite. Run normal database migrations for MySQL.',
      );
    }
    const [tables] = await connection.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [TABLE],
    );
    result.tableExists = tables.length > 0;
    if (!result.tableExists) return finalize(result, args);

    const [columns] = await connection.query(
      `SELECT COLUMN_NAME, DATA_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         AND COLUMN_NAME IN (?, ?)`,
      [TABLE, ...Object.keys(REQUIRED_COLUMNS)],
    );
    for (const column of columns) {
      result.columns[column.COLUMN_NAME] = String(column.DATA_TYPE || '');
    }

    const [indexes] = await connection.query(
      `SELECT INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
         AND INDEX_NAME IN (?, ?)`,
      [TABLE, ...REQUIRED_INDEXES],
    );
    for (const index of indexes) {
      result.indexes[index.INDEX_NAME] = true;
    }

    if (args.backfillUrls) {
      const [recommendedRows] = await connection.query(
        `SELECT id, cover_url, preview_url
         FROM ${TABLE}
         WHERE is_recommended = 1`,
      );
      const now = new Date().toISOString();
      for (const row of recommendedRows) {
        const seed = normalizeSeed(row.id);
        const coverFallback = buildFallbackUrl(args.baseUrl, seed, 'cover');
        const previewFallback = buildFallbackUrl(args.baseUrl, seed, 'preview');
        const nextCover = sanitizeUrl(row.cover_url, coverFallback);
        const nextPreview = sanitizeUrl(
          row.preview_url || row.cover_url,
          previewFallback,
        );
        if (nextCover === row.cover_url && nextPreview === row.preview_url) {
          continue;
        }
        await connection.execute(
          `UPDATE ${TABLE}
           SET cover_url = ?, preview_url = ?, updated_at = ?
           WHERE id = ?`,
          [nextCover, nextPreview, now, row.id],
        );
        result.backfilledRows += 1;
      }
    }

    const [rows] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM ${TABLE}
       WHERE is_recommended = 1
         AND (cover_url LIKE 'data:%' OR preview_url LIKE 'data:%')`,
    );
    result.recommendedTemplateDataUrls = Number(rows[0]?.count || 0);
    return finalize(result, args);
  } finally {
    await connection.end();
  }
}

function printResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const target =
    result.dialect === 'sqlite' ? ` sqlite=${result.sqlitePath}` : ' mysql=<env>';
  console.log(`>>> subtitle template database check:${target}`);
  if (result.migrated) console.log('[OK] non-destructive SQLite migration applied');
  if (result.backfilledRows > 0) {
    console.log(`[OK] subtitle template URL backfilled rows=${result.backfilledRows}`);
  }
  console.log(`${result.tableExists ? '[OK]' : '[X]'} table ${TABLE}`);
  for (const [name] of Object.entries(REQUIRED_COLUMNS)) {
    console.log(
      `${result.columns[name] ? '[OK]' : '[X]'} column ${TABLE}.${name}`,
    );
  }
  for (const indexName of REQUIRED_INDEXES) {
    console.log(`${result.indexes[indexName] ? '[OK]' : '[X]'} index ${TABLE}.${indexName}`);
  }
  console.log(
    `${result.recommendedTemplateDataUrls === 0 ? '[OK]' : result.strictDataUrls ? '[X]' : '[!]'} recommended template data:image rows=${result.recommendedTemplateDataUrls}`,
  );
  if (result.strictDataUrls && result.recommendedTemplateDataUrls > 0) {
    console.error(
      '[X] recommended template data:image URLs are blocked. Run the non-destructive URL backfill/migration before deployment.',
    );
  }
  if (result.error) console.error(`[X] ${result.error}`);
}

function normalizeSeed(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  if (text && /^[a-z0-9_-]+$/i.test(text)) return text;
  return require('crypto').createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function normalizeBaseUrl(baseUrl) {
  const text = String(baseUrl || '/template-previews').trim() || '/template-previews';
  return text.replace(/\/+$/, '');
}

function buildFallbackUrl(baseUrl, seed, variant) {
  return `${normalizeBaseUrl(baseUrl)}/subtitle-template-${seed}-${variant}.png`;
}

function sanitizeUrl(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  const normalized = text.toLowerCase();
  if (
    normalized.startsWith('data:') ||
    normalized.startsWith('javascript:') ||
    normalized.startsWith('blob:')
  ) {
    return fallback;
  }
  if (text.length > 2000) return fallback;
  return text;
}

(async () => {
  const args = parseArgs(process.argv);
  const result =
    args.dialect === 'mysql' ? await checkMysql(args) : checkSqlite(args);
  printResult(result, args.json);
  if (!result.ok) process.exit(1);
})().catch((error) => {
  console.error(`[X] subtitle template database check failed: ${error.message}`);
  process.exit(1);
});
