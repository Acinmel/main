# Project State

## 2026-05-19 Post-v1.0 Access Control Dispatch
- 新需求已拆解为 v1.0 后权限策略优化：普通新注册用户默认没有任何业务功能权限，必须由管理员开通后才能使用。
- 当前代码基础：后端已有 `accountStatus=pending/active/disabled`、`AccountActiveGuard` 和管理员用户管理入口；风险点是 `AuthService.registrationDefaultAccountStatus()` 受 `REGISTRATION_DEFAULT_ACCOUNT_STATUS` 控制，缺省可能让新用户直接 `active`，需要统一收紧为默认待开通。
- 已分发任务：`ARCH-004` 审查权限模型和既有用户兼容策略；`BE-017` 后端注册默认 pending 与业务 API 403 门禁；`FE-012` 前端等待审核页、入口禁用和管理员开通体验；`OPS-011` staging/production 默认配置与 smoke；`QA-012` 新用户未授权/开通/停用回归；`DOC-002` 同步 API、数据库、部署、验收和变更记录。
- 本次不改业务代码，仅完成影响范围定位、任务拆解和 Agent 分发。

## 2026-05-19 Release 20260519-003 Deployed
- 已打包并部署 `20260519-003`：`shuziren-api:20260519-003` healthy，`shuziren-web:20260519-003` started。
- 发布脚本通过：`SHA256SUMS` 校验、preflight、migration、docker compose build/up、`scripts/smoke-test.sh`、`scripts/verify-runtime.sh`。
- 线上验收通过：`GET /api/health` 返回 `ok/app/version=20260519-003`；公网 `GET /api/health/deep` 已收敛为摘要，不再返回 `build`、`gitCommit`、`includedFiles` 或内部路径；所有 deep 子项均为 `ok=true`。
- 静态缓存验收通过：`/index.html` 返回 `Cache-Control: no-cache`；`/assets/index-DvPcwezH.js` 返回 `Cache-Control: public, max-age=31536000, immutable`。
- `BE-PROD-001` 与 `OPS-PROD-002` 已更新为 `Done`；`OPS-PROD-001` 仍阻塞于真实域名和 TLS 证书。

## 2026-05-19 OPS-PROD-001 Repo-Side Hardening
- 已完成仓库侧生产 HTTPS 加固：Docker web 容器不再在内部 HTTP 响应加 `Strict-Transport-Security`；Compose 支持 `WEB_BIND_HOST=127.0.0.1` 防止公网绕过 HTTPS 访问 8080；生产部署脚本默认拒绝非 HTTPS `PUBLIC_BASE_URL`；新增宿主机 HTTPS Nginx 模板与 `deploy/setup-https-nginx.sh`；`scripts/smoke-test.sh` 支持 `REQUIRE_HTTPS=1` 验证 HTTP 跳转、HTTP 无 HSTS、HTTPS 有 HSTS。
- 当前生产切换仍阻塞：需要真实域名 DNS 指向 `39.105.194.164` 并签发可信 TLS 证书，不能用裸 IP 完成浏览器可信 HTTPS。

## 2026-05-19 OPS-PROD-002 Static Cache Headers
- 已完成仓库侧静态资源缓存优化：`/assets/` 使用 `Cache-Control: public, max-age=31536000, immutable`；`/index.html` 与 SPA fallback 使用 `Cache-Control: no-cache`。
- `scripts/smoke-test.sh` 已加入缓存头验收，会从首页自动提取首个 `/assets/*.js|css` 并校验 immutable 缓存。
- 待下一次发布后在线上执行缓存头 curl/smoke 验收。

## 2026-05-19 Production Health Monitoring Contract
- 已核对仓库内巡检脚本：`scripts/smoke-test.sh` 与 `scripts/verify-runtime.sh` 不依赖旧版 `/api/health/deep` 的 `build.gitCommit`、`build.includedFiles` 或内部路径字段；仅要求 JSON 可解析，配置 `HEALTH_DEEP_TOKEN` 时会带 token 拉取详细信息。
- 只读线上核对发现当前公网 `/api/health/deep` 仍返回旧详细结构，说明现网仍未发布健康接口收敛版本或仍在运行旧镜像；下一次发布后需要复验公网 deep 只返回摘要。
- 已同步 `docs/DEPLOY.md` 的健康监控契约：公网监控只使用 `ok/app/version/checks.<item>.ok`，详细诊断必须带 `X-Health-Token`。

## 2026-05-19 BE-PROD-001 Completed (Review)
- 已完成生产健康接口信息收敛：
  - `GET /api/health` 仅返回 `ok/app/version`。
  - `GET /api/health/deep` 默认仅返回摘要 `checks.<item>.ok`。
  - 公网不再暴露 `includedFiles`、`gitCommit`、内部目录路径和依赖细节。
- 详细诊断改为受控访问：仅 loopback 或请求头 `X-Health-Token` 与 `HEALTH_DEEP_TOKEN` 匹配时返回完整结果。
- 已同步 `scripts/smoke-test.sh`、`scripts/verify-runtime.sh`、`docs/API.md`、`docs/DEPLOY.md`、`docs/CHANGELOG.md`。
- 验证通过：`npm --prefix backend run lint`、`npm --prefix backend run test -- health.service.spec.ts --runInBand`、`npm --prefix backend run build`。

## 2026-05-19 BE-PROD-002 Completed (Review)
- 已完成 `GET /api/v1/tools/digital-human-env` 收敛：移除 `arkKeyLength`，仅返回前端必需能力布尔位：
  - `arkConfigured`
  - `seedreamConfigured`
  - `remoteConfigured`
- 已新增 e2e 防回归断言：`digital-human-env` 不得再包含 `arkKeyLength` 字段。
- 已同步接口文档：`docs/API.md`。
- 验证：`npm --prefix backend run build` 通过。
- 当前剩余门禁阻塞（与本任务改动无关）：`health.service.spec.ts` 与 `tools-pipeline.e2e-spec.ts` 既有失败，待对应任务继续处理。

## 2026-05-19 Production Risk QA Round 1
- 已对线上 `http://39.105.194.164:8080` 执行只读风险验收：`/`、`/api/health`、`/api/health/deep` 可访问，build version 为 `20260519-002`，deep health 的 database/storage/ffmpeg/ytdlp/schema 均为 ok。
- API 验证通过：测试账号登录 201，`/api/v1/auth/me` 200，`/api/v1/tools/recent-extractions?limit=6` 200，资源、音色、字幕模板和转写健康接口均 200；`/studio` 浏览器回归无 `recent-extractions` 404，`QA-010` 已关闭。
- Chrome CDP 抓包访问 `/studio`、`/resources`、`/admin/dashboard`：API 4xx/5xx 为 0，旧 `/api/v1/tools/saved-videos` 请求为 0，stream 请求为 0，Blob object URL 创建数为 0，console error 为 0。
- 已分发线上风险返工：`OPS-PROD-001` 生产 HTTPS、`BE-PROD-001` 健康接口信息暴露和 payload 膨胀、`OPS-PROD-002` 静态资源缓存、`BE-PROD-002` `digital-human-env` 移除 `arkKeyLength`。

## 2026-05-19 FE/BE PERF Review QA
- `FE-PERF-001` 已复测通过：`frontend/src` 中无 `fetchSavedVideoBlob` 和 saved-video 整文件 Blob 预览路径；`NewAvatarModal` 使用 `avatars/upload-videos` 的 `previewUrl`，`AvatarLibraryView` / `CreativeStudioView` 使用 `avatar-video-files/:fileName/stream` URL；资源库运行态未出现旧 `/tools/saved-videos` 请求，object URL 创建数为 0。
- `BE-PERF-001` 已复测通过：本地 API 上传测试 avatar 视频后，`metadata` 返回 200；`Range: bytes=2-5` 返回 206、`Content-Range: bytes 2-5/<size>`、`Accept-Ranges: bytes`、`Content-Length: 4`；非法 Range 返回 416；跨账号访问 metadata/stream 返回 404。
- 已执行验证：`npm --prefix frontend run lint`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run build`、`npm --prefix backend run test -- resources.service.spec.ts resources.controller.spec.ts --runInBand`、`npm --prefix backend run test -- --runInBand`、`npm --prefix backend run build` 均通过。
- 测试产生的临时 avatar 资源和视频文件已清理；本地临时 3000/5173 服务已停止。

## 2026-05-19 FE-PERF-001 Frontend Blob Preview Removal
- 前端已移除添加数字人、资源库卡片预览、创作页数字人封面兜底中的整文件 Blob 视频预览路径。
- `NewAvatarModal` 改为读取当前账号 `avatars/upload-videos` 专用列表，并直接使用后端返回的 `previewUrl` 给 `<video preload="metadata">`。
- `AvatarLibraryView`、`CreativeStudioView` 改为使用 `avatar-video-files/:fileName/stream` URL，不再把大视频下载到 object URL；关闭/切换/卸载时清理预览状态。
- 验证通过：`npm --prefix frontend run lint`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run build`。

## 2026-05-19 BE-PERF-001 Backend Range Stream Update
- `GET /api/v1/resources/avatar-video-files/:fileName/stream` now supports `Range`, `206 Partial Content`, `416`, `Content-Range`, and `Accept-Ranges: bytes` while retaining current-user avatar upload ownership checks.
- Added `GET /api/v1/resources/avatar-video-files/:fileName/metadata` so video metadata preview can read file stats without loading the full video into memory.
- Synced `docs/API.md`, `docs/PERFORMANCE.md`, and `docs/CHANGELOG.md`; validation passed: backend lint, targeted resource tests, full backend unit tests, and backend build.

## 2026-05-19 v1.0 Risk Test Round 1
- 已执行 v1.0 第一轮风险测试，不做核心功能全链路回归；覆盖请求频率、参数风险、Blob/object URL、timer/listener、后端缓存和 Range stream。
- 静态扫描与 targeted test：`npm --prefix frontend run typecheck` 通过；`npm --prefix backend run test -- saved-video.service.spec.ts voice-preview-task.service.spec.ts --runInBand` 通过；`npm --prefix backend run test -- health.service.spec.ts resources.service.spec.ts --runInBand` 通过。
- 运行时抓包：临时启动本地 3000/5173，无头 Chrome 登录测试账号访问 `/resources` 和 `/studio`；`/resources` 初始仅触发 `auth/me` 与 `resources/avatars` 业务请求，切到 `/studio` 新增 recent-extractions、avatars、voices、subtitle-templates、dy-cookie、pipeline-health；未触发视频 Blob。
- 发现风险 1：前端 `NewAvatarModal` / `AvatarLibraryView` / `CreativeStudioView` 仍存在 `fetchSavedVideoBlob()` 整文件 Blob 预览路径，接口为旧 `v1/tools/saved-videos/:fileName/stream`，大视频会常驻内存并绕开 `BE-016` 新增的头像上传视频专用接口。
- 发现风险 2：`GET /api/v1/resources/avatar-video-files/:fileName/stream` 当前设置 `Content-Length` 后直接返回 stream，没有处理 `Range` / `206 Partial Content`；500MB 数字人上传视频用于 `<video preload="metadata">` 时仍可能产生全量读取风险。
- 本轮已分发：`FE-PERF-001` 给前端优化 Agent，`BE-PERF-001` 给后端优化 Agent，`QA-PERF-001` 记录本轮测试完成。

## 2026-05-19 QA Strategy Shift After v1.0
- 从现在开始，测试验收 Agent 不再主动执行模块核心功能全链路测试；v1.0 主链路已作为版本基线保留。
- 后续测试方向切换为风险验收：请求是否过于频繁、接口参数是否存在越权/注入/大 payload 风险、数据保存是否存在内存或磁盘膨胀风险、一次性组件/变量/事件监听/object URL/timer/轮询注册后是否正确销毁。
- 新增或修改任务进入验收时，默认输出性能风险、请求频率、参数风险、资源释放、内存/文件保存风险结论；除非用户明确要求，不再重复“按钮能否点击、流程能否走通”类核心功能验收。

## 2026-05-19 v1.0 Milestone
- 线上主流程已全部通过，当前项目正式标记为 `v1.0` 版本节点。
- 本阶段目标从“打通全链路”切换为“围绕已上线能力做局部功能优化、体验优化、安全边界加固和运维稳定性补强”。
- 向所有 Agent 同步感谢：指挥官 Agent 完成需求拆解、节奏控制与看板维护；前端 UI + 业务开发 Agent 打通创作页、资源库、数字人、配音和作品流程；前端优化 Agent 推进预览加载、状态反馈和交互体验；后端功能逻辑开发 Agent 完成鉴权、资源、任务、AI 工具和业务接口；后端优化 Agent 推进异步任务、并发、Range stream 和失败态；运维环境 + 服务器维护 Agent 完成 Docker、Nginx、发布、回滚、smoke 和 runtime verify；测试验收 Agent 完成跨账号、接口、浏览器和线上链路验收；架构审查 Agent 持续守住模块边界、任务状态化和安全访问模型。
- 后续看板只保留必要优化：已知体验细节、资源归属、安全访问、预览性能、监控告警、文档和测试自动化；不再把 v1.0 主链路作为阻塞项。

## 2026-05-19 Release 20260519-002 Deployed
- 已打包并部署 `20260519-002`，用于修复线上字幕小方块问题。
- 发布包：`dist-release/shuziren-release-20260519-002.zip`，SHA256：`39616f0512d82f22789b5fdf145432f4b4e173cb30b886532261278bb5397613`。
- 线上镜像已切换到 `shuziren-api:20260519-002`、`shuziren-web:20260519-002`。
- 服务器部署脚本已通过：包内 `SHA256SUMS` 校验、preflight、migration、docker compose build/up、`scripts/smoke-test.sh`、`scripts/verify-runtime.sh`。
- 字幕专项验证通过：API 容器已安装 `fonts-noto-cjk` / `fonts-wqy-zenhei`，`fc-match "Noto Sans CJK SC"` 正常；后端 dist 默认字幕字体为 `Noto Sans CJK SC`；FFmpeg 中文字幕渲染探测不再出现 `failed to find any fallback with glyph`。
- 注意：旧成片中已经烧录成小方块的字幕不会自动恢复，需要用户重新生成成片。

## 2026-05-19 BE-016 Backend Completed (Review)
- 已完成“添加数字人 -> 从已保存视频中选择”后端隔离修复：
  - 新增 `GET /api/v1/resources/avatars/upload-videos`，仅返回当前用户 `avatar_resources` 中 `avatar-upload_*` 本地来源视频。
  - 新增 `GET /api/v1/resources/avatar-video-files/:fileName/stream`，仅允许当前用户访问 own 文件。
  - `POST /api/v1/resources/avatars` 在传入本地 `originalVideoUrl` 时增加来源与归属校验：非 `avatar-upload_*` 或非本人文件拒绝。
- 文档已同步：`docs/API.md`、`docs/DATABASE.md`。
- 验证通过：`npm --prefix backend run test -- --runInBand`、`npm --prefix backend run build`。
- 下一步：`FE-011` 切换前端下拉数据源到新接口，并由 `QA-011` 执行跨账号与抖音文件排除回归。

## 2026-05-19 Avatar Saved Video Isolation Verified
- 线上已复现“添加数字人 -> 从已保存视频中选择”越权问题：新注册账号 `ops_saved_video_probe_7e5d2034@example.com` 请求 `GET /api/v1/tools/saved-videos` 返回 `count=37`，包含其他历史视频和抖音下载视频，如 `*_douyin_dy_video.mp4`。
- 代码定位：`backend/src/modules/tools/tools.controller.ts` 的 `listSavedVideos()` 直接读取全局 `VIDEO_SAVE_DIR`，没有按 `req.userId` 过滤；`frontend/src/components/resources/NewAvatarModal.vue` 使用该接口作为数字人已保存视频下拉数据源。
- 已更新 `TASK_BOARD.md`：新增 `BE-016`（后端主修复）、`FE-011`（前端接口切换与文案配合）、`QA-011`（跨账号和抖音视频排除验收）。
- 下一步：后端先修复数据来源和归属校验，确保添加数字人只能选择当前用户上传到数字人库的视频，禁止抖音抓取视频和其他用户视频混入。

## 2026-05-19 BE-015 Release Route Gate Completed
- Added `scripts/verify-release-routes.js` to enforce route existence checks for `GET/POST /api/v1/tools/recent-extractions`.
- Integrated checks into both release builders:
  - `deploy/build-release.sh`
  - `deploy/build-release.ps1`
- The release process now validates route markers in both:
  - local build output: `backend/dist/modules/tools/tools.controller.js`
  - packaged output: `dist-release/<package>/backend/dist/modules/tools/tools.controller.js`
- Local validation:
  - pass: `node scripts/verify-release-routes.js --backend-dist-dir backend/dist --context manual-backend-dist`
  - expected fail on historical package `20260518-006`, confirming the gate can block bad artifacts.
- Completed later: `OPS-010` redeploy/version check and `QA-010` browser regression both passed; `/studio` no longer triggers `recent-extractions` 404.

## 2026-05-18 Recent Extractions 404 Hotfix
- Restored backend controller routes for `GET /api/v1/tools/recent-extractions` and `POST /api/v1/tools/recent-extractions`; the service and table already existed but the controller route was missing, causing 404 on the video creation page.
- Added e2e coverage for list/save recent extraction records. Validation passed: backend lint, unit tests, build, and targeted tools-pipeline e2e.
## 2026-05-18 Release 20260518-006 Deployed
- 已打包并上线 `20260518-006`，包含 `BE-014` voice-preview 异步队列/试听音频签名 Range stream 和 `FE-010` 配音试听状态机改造。
- 本地发布门禁通过：frontend build、DY-DOWNLOADER build、backend build、backend jest 8 suites / 33 tests passed。
- 服务器部署门禁通过：zip SHA256 校验、包内 `SHA256SUMS` 校验、preflight、MySQL migration、database preflight、docker compose build/up、smoke-test、runtime verify。
- 线上容器已运行：`shuziren-api:20260518-006` healthy，`shuziren-web:20260518-006` started，`/api/health` 与 `/api/health/deep` 均通过。
- Next: `OPS-009` 和 `QA-009` 继续做 preview-audios Range/Auth、试听卡片可见性、跨账号隔离和浏览器播放回归。

## 2026-05-18 BE-014 Completed
- Backend voice preview performance guard is complete: `POST /api/v1/tools/voice-preview` creates an async task and `GET /api/v1/tools/voice-preview-tasks/:taskId` returns status/result.
- Same-user repeated preview clicks now use latest-request-wins: unfinished older tasks are marked failed with a superseded error, and stale generated audio is removed if an old task finishes late.
- Preview audio stream now requires signed `token/expires`, validates current user, and supports `Content-Length`, `Accept-Ranges`, `Content-Range`, 206 and 416 responses.
- Backend validation passed: `npm --prefix backend run lint`, `npm --prefix backend run test -- --runInBand`, `npm --prefix backend run build`. `docker compose config` is still blocked locally because Docker CLI is not installed in PATH.
- Next: `OPS-009` must verify reverse proxy preserves Range/Auth headers; `QA-009` must run browser playback/cross-account regression.
## 2026-05-18 FE-010 Frontend Completed (Review)
- `CreativeStudioView` 已完成配音试听状态流改造：点击生成后立即进入 `submitted`，并按 `queued/running/saving/ready/failed/timeout` 展示即时反馈。
- 已兼容两类后端返回：同步 `audioUrl` 直出、异步 `previewTaskId + statusUrl` 轮询，轮询超时和失败有明确错误态。
- 试听卡片改为状态驱动显示，不再仅依赖 `voicePreviewUrl`；播放和下载在无可用 URL 时禁用，避免误触发。
- 已执行并通过：`npm --prefix frontend run typecheck`、`npm --prefix frontend run build`。下一步进入 `QA-009` 验收。

## 2026-05-18 BE-013 Completed
- `POST /api/v1/tools/voice-preview` 已改为异步任务创建，快速返回 `previewTaskId/status/pollPath`。
- 新增 `GET /api/v1/tools/voice-preview-tasks/:taskId`，按当前用户返回 `queued/running/succeeded/failed` 与 `audioUrl/durationSeconds/error`。
- `GET /api/v1/tools/preview-audios/:fileName/stream` 已要求 `token+expires` 短期签名并绑定 `userId`，禁止跨账号直接访问。

## 2026-05-18 Voice Preview Visibility/Playback Dispatch
- 新问题已拆解：创作第二步“生成音频”成功后，前端必须等 `POST /api/v1/tools/voice-preview` 同步长请求完整返回并写入 `voicePreviewUrl`，才显示“试听音频已生成”；后端当前等待 TTS 与 `persistPreviewAudio()` 写盘后才返回，播放层还会先全量 `fetch blob`。
- 已分发任务：`ARCH-003` 审查 voice-preview 状态化链路；`BE-013` 后端补齐用户归属与快速返回/状态查询；`BE-014` 后端优化 TTS 并发、超时、写盘和 stream；`FE-010` 前端生成状态与试听卡片即时反馈；`OPS-009` 校验 preview-audios 反代与私有缓存；`QA-009` 做可见性、播放速度和跨账号隔离验收。
- 当前未改业务代码，本次只完成问题定位、拆解与任务看板分发。

## 2026-05-18 Saved Videos Isolation/Preview Dispatch
- 新问题已拆解：数字人添加弹窗“从已保存视频选择”当前基于全局 `VIDEO_SAVE_DIR` 列表，首次登录账号会看到历史/其他用户视频；选择后预览通过整文件 blob 下载，导致大视频等待时间长。
- 已分发任务：`ARCH-002` 审查 saved video 归属模型；`BE-012` 后端按用户隔离并支持 Range/短期预览 URL；`FE-009` 前端预览改为按需 metadata/stream；`OPS-008` 校验 Nginx/OSS Range 与私有资源代理；`QA-008` 做跨账号隔离和预览速度验收。
- 当前未改业务代码，本次只完成问题拆解与任务看板分发。

## 2026-05-18 BE-011 Completed
- 创作页“最近提取记录”已从前端本地缓存升级为后端按用户隔离存储（`recent_extractions`）。
- 新增接口：`GET /api/v1/tools/recent-extractions`、`POST /api/v1/tools/recent-extractions`，仅返回当前 JWT 用户数据。
- 数据库已补充 `recent_extractions`（MySQL/SQLite 双迁移）与 `(user_id, source_url)` 唯一键，支持同用户重复提取 upsert。
- 已验证通过：`npm --prefix backend run test -- recent-extraction.service.spec.ts --runInBand`、`npm --prefix backend run build`、`npm --prefix frontend run build`。

## 2026-05-18 Release Candidate 20260518-005 Prepared
- 已生成下一次部署候选包：`dist-release/shuziren-release-20260518-005.zip`。
- 包含看板候选内容：`BE-010` deep health 修复、`FE-008` 资源库视频预览缓存返工。
- 已通过门禁：frontend `lint/typecheck/build`，backend `lint/test/build/test:e2e`，release package build。
- 已部署到线上：`20260518-005`，服务器 runtime verify 和 smoke test 通过，`/api/health` 与 `/api/health/deep` 均返回 `ok=true`。
- 待验收项：`FE-008` 已上线但仍在 `Review`，需要 `QA-007` 浏览器复测首屏无全量加载、hover 单卡请求、返回后缓存复用、预览弹窗。

## 2026-05-18 BE-010 Completed
- `BE-010` 已完成：`/api/health/deep` 的 ffmpeg 探测改为复用 `FfmpegAudioService.probeBinary()`，与业务链路保持一致。
- `schema` 探测已支持数据库方言分支：MySQL 使用 `INFORMATION_SCHEMA`，SQLite 使用 `PRAGMA table_info(...)`，修复 SQLite 环境误报 `INFORMATION_SCHEMA` 缺失的问题。
- 新增单测：`backend/src/modules/health/health.service.spec.ts`，覆盖 SQLite 与 MySQL schema 检查路径。
- 后端门禁已通过：`npm --prefix backend run lint`、`npm --prefix backend run test -- --runInBand`、`npm --prefix backend run build`、`npm --prefix backend run test:e2e -- --runInBand`。

## 2026-05-18 FE-008 Rework Update
- `FE-008` 已完成返工并回到 `Review`：会话缓存 key 从 `id + updatedAt + originalVideoUrl` 调整为稳定的 `id + originalVideoUrl`，修复 SPA 路由返回后同卡片二次 hover 仍重复请求 stream 的问题。
- `QA-007` 已从 `Blocked` 解除为 `Ready`，待复测“首屏无全量加载、hover 单卡请求、跨路由返回缓存复用、预览弹窗可播放”。
- 前端门禁已执行并通过：`npm --prefix frontend run lint`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run build`。

## 2026-05-18 QA Retest And Dispatch Update
- 本轮测试已完成：前端 `lint/typecheck/build` 全通过；后端 `lint/test/build/test:e2e` 全通过；API 冒烟中 `/`、`/api`、`/api/v1/tools/digital-human-env`、`/api/v1/auth/me` 鉴权、`/api/v1/tools/transcribe-pipeline-health`、`/api/health` 均通过。
- `FE-007` / `QA-006` 已转 `Done`：同一浏览器 A/B 账号验证“最近提取记录”按账号隔离，旧全局 localStorage key 已清理，无跨账号泄漏。
- `FE-008` 退回 `Ready` 给前端 UI + 业务开发 Agent：`/resources` 首屏无全量 stream 请求、hover 单卡请求和预览弹窗均通过；失败点是 SPA 离开 `/resources` 再返回后，同一卡片第二次 hover 仍请求同一 saved-video stream，未复用已加载预览缓存。
- `QA-007` 已标记 `Blocked`：等待 `FE-008` 返工后复测“首屏无全量加载、hover 单卡请求、跨路由返回缓存复用、预览弹窗”。
- 环境阻塞仍存在：PowerShell PATH 无 `docker` 和 `bash`，`docker compose config` 与 `bash scripts/smoke-test.sh` 不可执行；`/api/health/deep` 剩余阻塞转由 `OPS-006` 补齐本地 `TEMP_DIR` / `yt-dlp` 等运行依赖后复测。

## 2026-05-18 Resource Library Preview Optimization
- `FE-008` 已修复并进入 Review：`/resources` 头像卡片视频预览从“列表变更即全量并发加载”改为“卡片 hover 按需加载”，降低重复 loading。
- 新增会话级卡片预览缓存（`id + updatedAt + originalVideoUrl`），跨页面返回素材库时可复用已加载预览，避免每次重新拉取全部 saved-video blob。
- 已执行前端门禁：`npm --prefix frontend run lint`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run build` 均通过；等待 `QA-007` 浏览器回归。

## 2026-05-18 Frontend Privacy Update
- `FE-007` 已修复并进入 Review：创作页“最近提取记录”从全局 localStorage key 改为按当前账号 `id/email` 隔离存储，旧全局 key 不再读取。
- `QA-006` 已分发给测试验收 Agent：需要在同一浏览器中用两个账号交叉验证最近提取记录互不可见。
- 已执行前端门禁：`npm --prefix frontend run lint`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run build` 均通过。

## 2026-05-18 OSS QA/BE Update
- `QA-005` 已执行并通过：线上完成上传视频、上传音频、口型生成、成片下载。
- `QA-004` 已复测通过：部署 `20260518-004` 后，`GET /api/v1/resources/voice-files/:fileName/stream` 从 404 恢复为 200。
- `BE-009` 已完成并上线：`resources.service.ts` 兼容 `ali-oss getStream()` 返回 `{ stream }`；线上声音样本 OSS 流式回读恢复。

## 2026-05-18 Backend Update
- `BE-002` 已完成：后端 lint 门禁通过，`npm --prefix backend run lint`、`build`、`test -- --runInBand`、`test:e2e -- --runInBand` 全通过。
- `BE-003` 已完成：`no-unsafe-*` 类型安全收敛完成，provider response / statement cache / e2e response body 已补最小类型保护。
- 阻塞解除：`backend/src/integrations/ai/qwen-voice-clone.service.ts` 中 `audio` 变量重名导致的编译失败已修复。

## 2026-05-18 QA Update
- 看板复测已完成：前端 `lint/typecheck/build` 全通过；后端 `lint/test/build/e2e` 全通过；PowerShell 等价 smoke 的 `/`、`/api`、`/api/v1/tools/digital-human-env`、无 token `/auth/me` 401、注册测试账号后带 token `/auth/me` 均通过。
- 本轮新增环境失败项：`docker`、`bash` 仍不在 PowerShell PATH；`bash scripts/smoke-test.sh`、`docker compose config` 仍不可执行；`/api/health/deep` 返回 `ok=false`，原因包括 `TEMP_DIR=C:\tmp` 不存在、`ffmpeg/yt-dlp` ENOENT、本地 SQLite 环境下 schema 检查误用 MySQL `INFORMATION_SCHEMA`。
- 已分发新任务：`OPS-006` 补齐本地 deep health 运行依赖，`OPS-007` 准备 OSS/AI 安全回归测试条件。

更新日期：2026-05-18

## 当前项目阶段

阶段：全栈 MVP 已成型，进入多 Agent 协作、稳定性加固和发布流程标准化阶段。

当前判断：

- 前端已经具备数字人配置、资源库、创作工作台、任务流程、后台管理等主流程页面。
- 后端已经具备鉴权、资源、任务、作品、后台、AI 工具接口、MySQL/SQLite 双持久化、Docker Compose 一体化部署。
- 当前重点不是重写业务，而是建立任务流、验收流、部署流和状态文档，让多个 Agent 能持续协作。

## 已完成功能

- 用户注册、登录、`/api/v1/auth/me` 当前用户信息。
- 全局 JWT 鉴权、账号状态拦截、管理员角色访问控制。
- 数字人形象生成、保存、读取、删除。
- 头像、声音、字幕模板资源库，支持推荐资源和个人资源。
- 声音克隆、上传声音样本、provider stream。
- 声音资源缺失样本时不再回退到同一段外部音乐，旧兜底音频 URL 会在资源初始化时清理为空。
- 声音克隆失败时会回退为 `local-upload` 本地音色，且可在试听与最终成片流程中直接复用样本音频。
- 声音样本存储支持 `local/oss` 双模式，`VOICE_SAMPLE_STORAGE=oss` 时写入 OSS 且保持现有 `voice-files` 接口不变。
- OSS 模式下声音样本试听与 provider 回读已支持流式代理，减少后端内存占用。
- 最终渲染后端已兼容顶层 `voiceRate` 语速参数，创作页已接入用户自选语速并移除固定 `1.13` 默认值。
- 创作页第二步已显示脚本、数字人、音色 ready 状态、生成支持能力和资源匹配失败原因；已保存视频弹窗读取失败时会显示 `/api/v1/tools/saved-videos` 错误与重试入口。
- `/studio` 语速/音量滑杆已补齐 `NSlider` 注册；数字人添加弹窗初次挂载会立即请求已保存视频列表。
- 口播创作流程：链接解析、视频元信息、转写、文案优化、TTS、字幕工作流、对口型预览、最终渲染。
- 任务流程：创建任务、上传照片、提取文案、改写、提交渲染、结果下载。
- 我的作品列表和作品元数据编辑。
- 后台：统计、用户审核、审计日志、作品、数字人模板、资源管理。
- 数据层：MySQL 生产模式，SQLite 本地兜底模式。
- 部署层：`docker-compose.yml`、`compose.runtime.yml`、`deploy/` 发布和回滚脚本。
- 文件体积优化：前端字体收敛到 latin 子集，平台 logo 压缩，未引用生成副本和 PNG 备份已清理；后端移除 `ffmpeg-static` / `ffprobe-static` 大体积 npm 依赖；Docker build context 已排除本地运行产物。
- 基础运行保护：CORS、生产 JWT/CORS 校验、安全响应头、基础限流、慢请求日志。

## 未完成功能

- 标准 CI 尚未固化到仓库流水线。
- 前端 `package.json` 已提供 `lint` 脚本，当前以 `vue-tsc -b` 作为前端质量门禁。
- 长任务仍有部分 HTTP 请求直接等待外部 AI 或 FFmpeg，后续需要统一进入任务队列或任务状态服务。
- 任务状态目前支持内存/数据库/Redis 方向的能力，但生产高并发需要明确 Redis 与队列部署策略。
- 部分历史中文注释或文档存在编码显示异常，后续应统一 UTF-8。
- 生产监控、日志采集、告警和备份恢复演练尚未形成自动化。

## 当前阻塞

- 真实 AI 能力依赖外部密钥：`DASHSCOPE_API_KEY`、`ARK_API_KEY`、`SEEDANCE_I2V_API_KEY`、`DY_DOWNLOADER_COOKIE` 等。
- 生产启动必须设置 `JWT_SECRET` 和 `CORS_ORIGINS`，否则后端会拒绝启动。
- 需要公网可访问媒体回调时必须设置 `PUBLIC_BASE_URL`、`PUBLIC_UPLOAD_BASE_URL`。
- Docker staging 若本机已有服务占用端口，需要通过 `WEB_PORT`、`MYSQL_HOST_PORT` 覆盖。
- 2026-05-18 本地 `npm ci` 仍被 Windows 原生依赖文件锁阻断：前端 `rolldown-binding.win32-x64-msvc.node`、后端 `better_sqlite3.node` 出现 EPERM；需释放占用进程后复跑。
- 2026-05-18 当前 PowerShell PATH 仍无 `docker` 和 `bash`，因此本轮体积优化未直接执行 `docker compose config` 与 `bash scripts/smoke-test.sh`。
- 2026-05-18 `/studio` 看板返工已验收通过：`FE-005`、`FE-006`、`BE-008`、`QA-003` 均已转 `Done`；非付费链路已跑到第三步。真实 `voice-preview` / `render-final` provider 点击仍需 mock 或人工确认后再测。
- 2026-05-18 `/api/health/deep` 本地复测未通过：`TEMP_DIR=C:\tmp` 不存在或不可写，deep health 未发现 `backend/ffmpeg/bin/ffmpeg.exe`，`yt-dlp` 未配置，SQLite 本地库下 schema 检查仍按 MySQL `INFORMATION_SCHEMA` 执行。
- 2026-05-18 `QA-004` / `QA-005` 已执行真实链路并通过：`QA-005` 完成上传视频、上传音频、口型生成、成片下载；`QA-004` 在部署 `20260518-004` 后确认 `voice-files/*/stream` 返回 200。

## 当前环境

本地工作目录：`C:\Users\PC\shuziren`

默认本地开发：

- 前端：`npm run dev:frontend`，默认 `http://127.0.0.1:5173`
- 后端：`npm run dev:backend`，默认 `http://127.0.0.1:3000/api`
- Docker：`docker compose up -d --build`，默认 `http://127.0.0.1:8080`

当前验证限制：

- 当前 PowerShell PATH 未提供 `bash`，因此 `.sh` 脚本需在 Git Bash、WSL、Linux、CI 或服务器上执行。
- 当前 PowerShell PATH 未提供 `docker`，因此 Compose 验证需在安装 Docker CLI 的环境执行。
- 2026-05-18 已执行 PowerShell 等价 smoke：`/`、`/api`、`/api/v1/tools/digital-human-env`、无 token `/api/v1/auth/me` 401、带本地测试 token `/api/v1/auth/me` 成功均通过；但当前无 `bash`，仍未直接执行 `scripts/smoke-test.sh`。
- 2026-05-18 `GET /api/v1/auth/me` 的响应结构为 `{ user: { ... } }`，测试脚本需读取 `user.email` 和 `user.accountStatus`。
- 2026-05-18 `GET /api/v1/tools/transcribe-pipeline-health` 带 token 可找到内置 `backend/ffmpeg/bin/ffmpeg.exe`，但 `GET /api/health/deep` 仍按 `ffmpeg` PATH 检查失败，后端健康检查存在解析不一致。

关键目录：

- 前端源码：`frontend/src`
- 后端源码：`backend/src`
- 后端环境示例：`backend/.env.example`
- 部署脚本：`deploy/`
- 协作脚本：`scripts/`

## 下一步目标

1. `OPS-004`：运维环境 Agent 落地 Windows Docker + bash 验收环境，释放 Node/原生依赖文件锁，复跑 `bash scripts/check-all.sh`、`bash scripts/smoke-test.sh`、`docker compose config` 与 frontend/backend `npm ci`。
2. `OPS-006`：运维环境 Agent 补齐本地 deep health 运行依赖：可写 `TEMP_DIR`、`FFMPEG_BIN`/PATH、`YTDLP_BIN`，重启 API 后复测 `/api/health/deep`。
3. `QA-001`：测试验收 Agent 在运维补齐依赖后复测 `/api/health/deep`，确认 ffmpeg/schema 子项与 `transcribe-pipeline-health` 一致。
4. `OPS-007`：运维环境 Agent 准备 OSS/AI 安全回归测试条件：mock/staging provider，或取得用户确认的测试账号、声音样本、视频样本、token 与日志采集方式。
5. `QA-001`：测试验收 Agent 在 bash 可用后直接执行 `scripts/smoke-test.sh`，确认脚本门禁与 PowerShell 等价结果一致。
6. `OPS-007`：沉淀后续 OSS/AI 回归测试条件和日志采集方式，避免每次真实 provider 回归都临时组织。
## 2026-05-19 Studio recent-extractions 404 Dispatch
- 已新增看板任务并分发：
  - `OPS-010`：线上 API 版本一致性修复与部署校验（已完成，用户确认）。
  - `BE-015`：后端 dist/发布包路由存在性核对与文档补充。
  - `QA-010`：`/studio` 首屏 recent-extractions 回归验收。
- 当前结论：本地代码存在路由与前端容错，线上 404 主要是运行版本与发布包不一致导致。
## 2026-05-19 Production recent-extractions API Verified
- Production `GET http://39.105.194.164:8080/api/v1/tools/recent-extractions?limit=6` now returns 401 without token instead of 404, confirming the route is present online.
- Production `/api/health` and `/api/health/deep` return `ok=true`; runtime build version is `20260519-002`.
- No additional production redeploy was executed in that turn. Browser login regression has since passed in `QA-010` / `QA-PROD-001`; `/studio` has no visible `recent-extractions` error toast and no 404 in CDP network capture.
