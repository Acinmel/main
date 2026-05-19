# Deploying Media Workers

## Minimal deployment

The current code can run as one backend process with bounded in-process queues.

Required services:

- Node backend
- MySQL for production persistence
- Redis for fast task status cache, optional but recommended
- persistent upload/data volume
- ffmpeg/ffprobe available in the container or host

Minimum production env:

```env
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_DATABASE=shuziren
MYSQL_USER=shuziren
MYSQL_PASSWORD=change-me
MYSQL_CONNECTION_LIMIT=10

REDIS_URL=redis://redis:6379
TASK_STATUS_REDIS_URL=redis://redis:6379

UPLOAD_DIR=/workspace/uploads
FFMPEG_BIN=/usr/bin/ffmpeg
FFPROBE_BIN=/usr/bin/ffprobe

AI_API_MAX_CONCURRENCY=4
FFMPEG_MAX_CONCURRENCY=2
RENDER_QUEUE_CONCURRENCY=1
VOICE_PREVIEW_QUEUE_CONCURRENCY=2
VOICE_PREVIEW_FILE_CONCURRENCY=2
PREVIEW_AUDIO_STREAM_SECRET=change-me
```

## Worker split plan

For higher traffic, run API and worker separately.

API responsibilities:

- validate requests
- write task rows
- accept small metadata and upload references
- return task ids
- serve task status

Worker responsibilities:

- claim queued tasks
- run ffmpeg and AI provider calls
- write status/progress
- upload outputs
- remove temp files after completion/failure
- enforce latest-request-wins for per-user preview jobs, so repeated clicks do not publish stale audio

Recommended task claim pattern:

1. API inserts `task_statuses` row with `status=pending`.
2. Worker atomically claims one pending row.
3. Worker marks `processing`.
4. Worker heartbeats progress and timestamp.
5. Worker marks `completed` or `failed`.
6. Cleanup job deletes expired temp files and expired status rows.

## Process sizing

Start small and measure:

| Machine | API replicas | Worker replicas | `FFMPEG_MAX_CONCURRENCY` | `AI_API_MAX_CONCURRENCY` |
| --- | ---: | ---: | ---: | ---: |
| 2 core / 4 GB | 1 | 1 | 1 | 2 |
| 4 core / 8 GB | 1-2 | 1 | 2 | 4 |
| 8 core / 16 GB | 2 | 2 | 2 per worker | 4-6 per worker |

## Operational checks

- Confirm `docker compose config` is valid before deploy.
- Confirm upload/data directories are mounted and writable.
- Confirm ffmpeg path in container with `ffmpeg -version`.
- Confirm Redis connectivity from backend logs.
- Alert on API memory, worker memory, queue full errors, and provider timeout errors.
- Keep `TRANSCRIBE_MEDIA_MAX_BYTES`, lip-sync upload limits, and reverse-proxy body size aligned.

## Safe retry policy

Use retries only where duplicate provider side effects are acceptable:

- Safe: status polling GET, result file download, transient network reads.
- Provider-specific: chat/TTS/image calls if duplicate billing is acceptable.
- Avoid blind retry: async provider task creation, upload policy creation, and any endpoint that can create a paid job.

When retries are enabled, use short exponential backoff with jitter and keep the global AI limiter active.
