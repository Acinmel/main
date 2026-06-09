# Performance

## Current Priorities

1. 避免重复调用高成本 AI provider。
2. 视频和音频预览要尽快出现可见反馈。
3. 前端恢复状态不能产生重复请求或陈旧回填。
4. 包装成片不重复执行音频生成和口型生成。
5. 模板预览图不能使用生产内联大图。

## Frontend

### Request Control

- `/studio` package-render polling must have one owner: recursive timer, one in-flight request, active `taskId`, and `pollSeq` stale-response guard; do not issue a separate immediate refresh after task creation.
- `/studio` step-2 `stage-state` saves must use a latest-only serialized queue: identical payload keys are skipped, older unsent payloads are replaced, and project switch/route leave/unmount aborts active saves and clears stale queued payloads.
- `stage-state`、`audio-assets`、`subtitle-tracks` 请求支持 `AbortSignal`。
- 用户快速切换文案、音频、数字人或模板时，旧请求不能覆盖新状态。
- 长任务轮询只对 `pending/processing` 状态继续，不对成功任务重复轮询。
- `/studio` 口型、包装成片和标题素材轮询必须保持单任务单定时器、单 in-flight 请求；切换 `projectId`、离开路由、组件卸载、完成、失败或超时时必须清理 timer 与 abort controller。
- 标题素材轮询按 `markId` 限制活跃数量、次数和总时长，避免批量标题标记造成前端轮询风暴。
- `stage-state`、`video-script/save`、`subtitle-tracks/:id/cues` 保存请求必须基于稳定 payload key 去重；相同 pending/done 内容不重复提交，失败后释放 pending 并保留错误提示。

### Media Preview

- 视频选择后先展示封面或轻量预览。
- 完整视频流加载使用固定尺寸容器，避免布局跳动。
- 大视频预览优先使用后端 Range/stream 或短时签名地址。
- 口型视频不做历史自动匹配；输入变更后必须清空当前口型预览，避免第三步误用。

### Bundle And Layout

- 创作台大组件继续拆分到 `frontend/src/components/studio` 和 composable。
- 资源库、模板编辑器、视觉编辑器可按入口懒加载。
- 字幕/标题编辑器滚动区域必须限制高度，不推动全页反复重排。

## Backend

### Idempotency

- `video-lipsync` 使用稳定 `dedupeKey`。
- 同一用户同一 dedupe key 的近期 completed 任务可以直接复用。
- 显式重新生成必须使用 `forceRetry=true` 或新的点击意图 key。

### Async Tasks

- 音频、ASR、口型、标题素材和包装成片都不得阻塞 HTTP 请求线程。
- 任务必须有状态、进度、错误原因、超时和过期清理。
- 外部 provider 调用必须设置超时。

### Database

关键查询必须走索引：

- `digital_human_video_assets` 复用查询。
- `video_project_stage_states` 当前项目状态。
- `audio_assets` 当前用户项目列表。
- `subtitle_tracks` 当前用户项目列表。
- `task_statuses` 当前用户任务列表和状态清理。

## Media Quality

- 默认目标不是压缩原视频，而是在必要处理后尽量保留画面质量。
- 只改嘴型时，应优先保持原分辨率、帧率、色彩空间和码率策略。
- FFmpeg 参数变更必须验证：
  - 分辨率。
  - fps。
  - 色彩范围和色彩矩阵。
  - 视频码率或 CRF。
  - 音视频同步。

## Checks

```bash
npm --prefix frontend run build
npm --prefix backend run test
npm --prefix backend run build
npm run check:staged-db
npm run check:subtitle-template-db
```

## Watch Items

- 真实 VideoRetalk 长任务的超时和状态同步。
- 生产视频色彩偏移和清晰度变化。
- 大文件 Range 请求和 Nginx 缓存策略。
- 字幕模板列表和预览图加载性能。
