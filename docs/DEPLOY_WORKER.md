# Worker Deployment

当前版本不强制拆分独立 worker 服务。第一阶段继续使用后端进程内受控队列处理媒体任务，后续只有在并发和稳定性需要时再拆独立 worker。

## Current Worker Jobs

- TTS 音频生成。
- ASR 字幕时间轴生成。
- 口型视频生成。
- 标题透明素材生成。
- 包装成片。

## Required Runtime

- Node.js backend。
- SQLite 本地或 MySQL 生产库。
- FFmpeg 和 ffprobe。
- 持久化上传目录或 OSS。
- 外部 provider 的 API key。

## Environment

```env
UPLOAD_ROOT=/workspace/uploads
FFMPEG_BIN=/usr/bin/ffmpeg
FFPROBE_BIN=/usr/bin/ffprobe
LIPSYNC_COMPLETED_DEDUPE_WINDOW_MS=1800000
TITLE_ASSET_OUTPUT_DIR=/workspace/uploads/title-assets
TITLE_ASSET_TEMP_DIR=/workspace/tmp/title-assets
```

## Boundaries

- API 只创建任务并返回 `taskId`。
- worker 处理下载、provider 调用、FFmpeg、上传和状态更新。
- 高成本任务必须有限流、超时、失败态和幂等复用。
- staging 可以自动部署验证；production worker 重启必须人工确认。

## Verification

```bash
ffmpeg -version
ffprobe -version
npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand
npm --prefix backend run test -- title-assets.service.spec.ts --runInBand
npm --prefix backend run build
```
