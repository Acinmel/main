# Queue And Async Tasks

## Principle

所有耗时媒体处理都必须异步化。HTTP 创建接口只负责校验、记录任务、返回 `taskId`，不在请求线程里等待 FFmpeg、ASR、TTS、口型生成或 Remotion/标题渲染完成。

## Current Task Types

| Kind | Purpose | Status Source |
|---|---|---|
| `video-lipsync` | 音频 + 数字人视频生成口型视频 | `task_statuses` |
| `video-package` | 字幕、标题、音频和视频包装成片 | `task_statuses` |
| `video-render` | 兼容旧视频渲染任务 | `task_statuses` |
| `pd-event` | 兼容旧剪辑/事件任务 | `task_statuses` |
| `title-asset` | 标题透明素材生成 | `video_title_asset` + render task 状态 |

## Status Model

通用任务：

- `pending`
- `processing`
- `completed`
- `failed`

标题素材：

- `pending`
- `processing`
- `success`
- `failed`

每个失败状态必须记录可展示的 `error_message`。

## Idempotency

- 前端每次点击生成应生成稳定的 `idempotencyKey`。
- 用户主动重试才允许创建新的 key 或传 `forceRetry=true`。
- `video-lipsync` 对近期 completed 任务支持复用，默认窗口由 `LIPSYNC_COMPLETED_DEDUPE_WINDOW_MS` 控制。
- 复用必须限定当前用户和当前项目，不能跨账号复用。

## Worker Boundaries

### API Layer

- 校验 JWT、账号状态和权限。
- 校验资源归属。
- 写入任务记录。
- 返回 `taskId/status`。

### Worker Or Service Layer

- 下载或读取输入媒体。
- 调用外部 provider。
- 执行 FFmpeg 或标题素材渲染。
- 写入输出资产表。
- 更新任务状态。
- 清理临时文件。

## Failure Handling

- provider 超时：任务标记 failed，保留 provider 错误摘要。
- 输入文件缺失：任务直接 failed，不重试。
- 输出文件校验失败：任务 failed，不能写入可复用资产。
- 前端轮询超时：不代表任务失败；当前工作流不再自动按音频和数字人匹配历史口型视频，用户需要重新生成或等待当前任务状态完成。

## Cleanup

- 过期 `pending/processing` 任务需要标记 failed 或清理。
- 临时文件目录需要定期清理。
- 不删除已登记且仍被项目引用的用户资产。

## Verification

```bash
npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand
npm --prefix backend run test -- title-assets.service.spec.ts --runInBand
npm --prefix backend run build
```
