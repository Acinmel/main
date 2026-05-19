# Backend Queue Model

## Current model

The project now uses lightweight in-process queues for the highest-risk workloads:

- `ffmpeg`: all ffmpeg/ffprobe calls go through one shared limiter.
- `ai-api`: major external AI calls go through one shared limiter.
- `render-final`: final smart-clip render work is queued asynchronously and the API returns a task id immediately.
- `voice-preview`: TTS preview work is queued asynchronously; repeated clicks by the same user supersede older unfinished preview tasks.

This is intentionally small-scope: it reduces blast radius without changing public routes.

## Render task lifecycle

1. API receives final render request.
2. `VideoProjectRenderService.createFinalRenderTask()` creates `render_xxx`.
3. Status is stored in memory, `task_statuses`, and Redis when configured.
4. Background execution enters `render-final` queue.
5. Progress callbacks update status.
6. Success/failure writes final status.
7. Expired rows and in-memory terminal tasks are cleaned by interval.

Status lookup order:

1. in-process memory
2. Redis task status cache
3. SQL `task_statuses`

## Database table

`task_statuses`

| Column | Purpose |
| --- | --- |
| `id` | Public task id, e.g. `render_xxx` |
| `user_id` | Owner guard for status lookup |
| `kind` | Task category, currently `video-render` or `voice-preview` |
| `status` | Render: `pending/processing/completed/failed`; voice preview: `queued/running/succeeded/failed` |
| `progress` | Integer percentage |
| `payload_json` | Small task metadata |
| `result_json` | Output URL/duration/hint |
| `error` | Failure reason |
| `expires_at` | Cleanup boundary |

Indexes:

- `(user_id, updated_at, id)`
- `(status, updated_at)`
- `(expires_at)`

## Recommended defaults

```env
FFMPEG_MAX_CONCURRENCY=2
FFMPEG_QUEUE_LIMIT=20
AI_API_MAX_CONCURRENCY=4
AI_API_QUEUE_LIMIT=100
AI_API_MAX_RETRIES=0
AI_API_RETRY_DELAY_MS=500
RENDER_QUEUE_CONCURRENCY=1
RENDER_QUEUE_LIMIT=50
VOICE_PREVIEW_QUEUE_CONCURRENCY=2
VOICE_PREVIEW_QUEUE_LIMIT=50
VOICE_PREVIEW_FILE_CONCURRENCY=2
VOICE_PREVIEW_FILE_QUEUE_LIMIT=20
VOICE_PREVIEW_TASK_MEMORY_MAX=500
VOICE_PREVIEW_TASK_MEMORY_TTL_MS=21600000
PREVIEW_AUDIO_URL_TTL_SECONDS=7200
```

For a 2-core VPS, start lower:

```env
FFMPEG_MAX_CONCURRENCY=1
AI_API_MAX_CONCURRENCY=2
RENDER_QUEUE_CONCURRENCY=1
```

## When to split workers

Move from in-process queues to a separate worker process when any of these are true:

- API p95 latency rises while render/ASR jobs are active
- ffmpeg jobs regularly exceed CPU capacity
- AI provider polling lasts many minutes
- API and worker need independent deploy/scale cycles
- memory usage spikes with concurrent uploads

Target split:

- API process: auth, upload validation, task creation, status reads
- Worker process: ffmpeg, ASR/TTS/image/video provider calls, temp cleanup
- Shared stores: MySQL + Redis + object storage

Keep provider keys only in server/worker env. Never expose GPU or provider endpoints directly to the browser.
