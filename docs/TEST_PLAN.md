# Test Plan

## QA-CORE-001 Core Flow Recovery

当前必须优先执行完整主链路验收，直到本地流程重新稳定跑通。

验收路径：

1. 文案：提取爆款文案或手写文案，创建 `video_projects`，确认 `projectId`、`video-script`、`scriptHash` 写入。
2. 音频：选择/克隆音色，调用 `POST /api/v1/audio-assets/generate`，确认 `audioAssetId`、试听 URL、duration。
3. 字幕：调用 `POST /api/v1/audio-assets/:id/subtitle-track`，请求体必须包含当前 `projectId`、`scriptText`、`scriptSegments`；返回和后续 GET 都必须为 `source=tts_alignment`，条数等于 `scriptSegments.length`。
4. 口型：调用 `POST /api/v1/video-projects/:projectId/lipsync-tasks`，确认状态查询、失败提示、`provider_running` 恢复、成功写入 `digitalHumanVideoAssetId`。
5. 包装：调用 `POST /api/v1/video-projects/:projectId/package-render-tasks`，确认使用当前口型视频、字幕轨和字幕模板样式，最终输出视频可访问。

记录要求：

- 每一步记录 Request URL、Method、关键 payload、response 产物 ID、UI 状态、后端日志中的 taskId。
- 任一步失败，停止后续步骤，只回派该阶段对应 Agent。
- 不触发生产发布；真实付费 provider 调用需用户明确确认。可先用 mock/stub 跑状态机，但最终要在 staging 用小素材验一次真实主链路。

## OPS-038 VideoRetalk Ops Validation

- Validate configuration only; do not trigger real Aliyun VideoRetalk unless the user explicitly confirms a paid provider call.
- Check `.env.example`, `backend/.env.example`, `deploy/compose.env.example`, and `deploy/docker.env.example` include:
  - `ALI_VIDEORETALK_POLL_MAX_MS`
  - `ALI_VIDEORETALK_POLL_INTERVAL_MS`
  - `ALI_VIDEORETALK_RECOVER_WINDOW_MS`
  - `ALI_VIDEORETALK_INPUT_MAX_BYTES`
  - `ALI_VIDEORETALK_MEDIA_*` preflight thresholds
- For local/staging real-provider validation, use a dedicated test account, non-production key, and small test media first.
- For `provider_running` cases, verify `task_statuses.result_json.provider.taskId` and `recoverUntil` are persisted before any manual troubleshooting.
- Use `docs/DEPLOY.md#ops-038-aliyun-videoretalk-runbook` for log and DB inspection commands.

## OPS-CORE-001 Runtime Gate Validation

- Validate local/staging configuration only; do not trigger production deploy/restart/rollback or real paid provider calls unless explicitly confirmed.
- Required static checks:
  - `bash -n scripts/preflight-check.sh scripts/smoke-test.sh scripts/deploy-staging.sh scripts/deploy-prod.sh`
  - YAML parse or `docker compose --env-file .deploy.env config`
  - `git diff --check` for deployment/script/doc files
- Required preflight checks:
  - `UPLOAD_DIR`, `UPLOAD_DIR/tmp`, `TEMP_DIR`, `VIDEO_SAVE_DIR`, preview dirs, and `LIP_SYNC_PUBLIC_MEDIA_DIR` are writable.
  - `FFMPEG_BIN`, `FFPROBE_BIN`, `YTDLP_BIN`, `ASR_PYTHON_BIN`, and `ASR_FUNASR_SCRIPT` are configured.
  - `ENABLE_LEGACY_TOOLS_ENDPOINTS=false` and `ENABLE_LEGACY_TASKS_ENDPOINTS=false`.
  - Nginx proxy config forwards `Range` and `If-Range`.
- Real ASR/TTS/VideoRetalk provider env is enforced only when `CORE_FLOW_REAL_PROVIDER=1`.

## QA-048 LipSync Source Format Contract

- 测试目标：用户上传的数字人视频是什么格式，第二步最终口型预览就必须保持什么格式；除口型变化外，不允许改变画幅、比例、帧率、像素格式、色彩元数据、音轨策略和时长策略。
- 必测文件：源视频、预处理输入、provider 临时输出、第二步最终预览输出、第三步包装输出。
- 必测命令：对每个文件执行 ffprobe，至少检查 `format_name`、`width/height`、`coded_width/coded_height`、`sample_aspect_ratio`、`display_aspect_ratio`、`avg_frame_rate`、`pix_fmt`、`color_range/color_space/color_transfer/color_primaries`、音频流数量和 `duration`。
- 通过标准：`renderMode=preserveSourceAspect` 下第二步最终预览输出与源视频参数一致；provider 临时输出即使异常，也必须在最终保存前被恢复或导致任务失败。
- 失败标准：最终预览被改成 `1080x1920`、`coded_width/coded_height` 异常、fps 被强制为 30、色彩元数据丢失、音轨策略被错误改变，或失败任务仍创建成功 `digital_human_video_assets`。
- 第三步包装：只有用户明确选择最终输出画幅时才允许改变画布；否则第三步输入视频参数也应保持第二步最终预览输出。

## Test Strategy

当前是 V1.0 后优化阶段。默认不做破坏性测试，不自动触发真实付费 provider，不使用生产数据库和生产上传目录。

每个功能改动至少归入以下一种验证：

- 前端 UI：typecheck、build、关键页面浏览器验证。
- 后端接口：单测、build、curl 或 e2e。
- 数据结构：迁移检查、索引检查、跨账号隔离检查。
- 部署脚本：shell 语法、`docker compose config`、staging smoke。
- 长任务：任务创建、状态轮询、失败态、幂等复用、超时。

## Standard Commands

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix backend run test
npm --prefix backend run build
bash scripts/check-all.sh
bash scripts/smoke-test.sh
```

Windows 本地没有 Git Bash 时，可分别运行 npm 命令和 PowerShell 等价检查。

## Core Regression Matrix

### Auth And Permission

- 新注册普通用户不能使用创作和生成能力。
- 管理员开通权限后，用户可进入创作流程。
- 登录后可修改密码。
- 忘记密码通过手机号和身份证信息恢复。
- 非管理员不能访问 `/api/v1/admin/*`。

### Resource Isolation

- A 用户不能看到 B 用户的数字人视频、音色、字幕模板副本、生成音频、生成视频和最近提取记录。
- 私有视频和音频流接口未登录返回 `401`。
- 跨账号访问私有资源返回 `403` 或 `404`。
- 推荐资源可见但不可被普通用户修改。

### Audio And Subtitle

- 第一步点击下一步创建 `video_projects`，返回真实 `projectId`，任务名允许重复。
- 音频和字幕接口使用真实 `projectId`，不得为新任务继续写入 `studio-current`。
- `POST /api/v1/audio-assets/generate` 成功后返回可试听音频。
- 生成失败时前端在配音区域展示后端错误。
- `POST /api/v1/audio-assets/:id/subtitle-track` 生成 `startTime/endTime` 秒级字幕。
- 字幕轴生成必须支持 `scriptSegments`：当 ASR 原始结果只有 2 段、第二步口播文案为 N 段时，最终返回 N 条字幕，文本与文案分段一致，时间递增且不重叠。
- 当请求传入 `scriptSegments` 时，POST 响应与后续 GET 响应必须指向同一个 trackId，且 `source=tts_alignment`；如果返回 `source=asr`，视为验收失败。
- 前端 Network 验收必须同时记录 POST `/audio-assets/:id/subtitle-track` 的请求体、响应 trackId，以及 GET `/subtitle-tracks/:id` 的返回条数，防止误读音频生成阶段自动创建的 ASR 轨道。
- `PATCH /api/v1/subtitle-tracks/:id/cues` 保存用户修改后的字幕时间和文本。

### Creation Task Retention

- A 用户创建任务后，B 用户不能通过列表、详情或阶段状态接口读取。
- 同一用户可以创建同名任务，两个任务必须有不同 `projectId`。
- 刷新 `/studio?projectId=<id>` 后按该任务恢复文案、音频、字幕、数字人选择和阶段状态。
- 从任务列表进入已有任务时，不按音频名、文案、数字人视频或链接匹配其他任务结果。
- 归档任务不出现在默认列表，直接访问详情仍按产品规则返回归档状态或不可编辑状态。
- B 用户调用 A 用户 `projectId` 的 `render-final`、`lipsync-tasks`、`package-render-tasks`、`pd-events`、`detect-cut-points` 均应返回 `404`。
- 越权长任务请求失败后，检查没有新增 `task_statuses` 记录、没有返回 `taskId`、没有占用并发额度。

### Lipsync And Retention

- 选择当前用户视频后可看到预览。
- 创建口型任务后可轮询到 `completed` 或 `failed`。
- 未显式指定时，口型任务默认 `renderMode=preserveSourceAspect`，输出宽高不应被强制改为 `1080x1920`。
- 仅当显式选择 `renderMode=1080x1920` 时，才允许缩放/补边到竖版画幅。
- 成功后写入 `digital_human_video_assets` 和 `video_project_stage_states`。
- 刷新当前 `projectId` 的创作台后只恢复该任务音频和字幕时间轴，不自动恢复其他任务历史口型预览。
- 文案、音频、数字人视频或渲染模式变更后，清空当前口型结果并要求重新生成。
- 缺失文件的口型资产不返回可复用结果。

### Template Editing

- 公版模板只能预览和复制。
- 复制模板归属当前用户，可保存字幕、标题、封面和画幅样式。
- 切换模板不影响文案编辑框可读性。
- 保存后的模板样式参与最终包装成片。

### Title Assets

- 选中文案后可创建 `title_effect` mark。
- 标题素材任务异步创建并可查询状态。
- 成功素材有透明背景；失败原因可见。
- 删除 title mark 后，对应素材不参与最终合成。

### Package Render

- 最终成片请求使用已生成口型视频、音频资产、字幕轨道和模板样式。
- 不在最终成片接口里重新生成音频或口型。
- `POST /api/v1/video-projects/{otherUserProjectId}/package-render-tasks` 必须返回 `404`，不能创建 `pkg_*` 任务。
- 包装任务失败返回可读错误。

## Staging Smoke

staging 必须使用：

- 独立数据库。
- 独立上传目录或 OSS 前缀。
- 非生产付费密钥，或 mock provider。
- 测试账号和测试素材。

建议 smoke 项：

```bash
SMOKE_BASE_URL=http://staging.example.com \
SMOKE_USERNAME=test_user \
SMOKE_PASSWORD=test_password \
bash scripts/smoke-test.sh
```

## Production Read-Only Checks

未获得人工确认时，线上只允许只读或低风险检查：

- `/api/health`
- 登录测试账号。
- 页面可访问性。
- 静态资源加载状态。
- 不触发生成、不删除资源、不修改生产数据。

生产发布、重启、回滚和真实付费 provider 调用必须人工确认。

## Blocked Test Items

| Item | Reason | Required Confirmation |
|---|---|---|
| `QA-LIPSYNC-001` 真实长任务边界 | 可能调用真实 VideoRetalk 或其他付费 provider | 使用 staging/mock，或确认允许一次真实 provider 调用 |
| 生产部署 smoke | 可能涉及生产重启和缓存刷新 | 明确生产发布确认 |
| 破坏性迁移验证 | 会影响生产数据 | 备份、回滚方案和人工确认 |
