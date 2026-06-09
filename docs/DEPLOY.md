# Deploy

## Deployment Policy

- 本地和 staging 可以自动构建、启动、测试和返工。
- production 发布、重启、回滚、Nginx/DNS/证书变更必须人工确认。
- production 不允许复用 staging 的测试脚本执行破坏性操作。
- 真实付费 provider 密钥新增、替换、删除或调用前必须人工确认。

## Runtime Components

- `web`：Nginx 静态前端，反代 `/api` 到后端。
- `api`：NestJS 服务。
- `mysql`：生产持久化数据库。
- `uploads`：本地或服务器上传目录。
- OSS：可选，用于前端直传和远程媒体存储。
- FFmpeg：音频转码、字幕烧录、标题叠加、音视频对齐。

## Required Environment

基础：

- `NODE_ENV`
- `PORT`
- `PUBLIC_BASE_URL`
- `CORS_ORIGIN`
- `JWT_SECRET`

数据库：

- `DB_TYPE=sqlite|mysql`
- `SQLITE_PATH`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`

上传和媒体：

- `UPLOAD_ROOT`
- `PUBLIC_UPLOAD_BASE_URL`
- `OSS_ACCESS_KEY_ID`
- `OSS_ACCESS_KEY_SECRET`
- `OSS_BUCKET`
- `OSS_REGION`
- `OSS_PREFIX`

AI/媒体 provider：

- `TTS_PROVIDER`
- `ASR_PROVIDER`
- `LIPSYNC_PROVIDER`
- `VIDEO_PROVIDER`
- 对应 provider 的 API key 和 endpoint。

任务控制：

- `LIPSYNC_COMPLETED_DEDUPE_WINDOW_MS`
- `TITLE_ASSET_OUTPUT_DIR`
- `TITLE_ASSET_TEMP_DIR`
- `TASK_EXPIRE_MS`

不要把真实密钥写入仓库。

## Local Development

```bash
npm install
npm --prefix frontend install
npm --prefix backend install
npm --prefix backend run start:dev
npm --prefix frontend run dev
```

访问：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:3000/api`

本地预览视频时，Vite 需要代理 `/uploads` 到后端或本地上传目录。

## Docker Validation

```bash
docker compose config
docker compose up -d --build
bash scripts/smoke-test.sh
```

本地 Docker 不应连接生产数据库或生产 OSS 前缀。

## Staging

staging 允许自动部署，但必须满足：

- 独立数据库。
- 独立上传目录或 OSS 前缀。
- 测试账号。
- mock provider 或明确允许的低成本测试 provider。
- 不使用生产密钥。

推荐流程：

```bash
bash scripts/check-all.sh
bash scripts/deploy-staging.sh
bash scripts/smoke-test.sh
```

## Production

执行前必须给出：

- 发布版本和变更范围。
- 数据库影响。
- 环境变量影响。
- 回滚方案。
- smoke test 计划。
- 需要人工确认的问题。

未获得确认前只能准备脚本、检查配置和输出计划，不能实际发布。

## Rollback

回滚原则：

- 不删除数据库。
- 不删除上传文件卷。
- 优先回滚应用镜像和静态产物。
- 回滚后执行只读 health check 和登录检查。

命令入口：

```bash
bash scripts/rollback.sh
```

## Health And Smoke

基础检查：

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:8080/api/health
```

业务 smoke 应覆盖：

- 登录。
- 当前用户素材列表。
- 音频生成或 mock 音频登记。
- 字幕时间轴。
- stage-state 保存和恢复。
- 口型任务状态查询。
- 第三步包装任务创建。

线上只读 smoke 不触发生成、不删除资源、不修改生产数据。
## OPS-038 Aliyun VideoRetalk Runbook

Scope:
- This runbook applies to local and staging VideoRetalk troubleshooting.
- Real Aliyun VideoRetalk calls may incur cost. Do not run real provider verification with production data or production keys unless the user explicitly confirms it.
- Increasing polling time alone is not a fix. It must be used together with provider metadata persistence, `provider_running` recovery, and media preflight guards.

Required environment variables:

```bash
LIP_SYNC_PROVIDER=aliyun-videoretalk
ALI_VIDEORETALK_USE_TEMP_UPLOAD=true
ALI_VIDEORETALK_BASE_URL=https://dashscope.aliyuncs.com/api/v1
VIDEO_RETALK_API_URL=https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis/
ALI_VIDEORETALK_MODEL=videoretalk
ALI_VIDEORETALK_VIDEO_EXTENSION=false
ALI_VIDEORETALK_POLL_MAX_MS=1800000
ALI_VIDEORETALK_POLL_INTERVAL_MS=3000
ALI_VIDEORETALK_RECOVER_WINDOW_MS=86400000
ALI_VIDEORETALK_INPUT_MAX_BYTES=314572800
```

Recommended local/staging polling budget:

| Scenario | `ALI_VIDEORETALK_POLL_MAX_MS` | Notes |
|---|---:|---|
| Short smoke with mock/stub provider | `60000` to `180000` | Should not call real provider. |
| Normal local/staging real-provider validation | `1800000` | 30 minutes; requires manual confirmation before real call. |
| Long media edge-case validation | `2700000` | 45 minutes; use only with dedicated test media and non-production key. |
| Production | Change only after approval | Keep recoverable `provider_running`; do not hide slow provider behavior by unlimited polling. |

Media preflight thresholds:

```bash
ALI_VIDEORETALK_MEDIA_MAX_SOURCE_DURATION_SECONDS=120
ALI_VIDEORETALK_MEDIA_MAX_SOURCE_SIZE_BYTES=314572800
ALI_VIDEORETALK_MEDIA_MAX_PREPARED_DURATION_SECONDS=120
ALI_VIDEORETALK_MEDIA_MAX_PREPARED_SIZE_BYTES=314572800
ALI_VIDEORETALK_MEDIA_MAX_PREPARED_WIDTH=2048
ALI_VIDEORETALK_MEDIA_MAX_PREPARED_HEIGHT=2048
ALI_VIDEORETALK_MEDIA_ALLOWED_PIX_FMTS=
ALI_VIDEORETALK_MEDIA_MAX_AUDIO_DURATION_SECONDS=120
ALI_VIDEORETALK_MEDIA_MAX_AUDIO_SIZE_BYTES=31457280
```

Operational meaning:
- `source` thresholds validate the uploaded avatar video before provider submission.
- `prepared` thresholds validate the backend-normalized provider input video.
- `audio` thresholds validate the driving audio after container normalization.
- Leave `ALI_VIDEORETALK_MEDIA_ALLOWED_PIX_FMTS` empty by default to avoid unnecessary blocking; configure it only when provider docs require explicit formats.
- Over-limit media should fail before Aliyun submission with a readable 4xx error.
- Bitrate is diagnostic-only and must not be used as a blocking threshold.
- `provider_running` means Aliyun is still processing after local foreground polling budget. It is not a terminal failure.

Log retention:
- Keep API container logs for at least 7 days in staging and production.
- Keep task evidence in `task_statuses.result_json` until normal task cleanup TTL expires.
- For long-running provider cases, preserve `provider.requestId`, `provider.taskId`, `provider.lastResponse`, `provider.recoverUntil`, and `metadataJson.mediaPreflight`.

Local Docker log commands:

```bash
docker compose logs --since 2h api | grep -Ei "videoretalk|lipsync|provider_running|RUNNING_TIMEOUT|mediaPreflight|ffprobe"
docker compose exec mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "SELECT id, kind, status, progress, updated_at, JSON_EXTRACT(result_json, '$.provider.taskId') AS provider_task_id FROM task_statuses WHERE kind='video-lipsync' ORDER BY updated_at DESC LIMIT 20;"
```

Local SQLite inspection:

```bash
sqlite3 backend/data/app.db "SELECT id, kind, status, progress, updated_at, json_extract(result_json, '$.provider.taskId') AS provider_task_id, json_extract(result_json, '$.provider.recoverUntil') AS recover_until FROM task_statuses WHERE kind='video-lipsync' ORDER BY updated_at DESC LIMIT 20;"
sqlite3 backend/data/app.db "SELECT id, project_id, audio_asset_id, avatar_resource_id, digital_human_video_asset_id, lipsync_task_id, updated_at FROM video_project_stage_states ORDER BY updated_at DESC LIMIT 20;"
```

Recovery troubleshooting checklist:
- Confirm the frontend did not submit a second provider task for the same user action.
- Confirm `task_statuses.status='provider_running'` still contains `provider.taskId`.
- Confirm `provider.recoverUntil` has not expired.
- Confirm the original `audioAssetId`, `avatarResourceId`, and `projectId` still belong to the same user.
- Check whether `digital_human_video_assets` was created after provider completion.
- Check whether `video_project_stage_states.digital_human_video_asset_id` and `lipsync_task_id` were updated together.

Manual ffprobe summary command:

```bash
ffprobe -v error -show_entries format=format_name,duration,size,bit_rate -show_entries stream=codec_type,codec_name,width,height,coded_width,coded_height,sample_aspect_ratio,display_aspect_ratio,avg_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries,bit_rate -of json path/to/media.mp4
```

## OPS-CORE-001 Core Flow Runtime Gate

Scope:
- This gate prepares local and staging only. It must not trigger production publish, restart, rollback, or real paid provider calls without explicit confirmation.
- The checked core flow is: script extraction -> voice clone / TTS audio -> subtitle timeline -> VideoRetalk talking-head output -> final smart clip render.

Required local/staging runtime paths:

```bash
UPLOAD_DIR=/workspace/uploads
TEMP_DIR=/workspace/tmp
VIDEO_SAVE_DIR=/workspace/data/download-video
PREVIEW_VIDEO_SAVE_DIR=/workspace/data/preview-videos
PREVIEW_AUDIO_SAVE_DIR=/workspace/data/preview-audios
LIP_SYNC_PUBLIC_MEDIA_DIR=/workspace/data/lip-sync-public
```

Required runtime binaries:

```bash
FFMPEG_BIN=/usr/bin/ffmpeg
FFPROBE_BIN=/usr/bin/ffprobe
YTDLP_BIN=/usr/local/bin/yt-dlp
ASR_PYTHON_BIN=python3
ASR_FUNASR_SCRIPT=/workspace/scripts/dashscope_funasr_transcribe.py
```

Core-flow switches:

```bash
ENABLE_LEGACY_TOOLS_ENDPOINTS=false
ENABLE_LEGACY_TASKS_ENDPOINTS=false
```

Real provider checks are opt-in:

```bash
CORE_FLOW_REAL_PROVIDER=1
DASHSCOPE_API_KEY=...
DASHSCOPE_ASR_BASE_URL=https://dashscope.aliyuncs.com/api/v1
DASHSCOPE_TTS_BASE_URL=https://dashscope.aliyuncs.com/api/v1
TTS_API_URL=https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
LIP_SYNC_PROVIDER=aliyun-videoretalk
VIDEO_RETALK_API_URL=https://dashscope.aliyuncs.com/api/v1/services/aigc/image2video/video-synthesis/
```

Validation commands:

```bash
COMPOSE_ENV_FILE=.deploy.env PREFLIGHT_SKIP_DB=1 bash scripts/preflight-check.sh
COMPOSE_ENV_FILE=.deploy.env bash scripts/preflight-check.sh
FRONTEND_URL=http://127.0.0.1:8080 API_BASE_URL=http://127.0.0.1:8080/api bash scripts/smoke-test.sh
```

Nginx requirements:
- `/api` reverse proxy must forward `Range` and `If-Range`.
- Upload and output media must support byte-range playback for browser video/audio preview.
- `PUBLIC_BASE_URL`, `PUBLIC_UPLOAD_BASE_URL`, and `CORS_ORIGINS` must match the actual staging/public entry.
