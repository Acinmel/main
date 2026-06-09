# Changelog

## 2026-05-27 BE-CORE-008 VideoRetalk Preflight Baseline

- `SubtitleWorkflowService` media preflight default thresholds are now provider-aligned: `120s`, `300MB`, max side `2048`, audio `30MB`.
- `ALI_VIDEORETALK_MEDIA_ALLOWED_PIX_FMTS` default is now empty, so pix_fmt is blocked only when explicitly configured.
- Kept bitrate as diagnostic-only (log, no blocking).
- Synced root/backend/deploy env examples and `docs/DEPLOY.md`; added unit test coverage in `subtitle-workflow.service.spec.ts`.

## 2026-05-27 OPS-CORE-001 Core Flow Runtime Gate

- Added local/staging core-flow preflight checks for writable upload/temp/media directories, `uploads/tmp`, `ffprobe`, ASR script presence, legacy endpoint switches, and Nginx Range forwarding.
- Added Docker Compose environment passthrough for `FFPROBE_BIN`, `ENABLE_LEGACY_TOOLS_ENDPOINTS`, and `ENABLE_LEGACY_TASKS_ENDPOINTS`.
- Documented the local/staging runtime gate and kept real ASR/TTS/VideoRetalk provider validation opt-in through `CORE_FLOW_REAL_PROVIDER=1`.

## 2026-05-27 FE-PERF-CORE-001 Core Flow Polling

- `/studio` package-render polling now uses a single recursive timer with `taskId` and `pollSeq` stale-response checks.
- Removed duplicate status refresh immediately after package task creation; the polling loop owns the first and subsequent reads.
- Package render terminal, failed, and timeout states release the submit lock for retry.

## 2026-05-27 BE-CLEAN-004 Backend Slimming

- Removed legacy-only AI providers from `backend/src/integrations/ai/ai.module.ts`: `VideoGenerateLlmService`, `SeedanceI2vService`, `ArkI2vVideoService`.
- Removed corresponding injections and deprecated route handlers from `backend/src/modules/tools/tools.controller.ts`: `generate-video-preview`, `seedance-i2v-async`, `ark-i2v-task`.
- Deleted unused legacy service files:
  - `backend/src/integrations/ai/video-generate-llm.service.ts`
  - `backend/src/integrations/ai/seedance-i2v.service.ts`
  - `backend/src/integrations/ai/ark-i2v-video.service.ts`
- Regression check passed: `npm --prefix backend run build`, `npm --prefix backend run test`.

## 2026-05-27 OPS-038 VideoRetalk Ops Runbook

- Added local/staging Aliyun VideoRetalk operations guidance for polling budget, `provider_running` recovery, media preflight limits, log retention, and troubleshooting commands.
- Added VideoRetalk preflight and recovery environment variables to root/backend/deploy env examples.
- Documented that real provider validation requires explicit manual confirmation and must not use production data or production keys.

## 2026-05-27 BE-CLEAN-002 Legacy Tools Kill-Switch

- Added a backend kill-switch for high-risk legacy tools endpoints in `backend/src/app.config.ts`.
- Default behavior is disabled (`410 Gone`) to prevent bypass of project-scoped checks, media preflight, SSRF hardening, and provider dedupe flow.
- Optional compatibility switch for test environments: `ENABLE_LEGACY_TOOLS_ENDPOINTS=true`.
- Added e2e coverage in `backend/test/tools-pipeline.e2e-spec.ts` to assert disabled endpoints return `410`.

## 2026-05-27 FE-PERF-012 Stage State Save Queue

- `/studio` step-2 `stage-state` saves now use a latest-only queue: identical pending/done payloads are skipped, and rapid avatar/model/quality changes keep only the newest unsent payload.
- `PUT stage-state` is serialized to one in-flight request; stale results only complete when they still belong to the current `projectId` and latest save sequence.
- Project switch, route leave, and component unmount abort the active save and clear queued stale payloads.

## 2026-05-26 QA-048 LipSync Source Format Contract

- QA-048 验收口径收敛为源视频格式合同：用户上传视频的格式参数必须贯穿到第二步最终口型预览，除口型变化外不允许改变画幅、比例、帧率、像素格式、色彩元数据和音轨策略。
- `BE-072` 调整为后端必须记录 source/provider/final 三段 ffprobe 摘要，并在 provider 输出异常时恢复到源格式或让任务失败，不得保存异常成功资产。
- `QA-049` 调整为对源视频、预处理输入、provider 临时输出、第二步最终预览输出和第三步包装输出做 ffprobe 验收。

## 2026-05-26 BE-070 Preserve Source Aspect For LipSync

- `prepareVideoForAliLipSync()` 与 `normalizeVideoForRenderMode()` 已支持真正 `preserveSourceAspect`：不再默认注入 `scale/pad` 过滤器。
- 第二步口型任务默认 `renderMode` 改为 `preserveSourceAspect`，不再默认按 `adaptive` 重写尺寸。
- `1080x1920` 仍保留，仅在明确选择竖版输出时使用。
- 新增单测覆盖 `preserveSourceAspect` 下 `ffmpeg` 参数不包含 `-vf scale/pad`。

## 2026-05-26 CosyVoice TTS Rate Control

- 生成音频统一收敛到阿里云 CosyVoice SpeechSynthesizer。
- `voiceRate` 继续由前端语速滑块传入，并透传为阿里云 `parameters.rate`。
- 历史音色若保存了非 CosyVoice 合成模型，生成音频时不再走旧的 multimodal generation 路径。

## 2026-05-26 VideoRetalk Input Size Guard

- 后端新增 Aliyun VideoRetalk 输入大小前置校验：视频和音频单文件默认上限 300MB（可通过 `ALI_VIDEORETALK_INPUT_MAX_BYTES` 配置）。
- 超限时在后端直接返回 `400 Bad Request`，避免任务进入 provider 后才失败并消耗轮询时间。
- 新增单测覆盖超限拦截：`ali-lip-sync.service.spec.ts`。

## 2026-05-26 BE-069 Subtitle Source Boundary

- `POST /api/v1/audio-assets/:id/subtitle-track` 仅在显式传入 `scriptSegments` 时生成 `source=tts_alignment` 字幕轨。
- 音频生成阶段自动创建字幕轨恢复为 ASR 轨道（`source=asr`），避免与“按文案分段字幕轴”混用。
- 分段字幕轨新增强校验：`subtitles.length` 必须等于传入的 `scriptSegments.length`，否则返回错误。
- 创建字幕轨后同步更新 `audio_assets.subtitle_track_id` 与 `video_project_stage_states.subtitle_track_id`，减少前端读取旧轨道的风险。
- 新增后端日志字段：`requestedSegmentCount`、`cueCount`、`alignmentSource`，用于 QA 抓包定位。

## 2026-05-25 BE-068 Subtitle Cue Alignment

- `POST /api/v1/audio-assets/:id/subtitle-track` 新增支持 `projectId`、`scriptText`、`scriptSegments` 入参。
- 当传入 `scriptSegments` 时，字幕轨优先按文案分段生成 `N` 条 `cues`，不再直接等于 ASR 原始段数。
- 新增时长对齐逻辑：使用 ASR 时间边界 + 音频时长兜底，确保 `startTime/endTime` 递增且不重叠。
- 保留并强化 `projectId` 归属校验，跨项目音频资产创建字幕轨返回 `400`。
- 补充 `staged-workflow` controller/service 单测覆盖。

## 2026-05-25 Studio Legacy Residual Cleanup

- `/studio` 第一步到第三步完成旧逻辑残留复查：新流程使用真实 `projectId`，不再主动调用历史口型自动匹配接口。
- 清理前端不可达旧音色校验分支和未使用的 `listSavedVideos()` API 包装，降低后续误用旧 saved-videos 入口的风险。
- 后端 legacy `studio-current`、`lipsync-assets/resolve` 和旧 `video-script` 路径仍保留兼容，但不作为当前前端主流程入口。

## 2026-05-25 Video Script Empty State

- 修复新建创作任务进入第二页时浏览器 Network 出现 `GET /api/video-script/:projectId` 404 的问题。
- 未保存智能剪辑文案配置现在返回 `200 data=null`，前端按正常空状态继续流程。
- 前端 video-script API 已统一为 `/api/v1/video-script/*`。

本文件只记录 V1.0 后仍影响当前系统行为的关键变化。历史排查流水、失败中间态和过期任务细节不再追加到这里。

## 2026-05-25

### ARCH-017 Project-Scoped Long Task Boundary

- 明确所有带 `projectId` 的长任务创建接口必须先校验 `video_projects.id + user_id`。
- 校验必须发生在 dedupe、并发计数、任务持久化和外部 provider 调用之前。
- 跨账号请求统一返回 `404`，不得返回 `taskId`，不得创建 `task_statuses`，不得占用并发额度。
- `studio-current` 只保留旧 stage-state/resolve 兼容，不作为新长任务创建入口。

### BE-066 Ownership Guard Implementation

- `VideoProjectRenderService` 新增统一 `assertOwnedProject(userId, projectId)`。
- 已覆盖 `detect-cut-points`、`render-final`、`lipsync-tasks`、`package-render-tasks`、`pd-events` 入口前置校验。
- 越权请求在 dedupe、并发校验、任务持久化之前即返回 `404`，不会创建内存 task，不会写入 `task_statuses`。
- 新增单测覆盖跨账号拦截与“无任务创建”断言。

### FE-PERF-009/010 Studio Request Control

- `/studio` 第二步口型轮询增加 in-flight 请求取消，避免同一 `taskId` 产生并发状态查询。
- 第三步标题素材轮询改为单 `markId` 单 timeout 链，增加活跃数量、轮询次数和总时长上限。
- `stage-state`、`video-script/save`、`subtitle-tracks/:id/cues` 增加稳定 payload key 去重，相同 pending/done 内容不重复提交。
- 保存失败仍展示原有错误提示，并释放 pending key 允许用户再次触发保存。

### FE-PERF-008 Task List Performance

- 新增 `/projects` 创作任务列表入口，支持按进行中、已归档、全部分页读取当前账号任务。
- 任务列表支持打开详情前预检、改名、归档和恢复，操作期间显示加载态并禁止重复点击。
- `videoProjects` 前端 API 增加列表、改名、归档/恢复和 `AbortSignal` 支持。
- 创作台项目详情与 stage-state 恢复请求支持取消陈旧请求；恢复期间不挂载大视频预览，避免视频初始化阻塞任务恢复。

### BE-065 Project Binding And Isolation

- 音频资产、字幕轨道、口型产物、包装渲染和 stage-state 全链路增加 `projectId` 归属校验并强绑定写入。
- `studio-current` 仅保留遗留兼容：未传 `projectId` 时回退到 `studio-current`，并兼容命中 legacy `project_id IS NULL` 记录。
- `lipsync-assets/resolve` 兼容 legacy 数据查询，但新流程保持 `userId + projectId` 精确匹配，不跨项目复用。
- 新增后端测试覆盖：跨账号项目访问拦截、跨项目音频引用拦截、缓存逻辑回归。

### Video Projects CRUD

- 新增创作任务主表 `video_projects`（SQLite/MySQL），按 `user_id` 隔离。
- 新增创作任务接口：
  - `POST /api/v1/video-projects`
  - `GET /api/v1/video-projects`
  - `GET /api/v1/video-projects/:projectId`
  - `PATCH /api/v1/video-projects/:projectId`
  - `POST /api/v1/video-projects/:projectId/archive`
- 任务名允许重复，`projectId` 为唯一主键；支持改名和归档，不删除底层音视频资产。

### ARCH-016 Creation Task Container

- 确定新增 `video_projects` 作为创作任务主实体。
- 任务名只用于展示和搜索，允许重复；`projectId` 是文案、音频、字幕、口型、模板和包装成片的唯一关联点。
- 新流程不再使用音频名、文案、数字人视频、爬取链接或画幅自动匹配历史口型结果。
- `video_project_stage_states` 保留为真实 `projectId` 下的阶段快照，旧 `studio-current` 只作为遗留兼容。

### Documentation Cleanup

- 压缩项目状态、任务看板、路线图和核心 docs。
- 删除历史流水账、乱码段落、旧接口验收记录和已经失效的中间结论。
- 文档重新对齐当前核心流程：音频资产、字幕时间轴、口型资产、阶段状态恢复、模板编辑和包装成片。

### Package Render Temp Directory

- 修复第三步“立即剪辑”在本地 `uploads/tmp` 不存在时报 `ENOENT mkdtemp ...package-render-XXXXXX` 的问题。
- 包装成片和音频探测创建临时目录前，会先递归创建运行临时根目录。

### Stage 2 Lipsync Auto Matching

- 移除前端第二步历史口型视频自动匹配逻辑。
- `/studio` 不再调用 `lipsync-assets/resolve`，刷新后只恢复音频和字幕时间轴。
- 第三步只使用当前页面本次生成成功得到的 `digitalHumanVideoAssetId`。

### Stage 2 Result Retention

- 增加 `video_project_stage_states` 作为创作台阶段状态。
- 增加 `GET/PUT /api/v1/video-projects/:projectId/stage-state`。
- 前端进入第二步或刷新后自动恢复音频试听和字幕时间轴。

### Stage State Cache And Pending Error Code

- `GET /api/v1/video-projects/:projectId/stage-state` 增加 `Cache-Control: no-store` 等响应头，避免浏览器缓存协商返回 `304` 后误用阶段状态。
- 待审核账号访问业务接口时，后端 `403` 增加结构化错误码 `ACCOUNT_PENDING`，便于前端稳定识别并跳转待审核页。

### Local Lipsync Preview

- 本地 Vite 增加 `/uploads` 预览代理。
- 第二步生成口型视频后支持大预览弹窗。
- 口型预览失败时不再静默显示空视频框。

### Audio And ASR Stability

- TTS 音频进入 ASR 前统一转为 `16kHz mono wav`。
- 音频生成失败时在第二步配音区域展示后端错误。
- 生成字幕时间轴使用秒级 `startTime/endTime`。

### Template Editing

- 字幕模板采用“公版只读、复制后编辑”的模式。
- 用户模板保存字幕、标题、封面、画幅和位置样式。
- 包装成片读取保存后的模板样式。

## 2026-05-24

### V1.0 Baseline

- 线上主流程通过：文案、音频、数字人视频、口型生成、字幕模板、标题素材、最终成片。
- 项目阶段切换为 V1.0 后优化与稳定性迭代。

### Resource Isolation

- 数字人视频、音色、字幕模板、最近提取记录按当前用户隔离。
- 私有资源流接口要求鉴权和归属校验。
- 普通新注册用户默认无权限，需管理员开通后使用。

### Title Assets

- 文案 marks 支持 `title_effect`。
- 标题素材任务使用异步渲染。
- 最终成片可叠加透明标题素材。

## Ongoing

- `QA-LIPSYNC-001`：真实口型长任务边界测试待 staging/mock 或人工确认。
- `OPS-PROD-001`：生产 HTTPS、缓存、发布和回滚路径待人工确认后执行。
