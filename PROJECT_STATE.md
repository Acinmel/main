# Project State

## 2026-05-27 Post-V1.0 Core Flow Impact Audit

- 结论：V1.0 后新增能力中，已经进入主链路并可能阻塞流程的只有 6 类：`video_projects/projectId` 任务容器、`scriptHash/stage-state` 阶段恢复、`tts_alignment` 字幕时间轴、`preserveSourceAspect` 口型保真、`provider_running` 口型长任务恢复、最终包装资产一致性校验。这些必须保留，但必须逐项完成端到端验收。
- 当前仍会造成主流程阻塞的点：`QA-CORE-001` 未跑通；缺少安全 mock/stub E2E；VideoRetalk 真实 provider 成功回写未复测；剩余媒体 preflight 仍有时长/体积/分辨率/像素格式/音频大小硬阈值；前端 `subtitleTimelineAligned`、模板选择、stage-state 恢复过严时会让第三步按钮不可用。
- 应冻结为可选能力的 V1.0+ 功能：Remotion/title assets、大标题素材、模板高级编辑/复制模板、封面编辑、项目列表性能优化、后端瘦身、legacy 删除、线上部署准备。这些功能不得成为第二步或第三步生成按钮的前置条件。
- 主流程当前最小验收路径固定为：创建 `projectId` -> 保存当前文案快照和 `scriptHash` -> CosyVoice 生成当前 `audioAssetId` -> 用当前 `scriptSegments` 生成 `source=tts_alignment` 且条数一致的 `subtitleTrackId` -> 当前音频和当前数字人生成 `digitalHumanVideoAssetId` -> 选择一个有效 `subtitleTemplateId` -> 包装成片。
- 下一步策略：先补 `BE-CORE-005/QA-CORE-002` 的安全 mock/stub 主链路，再做 `QA-CORE-004` V1.0 回归矩阵；在这之前，所有 Review 状态的主链路任务不得转 Done，所有非主链路新增需求继续冻结。

## 2026-05-27 ARCH-CORE-024 Boundary Review

- 审查结论：核心流程边界成立，但当前实现不完全通过。`subtitleTemplateId` 作为“字幕样式选择”可以是第三步必需项；复制模板、模板高级编辑、封面编辑、标题素材、Remotion 透明标题和线上部署都只能是可选能力。
- 已确认安全边界：`video-projects/:projectId/package-render-tasks` 已先校验项目归属，包装主链路只应强依赖 `digitalHumanVideoAssetId + audioAssetId + subtitleTrackId + subtitleTemplateId`；跨账号/跨项目资产一致性校验应继续保留。
- 发现的阻塞风险 1：前端 `smartClipIncludeTitleAssets` 当前默认 `true`，并传入包装任务；`StepThreeSmartEdit` 虽声明 `includeTitleAssets` props，但未真正把它作为用户可控的核心外开关展示。标题素材会在用户无感知时参与核心包装。
- 发现的阻塞风险 2：后端 project-scoped 包装路径在 `includeTitleAssets === true` 时调用 `overlayTitleAssets()`，当前没有降级捕获；若存在损坏的成功标题素材或叠加失败，最终包装任务会失败，等于让可选标题素材阻塞 V1.0 主链路。
- 发现的体验风险：第三步进度文案固定出现“标题叠加/封面效果”，即使本次没有标题素材也会暗示标题是必需流程。该文案应按实际开关/素材存在性显示，或改成中性“画面处理/音视频对齐”。
- 已更新看板：`ARCH-CORE-024` 审查完成；新增 `BE-CORE-009`，并收紧 `FE-CORE-003`、`QA-CORE-004` 的验收口径。

## 2026-05-27 BE-CORE-007 VideoRetalk Bitrate Gate Removed

- 已确认“预处理视频码率过高：20.81Mbps，最大允许 12.00Mbps”来自 `BE-PERF-013` 的 VideoRetalk 媒体 preflight，默认 `ALI_VIDEORETALK_MEDIA_MAX_PREPARED_BITRATE_BPS=12000000` 是我们为了减少 provider 排队超时加的保守硬阈值，不是核心业务必需条件。
- 已取消口型任务对源视频、预处理视频、输入音频的码率硬拦截；码率仍会通过 ffprobe 写入 `mediaPreflight` 诊断日志，但不再阻断提交。
- 仍保留必要体检：媒体必须可读、时长/体积/分辨率/像素格式在合理范围内，音频容器不一致时自动规范化，避免空文件、超大文件和明显 provider 不可处理输入。
- 已删除 env 示例和部署文档中的 `ALI_VIDEORETALK_MEDIA_MAX_*_BITRATE_BPS` 配置，防止后续再次配置出 12Mbps 阻断。
- 已重启本地后端：新进程 PID `19720`，健康检查 `GET /api/health` 返回 `ok=true`。验证通过：`npm --prefix backend run test -- subtitle-workflow.service.spec.ts --runInBand`、`npm --prefix backend run test`（28 suites / 173 tests）、`npm --prefix backend run build`。

## 2026-05-27 BE-CORE-006 VideoRetalk Timeout Recurrence Hotfix

- 复发原因已确认：本地 3000 后端进程 `node dist/main` 启动于 02:18，仍在运行旧内存代码；14:34 后构建出的 `provider_running` 修复没有被加载，所以 16:14 的 Aliyun `RUNNING` 任务又被写成 `failed`。
- 已补后端兜底：即使 VideoRetalk 超时以旧格式普通 `Error` 抛出（`Aliyun VideoRetalk task timed out after ... { output.task_status=RUNNING }`），也会解析出 provider task 并写入 `provider_running`，不再当真实失败。
- 已追加自愈机制：`GET /api/v1/render-tasks/:taskId` 读取到 lipsync `failed` 行时，会二次识别错误文案和 `result_json.provider`；若 provider 仍为 `RUNNING/PENDING/PROCESSING/SUBMITTED`，自动转回 `provider_running` 并触发恢复轮询。
- 已修正本地失败任务 `lipsync_0612948d-af36-41fa-97c3-338cbb21da0a`：状态从 `failed` 恢复为 `provider_running`，保留 Aliyun taskId/requestId，前端继续查询时可进入恢复链路，不需要重新提交 provider。
- 已重启本地后端：当前监听进程 PID `16132`，健康检查 `GET /api/health` 返回 `ok=true`。
- 验证通过：`npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`。

## 2026-05-27 FE-CORE-002 LipSync Preview Aspect

- 已检查第二步口型生成参数：前端 `getCurrentStageTwoRenderMode()` 固定返回 `preserveSourceAspect`，创建口型任务时传入 `renderMode=preserveSourceAspect`；后端 `video-lipsync` payload 默认也是 `preserveSourceAspect`。
- 已检查后端 FFmpeg 生成路径：`prepareVideoForAliLipSync()` 和 `normalizeVideoForRenderMode()` 在 `preserveSourceAspect` 下不走 1080x1920 的 `scale/pad` 竖版强制逻辑；若仍扭曲，下一步需要对真实输出文件执行 ffprobe 对比源视频和 provider 输出。
- 已修复前端预览框：第二步“预览口型视频”弹窗改为 9:16 frame，视频使用 `object-fit: contain` 等比显示，避免预览 CSS 拉伸造成误判。
- 验证通过：`npm --prefix frontend run build`。

## 2026-05-27 OPS-CORE-001 Update

- 已补齐本地/staging 主链路运行门禁：`scripts/preflight-check.sh` 现在检查上传目录、`uploads/tmp`、临时目录、预览/口型公开媒体目录可写性，以及 `ffmpeg/ffprobe/python dashscope/ASR script` 容器内可用性（容器运行时）。
- `docker-compose.yml` 与 `compose.runtime.yml` 已显式透传 `FFPROBE_BIN` 和 legacy 关闭开关，避免 staging 误启旧入口或缺少 ffprobe。
- `docs/DEPLOY.md`、`deploy/compose.env.example`、`docs/CHANGELOG.md` 已补充 OPS-CORE-001 本地/staging 运行条件；真实 provider 校验仍需显式 `CORE_FLOW_REAL_PROVIDER=1` 与人工确认，不触发生产发布。

## 2026-05-27 FE-CORE-001 Frontend Update

- 已完成 `/studio` 第二步到第三步状态门禁收敛：新增 `subtitleTimelineAligned`，只有 `subtitleTrackId` 存在且字幕轨通过 `tts_alignment` 对齐校验时，才允许进入第三步和最终渲染。
- 已修复旧 ASR 轨误恢复：项目恢复时校验字幕轨 `audioAssetId` 与当前音频一致且 `source=tts_alignment`，否则标记失败并清空 `stage-state.subtitleTrackId`，避免旧轨回填。
- 已修复失效模板回填：恢复文案配置后会校验 `selectedSubtitleTemplateId` 是否仍在当前模板列表，不存在则回退到可用模板，避免无效模板被当成已选。
- 第二步口型生成按钮禁用逻辑已改为依赖真实阶段产物（音频、字幕对齐、数字人），不再依赖“是否已选音色”这类非必需条件。
- 构建验证通过：`npm --prefix frontend run build`。

## 2026-05-27 FE-PERF-CORE-001 Frontend Update

- Core-flow frontend performance fix completed for `/studio` package-render polling.
- Step-3 package render now has one polling source: recursive `setTimeout` with one in-flight request, active `taskId`, and `pollSeq` stale-response guard.
- Removed the extra immediate `refreshSmartClipRenderTask()` after package task creation; the polling loop performs the first status read.
- Terminal, failed, and timeout states release `smartClipSubmitLocked` so the user can retry without refreshing the page.
- Verified: `npm --prefix frontend run lint`, `npm --prefix frontend run build`.

## 2026-05-27 Core Flow Recovery Mode

- 当前判断：项目已经从“局部优化”偏离到“核心链路不稳定”。在本地核心流程重新跑通前，所有 Agent 停止处理非主链路扩展、模板花样、后端瘦身和线上部署准备。
- 当前唯一 P0 主链路：提取爆款文案 -> 克隆/选择声音并生成音频 -> 按口播分段生成秒级字幕时间轴 -> 生成当前数字人口型视频 -> 用户选择字幕模板并渲染最终视频。
- 阶段产物必须显式串联：`projectId`、`scriptHash`、`audioAssetId`、`subtitleTrackId`、`digitalHumanVideoAssetId`、`subtitleTemplateId`、`packageRenderTaskId/finalVideoUrl`。不允许再用音频名称、文案、数字人名称、来源链接或旧 `studio-current` 自动匹配当前结果。
- 当前高风险阻塞点：字幕时间轴仍有 `source=asr`/条数不等于口播分段的验收失败记录；真实口型 provider 本地端到端未验收；最终包装曾出现 `uploads/tmp/package-render-*` 目录缺失；部分前端 API 文件仍保留 legacy 包装，需要确认不会被主流程误调。
- 执行策略：`TASK_BOARD.md` 已新增 `Core Flow Recovery Gate`。`QA-CORE-001` 本地端到端验收通过前，单元测试、build 或局部 mock 通过都只能算 `Review`，不能把主链路任务标为 `Done`。
- 分发：后端功能逻辑 Agent 负责 API 合同、字幕时间轴、最终包装；后端优化 Agent 负责口型长任务和重复调用防护；前端 UI + 业务开发 Agent 负责 `/studio` 主状态机；前端优化 Agent 负责陈旧请求/轮询/保存；运维 Agent 负责本地与 staging 环境；测试验收 Agent 负责逐步记录端到端证据。

## 2026-05-27 BE-CLEAN-004 Completed

- 已完成后端瘦身第二阶段：`ToolsController/ToolsModule/AiModule` 移除旧入口专用依赖，不影响 `/studio` 主链路。
- `backend/src/integrations/ai/ai.module.ts` 已删除 legacy-only provider 注入与导出：`VideoGenerateLlmService`、`SeedanceI2vService`、`ArkI2vVideoService`。
- `backend/src/modules/tools/tools.controller.ts` 已删除对应构造注入和 3 个旧入口实现：`generate-video-preview`、`seedance-i2v-async`、`ark-i2v-task`。
- 已删除无引用 service 文件：`video-generate-llm.service.ts`、`seedance-i2v.service.ts`、`ark-i2v-video.service.ts`。
- 验证通过：`npm --prefix backend run build`、`npm --prefix backend run test`。
- 环境限制：`docker compose config` 未执行（当前环境缺少 Docker CLI）。

## 2026-05-27 OPS-038 Completed

- 已完成本地/staging Aliyun VideoRetalk 运维手册：补充轮询预算、`provider_running` 恢复语义、媒体 preflight 阈值、日志保留和 DB/日志排查命令。
- 已补齐环境样例：`.env.example`、`backend/.env.example`、`deploy/compose.env.example`、`deploy/docker.env.example`。
- 未触发真实 VideoRetalk provider；真实 provider 验证仍需人工确认，且不得使用生产数据或生产密钥。

## 2026-05-27 BE-CLEAN-002 Completed

- 已完成高风险 legacy tools 入口默认下线：`generate-video-preview`、`seedance-i2v-async`、`ark-i2v-task`、`upload-video`、`upload-audio`、`generate-lip-sync-video`、`ali-lip-sync`、`lip-sync-preview`、旧 `voice-preview`。
- 实现方式：`backend/src/app.config.ts` 新增全局 kill-switch 中间件，命中 legacy 路由即在 controller 前返回 `410`，阻断 provider 调用、远程 fetch 与文件上传写盘。
- 兼容开关：仅测试环境可显式设置 `ENABLE_LEGACY_TOOLS_ENDPOINTS=true` 临时开启，默认关闭。
- 已补 e2e 回归：`backend/test/tools-pipeline.e2e-spec.ts` 新增 legacy 路由默认 `410` 断言。
- 文档同步：`docs/API.md`、`docs/CHANGELOG.md`、`.env.example` 已更新开关与禁用策略。

## 2026-05-27 ARCH-022 Backend Slimming Review

- `ARCH-022` 审查通过：后端瘦身采用“先禁用高风险旧入口、再验证主链路、最后删除/拆模块”的顺序，不直接大面积删除旧模块。
- V1.0+ 保留范围：`/studio` project-scoped 主链路、`video_projects/task_statuses` 项目任务链、资源库、项目列表、管理后台、认证/健康检查，以及字幕、音频、标题素材、数字人口型和最终包装所需的性能/安全代码。
- 必须下线范围：旧 direct provider tools、旧 `/api/v1/tasks` 与 `/api/v1/works` 前台流水线、legacy `studio-current`/resolve/非 v1 video-script。默认应返回 `410 LEGACY_ENDPOINT_DISABLED` 或进入只读历史模式。
- 安全边界：旧入口禁用必须发生在 provider 调用、远程 fetch、文件写入、任务创建之前；不得再绕过 project-scoped 校验、媒体体检、SSRF 防护和付费 provider 防重复调用。
- 兼容边界：`user_works` 暂保留给管理后台历史读取，不做破坏性删表；如需调试旧 tools，只允许 `ENABLE_LEGACY_TOOLS_ENDPOINTS=true` 在 dev/test 环境显式开启，禁止生产开启。
- 后续执行顺序：`BE-CLEAN-001` 删除可证明死代码；`BE-CLEAN-002` 禁用高风险旧 tools；`BE-CLEAN-003` 下线旧任务/作品前台流水线；`QA-053` 回归确认主链路；`BE-CLEAN-004` 再拆分 `ToolsController/ToolsModule/AiModule`；`DOC-022` 最后同步 API/测试/变更文档。

## 2026-05-27 FE-075 Frontend Update

- 已完成第二步口型可恢复状态前端适配：`SmartClipRenderStatus` 增加 `provider_running`，并兼容通过 `hint/error` 识别 `RUNNING_TIMEOUT/PROVIDER_RUNNING`。
- `syncStageTwoLipSyncTaskState()` 在可恢复态会持久化 `lipsyncTaskId`，同时清空 `digitalHumanVideoAssetId/videoUrl`，避免第三步误用空或旧结果。
- 第二步新增可恢复态操作：继续查询、稍后恢复、重新生成；继续查询会复用原 taskId 轮询，不重复提交 provider。
- 刷新恢复时，若 stage-state 仅保留 `lipsyncTaskId`（无产物 URL/assetId），页面会恢复为“服务仍在处理中”的可恢复状态，不再直接当失败清空。
- 构建验证通过：`npm --prefix frontend run build`。

## 2026-05-27 BE-PERF-013 Media Preflight Completed

- 已完成 VideoRetalk 提交前媒体体检：`createLipSyncAsset` 在 provider 调用前对源视频、预处理视频、输入音频执行 ffprobe 摘要采集并做阈值校验（时长、体积、码率、分辨率、像素格式）。
- 已完成音频容器规范化：当检测到输入音频容器/扩展名不一致，或容器非 provider 推荐格式时，自动转为 WAV，并修正提交文件名与 mime，避免 `.mp3` 文件名承载 WAV/PCM 内容。
- 体检摘要已写入口型资产元数据：`metadataJson.mediaPreflight`，用于后续排查 provider 排队慢、超时和失败。
- 超限策略：在调用 provider 前直接返回明确 4xx 可读错误，不再把高风险媒体提交到外部任务队列。
- 验证通过：`npm --prefix backend run test`（28 suites / 165 tests）、`npm --prefix backend run build`。

## 2026-05-27 ARCH-021 Review

- `ARCH-021` 已审查通过：Aliyun VideoRetalk 仍为 `RUNNING` 时，本地轮询预算耗尽只能标记为 `RUNNING_TIMEOUT/provider_running` 类可恢复状态，不能直接当真实失败。
- 状态语义已收敛：`RUNNING_TIMEOUT` 表示本地前台轮询预算耗尽但 provider 未终态；`FAILED` 只用于 provider 明确失败、预提交校验失败或恢复/合同处理失败；`SUCCEEDED` 必须在下载结果、恢复源视频格式合同、发布产物、写入 `digital_human_video_assets` 和 stage-state 后才成立。
- 轻量方案：不新增独立重型队列；复用 `task_statuses`，扩展 `video-lipsync` 为 `provider_running` 或等价可恢复状态，并在 `result_json` 持久化 provider 元数据、输入 URL、媒体合同和 `recoverUntil`。
- 恢复边界：后台恢复只查询已有 provider task，不重复提交 Aliyun；恢复不能依赖临时 `draftDir`，必须用稳定资源引用、provider 输出 URL 和已持久化 `sourceContract` 完成最终恢复。
- 已更新看板：`ARCH-021` 标记 Done；`BE-077`、`BE-PERF-013`、`FE-075` 的验收口径已按该状态模型收紧。

## 2026-05-27 Backend Redundancy Audit Dispatch

- 结论：后端生产 TS 文件层面没有完全孤立文件；从 `main.ts/app.module.ts` 出发，88 个生产 TS 文件均可达。但函数/路由层面存在明确死代码、旧兼容入口和会影响主流程的高风险冗余。
- 已执行：生产 import 图扫描；前端 API wrapper 引用扫描；`npm exec tsc -- --noEmit --noUnusedLocals --noUnusedParameters -p tsconfig.build.json`；`npm --prefix backend run build`。
- 可证明死代码：TypeScript 未使用检查命中 11 项；另发现 `backend/src/modules/tools/tools.controller.ts:593-636` 为 `return` 后不可达分支。合计约 200 行可优先删除。
- 高风险冗余：旧 direct provider tools 仍开放，包括 `generate-video-preview`、`ark-i2v-task`、`seedance-i2v-async`、`generate-lip-sync-video`、`ali-lip-sync`、`lip-sync-preview`、旧 `voice-preview` 等。前端当前主流程不再引用这些创建入口，继续保留可能绕过 project-scoped 校验、媒体体检、SSRF 防护和付费 provider 防重复调用。
- 结构冗余：旧 `/api/v1/tasks`、`/api/v1/works` 前台流水线仍在后端注册，和当前 `video_projects + task_statuses + staged-workflow` 主链路重复；可以先隐藏/410 旧前台入口，保留 `user_works` 供管理后台历史数据读取。
- 已分发给架构审查 Agent：`ARCH-022`，确认后端瘦身边界和兼容窗口。
- 已分发给后端功能逻辑开发 Agent：`BE-CLEAN-001`，删除可证明死代码；`BE-CLEAN-003`，规划旧 `/v1/tasks`/`/v1/works` 下线。
- 已分发给后端优化 Agent：`BE-CLEAN-002`，下线高风险旧 tools 入口；`BE-CLEAN-004`，拆分并瘦身 `ToolsController/ToolsModule/AiModule`。
- 已分发给测试验收 Agent：`QA-053`，后端瘦身后执行 build/test/API 回归，不跑 Docker，不触发真实付费 provider。
- 已分发给指挥官 Agent：`DOC-022`，落地后同步 API、测试、变更文档。

## 2026-05-27 Aliyun VideoRetalk Timeout Dispatch

- 结论：本地口型任务不是 Aliyun 明确失败，而是 Aliyun task 仍为 `RUNNING` 时，本地 `ALI_VIDEORETALK_POLL_MAX_MS=900000` 轮询预算耗尽，被后端标记为 failed。
- 现场任务：本地 task `lipsync_561161f1-0e71-4196-a4fd-2e2b83b06b4f`，项目 `project_d444e7b5-387a-418a-85b8-18cd9d1cea64`，Aliyun request `51bf10fc-3d1f-9026-81d6-16fd78778a8a`，Aliyun task `4eee9e79-529a-4c53-9a67-39ddea9cab24`。本地创建约 `2026-05-27 03:53:36`，Aliyun 提交 `03:54:38`，调度 `03:55:00`，本地约 `04:09:38` 超时失败。
- 媒体证据：源数字人视频约 `40.93s/88.36MB/1920x1080 HEVC 10-bit`；预处理给 Aliyun 的视频约 `76.90s/199.97MB/1920x1080 H.264 10-bit`；TTS 音频约 `76.88s/3.69MB`，实际容器为 WAV/PCM，但文件名为 `.mp3` 且 DB mime 为 `application/octet-stream`。
- 主要风险：本地只把 provider taskId 写进错误文本，没有结构化持久化和恢复路径；如果 Aliyun 在 15 分钟后继续完成，系统不会自动下载结果、恢复源视频格式合同或写回 stage-state。
- 已分发给架构审查 Agent：`ARCH-021`，审查 provider `RUNNING` 超时和真实失败的状态模型、持久化字段、恢复边界。
- 已分发给后端功能逻辑开发 Agent：`BE-077`，持久化 Aliyun task metadata，增加 provider-running timeout 的可恢复状态和恢复查询/续跑路径。
- 已分发给后端优化 Agent：`BE-PERF-013`，增加提交前媒体体检、时长/大小/码率阈值、音频容器/扩展名规范化，避免 76s/200MB 重输入直接打到 provider。
- 已分发给前端 UI + 业务开发 Agent：`FE-075`，第二步区分“provider 仍处理中”和真实失败，提供继续查询/稍后恢复/重新生成的操作。
- 已分发给运维环境 + 服务器维护 Agent：`OPS-038`，补充 VideoRetalk 超时、轮询、媒体阈值和日志排查环境手册；真实 provider 验证仍需人工确认。
- 已分发给测试验收 Agent：`QA-052`，用 mock/provider stub 验证超时恢复和预提交拦截；不跑本地 Docker，不触发真实付费 provider。
- 已分发给指挥官 Agent：`DOC-021`，开发完成后同步 API、数据库、测试和变更日志。

## 2026-05-27 QA-051 Acceptance

- 结论：`QA-051` 验收通过，`FE-074`、`FE-PERF-012` 已在 `TASK_BOARD.md` 转为 `Done`；无新增返工任务需要分发。
- 测试项目：`project_c9f57284-03b2-44d7-ad1e-e44e09c92bdd`，测试数字人：`fcb38fe4-877c-439a-82e5-51b4e886c9f8`（我的数字人）。
- 已执行：`npm --prefix frontend run build`、`npm --prefix backend run test -- staged-workflow.service.spec.ts --runInBand`、本地 API health、浏览器 `/studio` 第二步添加已保存视频数字人、刷新恢复、移除数字人、显式 `PUT/GET stage-state`。
- 结果：添加后 `avatarResourceId` 写入 stage-state，`renderMode=preserveSourceAspect`，`lipsyncTaskId/digitalHumanVideoAssetId/videoUrl=null`；刷新同一项目后 UI 仍显示“我的数字人”；恢复阶段未重复保存；移除后 `avatarResourceId=null`；console warn/error 为 0。
- 限制：浏览器插件当前不能读取原生 Network payload，已用前端 API wrapper、显式 `PUT /api/v1/video-projects/:projectId/stage-state`、`GET` 响应和 SQLite 落库结果替代验证。未跑本地 Docker，未触发真实 TTS/provider/口型生成。

## 2026-05-27 FE-PERF-012 Frontend Update

- Optimized `/studio` step-2 `stage-state` saves with stable payload-key dedupe. Identical pending/done payloads are skipped.
- Added a latest-only save queue: rapid avatar add/select/remove and model/quality toggles replace older unsent payloads, while only one `PUT stage-state` may be in flight.
- Stale in-flight saves only mark completion when they still match the current `projectId` and latest save sequence; project switch, route leave, and unmount abort and clear the queue.
- Verified: `npm --prefix frontend run lint`, `npm --prefix frontend run build`.

## 2026-05-27 FE-074 Frontend Update

- 已修复 `/studio` 第二步数字人选择持久化缺失：新增 `selectedAvatarId` 独立监听，在非项目恢复/非第二步恢复阶段发生变更时，立即写回 `PUT /api/v1/video-projects/:projectId/stage-state`。
- 本次写回会同步清空 `lipsyncTaskId`、`digitalHumanVideoAssetId`、`videoUrl`，确保数字人变更后第三步不会误用旧口型结果。
- 当本地已有口型任务或口型预览时，数字人切换会即时清理本地口型状态并提示用户重新生成；无口型结果时静默清理并持久化。
- 构建验证通过：`npm --prefix frontend run build`。

## 2026-05-27 BE-076 Completed

- 已完成 `stage-state` 数字人归属校验：`saveProjectStageState()` 在写入 `avatarResourceId` 时会校验该资源属于当前用户（通过 `resources.getAvatar`）。
- 已补后端回归测试：
  - `PUT /stage-state` 写入 `avatarResourceId` 后，`GET /stage-state` 返回同一值。
  - 写入不存在的 `avatarResourceId` 返回 `404`，且不写库。
  - 写入跨账号 `avatarResourceId` 返回 `403`，且不写库。
- 已同步接口文档：`docs/API.md` 增加 stage-state 的 `avatarResourceId` 错误码与约束说明。
- 验证通过：`npm --prefix backend run test -- staged-workflow.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`。

## 2026-05-27 Studio Avatar Persistence Dispatch

- 结论：本地浏览器验收发现 `/studio` 第二步数字人选择未持久化。创建任务 `project_09837390-7d2f-44b4-968f-bb8ffe1f15e5` 后，通过已保存视频添加“我的数字人”，页面即时显示已选；刷新同一 `projectId` 后恢复为“未选择数字人”。
- 证据：SQLite `video_project_stage_states` 中该项目 `avatar_resource_id=null`、`render_mode=null`、`audio_asset_id=null`、`digital_human_video_asset_id=null`；说明当前选择只存在前端内存，未写入阶段状态。
- 已分发给前端 UI + 业务开发 Agent：`FE-074`，要求数字人新增、选择、删除后保存 `avatarResourceId`，并在数字人变化时清空旧口型结果字段。
- 已分发给前端优化 Agent：`FE-PERF-012`，要求 `stage-state` 保存去重、取消陈旧保存，避免连续点击或切换项目造成旧保存覆盖新选择。
- 已分发给后端功能逻辑开发 Agent：`BE-076`，要求补 `avatarResourceId` 保存/读取和资源归属回归测试；若接口已满足则只补测试与错误码说明。
- 已分发给测试验收 Agent：`QA-051`，要求浏览器复测并抓 `PUT stage-state` 的 method/url/payload；不触发真实 TTS/provider/口型生成，不跑本地 Docker。
- 未分发给运维：本问题是本地前后端业务状态持久化，不涉及 Docker、Nginx、生产发布或服务器配置。

## 2026-05-27 BE-075 Completed

- 结论：`BE-075` 已完成，`BE-072` 引入合同 ffprobe 后导致的 preserveSourceAspect 单测断言失配已修复。
- 修改文件：`backend/src/integrations/media/ffmpeg-audio.service.spec.ts`。
- 改动要点：preserve 相关用例不再假设 `execMediaTool` 固定 2 次调用，改为按 `ffmpeg.exe` / `ffprobe.exe` 分类断言；保留“无 `-vf` / 无 `scale=` / 无 `pad=`”核心断言；新增“存在合同探测 ffprobe（`format=format_name,duration`）”断言。
- 验证通过：`npm --prefix backend run test -- ffmpeg-audio.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`。
- 影响：`QA-050` 从 `Blocked` 调整为 `Ready`，可继续做 mock/provider stub 联调验收。

## 2026-05-27 QA-050 Acceptance

- 结论：`QA-050` 验收未通过，已在 `TASK_BOARD.md` 标记为 `Blocked`；目标重新生成链路的后端专项单测通过，但后端全量测试存在失败项，不能主观放行。
- 已验证通过：`npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand` 通过（12 tests），覆盖 `forceRetry` 下 active task 仍复用、`regenerationKey` 下 completed 任务不复用并清空 stage-state；`npm --prefix frontend run lint`、`npm --prefix backend run build`、`npm --prefix frontend run build` 通过。
- 失败项：`npm --prefix backend run test` 失败；复跑 `npm --prefix backend run test -- ffmpeg-audio.service.spec.ts --runInBand` 确认 3 条 preserveSourceAspect 用例失败。原因是 BE-072 新增源视频格式合同后多了一次 ffprobe 合同探测，旧用例仍断言 media tool 调用次数为 2。
- 已分发给后端功能逻辑开发 Agent：`BE-075`，修复 `ffmpeg-audio.service.spec.ts` 的旧调用次数断言，保留无 `scale/pad` 的核心断言，并补充合同 ffprobe 调用断言。
- 未执行：本地 Docker；真实付费 provider；浏览器 E2E。

## 2026-05-27 FE-PERF-011 Frontend Optimization

- 已完成第二步口型“重新生成”防旧任务回填改造：新增 `stageTwoLipSyncGenerationSeq` 和 `stageTwoLipSyncBoundTaskId`，为当前生成代次建立本地 token。
- `syncStageTwoLipSyncTaskState()` 已改为按 `generationSeq + expectedTaskId` 校验响应归属；旧代次任务在 completed/failed 分支、预览 URL resolve 后、stage-state 写回后都会被拦截，不再写回 `stageTwoLipSyncVideoUrl` 与 `stageTwoDigitalHumanVideoAssetId`。
- `startStageTwoLipSyncPolling()` 已改为 generation-aware：启动轮询先绑定 task 与 generation，轮询每轮校验代次；重新生成或清空结果会 abort 旧请求并使旧代次失效。
- `clearStageTwoLipSyncResult()` 现在会在停止轮询后递增 generation，确保旧异步请求即使晚到也不能覆盖当前状态。
- 验证通过：`npm --prefix frontend run build`。

## 2026-05-27 BE-PERF-011 Backend Optimization

- 已完成口型任务 dedupe 收敛：`forceRetry/regenerationKey` 不再绕过 active 复用，只禁用 completed 复用。
- `video-lipsync` 复用顺序调整为：先匹配 pending/processing（内存 + DB），再在非强制重生请求中匹配 completed（受 dedupe window 约束）。
- 新增日志分支：`active-dedupe-hit`、`completed-dedupe-hit`、`force-retry-new-task`，用于排查重复点击、旧任务复活和真实新任务创建。
- 已补单测并通过：`npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand`。
- 构建验证通过：`npm --prefix backend run build`。

## 2026-05-27 ARCH-020 Review

- `ARCH-020` 已审查通过：重新生成不是普通重复点击，而是当前阶段旧口型结果的失效动作；历史 `digital_human_video_assets` 可保留审计，不做物理删除，但不得自动回填当前阶段，不得进入第三步包装。
- 轻量方案：不新增复杂版本表；前端使用 regeneration intent、唯一 `idempotencyKey`、`forceRetry` 和本地 generation token；后端把 active task 复用与 completed task 复用拆开。
- 必改边界：`forceRetry/regenerationKey` 只能绕过 completed 任务复用，不能绕过 pending/processing 防重复；否则双击或网络重试会创建多个口型任务，带来重复付费和队列压力。
- 必改边界：旧轮询、旧预览 URL resolve、旧 stage-state 保存完成后必须校验当前 generation token；过期代次不得写回 `stageTwoLipSyncVideoUrl`、`stageTwoDigitalHumanVideoAssetId` 或 stage-state。
- 已更新看板：`ARCH-020` 标记 Done；`FE-PERF-011` 明确所有异步回写必须带 generation token；`BE-PERF-011` 明确 force retry 只禁 completed 复用、保留 active 复用。

## 2026-05-27 LipSync Regeneration Invalidation Dispatch

- 结论：第二步点击“重新生成”后旧口型视频再次出现，直接原因是前端清空了当前状态，但下一次生成没有传 `forceRetry` 或 regeneration key；后端 `video-lipsync` completed task dedupe 复用窗口会把旧 completed 任务和旧 `digitalHumanVideoAssetId/outputUrl` 再次返回。
- 当前风险：旧视频会污染第三步包装成片；用户删除/重新生成语义失效；文案、音频、数字人或画幅变化后可能复用不匹配口型；旧轮询/旧保存请求晚到可能回填旧 URL；completed dedupe 命中会掩盖真实重新生成失败并造成审计、费用和 QA 判断失真。
- 已更新看板并分发：`ARCH-020` 给架构审查 Agent；`FE-073` 给前端 UI + 业务开发 Agent；`FE-PERF-011` 给前端优化 Agent；`BE-074` 给后端功能逻辑开发 Agent；`BE-PERF-011` 给后端优化 Agent；`QA-050` 给测试验收 Agent；`DOC-020` 给指挥官 Agent。
- 修复原则：重新生成是当前阶段旧口型结果失效动作，不是普通重复点击；历史资产可以保留审计，但不得自动回填当前阶段，不得进入第三步包装。

## 2026-05-27 FE-073 Frontend Update

- 已完成前端重新生成意图/version：新增 `stageTwoLipSyncRegenerationVersion` 与 `stageTwoLipSyncForceRetryPending`。
- 点击第二步“重新生成”后会先清空 `lipsyncTaskId/digitalHumanVideoAssetId/videoUrl`，再标记下一次口型创建为强制重试。
- 下一次 `createSmartClipLipSyncTask()` 会携带：
  - `forceRetry: true`
  - regeneration `idempotencyKey`（基于 `projectId + audioAssetId + avatarResourceId + renderMode + scriptHash + version` 生成）
- 当第二步已有口型结果且再次点击“生成数字人口型视频”时，也会走 `forceRetry`，避免命中 completed dedupe 复用旧任务。
- 验证通过：`npm --prefix frontend run build`。
- 看板状态已更新：`FE-073` 置为 `Review`，待 `QA-050` 验收。

## 2026-05-27 BE-074 Backend Update

- 已完成 `video-lipsync` 显式重生后端逻辑：`CreateLipSyncTaskBody` 新增 `regenerationKey`。
- 当 `forceRetry=true` 或 `regenerationKey` 存在时，后端创建新口型任务前会先清空当前项目 stage-state：`lipsyncTaskId`、`digitalHumanVideoAssetId`、`videoUrl`。
- 同一条件下，创建逻辑会绕过 dedupe 复用路径，避免返回 completed 旧任务的 `digitalHumanVideoAssetId/outputUrl`。
- 已补回归测试：`video-project-render.service.spec.ts` 新增“regenerationKey 存在时不复用 completed + 清空 stage-state”用例。
- 验证通过：`npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run build`。

## 2026-05-26 QA-048 Partial Acceptance

- 结论：`QA-048` 不能标记 Done，已在 `TASK_BOARD.md` 标记为 `Blocked`；原因是未获确认不能触发真实付费口型 provider，本轮没有修复后的新口型输出可做最终 ffprobe 和画面裁剪验收。
- 已执行 ffprobe：源素材 `C:\Users\Public\共享文档\素材样品\ef29e81564eb7d6f96b7fd1f8ca70b0b.mp4` 为 `720x1280`、`coded 720x1280`、`avg_frame_rate=46350/1601`、`bt709`；历史错误口型视频和 `lipsync-final_1779653063432_8b2d0b26.mp4` 均为 `1080x1920`、`coded 1088x1920`、`30/1`、色彩元数据缺失，确认旧产物确实被强制改画幅。
- 已执行本地 FFmpeg preserve 预处理模拟：输出保持 `720x1280`、`coded 720x1280`、`bt709`，说明不加 `scale/pad` 的本地预处理路径可以保留源尺寸；临时输出已删除。
- 已执行验证：`npm --prefix backend run test -- ffmpeg-audio.service.spec.ts video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`、`npm --prefix frontend run lint`、`npm --prefix frontend run build` 均通过。
- 返工分发：新增 `BE-071` 给后端功能逻辑开发 Agent，要求把所有口型预处理默认收敛到 `preserveSourceAspect`，覆盖旧 `lip-sync-preview`/草稿 finalize 漏传 `renderMode` 的路径，并让未传 `renderMode` 的 API 默认落库为 `preserveSourceAspect`。
- 未执行：本地 Docker；真实付费 provider；生产环境写操作。

## 2026-05-26 BE-071 Completed

- `FfmpegAudioService.prepareVideoForAliLipSync()` 与 `normalizeVideoForRenderMode()` 的缺省 `renderMode` 已统一为 `preserveSourceAspect`，缺省路径不再回落 `adaptive`。
- 旧 `lip-sync-preview` 与草稿 `finalizeDraft` 调用链已显式传入 `preserveSourceAspect`，避免遗留漏传参数触发缩放。
- `VideoProjectRenderService.runLipSyncTask()` 已统一使用 `effectiveRenderMode`（默认 `preserveSourceAspect`）传给口型生成与资产落库。
- `StagedWorkflowService.createDigitalHumanVideoAsset()` 对缺失 `renderMode` 的入参落库兜底为 `preserveSourceAspect`。
- 验证通过：`npm --prefix backend run test -- ffmpeg-audio.service.spec.ts video-project-render.service.spec.ts staged-workflow.service.spec.ts --runInBand`、`npm --prefix backend run build`。

## 2026-05-26 QA-048 BE-071 Retest

- 结论：`BE-071` 非 provider 验收通过，但 `QA-048` 仍不能标记 Done；最终缺口是没有修复后的新口型输出文件，不能完成真实输出 ffprobe 与画面裁剪验收。
- 已验证：静态路径确认缺省 `renderMode=preserveSourceAspect`，旧 preview/finalize 路径不再漏传，`runLipSyncTask()` 与 `digital_human_video_assets.render_mode` 落库使用有效默认值。
- 已执行命令：`npm --prefix backend run test -- ffmpeg-audio.service.spec.ts video-project-render.service.spec.ts staged-workflow.service.spec.ts --runInBand` 通过（3 suites/37 tests），`npm --prefix backend run test` 通过（26 suites/156 tests），`npm --prefix backend run build`、`npm --prefix frontend run lint`、`npm --prefix frontend run build` 均通过。
- ffprobe 复核：源素材仍为 `720x1280/coded 720x1280/fps≈28.95/bt709`；历史错误口型视频与旧 lipsync-final 仍为 `1080x1920/coded 1088x1920/fps=30/1/色彩元数据缺失`。本地 FFmpeg preserve 预处理模拟输出保持 `720x1280/coded 720x1280/bt709`。
- 未执行：本地 Docker；真实付费 provider；生产环境写操作。

## 2026-05-26 QA-048 Resolution Plan

- QA-048 的产品规则收敛为“源视频格式合同”：用户上传视频是什么画面参数，第二步最终口型预览就必须保持什么参数；除嘴部运动变化外，不允许改变画幅、比例、帧率、像素格式、色彩元数据和音轨策略。
- 已分发给后端功能逻辑开发 Agent：`BE-072`，提交 provider 前记录源视频/预处理视频 ffprobe，provider 返回后记录临时输出 ffprobe，最终保存前必须恢复到源视频合同；可安全恢复则恢复后保存，无法恢复则任务失败且不落库成功资产。
- 已分发给运维环境 + 服务器维护 Agent：`OPS-037`，提供隔离 staging/mock 输出样本；真实 VideoRetalk 调用只用于确认外部 provider 行为，仍需用户明确确认，且不得使用生产数据、生产上传目录或生产密钥。
- 已分发给测试验收 Agent：`QA-049`，对源视频、预处理输入、provider 临时输出、第二步最终预览输出、第三步包装输出做 ffprobe 验收。
- 当前最短通过路径：后端完成 `BE-072` 后，用 mock 或新生成样本证明最终保存输出满足源视频合同；真实 provider 验证仍需用户确认，但不作为设计规则本身的前置条件。

## 2026-05-26 LipSync Video Parameter Diagnosis

- 用户提供的 `C:\Users\Public\共享文档\素材样品\错误口型视频.mp4` 已只读检查，未改动原视频文件和业务代码。
- ffprobe 结果：错误口型视频为 `1080x1920`、`coded_width=1088`、`fps=30/1`、`pix_fmt=yuv420p`、色彩元数据 `unknown`；同目录疑似源素材为 `720x1280`、`fps≈28.95`、`bt709`。
- 直接原因：前端当前会把 9:16 字幕模板比例映射成 `renderMode=1080x1920`；后端 `prepareVideoForAliLipSync()` 和 `normalizeVideoForRenderMode()` 在该模式下执行 FFmpeg `scale/pad`，主动把视频改成 1080x1920。
- 风险点：即使走 `adaptive`，当前后端也会重编码、把尺寸截成偶数并 `setsar=1`，因此现有 `preserveSourceAspect` 还不是严格保真模式。
- 已更新看板：新增 `ARCH-019`、`BE-070`、`FE-072`、`QA-048`、`DOC-019`，目标是第二步口型默认保持原视频参数，第三步包装画幅转换只在用户明确选择最终输出画幅时发生。

## 2026-05-26 Creation Task Script Snapshot Dispatch

- 结论：创建任务后进入第二步会触发项目恢复，当前恢复逻辑会先清空本地文案状态；如果创建任务时没有先保存第一步文案，后续音频、字幕、口型会基于变化后的文案生成，导致已生成资产无法和当前文案稳定对齐。
- 轻量方案：不新增表、不新增文案版本系统；复用现有 `video_scripts.script_text` 保存项目初始文案快照，复用 `video_project_stage_states.script_hash` 做一致性校验。
- `ARCH-018` 已审查通过：现有 `video_scripts` 和 `video_project_stage_states` 足够承载该需求，无需数据库迁移、无需新增文案版本系统、无需新增后端接口。
- 已完成：`FE-071` 已在创建任务成功后、项目恢复前写入 `saveVideoScript` 与 `saveProjectStageState(scriptHash)`；保存失败会留在第一步并提示重试。
- 当前约束：快照保存失败时不得进入第二步生成音频或口型；不得恢复历史口型视频，也不得按文案、音频、数字人做自动匹配。

## 2026-05-26 BE-069 Completed

## 2026-05-26 BE-070 Completed

- `FfmpegAudioService` 已完成 `preserveSourceAspect` 真保真：口型预处理与包装规格化在该模式下不再默认插入 `scale/pad`，避免无必要裁剪与尺寸重写。
- 第二步口型默认 `renderMode` 已从 `adaptive` 调整为 `preserveSourceAspect`。
- `1080x1920` 仍保留为显式竖版输出模式。
- 已补单测并通过：`ffmpeg-audio.service.spec.ts`、`video-project-render.service.spec.ts`，后端 build 通过。

## 2026-05-26 FE-072 Frontend Update

- `CreativeStudioView.vue` 的第二步口型生成已固定使用 `renderMode=preserveSourceAspect`，不再根据字幕模板比例自动映射 `1080x1920`。
- 第二步口型结果失效监听已移除对字幕模板画幅和渲染分辨率的依赖，避免用户切模板/分辨率时误触发口型重置。
- 前端构建验证通过：`npm --prefix frontend run build`。
- 看板状态已更新为 `FE-072: Review`，等待 `QA-048` 基于 ffprobe 和第三步成片链路验收。

- 后端已完成字幕轨来源收敛：显式 `POST /api/v1/audio-assets/:id/subtitle-track` 传入 `scriptSegments` 时，强制返回/持久化 `source=tts_alignment`，并保证 `subtitles.length === scriptSegments.length`。
- 音频生成阶段自动创建字幕轨保持 `source=asr`，避免被误当作分段字幕轨。
- 显式创建字幕轨后，后端同步更新 `audio_assets.subtitle_track_id` 与 `video_project_stage_states.subtitle_track_id`，降低页面读取旧 ASR 轨道风险。
- 已补日志诊断字段：`requestedSegmentCount/cueCount/alignmentSource`；后端验证通过：`staged-workflow` 单测 + `backend build`。

## 2026-05-25 Subtitle Timeline QA Failure

- 用户提供的本地返回数据为 `GET /api/v1/subtitle-tracks/track_392a4e65-434c-4ccb-aef0-ab5eb20102ca`，结果 `source=asr`、`subtitles.length=3`。
- 结论：这不是按第二步 `scriptSegments` 生成的字幕轨，而是 ASR 原始轨道；正确的分段字幕轨必须返回 `source=tts_alignment`，且条数等于前端传入的 `scriptSegments.length`。
- 当前阻塞点：显式生成字幕轴后，页面或接口仍可能使用音频生成阶段自动创建的 ASR 字幕轨。
- 已更新看板：`FE-069` 改为 `Blocked`，新增 `BE-069`、`FE-070`，`QA-046` 改为 `Blocked` 等待返工后复测。
- `FE-070` 前端已完成并通过 `npm --prefix frontend run build`：显式生成字幕轴时仅接受本次 POST 对应 track，强校验 `source=tts_alignment` 和条数=`scriptSegments.length`；失败时提示“字幕轴未按文案分段生成”并阻断进入第三步，同时移除音频阶段自动回填 `audioAsset.subtitleTrackId` 的覆盖路径。

## 2026-05-25 QA-PERF-002 Acceptance

- 结论：`QA-PERF-002` 验收通过，已在 `TASK_BOARD.md` 标记为 `Done`；`BE-PERF-009`、`BE-PERF-010` 主表状态已从 `Ready` 修正为 `Done`。
- 已验证：前端长任务轮询具备 in-flight 防并发、`AbortController`、标题素材轮询上限/超时和路由/项目/卸载清理；保存链路具备稳定 payload key 去重。
- 已验证：后端状态查询路径设置 no-store/Retry-After，状态读取不触发 provider；`video-script`、字幕 cues、`subtitleVisualStyle/titleLayout` 均有数量、长度、深度、节点或字节预算限制。
- 执行命令：`npm --prefix frontend run lint`、`npm --prefix frontend run build`、`npm --prefix backend run test`、`npm --prefix backend run build` 均通过；后端测试结果为 24 suites / 146 tests passed。
- 未执行：本地 Docker；真实付费 provider；浏览器 Network 时序录制（当前本地未安装 Playwright/浏览器自动化依赖）。

## 2026-05-25 Subtitle Timeline Dispatch

- 结论：字幕轴只生成 2 段的直接原因是后端按 ASR 返回的 `segments` 原样生成 cues，当前接口没有接收第二步口播文案分段。
- `BE-068` 已完成：`POST /api/v1/audio-assets/:id/subtitle-track` 已支持 `projectId/scriptText/scriptSegments`，并在 `scriptSegments` 存在时按分段数生成秒级字幕轴（ASR 时长边界 + 音频时长兜底，时间递增且不重叠）。
- 已分发给前端 UI + 业务开发 Agent：`FE-069`，生成字幕轴时传当前第二步口播文案和分段数组，不再空 body 调用。
- 已分发给测试验收 Agent：`QA-046`，用 ASR 2 段、文案多段样例验收字幕条数、时间递增和第三步成片使用。
- `FE-069` 前端代码已完成并通过 `npm --prefix frontend run build`：字幕轴创建请求已携带 `projectId/scriptText/scriptSegments`，分段优先取用户当前字幕分段，其次取 `extractedScriptLines`；当前进入 `QA-046` 联调验收阶段。
- 已分发给指挥官 Agent：`DOC-017`，开发完成后同步接口、测试和变更文档。

## 2026-05-25 Performance Optimization Dispatch

- 已按 `/studio` 第一步到第三步的性能风险新增看板任务，均为 `Ready`。
- 前端优化 Agent 已完成：`FE-PERF-009` 处理长任务轮询和定时器清理；`FE-PERF-010` 处理保存请求去重、防抖和相同 payload 防重复提交。
- 分发给后端优化 Agent：`BE-PERF-009` 处理状态查询抗压、缓存和内存 task map 上限；`BE-PERF-010` 处理大 payload、marks/cues/style 对象参数上限。
- 分发给测试验收 Agent：`QA-PERF-002` 做请求频率、参数上限、轮询清理和内存/缓存增长验收；不触发真实 provider，不跑本地 Docker。

## 2026-05-25 Studio Step 1-3 Legacy Residual Scan

- 结论：已对 `/studio` 第一步到第三步做旧逻辑残留检测，`QA-045` 已在 `TASK_BOARD.md` 标记为 `Done`。
- 已确认：第一步创建任务后使用真实 `projectId`；第二步恢复只恢复音频和字幕，旧口型结果会清空并提示重新生成；第三步包装成片只提交当前 `projectId`、音频资产、字幕轨道和本次口型资产。
- 已清理：`FE-068` 删除前端不可达旧音色校验死代码和未使用的 `listSavedVideos()` 包装函数。
- 仍保留但允许：后端 `studio-current` 仅作为 legacy stage-state/resolve 兼容；`lipsync-assets/resolve` 兼容接口仍存在，但前端 active flow 不再调用；旧 `/api/video-script/*` 路径只作为兼容路由，前端已统一为 `/api/v1/video-script/*`。
- 验证：`rg` 残留扫描、前端 lint/typecheck/build、后端相关单测和后端 build 均通过；未跑本地 Docker，未触发真实 provider。

## 2026-05-25 QA-044 Acceptance

- 结论：`QA-044` 复测通过，已在 `TASK_BOARD.md` 标记为 `Done`。
- 已验证通过：创作任务创建、重复任务名、改名、归档、列表过滤、按真实 `projectId` 保存/恢复 `stage-state`、跨账号读取/改名/归档/stage-state 隔离、旧 `studio-current` 兼容。
- `ARCH-017` 已完成：project-scoped 长任务接口必须先校验 `video_projects.id + user_id`，再执行 dedupe、并发判断、任务持久化和 provider 调用；`BE-066` 已由后端功能逻辑开发 Agent 完成代码修复并补充跨账号回归单测。
- 复测结果：B 账号调用 A 项目的 `detect-cut-points`、`render-final`、`lipsync-tasks`、`package-render-tasks`、`pd-events` 均返回 `404`，且 `task_statuses` 没有新增记录。
- 本轮未跑本地 Docker；未触发真实 provider。

## 2026-05-25 Video Script Empty State Fix

- 结论：已修复新建创作任务进入第二页时 `GET /api/video-script/:projectId` 在 F12 Network 中显示 404 的问题。
- 原因：新任务尚未保存智能剪辑文案配置，后端把正常空状态当作 NotFound 返回；前端已捕获该 404，但 Network 仍显示红色请求。
- 修复：`GET /api/v1/video-script/:projectId` 和兼容旧路径 `/api/video-script/:projectId` 在缺失配置时返回 `200 data=null`；前端 `saveVideoScript/getVideoScript` 统一切到 `v1/video-script` 路径并兼容空数据。
- 验证：后端 video-script 单测、后端 build、前端 typecheck/build、临时 `3100` API 登录请求均通过。

## Current Stage

- 阶段：V1.0 后优化与稳定性迭代。
- 产品：AI 数字人口播视频生成平台。
- 主入口：`/studio` 创作台；辅助入口包括资源库、字幕模板库、数字人素材库、管理员后台。
- 当前策略：线上流程已跑通，后续只做功能优化、稳定性加固、体验优化、测试环境验证和必要的轻量扩展。

## Current Core Flow

1. 用户在创作台第一步准备文案，点击下一步时创建 `video_projects` 创作任务，任务名可编辑。
2. 后续音频、字幕、数字人选择、口型视频、模板和包装成片都绑定真实 `projectId`。
3. 音频阶段生成或上传音频资产，写入 `audio_assets`，并生成秒级字幕时间轴 `subtitle_tracks`。
4. 口型阶段使用当前用户自己的数字人视频和音频创建异步 `video-lipsync` 任务，成功后写入 `digital_human_video_assets`。
5. 留存阶段通过 `projectId + video_project_stage_states` 恢复任务内容；不再按音频、数字人、文案、链接或画幅自动匹配历史口型视频。
6. 智能剪辑阶段只做包装成片：读取口型视频、音频、字幕时间轴、字幕模板和标题素材，完成字幕烧录、标题叠加、音视频对齐和输出发布。
7. 字幕模板和标题模板使用“公版只读、复制后可编辑”的模式，用户只能修改自己的模板。

## Current Environment

- 前端：Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI。
- 后端：NestJS 11、TypeScript、SQLite 本地库、MySQL 生产库、FFmpeg、外部 TTS/ASR/口型生成服务。
- 本地开发：前端 `http://127.0.0.1:5173`，后端 `http://127.0.0.1:3000/api`。
- Docker 验证：`http://127.0.0.1:8080`，Nginx 反代 `/api` 到后端。
- 线上发布、生产重启、生产回滚、真实付费接口调用仍需要人工确认。

## Completed Core Capabilities

- V1.0 主链路已通过：文案、音频、数字人视频、口型生成、字幕模板、标题素材、最终成片。
- 用户资源隔离已作为默认规则：音色、数字人视频、字幕模板、阶段状态和生成资产均按当前账号隔离。
- 普通新注册用户默认无功能权限，需管理员开通后才能使用核心功能。
- 最近提取记录、素材库、模板库已经按用户维度设计隔离。
- 第二步支持分段编辑口播文案、滚动查看、音频试听和本次生成的口型视频预览；刷新后只自动恢复音频和字幕，口型视频需用户重新生成。
- 第三步支持字幕模板切换、复制公版模板后编辑、可视化字幕/标题位置配置、标题透明素材叠加。
- 本地 Vite 已支持 `/uploads` 预览代理，生成口型视频后可在本地预览。
- 创作台 `stage-state` 接口已强制 `no-store`，避免浏览器返回 `304` 后误用陈旧阶段状态。
- 待审核账号访问业务接口返回结构化 `403`（`code=ACCOUNT_PENDING`），便于前端统一识别和引导。
- `ARCH-016` 已确定下一步采用 `video_projects` 创作任务容器，任务名只做展示和搜索，`projectId` 作为所有阶段数据的唯一关联点。
- `ARCH-017` 已确定 project-scoped 长任务统一鉴权边界，越权请求必须返回 `404` 且不得创建任务。

## Current Active Work

- `FE-PERF-008`：已完成 `/projects` 创作任务列表入口；列表分页、详情预检、改名、归档/恢复、创作台项目恢复和 stage-state 查询均具备加载态、取消陈旧请求与防重复点击保护。
- `QA-LIPSYNC-001`：真实 VideoRetalk 长任务边界测试仍阻塞，需 staging/mock 环境或明确确认使用真实付费 provider。
- `OPS-PROD-001`：生产 HTTPS、静态资源缓存和 smoke 验证仍需人工确认后执行。
- `QA-ENV-001`：准备不使用生产密钥和生产数据的 staging 验证账号、资源夹具和 smoke 参数。
- `BE-065`：已完成创作台关键资产按真实 `projectId` 强绑定，`studio-current` 仅保留遗留兼容。
- `BE-066`：已完成所有 project-scoped 长任务创建接口的项目归属校验前置修复。
- `BE-068`、`FE-069`、`QA-046`：基础改造已进入联调，但用户提供返回数据仍为 `source=asr`、3 条字幕，验收失败；当前转入 `BE-069`、`FE-070` 返工，目标是只接受 `source=tts_alignment` 且条数等于 `scriptSegments.length` 的字幕轨。
- `ARCH-018`：已完成创建任务文案快照架构审查，结论为复用现有 `video_scripts` + `stage-state script_hash`，不新增表和版本系统；`FE-071`、`QA-047` 继续推进。

## Current Blockers

- 真实长任务口型生成测试可能产生付费调用，未确认前不自动执行。
- 生产发布、生产重启、生产回滚、生产数据库破坏性变更不自动执行。
- 不允许为了测试复用生产密钥、生产数据库或生产上传目录。

## Next Goals

1. 优先处理 `BE-069` 和 `FE-070`，收敛 ASR 原始轨道与显式分段字幕轨的返回边界。
2. `QA-046` 复测字幕轴时间对齐和第三步成片使用，重点确认 `source=tts_alignment`、trackId 一致、字幕条数等于 `scriptSegments.length`。
3. 处理 `FE-071`、`QA-047`，让创建任务时的第一步文案成为第二步之后生成链路的稳定输入。
4. 继续按看板处理 `QA-ENV-001`、`QA-LIPSYNC-001` 和生产运维阻塞项。
5. 保持 V1.0 主链路稳定；按 `projectId` 恢复任务内容，但口型视频不做历史启发式匹配。
6. 准备 staging/mock 验证条件，再处理 `QA-LIPSYNC-001`。
7. 后续功能优化继续使用 `TASK_BOARD.md` 分发到对应 Agent，并由测试验收 Agent 回写结果。
## 2026-05-25 BE-PERF-009/010 Completion

- 已完成 `BE-PERF-009`：优化状态轮询路径，`title-assets/render-tasks/:taskId` 读取仅依赖 `task_statuses.result_json`，不再额外读取 title asset 行；接口补充 no-store 与轮询建议响应头，降低高频轮询带来的缓存和内存压力。
- 已完成 `BE-PERF-010`：新增 payload 风险防护，覆盖 `video-script/save` highlights 限流、title mark layout 复杂度、subtitle cues 数量和文本总量、`subtitleVisualStyle/titleLayout` 深度/节点/字节预算；超限统一返回 4xx。
- 验证结果：`npm --prefix backend run test` 通过（24 suites / 143 tests），`npm --prefix backend run build` 通过。
- 环境限制：`docker compose config` 未执行，当前环境缺少 Docker CLI；`npm --prefix backend run lint` 仍有存量错误（集中在未改动历史用例）。

## 2026-05-27 BE-077 Completed

- 已完成 `video-lipsync` 可恢复状态持久化：任务状态新增 `provider_running`，并在 `task_statuses.result_json.provider` 持久化 Aliyun provider 元数据（含 `requestId/taskId/taskStatus/inputMode/videoUrl/audioUrl/submittedAt/lastPolledAt/recoverUntil/inputMeta/sourceContract/preparedContract/audioContract/lastResponse`）。
- 本地轮询预算耗尽且 provider 仍 `RUNNING` 时，不再直接写 `failed`；后端改为 `provider_running`（progress 90+）并自动后台恢复。
- 新增恢复链路：后端基于已持久化 provider taskId 调 `recoverAliyunTask` 续查，不重复提交 provider；恢复成功后再执行格式合同恢复、落 `digital_human_video_assets`，并回写 stage-state。
- 回归验证通过：`npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`。
## 2026-05-27 QA-CORE-001 First Acceptance

- 结论：`QA-CORE-001` 首轮验收未通过，已在 `TASK_BOARD.md` 标记为 `Blocked`；核心流程相关任务仍只能保持 `Review/Blocked`，不能转 `Done`。
- 已执行基础门禁：`npm --prefix backend run test` 通过（28 suites / 170 tests）、`npm --prefix backend run build` 通过、`npm --prefix frontend run lint` 通过、`npm --prefix frontend run build` 通过。
- 已执行核心相关验证：`npm --prefix backend run test:pipeline` 通过（10 tests）；`npm --prefix backend run test -- staged-workflow.service.spec.ts video-project-render.service.spec.ts staged-workflow.controller.spec.ts video-projects.controller.spec.ts video-script.controller.spec.ts --runInBand` 通过（5 suites / 48 tests）。
- 发现阻塞：当前没有“保证不调用真实付费 provider”的完整主链路 E2E mock/stub。`backend/test/tools-pipeline.e2e-spec.ts` 设置了 `AI_MOCK_FALLBACK=true`，但 `SpeechAiService` 没有消费该开关；本机若存在 provider 密钥，`POST /api/v1/audio-assets/generate` 可能真实调用 TTS。
- 全量 e2e 现状：`npm --prefix backend run test:e2e` 失败于 `backend/test/admin-access.e2e-spec.ts`，注册 payload 未携带当前必填的 `phoneNumber/idCardNumber`，与核心流程无直接业务关系，但会阻断全量 e2e 门禁。
- 已分发给后端功能逻辑开发 Agent：`BE-CORE-005`，补齐显式安全 mock/stub 主链路；`BE-TEST-001`，修复过期 admin e2e 注册 fixture。
- 已分发给测试验收 Agent：`QA-CORE-002`，在 mock/stub 可用后补齐可重复执行的核心流程 E2E 脚本并回归 `QA-CORE-001`。
- 未继续执行：本地 Docker、真实 VideoRetalk、最终成片真实 provider、生产或 staging 写操作。说明：`test:pipeline` 的音频生成路径缺少强制 mock，已作为阻塞风险记录，后续不得再用它替代安全主链路 E2E。
