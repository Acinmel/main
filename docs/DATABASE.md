# 数据库设计（定版后基线）

本文档在**不改变当前已实现接口与行为**的前提下，定义持久化层，用于将内存中的关键数据落库，供后续任务流水线、作品列表、审计与多实例部署使用。

**推荐引擎**：PostgreSQL 14+（生产）；开发可选用 SQLite / 本机 PostgreSQL。  
**约定**：时间一律 **UTC**（`timestamptz`）；主键 **UUID**（`uuid`）或 **ULID** 均可，下文以 UUID 为例。

---

## 1. 与现有代码的对应关系

| 当前实现 | 位置 | 落库后 |
|----------|------|--------|
| 任务列表与详情 | `TasksService` 内存 `Map` | `tasks` + 关联表 |
| ASR 转写暂存（工具链） | `TranscriptStore` 内存 `Map` | `whisper_transcripts`（历史表名，可先仅工具链，后续与任务关联；新实现见 `backend/src/integrations/transcription/`） |
| 用户 ID | `readUserIdFromAuth` 派生字符串 | `users` 或仅存 `user_id` 外键（匿名 `anonymous` 可保留） |
| 照片上传 | 仅存元数据，buffer 丢弃 | `task_photos` 元数据 + 对象存储 key（后续） |

---

## 2. 概念模型（ER）

```mermaid
erDiagram
  users ||--o{ tasks : owns
  tasks ||--o| task_transcripts : has
  tasks ||--o| task_rewrites : has
  tasks ||--o| task_render_configs : has
  tasks ||--o| task_outputs : has
  whisper_transcripts }o--|| users : optional_owner

  users {
    uuid id PK
    text email UK
    text display_name
    timestamptz created_at
  }

  tasks {
    uuid id PK
    text user_id FK
    text status
    text source_video_url
    text fail_reason
    text prefilled_transcript
    boolean extract_started
    boolean render_started
    jsonb photo_meta
    timestamptz created_at
    timestamptz updated_at
  }

  task_transcripts {
    uuid task_id PK FK
    text language
    text full_text
    jsonb segments
    timestamptz created_at
  }

  task_rewrites {
    uuid task_id PK FK
    text style
    text text
    timestamptz updated_at
  }

  task_render_configs {
    uuid task_id PK FK
    jsonb options
    timestamptz created_at
  }

  task_outputs {
    uuid task_id PK FK
    text mp4_url
    text subtitle_url
    text script_url
    timestamptz updated_at
  }

  whisper_transcripts {
    uuid id PK
    text user_id
    text language
    text full_text
    jsonb segments
    text source_filename
    uuid task_id FK
    timestamptz created_at
  }
```

说明：

- **tasks**：与现有 `TaskInternal` 一致；`photo` 拆为 `photo_meta` JSONB（`originalName`、`mimeType`、`byteLength`）。
- **task_transcripts**：与 `TranscriptDto` 对齐；`segments` 为 `TranscriptSegment[]` 的 JSON。
- **task_rewrites / task_render_configs / task_outputs**：对应 `rewrite`、`renderConfig`、`output`；也可合并为单表 `task_snapshots` + `kind` 枚举，首版拆分更清晰。
- **whisper_transcripts**：落库后替代内存 `TranscriptStore`；`task_id` 可空——首页/工具链先产生转写、尚未创建任务时只写本表；创建任务后可关联更新。（表名沿用历史命名，与是否使用 OpenAI `whisper-1` 等模型无关。）

---

## 3. 表字段明细

### 3.1 `users`（可选；若长期仅匿名可延后）

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | `uuid` PK | 与 JWT `sub` 或内部 `user_demo` 映射规则在应用层约定 |
| `email` | `text` UNIQUE | 可空 |
| `display_name` | `text` | 可空 |
| `created_at` | `timestamptz` | 默认 `now()` |

### 3.2 `tasks`

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | `uuid` PK | |
| `user_id` | `text` NOT NULL | 与现逻辑一致：`anonymous` / `user_demo` / `usr_*` |
| `status` | `text` NOT NULL | 与 `TaskStatus` 枚举一致 |
| `source_video_url` | `text` NOT NULL | 归一化后的 URL |
| `fail_reason` | `text` | 可空 |
| `prefilled_transcript` | `text` | 可空；首页 `initialTranscript` |
| `extract_started` | `boolean` NOT NULL DEFAULT false | |
| `render_started` | `boolean` NOT NULL DEFAULT false | |
| `photo_meta` | `jsonb` | 可空；`{ originalName, mimeType, byteLength }` |
| `created_at` | `timestamptz` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL | |

**索引**：`(user_id, created_at DESC)`；`status`（视查询频率）。

### 3.3 `task_transcripts`

| 列 | 类型 | 说明 |
|----|------|------|
| `task_id` | `uuid` PK FK → `tasks.id` ON DELETE CASCADE | |
| `language` | `text` NOT NULL | 如 `zh`、`und` |
| `full_text` | `text` NOT NULL | |
| `segments` | `jsonb` NOT NULL | `[{ startMs, endMs, text }]` |
| `created_at` | `timestamptz` NOT NULL | |

### 3.4 `task_rewrites`

| 列 | 类型 | 说明 |
|----|------|------|
| `task_id` | `uuid` PK FK | |
| `style` | `text` NOT NULL | `RewriteStyle` |
| `text` | `text` NOT NULL | |
| `updated_at` | `timestamptz` NOT NULL | |

### 3.5 `task_render_configs`

| 列 | 类型 | 说明 |
|----|------|------|
| `task_id` | `uuid` PK FK | |
| `options` | `jsonb` NOT NULL | `RenderOptionsDto` 整包 |
| `created_at` | `timestamptz` NOT NULL | |

### 3.6 `task_outputs`

| 列 | 类型 | 说明 |
|----|------|------|
| `task_id` | `uuid` PK FK | |
| `mp4_url` | `text` | 可空 |
| `subtitle_url` | `text` | 可空 |
| `script_url` | `text` | 可空 |
| `updated_at` | `timestamptz` NOT NULL | |

### 3.7 `whisper_transcripts`（工具链 / 首页转写）

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | `uuid` PK | 即当前 API 的 `transcriptId` |
| `user_id` | `text` | 可空；便于统计 |
| `language` | `text` NOT NULL | |
| `full_text` | `text` NOT NULL | |
| `segments` | `jsonb` NOT NULL | |
| `source_filename` | `text` | 可空 |
| `task_id` | `uuid` FK → `tasks.id` ON DELETE SET NULL | 可空 |
| `created_at` | `timestamptz` NOT NULL | |

**索引**：`(created_at DESC)`；可选 `task_id`。

---

## 4. 后续扩展（非首版必做）

| 表 | 用途 |
|----|------|
| `video_meta_cache` | 缓存 `video-meta` 解析结果，键为 `canonical_url` |
| `media_files` | 本机 `VIDEO_SAVE_DIR` 文件元数据（路径、大小、hash、关联 task） |
| `audit_logs` | 关键操作审计 |

---

## 5. PostgreSQL DDL 参考（首版）

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  status text NOT NULL,
  source_video_url text NOT NULL,
  fail_reason text,
  prefilled_transcript text,
  extract_started boolean NOT NULL DEFAULT false,
  render_started boolean NOT NULL DEFAULT false,
  photo_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_user_created ON tasks (user_id, created_at DESC);

CREATE TABLE task_transcripts (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  language text NOT NULL,
  full_text text NOT NULL,
  segments jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_rewrites (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  style text NOT NULL,
  text text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_render_configs (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  options jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_outputs (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  mp4_url text,
  subtitle_url text,
  script_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE whisper_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  language text NOT NULL,
  full_text text NOT NULL,
  segments jsonb NOT NULL,
  source_filename text,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whisper_created ON whisper_transcripts (created_at DESC);
```

---

## 6. 接入策略（不改功能前提下的迁移顺序）

1. **引入 ORM**（TypeORM / Prisma 等）与迁移脚本，仅新增表，**不替换** `TasksService` / `TranscriptStore` 调用。
2. **双写**：写内存同时写 DB；读仍以内存为准，验证一致。
3. **读切换**：读主库，内存作降级或删除。
4. **工具链**：`GET /v1/tools/transcripts/:id` 优先从 `whisper_transcripts` 读取。

---

## 7. 环境变量（后续）

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串，如 `postgresql://user:pass@localhost:5432/shuziren` |

---

*文档版本：与当前仓库「定版」功能对齐；实现迁移时以 `backend/src/modules/tasks` 与 `backend/src/integrations/transcription/transcript.store.ts` 为准再核对字段。*
