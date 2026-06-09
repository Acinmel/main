#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const REQUIRED_TABLES = [
  'audio_assets',
  'subtitle_tracks',
  'digital_human_video_assets',
];

const REQUIRED_INDEXES = {
  audio_assets: [
    'idx_audio_assets_user_project_updated',
    'idx_audio_assets_user_updated',
  ],
  subtitle_tracks: [
    'idx_subtitle_tracks_user_project',
    'idx_subtitle_tracks_audio_asset',
  ],
  digital_human_video_assets: [
    'idx_dvh_assets_user_project_updated',
    'idx_dvh_assets_source_task',
    'idx_dvh_assets_reuse_lookup',
  ],
};

const SQLITE_TABLE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS audio_assets (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT NULL,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    storage_provider TEXT NOT NULL,
    object_key TEXT NULL,
    storage_path TEXT NULL,
    audio_url TEXT NULL,
    mime_type TEXT NULL,
    size_bytes INTEGER NULL,
    duration_seconds REAL NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT NULL,
    subtitle_track_id TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS subtitle_tracks (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT NULL,
    audio_asset_id TEXT NOT NULL,
    source TEXT NOT NULL,
    language TEXT NULL,
    duration_seconds REAL NULL,
    cues_json TEXT NULL,
    words_json TEXT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS digital_human_video_assets (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT NULL,
    avatar_resource_id TEXT NOT NULL,
    audio_asset_id TEXT NULL,
    render_mode TEXT NULL,
    source_task_id TEXT NULL,
    video_url TEXT NULL,
    video_path TEXT NULL,
    duration_seconds REAL NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

const SQLITE_INDEX_SCHEMA = [
  'CREATE INDEX IF NOT EXISTS idx_audio_assets_user_project_updated ON audio_assets(user_id, project_id, updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_audio_assets_user_updated ON audio_assets(user_id, updated_at, id)',
  'CREATE INDEX IF NOT EXISTS idx_subtitle_tracks_user_project ON subtitle_tracks(user_id, project_id, updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_subtitle_tracks_audio_asset ON subtitle_tracks(audio_asset_id, updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_dvh_assets_user_project_updated ON digital_human_video_assets(user_id, project_id, updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_dvh_assets_source_task ON digital_human_video_assets(source_task_id, updated_at)',
  'CREATE INDEX IF NOT EXISTS idx_dvh_assets_reuse_lookup ON digital_human_video_assets(user_id, project_id, avatar_resource_id, audio_asset_id, render_mode, status, updated_at)',
];

function parseArgs(argv) {
  const args = {
    dialect: process.env.STAGED_WORKFLOW_DB_DIALECT || 'sqlite',
    sqlitePath:
      process.env.SQLITE_PATH || path.join(ROOT, 'backend', 'data', 'app.db'),
    migrate: false,
    json: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === '--migrate') args.migrate = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--mysql') args.dialect = 'mysql';
    else if (arg === '--sqlite') args.dialect = 'sqlite';
    else if (arg.startsWith('--dialect=')) args.dialect = arg.split('=')[1];
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
    tables: {},
    indexes: {},
    missingTables: [],
    missingIndexes: [],
  };
}

function checkMissing(result) {
  result.missingTables = REQUIRED_TABLES.filter((table) => !result.tables[table]);
  result.missingIndexes = [];
  for (const [table, indexes] of Object.entries(REQUIRED_INDEXES)) {
    for (const indexName of indexes) {
      if (!result.indexes[indexName]) {
        result.missingIndexes.push(`${table}.${indexName}`);
      }
    }
  }
  result.ok = result.missingTables.length === 0 && result.missingIndexes.length === 0;
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
    if (args.migrate) {
      db.transaction(() => {
        for (const sql of SQLITE_TABLE_SCHEMA) db.prepare(sql).run();
        const cols = db
          .prepare(`PRAGMA table_info(digital_human_video_assets)`)
          .all();
        const hasRenderMode = cols.some((col) => col?.name === 'render_mode');
        if (!hasRenderMode) {
          db.prepare(
            `ALTER TABLE digital_human_video_assets ADD COLUMN render_mode TEXT NULL`,
          ).run();
        }
        for (const sql of SQLITE_INDEX_SCHEMA) db.prepare(sql).run();
      })();
      result.migrated = true;
    }

    for (const table of REQUIRED_TABLES) {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table);
      result.tables[table] = Boolean(row);
    }

    for (const table of REQUIRED_TABLES) {
      const rows = db.prepare(`PRAGMA index_list(${table})`).all();
      for (const row of rows) {
        result.indexes[row.name] = true;
      }
    }

    return checkMissing(result);
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
        '--migrate is only supported for SQLite. Run scripts/run-migrations.sh for MySQL.',
      );
    }

    const [tables] = await connection.query(
      `SELECT TABLE_NAME
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?, ?)`,
      REQUIRED_TABLES,
    );
    for (const row of tables) {
      result.tables[row.TABLE_NAME] = true;
    }

    const allIndexes = Object.values(REQUIRED_INDEXES).flat();
    const [indexes] = await connection.query(
      `SELECT TABLE_NAME, INDEX_NAME
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN (?, ?, ?, ?, ?, ?, ?)`,
      allIndexes,
    );
    for (const row of indexes) {
      result.indexes[row.INDEX_NAME] = true;
    }

    return checkMissing(result);
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
  console.log(`>>> staged workflow database check:${target}`);
  if (result.migrated) console.log('[OK] non-destructive SQLite migration applied');
  for (const table of REQUIRED_TABLES) {
    console.log(`${result.tables[table] ? '[OK]' : '[X]'} table ${table}`);
  }
  for (const [table, indexes] of Object.entries(REQUIRED_INDEXES)) {
    for (const indexName of indexes) {
      console.log(
        `${result.indexes[indexName] ? '[OK]' : '[X]'} index ${table}.${indexName}`,
      );
    }
  }
  if (result.error) console.error(`[X] ${result.error}`);
}

(async () => {
  const args = parseArgs(process.argv);
  const result =
    args.dialect === 'mysql' ? await checkMysql(args) : checkSqlite(args);
  printResult(result, args.json);
  if (!result.ok) process.exit(1);
})().catch((error) => {
  console.error(`[X] staged workflow database check failed: ${error.message}`);
  process.exit(1);
});
