-- Koubo Remake MVP · 关系型表结构草案（PostgreSQL 语法）
-- 实体：user, task, source_video, transcript, rewrite_result, uploaded_photo, render_job, output_file

CREATE TABLE users (
  id              UUID PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users (id),
  status          TEXT NOT NULL,
  title           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE source_videos (
  id              UUID PRIMARY KEY,
  task_id         UUID NOT NULL UNIQUE REFERENCES tasks (id),
  url             TEXT NOT NULL,
  platform        TEXT,
  local_audio_path TEXT,
  duration_sec    DOUBLE PRECISION,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transcripts (
  id              UUID PRIMARY KEY,
  task_id         UUID NOT NULL UNIQUE REFERENCES tasks (id),
  provider        TEXT,
  language        TEXT,
  full_text       TEXT NOT NULL,
  segments_json   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rewrite_results (
  id              UUID PRIMARY KEY,
  task_id         UUID NOT NULL REFERENCES tasks (id),
  style           TEXT NOT NULL,
  text            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE uploaded_photos (
  id              UUID PRIMARY KEY,
  task_id         UUID NOT NULL UNIQUE REFERENCES tasks (id),
  storage_path    TEXT NOT NULL,
  width           INT,
  height          INT,
  validation_json JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE render_jobs (
  id              UUID PRIMARY KEY,
  task_id         UUID NOT NULL REFERENCES tasks (id),
  mode            TEXT NOT NULL,
  aspect_ratio    TEXT NOT NULL,
  voice_style     TEXT,
  subtitle_style  TEXT,
  status          TEXT NOT NULL,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE output_files (
  id              UUID PRIMARY KEY,
  task_id         UUID NOT NULL REFERENCES tasks (id),
  kind            TEXT NOT NULL, -- video | subtitle | script
  storage_path    TEXT NOT NULL,
  bytes           BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tasks_user_created ON tasks (user_id, created_at DESC);
CREATE INDEX idx_render_jobs_task ON render_jobs (task_id);
