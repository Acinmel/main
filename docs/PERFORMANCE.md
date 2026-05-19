# Backend Performance Notes

## Scope

This pass focuses on backend runtime safety under concurrent media and AI workloads:

- keep API requests from running unlimited ffmpeg or AI calls
- avoid large video responses being copied fully into memory when they can be streamed
- bound in-process task/transcript caches
- add persistent render task status and optional Redis status cache
- keep existing routes compatible; long-running routes return task status where needed

## Findings

| Path | Problem code pattern | Risk | Fix / recommendation |
| --- | --- | --- | --- |
| `backend/src/modules/tools/tools.controller.ts` | `FileInterceptor('video')` and `FileInterceptor('file')` with default memory uploads for large videos/audio | High | Large transient uploads now use disk storage and remove temp files in `finally`. |
| `backend/src/modules/tools/tools.controller.ts` | `fetch(videoUrl)` without timeout; output video previously copied with `arrayBuffer()` | High | Added URL safety check, fetch timeout, and streaming write with `pipeline`. |
| `backend/src/modules/tools/subtitle-workflow.service.ts` | Lip-sync result video download used `arrayBuffer()` then `writeFile` | High | Result video is streamed to draft file, with timeout and content-length guard. |
| `backend/src/integrations/media/ffmpeg-audio.service.ts` | Multiple ffmpeg/ffprobe `execFileAsync` calls could run concurrently without a shared cap | High | Added shared `FFMPEG_MAX_CONCURRENCY`, queue limit, and default timeout. |
| `backend/src/integrations/ai/*.service.ts` | AI provider calls had per-request timeout but no shared concurrency guard | High | Added shared `AI_API_MAX_CONCURRENCY` / `AI_API_QUEUE_LIMIT` limiter around major ASR, TTS, rewrite, image, video, lip-sync, and voice clone calls. |
| `backend/src/modules/tools/video-project-render.service.ts` | Final render tasks were tracked in an unbounded process `Map` only | High | Added in-process render queue, DB `task_statuses`, Redis status cache, TTL cleanup, and memory cap. |
| `backend/src/modules/tools/voice-preview-task.service.ts` | `voice-preview` TTS generation could hold API requests open and repeated clicks could launch duplicate provider work | High | Added async task creation, task status persistence/cache, latest-request-wins per user, bounded TTS queue, and bounded preview-audio file writes. |
| `backend/src/modules/tools/tools.controller.ts` | Preview audio stream lacked metadata/range support for fast browser audio probing | Medium | Added signed audio access plus `Content-Length`, `Accept-Ranges`, `Content-Range`, and 206/416 handling. |
| `backend/src/modules/resources/resources.controller.ts` | Avatar upload video stream accepted `Range` but returned full-file streams, so metadata probing could pull large videos | Medium | Added current-user scoped metadata endpoint plus `Range`, `206`, `416`, `Content-Range`, and `Accept-Ranges` handling for `avatar-video-files/*/stream`. |
| `backend/src/modules/tasks/tasks.service.ts` | In-memory task `Map` retained terminal tasks indefinitely | Medium | Added TTL cleanup, max size cap, and interval cleanup. |
| `backend/src/integrations/transcription/transcript.store.ts` | Transcript store `Map` retained rows indefinitely | Medium | Added TTL cleanup, max size cap, and interval cleanup. |
| `backend/src/modules/resources/resources.service.ts` | `SELECT *` on resource tables | Medium | Replaced with explicit resource column lists. |
| `backend/src/modules/admin/admin.service.ts` | Audit aggregation scanned all users/actions for list page | Medium | Aggregation now runs only for the current page user IDs; count/list queries run in parallel. |
| `backend/src/modules/works/user-works-persistence.service.ts` | `GET /v1/works` returned all user works without `LIMIT` | Medium | Added `page`/`limit` support with a default cap. Response keeps `items` and adds pagination metadata. |
| `backend/src/database/database.service.ts` | SQLite statements prepared repeatedly; query indexes were thin for list/admin access | Medium | Added bounded statement cache, busy timeout, task status table, and key indexes. |
| `backend/src/modules/admin/admin.service.ts` | Offset pagination remains for admin lists | Low/Medium | Kept API compatible. For very large data, add cursor pagination in a later API version. |
| `backend/src/app.config.ts` | Basic global rate bucket `Map` | Low | Existing cleanup keeps this bounded by request window; tune env limits in production. |

## Runtime knobs

Use conservative defaults first, then raise them with real CPU, memory, and provider quota data.

```env
AI_API_MAX_CONCURRENCY=4
AI_API_QUEUE_LIMIT=100
AI_API_MAX_RETRIES=0
AI_API_RETRY_DELAY_MS=500
FFMPEG_MAX_CONCURRENCY=2
FFMPEG_QUEUE_LIMIT=20
FFMPEG_TIMEOUT_MS=1200000
RENDER_QUEUE_CONCURRENCY=1
RENDER_QUEUE_LIMIT=50
VOICE_PREVIEW_QUEUE_CONCURRENCY=2
VOICE_PREVIEW_QUEUE_LIMIT=50
VOICE_PREVIEW_FILE_CONCURRENCY=2
VOICE_PREVIEW_FILE_QUEUE_LIMIT=20
VOICE_PREVIEW_TASK_MEMORY_MAX=500
VOICE_PREVIEW_TASK_MEMORY_TTL_MS=21600000
PREVIEW_AUDIO_URL_TTL_SECONDS=7200

TASK_STATUS_REDIS_URL=redis://127.0.0.1:6379
TASK_STATUS_CACHE_TTL_SECONDS=86400
TASK_STATUS_TTL_MS=86400000
TASK_STATUS_CLEANUP_INTERVAL_MS=600000

RENDER_TASK_MEMORY_MAX=500
RENDER_TASK_MEMORY_TTL_MS=21600000
TASK_CACHE_MAX=1000
TASK_CACHE_TTL_MS=21600000
TRANSCRIPT_STORE_MAX=200
TRANSCRIPT_STORE_TTL_MS=21600000

REMOTE_MEDIA_FETCH_TIMEOUT_MS=120000
VIDEO_OUTPUT_FETCH_TIMEOUT_MS=300000
VIDEO_FETCH_MAX_BYTES=209715200
LIP_SYNC_RESULT_MAX_BYTES=524288000
```

## Remaining production risks

- SQLite still runs synchronously in process. It is acceptable for local/dev, but production should use MySQL with tuned connection limits.
- Some provider APIs require multipart/body buffers, so memory still scales with accepted upload size. Keep `TRANSCRIBE_MEDIA_MAX_BYTES` and lip-sync upload limits aligned with machine memory.
- Offset pagination remains on existing admin routes for compatibility. Cursor pagination is the next safe upgrade when data volume grows.
- AI retries are supported by the shared limiter, but defaults stay conservative. Use provider-specific retries for async task creation endpoints because duplicate provider jobs can be created.

## File Size Optimization Notes

2026-05-18 file-size pass:

- Frontend production build output dropped from 4,434,344 bytes to 2,451,825 bytes by limiting `@fontsource` imports to Latin subsets and downscaling landing platform logos from 512px PNGs to 128px PNGs.
- Frontend `dist` still contains no `.map` files. Largest JS chunks remain `vendor-naive-core` at 361KB and `vendor-naive-data` at 188KB; the current `manualChunks` split is effective enough for this pass.
- Removed generated `frontend/src/**/*.js` side files and top-level PNG backups that had imported `.webp` equivalents, reducing source tree payload by about 15.5MB.
- Backend npm install size dropped from about 626MiB to about 211MiB by removing `ffmpeg-static` and `ffprobe-static`. Runtime continues to resolve `FFMPEG_BIN` / `FFPROBE_BIN`, `backend/ffmpeg/bin`, then PATH; Docker images install system `ffmpeg`.
- Backend Docker build context now ignores local `ffmpeg/`, `uploads/`, `data/`, logs, media, and temp files. These are runtime volumes or local artifacts, not source inputs.
