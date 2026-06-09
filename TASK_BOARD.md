# Task Board

本看板只保留当前活跃任务、近期完成任务和分发规则。历史流水账不再追加到本文档，需要追溯时查看 git 历史。

## Core Flow Recovery Gate

当前项目进入“核心流程恢复模式”。在 `QA-CORE-001` 完成本地端到端验收前，所有 Agent 只处理会直接阻塞下列主链路的任务：

1. 提取爆款文案。
2. 克隆/选择声音并生成音频。
3. 按口播分段生成秒级字幕时间轴。
4. 用当前音频和当前数字人生成口型视频。
5. 用户选择字幕模板并渲染最终视频。

冻结规则：

- 暂停新增模板花样、后端瘦身、非必要性能优化、旧接口清理和线上部署准备。
- 不再把所有工作塞到第三步最终渲染；音频、字幕、口型、包装必须分阶段产出、分阶段验收。
- 每个阶段必须有明确产物 ID：`projectId`、`scriptHash`、`audioAssetId`、`subtitleTrackId`、`digitalHumanVideoAssetId`、`subtitleTemplateId`、`packageRenderTaskId/finalVideoUrl`。
- 任一阶段失败，只修该阶段的数据合同、接口、UI 状态和错误提示；禁止绕过去继续做后面的功能。
- `Done` 只允许在 QA 跑通本地核心流程后标记；单元测试或 build 通过只能进入 `Review`。

| Task ID | Status | Owner Agent | Priority | Acceptance | Test Result |
|---|---|---|---|---|---|
| CORE-000 | Done | 指挥官 Agent | P0 | 收回任务范围：确认当前唯一目标是恢复主链路，不继续并行做外围优化和新功能。 | 已完成：主链路定义为“提取爆款文案 -> 克隆/选择声音并生成音频 -> 对齐字幕时间轴 -> 生成口型视频 -> 选择字幕模板渲染最终视频”。 |
| AUDIT-CORE-001 | Done | 指挥官 Agent / 架构审查 Agent | P0 | 整理 V1.0 后新增功能，判断哪些已经进入主链路、哪些应冻结为可选能力，并列出仍会造成主流程阻塞的点。 | 已完成静态审计：主链路风险集中在 `projectId/stage-state`、`tts_alignment`、`preserveSourceAspect`、`provider_running`、媒体 preflight、最终包装资产一致性和前端按钮门禁；Remotion 标题素材、模板高级编辑、封面编辑、后端瘦身、线上部署准备必须冻结为可选能力，不得阻塞核心生成。 |
| ARCH-CORE-024 | Done | 架构审查 Agent | P0 | 为 V1.0 后功能划定硬边界：标题素材、模板高级编辑、封面编辑、项目列表增强、legacy 删除和部署准备不得成为核心流程依赖；若代码或 UI 门禁把这些能力作为必填，必须退回可选分支。 | 审查完成但当前实现不完全通过：`subtitleTemplateId` 作为字幕样式选择可以是第三步必需项；复制/编辑模板、封面编辑、标题素材和 Remotion 透明标题只能可选。发现风险：前端 `smartClipIncludeTitleAssets` 默认 `true` 且没有真正作为用户可控开关展示；后端 `package-render-tasks` 在标题叠加失败时会让包装任务失败；第三步进度文案固定出现“标题叠加/封面效果”。已分发 `FE-CORE-003`、`BE-CORE-009`、`QA-CORE-004`。 |
| BE-CORE-008 | Review | 后端优化 Agent | P0 | 复查 VideoRetalk 剩余媒体 preflight 硬阈值：时长、体积、分辨率、像素格式、音频大小必须来自 provider 明确要求或可配置；不允许再用任意保守阈值阻断 V1.0 基线素材；码率只记录不拦截的规则必须保留。 | 已完成：preflight 默认值收敛到 provider 基线（120s/300MB/2048px/30MB audio），`ALI_VIDEORETALK_MEDIA_ALLOWED_PIX_FMTS` 默认空（不拦截），仅在显式配置时生效；码率继续只记录不阻断。同步更新 `.env.example`、`backend/.env.example`、`deploy/*.env.example`、`docs/DEPLOY.md` 并补单测锁定默认行为。验证：`npm --prefix backend run test -- subtitle-workflow.service.spec.ts --runInBand`、`npm --prefix backend run build`。 |
| BE-CORE-009 | Ready | 后端功能逻辑开发 Agent | P0 | 让标题素材叠加从核心包装链路中降级为可选分支：`includeTitleAssets=false` 时不得查询/叠加标题；`includeTitleAssets=true` 且标题素材缺失或叠加失败时，不得让无标题的最终包装失败，除非后续产品明确增加“标题必须成功”模式。需要返回或记录可读 warning，主输出 MP4 仍应成功。 | 待执行；重点文件 `backend/src/modules/tools/staged-workflow.service.ts`。当前风险点：`overlayTitleAssets()` 失败会抛出并中断 `packageRenderFromAssets()`。需补单测覆盖坏标题素材不阻塞无标题成片。 |
| FE-CORE-003 | Ready | 前端 UI + 业务开发 Agent | P0 | 复查 `/studio` 主流程按钮门禁：第二步和第三步只允许被当前阶段必需产物 ID 阻断；标题素材、模板高级编辑、封面编辑、项目列表、旧预览恢复失败不得禁用核心生成按钮。所有禁用原因必须能显示给用户。 | 待执行；重点检查 `subtitleTimelineAligned`、`selectedSubtitleTemplateId`、stage-state 恢复、模板回退和第三步立即剪辑按钮。补充必改：`smartClipIncludeTitleAssets` 不得默认无感知开启；要么默认 `false`，要么仅在用户显式开启且存在成功标题素材时传 `true`。第三步进度文案不能固定显示“标题叠加/封面效果”。 |
| QA-CORE-004 | Ready | 测试验收 Agent | P0 | 建立 V1.0 回归矩阵：使用固定本地夹具跑最小主链路，只启用文案、CosyVoice/mock 音频、字幕时间轴、口型任务、字幕模板、最终包装；明确禁用标题素材、模板编辑、封面编辑、项目列表增强和线上部署。 | 待 `BE-CORE-005/QA-CORE-002` 提供安全 mock/stub 后执行；输出每一步请求、响应、产物 ID、按钮状态和失败截图。补充验收：抓包确认包装请求默认 `includeTitleAssets=false` 或未传；人为制造损坏标题素材时，核心无标题包装仍能成功。 |
| ARCH-023 | Done | 架构审查 Agent | P0 | 审查核心流程边界：主流程必须以 `video_projects.id` 为唯一容器，所有阶段产物只按当前 `projectId + userId` 读取和写入；不得再按音频名、文案、数字人名称或旧 `studio-current` 自动匹配。 | 审查通过：采用单项目容器、阶段产物显式 ID、阶段状态可恢复；不新增复杂版本系统，不做大重构。 |
| BE-CORE-001 | Review | 后端功能逻辑开发 Agent | P0 | 核查并修复主链路 API 合同：文案提取/保存、音频生成、字幕时间轴、口型任务、模板包装成片必须全部走 project-scoped 当前接口；确认 legacy kill-switch 没有误伤当前主流程；清理或屏蔽前端仍可能误调的 legacy 包装。 | 已完成后端合同收敛：`POST /api/v1/audio-assets/generate` 与显式 `POST /api/v1/audio-assets/:id/subtitle-track` 新增强制 `projectId` 校验，拒绝 `studio-current`；保持 `video-projects/:projectId/lipsync-tasks` 与 `package-render-tasks` project-scoped 入口不变。同步更新 `docs/API.md`。验证：`npm --prefix backend run test`、`npm --prefix backend run build` 通过。待 `QA-CORE-001` 端到端验收。 |
| FE-CORE-001 | Review | 前端 UI + 业务开发 Agent | P0 | 收敛 `/studio` 主流程状态机：每一步只依赖上一阶段明确产物 ID；按钮禁用原因必须对应真实缺失项；页面不得把旧 ASR 轨、旧口型任务、旧模板状态回填成当前可用状态。 | 已完成前端状态机收敛：新增第二步字幕对齐门禁（`subtitleTimelineAligned`），进入第三步与最终渲染均要求 `subtitleTrackId` 存在且已通过 `tts_alignment` 校验；项目恢复时若字幕轨 `source!=tts_alignment` 或 `audioAssetId` 不匹配，会标记失败并清空 `stage-state.subtitleTrackId`，避免旧 ASR 轨回填；文案配置恢复时会校验 `selectedSubtitleTemplateId` 是否仍在当前模板列表，不存在则回退到可用模板，避免失效模板被当成已选。验证：`npm --prefix frontend run build` 通过。待 `QA-CORE-001` 端到端验收。 |
| FE-CORE-002 | Review | 前端 UI + 业务开发 Agent | P0 | 修复第二步“预览口型视频”弹窗画面比例：预览框必须是正常 9:16 高度，视频等比显示，不允许 CSS 拉伸造成画面变形；本任务不改口型生成参数。 | 已完成：`CreativeStudioView` 的口型预览弹窗新增 9:16 frame，视频改为 `width/height:100%` + `object-fit: contain`，弹窗宽度收敛为竖屏预览尺寸。静态检查确认第二步口型任务仍传 `renderMode=preserveSourceAspect`，后端默认同样为 `preserveSourceAspect`。验证：`npm --prefix frontend run build` 通过。待本地视觉复核；若仍扭曲，下一步检查生成文件 ffprobe/provider 输出。 |
| BE-CORE-002 | Review | 后端功能逻辑开发 Agent | P0 | 修复字幕时间轴主链路：显式字幕生成必须接收当前口播 `scriptSegments`，返回 `source=tts_alignment`，字幕条数等于分段数，`startTime/endTime` 秒级递增、不重叠，并写回当前项目 stage-state。 | 已完成：显式字幕轨仍强制 `scriptSegments`，并在生成后额外调用 `saveProjectStageState` 做 stage-state upsert，确保 `audioAssetId/subtitleTrackId` 一致回写（不依赖已有行）。现有 `tts_alignment + 分段数一致` 单测继续通过。验证：`npm --prefix backend run test`、`npm --prefix backend run build`。待 `QA-CORE-001` 与 `QA-046` 复核。 |
| BE-CORE-003 | Review | 后端优化 Agent | P0 | 修复口型视频主链路稳定性：当前 `audioAssetId + avatarResourceId + projectId` 创建口型任务后，状态可查询、失败可读、`provider_running` 可恢复，成功后必须写入 `digitalHumanVideoAssetId` 和 stage-state；不得复活旧视频。 | 本轮未新增代码，沿用已落地链路（`provider_running`、恢复、成功回写 stage-state、dedupe 分支拆分）并回归通过。验证覆盖：`video-project-render.service.spec.ts`（14 tests）+ 全量 backend test/build 通过。待 `QA-CORE-001` mock/provider stub 端到端确认后可转 Done。 |
| BE-CORE-006 | Review | 后端优化 Agent | P0 | 防止 VideoRetalk RUNNING 超时问题反复：即使旧链路抛出普通 `Error` 文案，只要包含 Aliyun `task_status=RUNNING` 和 `task_id`，后端必须落 `provider_running` 并保留恢复上下文；本地后端构建后必须重启再验收。 | 已追加防复发自愈：`GET /api/v1/render-tasks/:taskId` 发现 lipsync 任务被误写 `failed` 但 provider 仍 `RUNNING`（来自错误文案或 `result_json.provider`）时，会自动回写为 `provider_running` 并触发恢复，不再卡死为假失败。新增单测覆盖该场景；验证：`npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`。本地后端已重启并健康检查通过；当前进程见 `OPS-CORE-002`。待前端继续查询并确认恢复结果。 |
| BE-CORE-007 | Review | 后端优化 Agent | P0 | 取消 VideoRetalk 码率硬限制：码率只做诊断记录，不允许因为预处理视频超过 12Mbps 阻断口型任务；保留可读性、时长、体积、分辨率、像素格式和音频容器体检。 | 已完成：`SubtitleWorkflowService` 不再向 preflight 阈值传入任何 `maxBitRate`，并删除 env 示例/部署文档中的 `ALI_VIDEORETALK_MEDIA_MAX_*_BITRATE_BPS`；新增单测确认 30Mbps 视频不会仅因码率被拒绝。验证：`npm --prefix backend run test -- subtitle-workflow.service.spec.ts --runInBand`、`npm --prefix backend run test`（28 suites / 173 tests）、`npm --prefix backend run build`、本地后端重启 PID `19720`、`GET /api/health ok=true`。待重新提交/继续口型任务验证。 |
| OPS-CORE-002 | Review | 运维环境 + 服务器维护 Agent | P0 | 建立本地运行态门禁：后端 `npm run build` 后必须重启 `node dist/main`，并用 `GET /api/health` 确认新进程；任何真实 provider 验收前必须记录 API 进程启动时间和 dist 更新时间，避免旧内存代码再次参与测试。 | 已执行本地修复：旧 3000 进程 PID `7404` 启动于 02:18，已停止；本轮取消码率限制后再次重启，当前新进程 PID `19720`，健康检查通过。待后续纳入 QA 执行清单。 |
| QA-CORE-003 | Ready | 测试验收 Agent | P0 | 验证本轮 VideoRetalk 恢复：打开当前项目，继续查询 `lipsync_0612948d-af36-41fa-97c3-338cbb21da0a`，确认前端显示 `provider_running/继续查询` 而不是失败；如果 Aliyun 已成功，必须确认后端下载结果、写入 `digitalHumanVideoAssetId` 和 stage-state；不得重新提交新的 Aliyun task。 | 待执行。当前 DB 已保留 provider taskId `03e2b461-0d03-42b7-909a-73d6308d2474`，状态为 `provider_running`。 |
| BE-CORE-004 | Review | 后端功能逻辑开发 Agent | P0 | 修复最终包装主链路：确保 `uploads/tmp` 等运行时目录存在；包装任务只接收当前口型视频、当前字幕轨和当前模板样式；字幕模板样式数据必须参与 FFmpeg/渲染结果；失败时返回明确错误而不是 ENOENT。 | 已完成收敛：在 `packageRenderFromAssets` 新增资产一致性校验，要求 `subtitleTrackId.audio_asset_id === audioAssetId`，且 `digitalHumanVideoAssetId.audio_asset_id`（若存在）必须匹配当前 `audioAssetId`；防止同项目内错绑旧字幕/旧音频。`uploads/tmp` 目录兜底与样式合并逻辑保持生效并回归。验证：`staged-workflow.service.spec.ts` 新增 2 个拒绝错绑用例，`npm --prefix backend run test`、`npm --prefix backend run build` 通过。待 `QA-CORE-001` 端到端验收。 |
| FE-PERF-CORE-001 | Review | 前端优化 Agent | P0 | 主流程只做必要性能修复：去掉重复轮询、陈旧请求回填和重复保存；每个长任务只保留一个轮询源；生成中必须显示进度和当前阶段，不做新的视觉扩展。 | 已完成必要前端性能修复：第三步包装成片轮询改为单一递归 `setTimeout` 源，新增 `taskId + pollSeq` 陈旧响应拦截；提交包装任务后不再额外立即刷新一次状态，避免创建后双请求；终态、失败和超时会释放渲染锁。第二步口型轮询和 `stage-state` latest-only 保存队列保持现有单源/去重策略。验证：`npm --prefix frontend run lint`、`npm --prefix frontend run build` 通过。待 `QA-CORE-001` 本地端到端验收。 |
| OPS-CORE-001 | Review | 运维环境 + 服务器维护 Agent | P0 | 准备本地和 staging 主链路运行条件：上传目录、`uploads/tmp`、FFmpeg、ASR/TTS/口型 provider 配置、legacy 开关、CORS、反代 Range/Header；不得触发生产发布。 | 已补齐 preflight 门禁、Compose 运行变量和部署文档；验证：Git Bash `bash -n` 通过，Python YAML 解析确认 compose api env 已包含核心变量，`git diff --check` 通过；当前本机无 Docker CLI，未执行 `docker compose config`/staging preflight。真实 provider 校验需人工确认后设置 `CORE_FLOW_REAL_PROVIDER=1`。 |
| QA-CORE-001 | Blocked | 测试验收 Agent | P0 | 本地端到端验收核心流程：从一个链接或手写文案开始，完成创建任务、生成音频、生成字幕时间轴、生成口型视频、选择字幕模板、渲染最终视频；记录每一步请求、响应、产物 ID、UI 状态、失败截图和日志。 | 2026-05-27 首轮验收未通过，不能标 Done。已执行：`npm --prefix backend run test` 通过（28 suites / 170 tests）、`npm --prefix backend run build` 通过、`npm --prefix frontend run lint` 通过、`npm --prefix frontend run build` 通过、`npm --prefix backend run test:pipeline` 通过（10 tests）、核心相关单测 5 suites / 48 tests 通过。失败/阻塞：`npm --prefix backend run test:e2e` 失败于 `admin-access.e2e-spec.ts` 注册 payload 过期；当前主链路缺少“强制不调用真实 provider”的完整 mock/stub E2E，`AI_MOCK_FALLBACK` 未被 `SpeechAiService` 消费，不能安全自动验收到真实 TTS/VideoRetalk/最终成片。 |
| BE-CORE-005 | Ready | 后端功能逻辑开发 Agent | P0 | 为 `QA-CORE-001` 提供显式安全 mock/stub 主链路：音频生成、字幕时间轴、口型任务、最终包装均可在测试环境跑通，且设置 mock 开关后不得调用真实 TTS、ASR、VideoRetalk 或 OSS 付费 provider。 | 待执行。重点检查 `SpeechAiService` 目前不消费 `AI_MOCK_FALLBACK`，`POST /api/v1/audio-assets/generate` 在本机存在 provider 密钥时可能真实调用 TTS。 |
| QA-CORE-002 | Ready | 测试验收 Agent | P0 | 补齐可重复执行的核心流程 E2E 脚本：启动 Nest 测试应用，注册/登录测试账号，创建 project，保存 scriptHash，生成 mock audio，生成 `source=tts_alignment` 字幕，创建 mock lipsync task，创建 mock package render task，记录每步 method/url/payload/产物 ID。 | 待 `BE-CORE-005` 完成后执行；不得依赖真实密钥，不跑 Docker，不触发真实付费 provider。 |
| BE-TEST-001 | Ready | 后端功能逻辑开发 Agent | P1 | 修复 `backend/test/admin-access.e2e-spec.ts` 过期注册用例：注册请求必须携带当前必填的 `phoneNumber` 与 `idCardNumber`，避免全量 e2e 被非核心 fixture 问题阻断。 | 当前失败证据：`npm --prefix backend run test:e2e` 中普通用户/admin 固定邮箱注册期望 201，但实际 400。 |

## Current Active Tasks

| Task ID | Status | Owner Agent | Priority | Acceptance | Test Result |
|---|---|---|---|---|---|
| DOC-014 | Done | 指挥官 Agent | P1 | 清理过期文档，核心文档只保留 V1.0 后现行流程、接口、数据结构、UI、部署和测试规则。 | 已完成：压缩根目录协作文档和 `docs/` 核心文档，移除历史流水、乱码、旧部署说明和过期接口记录；执行 `rg` 检查未发现残留乱码关键词。 |
| QA-LIPSYNC-001 | Blocked | 测试验收 Agent | P0 | 验证真实 `video-lipsync` 长任务边界、超时、失败态、重复点击复用和最终预览恢复。 | 阻塞：真实 provider 可能产生费用，需 staging/mock 或人工确认。 |
| OPS-PROD-001 | Blocked | 运维环境 + 服务器维护 Agent | P0 | 生产 HTTPS、Nginx 静态资源缓存、上传目录权限、线上 smoke test 和回滚路径可验证。 | 阻塞：生产发布/重启/回滚需要人工确认。 |
| QA-ENV-001 | Ready | 测试验收 Agent | P1 | 准备不使用生产密钥和生产数据的 staging 验证账号、资源夹具和 smoke 参数。 | 待执行。 |
| ARCH-020 | Done | 架构审查 Agent | P0 | 审查“重新生成数字人口型视频”的失效模型：点击重新生成后，当前阶段旧 `lipsyncTaskId`、旧 `digitalHumanVideoAssetId`、旧 `videoUrl`、旧 completed dedupe 任务都不得再参与本次生成和第三步包装；历史资产可保留审计，但必须与当前阶段解绑。 | 审查通过：不新增复杂版本表；采用“前端 regeneration intent + `forceRetry` + 唯一 `idempotencyKey` + 本地 generation token + 后端 active/completed 复用拆分”。历史 `digital_human_video_assets` 可保留审计，不做物理删除；当前阶段只认 stage-state 和当前前端代次。必改：`forceRetry` 只能绕过 completed 复用，不能绕过 pending/processing 防重复；旧轮询、旧预览 URL resolve、旧 stage-state 保存必须被 generation token 拦截。 |
| FE-073 | Review | 前端 UI + 业务开发 Agent | P0 | 修复第二步“重新生成”业务流：点击重新生成后设置明确的 regeneration intent/version；下一次 `createSmartClipLipSyncTask()` 必须传 `forceRetry: true` 和新的 `idempotencyKey` 或 regeneration key；生成新任务前保持 `digitalHumanVideoAssetId/videoUrl/lipsyncTaskId` 为空，第三步入口必须阻断旧资产。 | 已完成前端改造：新增第二步口型重新生成 intent/version（`stageTwoLipSyncRegenerationVersion`），点击“重新生成”后标记 `forceRetry` 待发；下一次创建口型任务会携带 `forceRetry: true` 与基于项目/音频/数字人/renderMode/scriptHash/version 的 regeneration key（`idempotencyKey`）；生成前继续清空 `digitalHumanVideoAssetId/videoUrl/lipsyncTaskId`，第三步仍由现有阻断条件防止旧资产进入包装。验证：`npm --prefix frontend run build` 通过。待 `QA-050` 联调验收后可转 `Done`。 |
| FE-PERF-011 | Review | 前端优化 Agent | P0 | 防止旧任务异步回填：点击重新生成时停止并 abort 旧轮询和旧请求，递增本地 lip-sync generation 序号；`syncStageTwoLipSyncTaskState()`、`startStageTwoLipSyncPolling()`、预览 URL resolve 和 stage-state 保存都必须校验当前 generation token，任何旧 `taskId`、旧轮询响应、旧预览 URL、旧保存完成后都不得写回 `stageTwoLipSyncVideoUrl` 或 `stageTwoDigitalHumanVideoAssetId`。 | 已完成前端防回填改造：新增本地 `generationSeq` + `boundTaskId`，并在任务同步、轮询、预览 URL resolve、stage-state 写回前后做 stale 校验；重新生成/清空结果时会递增 generation 并 abort 旧轮询请求，旧代次响应不再回填口型视频与资产 ID。验证：`npm --prefix frontend run build` 通过。待 `QA-050` 联调验收后可转 `Done`。 |
| BE-074 | Review | 后端功能逻辑开发 Agent | P0 | 修复 `video-lipsync` 显式重新生成：`forceRetry=true` 或 regeneration key 存在时必须绕过 completed task 复用；新任务响应不得携带旧 `digitalHumanVideoAssetId`；必要时把同项目同音频同数字人的旧 active-stage 口型资产标记为 `superseded` 或至少从当前 stage-state 中解绑。 | 已完成后端改造：`CreateLipSyncTaskBody` 新增 `regenerationKey`；`forceRetry` 或 `regenerationKey` 命中时，创建前先清空当前项目 stage-state 的 `lipsyncTaskId/digitalHumanVideoAssetId/videoUrl`，并绕过 dedupe 复用路径创建新任务。已补单测（含 completed 任务不复用与 stage-state 清空断言）并通过 `npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run build`。待 `QA-050` 联调验收。 |
| BE-PERF-011 | Done | 后端优化 Agent | P0 | 收敛口型任务 dedupe 策略：把 active task 复用和 completed task 复用拆成两个明确分支；`forceRetry/regenerationKey` 只禁用 completed 复用，不能禁用同 dedupeKey 的 pending/processing 复用；补充日志/测试区分 `active-dedupe-hit`、`completed-dedupe-hit`、`force-retry-new-task`，避免缓存/DB 旧任务长期复活。 | 已完成：`video-lipsync` 复用逻辑改为“先命中 active（含 forceRetry）→ 再判断 completed（仅非 forceRetry）”；新增 dedupe 日志三分支；补充/更新单测覆盖 forceRetry 下 active 复用、completed 复用命中、regeneration 强制新任务日志。验证：`npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run build` 通过。 |
| QA-050 | Ready | 测试验收 Agent | P0 | 验收“重新生成不会复活旧视频”：用 mock/provider stub 先生成 A，点击重新生成后确认前端 state 与 stage-state 均清空；再次生成必须创建新 taskId，不返回 A 的 `digitalHumanVideoAssetId/outputUrl`；旧轮询响应不能回填；第三步不能使用旧视频；不触发真实付费 provider。 | 2026-05-27 返工阻塞已解除：BE-075 完成后，`npm --prefix backend run test -- ffmpeg-audio.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build` 全部通过。待 QA 继续执行 mock/provider stub 联调与浏览器 E2E。 |
| FE-074 | Done | 前端 UI + 业务开发 Agent | P0 | 修复 `/studio` 第二步数字人选择未持久化：通过“+ 新建数字人/添加已保存视频”、点击已有数字人卡片切换、移除数字人后，都必须把当前 `avatarResourceId` 写入 `PUT /api/v1/video-projects/:projectId/stage-state`；刷新同一 `projectId` 后应恢复已选数字人。数字人变更时必须清空当前口型结果相关状态：`lipsyncTaskId/digitalHumanVideoAssetId/videoUrl`，防止第三步误用旧视频。 | `QA-051` 验收通过：本地浏览器打开 `/studio?projectId=project_c9f57284-03b2-44d7-ad1e-e44e09c92bdd`，点击“+ 添加”从已保存视频添加数字人后，DB/API 均确认写入 `avatarResourceId=fcb38fe4-877c-439a-82e5-51b4e886c9f8`、`renderMode=preserveSourceAspect`，旧口型字段 `lipsyncTaskId/digitalHumanVideoAssetId/videoUrl` 为 `null`；刷新同一项目后 UI 恢复“我的数字人”；移除数字人后 `avatarResourceId=null`。未触发 TTS/provider/口型生成，未跑 Docker。 |
| FE-PERF-012 | Done | 前端优化 Agent | P1 | 优化第二步 `stage-state` 保存：数字人选择、删除、模型/画质切换等只在 payload 变化时保存；同一内容不得重复写入；离开页面、切换 `projectId` 或连续点击时必须取消/忽略陈旧保存结果，避免旧保存把新选择覆盖。 | `QA-051` 验收通过：刷新项目恢复数字人后，`video_project_stage_states.updated_at` 保持添加时的 `2026-05-26T19:39:54.488Z`，未因恢复阶段重复保存；移除和显式 PUT 才产生后续受控更新时间。浏览器插件无 Network payload 能力，已用前端 API wrapper、显式 PUT/GET 和 DB 落库结果确认 method/url/payload。未触发真实 provider，未跑 Docker。 |
| BE-076 | Done | 后端功能逻辑开发 Agent | P1 | 补充 `stage-state` 中 `avatarResourceId` 的保存与归属回归测试：`PUT /api/v1/video-projects/:projectId/stage-state` 写入当前用户可用数字人后，`GET` 必须返回同一 `avatarResourceId`；跨账号或不存在资源不得被用于后续 project-scoped 长任务。若当前接口已满足，只补测试和错误码说明。 | 已完成：`saveProjectStageState` 新增 `avatarResourceId` 归属校验（通过 `resources.getAvatar(userId, avatarResourceId)`）；补充 `staged-workflow.service.spec.ts` 回归：`PUT→GET` 保持同一 `avatarResourceId`、不存在 avatar 返回 `404`、跨账号 avatar 返回 `403`，并断言校验失败不写库。文档 `docs/API.md` 已补 `stage-state` 错误码说明。验证通过：`npm --prefix backend run test -- staged-workflow.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`。 |
| QA-051 | Done | 测试验收 Agent | P0 | 回归验收 `/studio` 第二步数字人持久化：登录测试账号，创建新任务，添加已保存视频数字人，抓取 `PUT stage-state` 的 method/url/payload，刷新 `/studio?projectId=<id>` 后确认已选数字人仍显示；确认 `avatarResourceId`、`renderMode`、旧口型清空字段正确；不触发真实 TTS/provider/口型生成，不跑本地 Docker。 | 2026-05-27 验收通过：`npm --prefix frontend run build` 通过；`npm --prefix backend run test -- staged-workflow.service.spec.ts --runInBand` 通过（21 tests）；本地 API health 通过；浏览器登录账号 `447519854@qq.com` 后打开 `/studio?projectId=project_c9f57284-03b2-44d7-ad1e-e44e09c92bdd`，添加已保存视频数字人并刷新，UI 保持“我的数字人”选中且 console warn/error 为 0。显式接口检查：`PUT /api/v1/video-projects/project_c9f57284-03b2-44d7-ad1e-e44e09c92bdd/stage-state`，payload 含 `avatarResourceId=fcb38fe4-877c-439a-82e5-51b4e886c9f8`、`renderMode=preserveSourceAspect`、旧口型字段为 `null`，PUT/GET 均 200。补充删除检查通过：移除后 `avatarResourceId=null`。浏览器插件不能读取原生 Network payload，已用显式 API 请求和 DB 落库结果替代验证；未触发真实 provider，未跑 Docker。 |
| ARCH-021 | Done | 架构审查 Agent | P0 | 审查 VideoRetalk 长任务状态模型：本地轮询超时但 Aliyun 仍 `RUNNING` 时，不得直接等同真实失败；明确 provider task 持久化字段、可恢复状态、后台继续轮询/恢复边界，以及 `FAILED`、`SUCCEEDED`、`RUNNING_TIMEOUT` 的产品语义。 | 审查通过：采用可恢复 provider 状态模型，不新增独立重型队列；扩展 `video-lipsync` task 状态为 `provider_running` 或等价可恢复态，并在 `result_json` 持久化 provider 元数据、输入合同和恢复截止时间。`RUNNING_TIMEOUT` 表示本地前台轮询预算耗尽但 provider 未终止，不是失败；`FAILED` 只用于 provider 明确失败或本地预检/恢复失败；`SUCCEEDED` 必须在下载 provider 结果、恢复源视频格式合同、写入资产和 stage-state 后才成立。 |
| BE-077 | Done | 后端功能逻辑开发 Agent | P0 | 持久化 Aliyun VideoRetalk 可恢复状态：提交成功后立即写入 `provider.name/requestId/taskId/taskStatus/inputMode/videoUrl/audioUrl/submittedAt/lastPolledAt/recoverUntil/inputMeta/sourceContract/preparedContract/audioContract/lastResponse`；本地预算耗尽且 provider 仍 `RUNNING` 时，本地 task 标记为 `provider_running`（或等价可恢复状态）、progress 保持 80-95，不创建成功资产、不清空证据、不写 failed。提供后台续查/手动恢复路径，后续 `SUCCEEDED` 后下载结果、执行源视频格式合同恢复、写入 `digitalHumanVideoAssetId` 和 stage-state；`FAILED/UNKNOWN` 才转终态失败。 | 已完成：`video-lipsync` 增加 `provider_running` 状态与持久化 provider 元数据；Aliyun `RUNNING_TIMEOUT` 不再落 `failed`，会后台自动恢复并在成功后写入 `digital_human_video_assets` 与 stage-state。补充恢复链路单测并通过。验证：`npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`。 |
| BE-PERF-013 | Done | 后端优化 Agent | P0 | 增加 VideoRetalk 提交前媒体体检和风险限制：记录源视频、预处理视频、音频的 ffprobe 摘要；配置化限制时长、文件大小、码率、分辨率/像素格式；音频扩展名和真实容器必须一致，必要时统一转为 provider 明确支持的 WAV/AAC 并修正文件名/mime；超过安全阈值时在调用 provider 前返回明确 4xx/可读错误；不得破坏 `preserveSourceAspect` 最终输出合同。 | 已完成：`createLipSyncAsset` 在 provider 提交前新增媒体体检（source/prepared/audio ffprobe 摘要 + 阈值校验），并将体检摘要写入 `metadataJson.mediaPreflight`；当音频容器/扩展名不一致或容器不受支持时自动规范化为 WAV，并修正提交文件名与 mime。超限会在调用 provider 前返回明确 4xx。验证通过：`npm --prefix backend run test`、`npm --prefix backend run build`。 |
| FE-075 | Review | 前端 UI + 业务开发 Agent | P1 | 第二步口型生成需要区分“provider 仍处理中”和“真实失败”：后端返回 `provider_running/RUNNING_TIMEOUT` 可恢复状态时，页面展示“服务仍在处理，可稍后恢复/继续查询/重新生成”的明确操作；该状态不得进入第三步、不得使用空或旧视频；`failed` 才展示真实失败。 | 已完成前端联调适配：`SmartClipRenderStatus` 增加 `provider_running`；第二步轮询与状态同步新增可恢复态识别（`status=provider_running` 或 `hint/error` 含 `RUNNING_TIMEOUT/PROVIDER_RUNNING`），在可恢复态展示“继续查询/稍后恢复/重新生成”；自动清空本地 `digitalHumanVideoAssetId/videoUrl` 并持久化 `lipsyncTaskId`（资产字段为 `null`），确保不可进入第三步误用旧视频；刷新恢复时若 stage-state 仅有 `lipsyncTaskId` 会恢复为可继续查询状态。验证：`npm --prefix frontend run build` 通过。待 `QA-052` 联调验收。 |
| OPS-038 | Done | 运维环境 + 服务器维护 Agent | P1 | 补充本地/staging VideoRetalk 环境参数和运行手册：`ALI_VIDEORETALK_POLL_MAX_MS`、`ALI_VIDEORETALK_POLL_INTERVAL_MS`、媒体大小/时长/码率阈值、日志保留、恢复任务排查命令；真实 provider 验证必须先人工确认，不使用生产数据和生产密钥。 | 已完成：`docs/DEPLOY.md` 新增 OPS-038 VideoRetalk Runbook，包含轮询预算、`provider_running` 恢复语义、媒体 preflight 阈值、日志保留、Docker/MySQL/SQLite/ffprobe 排查命令；`.env.example`、`backend/.env.example`、`deploy/compose.env.example`、`deploy/docker.env.example` 补齐相关变量。未触发真实 provider。 |
| QA-052 | Ready | 测试验收 Agent | P0 | 用 mock/provider stub 验证 VideoRetalk 超时恢复链路：provider 先持续 `RUNNING` 超过本地轮询预算，再返回 `SUCCEEDED`；确认本地不创建重复 Aliyun 任务、不丢失 provider taskId、恢复后能生成资产并写回 stage-state；同时验证超长/超大媒体会在调用 provider 前被拦截。不跑本地 Docker，不触发真实付费 provider，除非用户明确确认。 | 新增分发：待 ARCH-021/BE-077/BE-PERF-013/FE-075 完成后验收。 |
| DOC-021 | Ready | 指挥官 Agent | P1 | BE-077/BE-PERF-013/FE-075/QA-052 落地后同步 `docs/API.md`、`docs/DATABASE.md`、`docs/TEST_PLAN.md`、`docs/CHANGELOG.md`：明确 VideoRetalk provider-running timeout、恢复查询、媒体体检限制和前端提示规则。 | 待开发完成后复核。 |
| ARCH-022 | Done | 架构审查 Agent | P0 | 审查通过：V1.0+ 后端只保留 `/studio` project-scoped 主链路、资源库、项目列表、管理后台、认证/健康检查和必要性能/安全代码；旧 direct provider tools、旧 `/v1/tasks`/`/v1/works` 前台流水线、legacy `studio-current`/resolve/非 v1 video-script 必须按“先禁用、再验证、最后删除/拆模块”的顺序下线。 | 结论：旧入口不得再触发付费 provider、远程 fetch 或旧结果复活；本轮不做破坏性删表，不做生产物理删除。保留 `user_works` 管理后台历史读取，旧公开入口先返回 `410 LEGACY_ENDPOINT_DISABLED` 或仅测试环境 feature flag 开启。 |
| BE-CLEAN-001 | Done | 后端功能逻辑开发 Agent | P0 | 删除可证明无生产调用的后端死代码：`tsc --noUnusedLocals --noUnusedParameters` 报出的未使用字段/函数/import，以及 `generateTtsAudio()` 中 `return` 后不可达代码；删除后必须通过 `npm --prefix backend run build` 和相关单测。 | 已完成：清理未使用 import/field/函数（含 `buildVoiceInstruction`、`resolveRealtimeAudioFormat`、`buildSilentWav`、`resources.service` 内多处旧私有方法），并移除 `tools.controller.ts` 中 `generateTtsAudio()` `return` 后不可达分支。验证通过：`npm exec tsc -- --noEmit --noUnusedLocals --noUnusedParameters -p tsconfig.build.json`、`npm --prefix backend run test`（28 suites/166 tests）、`npm --prefix backend run build`。 |
| BE-CLEAN-002 | Done | 后端优化 Agent | P0 | 禁用高风险旧 tools 入口：`generate-video-preview`、`seedance-i2v-async`、`ark-i2v-task`、`upload-video`、`upload-audio`、`generate-lip-sync-video`、`ali-lip-sync`、`lip-sync-preview`、旧 `voice-preview` 创建接口；生产/默认本地必须返回 `410 LEGACY_ENDPOINT_DISABLED`，并在响应中指向 project-scoped 替代流程。 | 已完成：在 `backend/src/app.config.ts` 增加全局 kill-switch（默认关闭 legacy endpoints），在路由前直接返回 `410`，避免 provider 调用/远程 fetch/文件上传落盘。测试环境可用 `ENABLE_LEGACY_TOOLS_ENDPOINTS=true` 临时开启。已补 e2e：`backend/test/tools-pipeline.e2e-spec.ts` 断言上述入口默认返回 `410`。验证：`npm --prefix backend run test -- tools-pipeline.e2e-spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`。 |
| BE-CLEAN-003 | Done | 后端功能逻辑开发 Agent | P1 | 规划旧 `/api/v1/tasks` 与 `/api/v1/works` 前台流水线下线：先确认无主导航入口并移除/隐藏前端旧路由，再将公开旧任务创建、状态推进、作品生成入口转只读或 `410`；保留 `user_works` 供管理后台历史数据读取，不做破坏性删表。 | 已完成：`backend/src/app.config.ts` 新增 legacy tasks/works kill-switch（默认禁用）并拦截 `POST /api/v1/tasks/**`、`PATCH /api/v1/works/:id` 返回 `410 LEGACY_ENDPOINT_DISABLED`；新增开关 `ENABLE_LEGACY_TASKS_ENDPOINTS=true` 仅用于测试环境临时放开；`docs/API.md` 已同步兼容策略和替代入口（project-scoped `/api/v1/video-projects`）；补充 e2e 覆盖（`backend/test/tools-pipeline.e2e-spec.ts`、`backend/test/auth-flow.e2e-spec.ts`）。验证通过：`npm --prefix backend run test`、`npm --prefix backend run build`。 |
| BE-CLEAN-004 | Done | 后端优化 Agent | P1 | 拆分并瘦身 `ToolsController/ToolsModule/AiModule`：必须在 BE-CLEAN-002/003 和 QA-053 通过后执行；只移除确认为旧入口专用的 provider 注入和服务文件，保留 `audio-assets`、字幕、标题素材、项目长任务、资源库、抖音下载/转写等当前主链路。 | 已完成：`AiModule` 移除 legacy-only provider 注入（`VideoGenerateLlmService`、`SeedanceI2vService`、`ArkI2vVideoService`）；`ToolsController` 删除对应注入与旧入口路由实现（`generate-video-preview`、`seedance-i2v-async`、`ark-i2v-task`）；删除 3 个已无引用 service 文件。验证通过：`npm --prefix backend run build`、`npm --prefix backend run test`。`docker compose config` 当前环境不可执行（未安装 Docker CLI）。 |
| QA-053 | Ready | 测试验收 Agent | P0 | 验收后端瘦身：执行 `npm --prefix backend run test`、`npm --prefix backend run build`，并用接口用例确认 `/studio` 主链路相关 API、资源库、项目列表、管理后台仍可用；旧入口按预期返回 `410/disabled` 或已移除；不跑本地 Docker，不触发真实付费 provider。 | ARCH-022 已完成；等待 BE-CLEAN-001/002/003/004 完成后执行。需额外验证禁用旧入口不会发起 provider 调用、远程 fetch 或创建新任务。 |
| DOC-022 | Ready | 指挥官 Agent | P1 | 后端瘦身落地后同步 `docs/API.md`、`docs/TEST_PLAN.md`、`docs/CHANGELOG.md` 和看板：标明保留接口、废弃接口、兼容窗口和删除风险。 | 待开发完成后复核。 |
| BE-075 | Done | 后端功能逻辑开发 Agent | P0 | 修复 BE-072 遗留测试断言：`ffmpeg-audio.service.spec.ts` 中 preserveSourceAspect 相关用例需要兼容新增的源视频格式合同 ffprobe 调用；不得移除“无 `-vf` / 无 `scale=` / 无 `pad=`”核心断言；补充确认合同 ffprobe 参数存在。完成后必须通过 `npm --prefix backend run test -- ffmpeg-audio.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`。 | 已完成：preserveSourceAspect 用例改为按工具名筛选调用（`ffmpeg.exe`/`ffprobe.exe`），移除固定 `calls.length===2` 假设；保留“无 `-vf`/无 `scale=`/无 `pad=`”断言，并新增“存在合同 ffprobe（`format=format_name,duration`）”断言。验证通过：`npm --prefix backend run test -- ffmpeg-audio.service.spec.ts --runInBand`、`npm --prefix backend run test`、`npm --prefix backend run build`。 |
| DOC-020 | Ready | 指挥官 Agent | P1 | FE-073/FE-PERF-011/BE-074/BE-PERF-011/QA-050 落地后同步 `PROJECT_STATE.md`、`docs/API.md`、`docs/TEST_PLAN.md`、`docs/CHANGELOG.md`：明确“重新生成”是当前阶段旧口型结果失效动作，不等于普通重复点击。 | 待开发完成后复核。 |
| ARCH-019 | Ready | 架构审查 Agent | P0 | 审查“口型视频不改动原视频参数”方案：口型生成阶段不得被字幕模板画幅、第三步包装画幅或默认 9:16 输出策略强制改为 `1080x1920`；`preserveSourceAspect` 必须是真正的保真模式。 | 已诊断：`错误口型视频.mp4` 为 `1080x1920`，同目录疑似源素材为 `720x1280`；当前 `prepareVideoForAliLipSync()` / `normalizeVideoForRenderMode()` 在 `renderMode=1080x1920` 时强制 `scale+pad`，在 `adaptive` 时也会重编码并 `setsar=1`。待架构审查确认修复边界。 |
| BE-070 | Done | 后端功能逻辑开发 Agent | P0 | 修复口型/包装视频参数保真：`prepareVideoForAliLipSync()` 与 `normalizeVideoForRenderMode()` 支持真正 `preserveSourceAspect`，默认不得裁剪、不得强制 1080x1920、不得无必要重写尺寸；如 provider 需要转码，输出宽高、SAR/DAR、fps、色彩元数据应尽量与输入一致，并增加 ffprobe 前后对比日志或测试。 | 已完成：`preserveSourceAspect` 模式下不再注入 `-vf scale/pad`；第二步口型默认 `renderMode` 改为 `preserveSourceAspect`；保留 `1080x1920` 显式模式。新增 `ffmpeg-audio.service.spec.ts` 测试覆盖 preserve 模式参数。验证：`npm --prefix backend run test -- ffmpeg-audio.service.spec.ts video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run build` 通过。 |
| FE-072 | Review | 前端 UI + 业务开发 Agent | P0 | 第二步生成数字人口型默认传 `renderMode=preserveSourceAspect`；口型生成画幅不得再由字幕模板比例自动映射到 `1080x1920`。第三步包装成片的模板画幅选择与第二步口型保真解耦，只有用户明确选择输出画幅时才改变最终成片画布。 | 已完成前端改造：第二步 `getCurrentStageTwoRenderMode()` 固定为 `preserveSourceAspect`；第二步口型失效监听已移除模板画幅/分辨率依赖，不再因模板比例自动触发口型画幅映射。验证：`npm --prefix frontend run build` 通过。待 `QA-048` 做 ffprobe 与成片链路验收后可转 `Done`。 |
| QA-048 | Blocked | 测试验收 Agent | P0 | 使用原始数字人视频和 `C:\Users\Public\共享文档\素材样品\错误口型视频.mp4` 复测：口型输出前后 ffprobe 对比宽高、DAR/SAR、fps、pix_fmt、色彩元数据；确认视频画面没有裁剪，第三步包装只在用户明确选择画幅时改变画布。 | 2026-05-26 第二轮复测：`BE-071` 非 provider 验收通过。静态检查确认 `prepareVideoForAliLipSync()` / `normalizeVideoForRenderMode()` 缺省为 `preserveSourceAspect`，旧 preview/finalize 路径显式传 `preserveSourceAspect`，`runLipSyncTask()` 与落库使用 `effectiveRenderMode`。执行 `npm --prefix backend run test -- ffmpeg-audio.service.spec.ts video-project-render.service.spec.ts staged-workflow.service.spec.ts --runInBand` 通过（3 suites/37 tests）、`npm --prefix backend run test` 通过（26 suites/156 tests）、`npm --prefix backend run build` 通过、`npm --prefix frontend run lint` 通过、`npm --prefix frontend run build` 通过。复跑 `backend/ffmpeg/bin/ffprobe.exe`：源素材仍为 `720x1280/coded 720x1280/fps≈28.95/bt709`，历史错误口型视频与旧 lipsync-final 仍为 `1080x1920/coded 1088x1920/fps=30/1/色彩元数据缺失`；本地 FFmpeg preserve 预处理模拟输出保持 `720x1280/coded 720x1280/bt709`。未执行：本地 Docker、真实付费 provider、生产写操作。最终阻塞仍是缺少修复后的新口型输出，需 staging/mock 或用户确认一次真实 provider 调用后才能做最终 ffprobe/画面裁剪验收并转 Done。 |
| BE-071 | Done | 后端功能逻辑开发 Agent | P0 | 收敛所有口型预处理默认画幅：`prepareVideoForAliLipSync()` 默认值改为 `preserveSourceAspect`，所有调用点必须显式传入 `preserveSourceAspect` 或有明确的 `1080x1920` 用户选择；旧 `lip-sync-preview`/草稿 `finalizeDraft` 路径不得因漏传 renderMode 走 `adaptive` 缩放；API 调用未传 `renderMode` 时，持久化的 `digital_human_video_assets.render_mode` 也应记录为 `preserveSourceAspect`。 | 已完成：`prepareVideoForAliLipSync()` / `normalizeVideoForRenderMode()` 默认值改为 `preserveSourceAspect`；旧 preview/finalize 路径显式传 `preserveSourceAspect`；`runLipSyncTask()` 统一注入 `effectiveRenderMode`，并以该值持久化 `digital_human_video_assets.render_mode`；`createDigitalHumanVideoAsset()` 对缺失 renderMode 落库兜底 `preserveSourceAspect`。新增单测覆盖“未传 renderMode 不含 `-vf scale/pad`”与“落库 render_mode=preserveSourceAspect”。验证：`npm --prefix backend run test -- ffmpeg-audio.service.spec.ts video-project-render.service.spec.ts staged-workflow.service.spec.ts --runInBand`、`npm --prefix backend run build` 通过。 |
| BE-072 | Done | 后端功能逻辑开发 Agent | P0 | 建立口型输出“源视频格式合同”：提交 provider 前用 ffprobe 记录源视频/预处理视频的容器、宽高、coded_width/height、SAR/DAR、fps、pix_fmt、色彩元数据、音频轨和时长；provider 返回后先落临时文件并 ffprobe，对比源视频合同；`renderMode=preserveSourceAspect` 下最终保存/预览的口型视频必须恢复为源视频参数，除嘴部运动变化外不得改变画幅、比例、帧率、像素格式、色彩元数据和音轨策略。若 provider 输出可通过安全转封装/转码恢复，则恢复后再保存；无法恢复时任务失败并给出可读错误，不得创建成功的 `digital_human_video_assets`。显式 `1080x1920` 模式除外。 | 已完成：后端新增源/预处理/provider/final 四段 ffprobe 合同比对与 `restoreVideoToSourceContract()` 恢复；`createLipSyncAsset` 输出 `metadataJson`（formatContract 摘要）并透传落库 `digital_human_video_assets.metadata_json`；SQLite/MySQL 初始化与迁移补齐 `metadata_json` 字段。验证：`npm --prefix backend run test -- ffmpeg-audio.service.spec.ts --runInBand`、`npm --prefix backend run test -- video-project-render.service.spec.ts staged-workflow.service.spec.ts --runInBand`、`npm --prefix backend run build` 通过。 |
| OPS-037 | Ready | 运维环境 + 服务器维护 Agent | P0 | 为 QA-048 提供隔离验证条件：优先准备 staging/mock provider 输出样本验证“源视频格式合同”和恢复逻辑；如需证明真实 VideoRetalk 线上 provider 行为，必须先获得用户明确确认后才允许一次真实调用。不得使用生产数据库、生产上传目录或生产密钥；产物需保存源视频、预处理输入、provider 临时输出、最终保存输出四个文件路径，供 QA ffprobe。 | 待执行。mock 可以验证系统最终输出合同；真实 provider 验证只用于确认外部服务当前行为，不作为后端保真逻辑的前置依赖。 |
| QA-049 | Ready | 测试验收 Agent | P0 | 在 `BE-072` 完成后执行 QA-048 最终验收：对源视频、预处理输入、provider 临时输出、第二步最终预览输出、第三步包装输出做 ffprobe；重点校验第二步最终预览除口型变化外保持源视频宽高、DAR/SAR、fps、pix_fmt、色彩元数据、音轨和时长策略；第三步只有用户明确选择最终画幅时才允许改变画布。 | 待执行；没有新生成的最终口型输出前不得标记 Done。 |
| DOC-019 | Ready | 指挥官 Agent | P1 | BE-070/FE-072/QA-048 落地后同步 `docs/API.md`、`docs/UI_GUIDE.md`、`docs/TEST_PLAN.md`、`docs/CHANGELOG.md`：明确第二步口型默认保持原视频参数，第三步画幅转换仅用于最终包装输出。 | 待开发完成后复核。 |
| BE-064 | Done | 后端功能逻辑开发 Agent | P0 | 新增 `video_projects` 创作任务表和 CRUD：任务归属当前用户，任务名可重复，`projectId` 是唯一主键；支持创建、列表、详情、改名、归档。 | 已完成：新增 `POST/GET(list)/GET(detail)/PATCH(rename)/POST(archive)`；数据库新增 `video_projects`（SQLite/MySQL）与索引 `idx_video_projects_user_status_updated`、`idx_video_projects_user_updated`；验证通过 `npm --prefix backend run test -- video-projects.service.spec.ts video-projects.controller.spec.ts --runInBand`、`npm --prefix backend run build`。 |
| FE-063 | Done | 前端 UI + 业务开发 Agent | P0 | 第一步完成后弹出“创建创作任务”面板，允许编辑任务名；创建成功后进入 `/studio?projectId=<id>` 或等价路由，后续步骤都使用真实 `projectId`。 | 已完成：第一步按钮触发“创建创作任务”弹窗，任务名可编辑；创建成功后写入 URL `projectId` 并进入第二步；`CreativeStudioView` 中音频、字幕、口型、标题标记、成片渲染和 stage-state 写入均改为动态 `projectId`。验证：`npm --prefix frontend run build` 通过。 |
| BE-065 | Done | 后端功能逻辑开发 Agent | P0 | 将音频、字幕、口型、包装成片和 stage-state 写入真实 `projectId`；禁止跨账号访问项目资产；保留 `studio-current` 只做遗留兼容。 | 已完成：`StagedWorkflowService` 新增项目归属校验，音频/字幕/口型/包装/stage-state 全链路按 `projectId` 强绑定；`studio-current` 仅遗留兼容（含 legacy `NULL` 资源匹配）；新增跨项目/跨账号隔离测试。验证：`npm --prefix backend run test -- staged-workflow.service.spec.ts video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run build` 通过。 |
| FE-064 | Done | 前端 UI + 业务开发 Agent | P0 | 创作台按 `projectId` 精确恢复任务内容：文案、音频、字幕、数字人选择、当前阶段和已生成资产；不按音频名、文案、数字人视频或链接做启发式匹配。 | 已完成：监听 `route.query.projectId` 后按项目全量恢复（文案配置、stage-state、音频与字幕、数字人选择）；新增恢复中/失败提示与重试；切换或移除 `projectId` 时清理项目绑定状态，避免跨任务串数据。验证：`npm --prefix frontend run build` 通过。 |
| FE-PERF-008 | Done | 前端优化 Agent | P1 | 任务列表、任务详情和阶段状态查询支持分页、取消陈旧请求、加载态和防重复点击；大视频预览不阻塞任务恢复。 | 已完成：新增 `/projects` 创作任务列表，接入 `GET /video-projects` 分页、改名、归档/恢复和打开详情；列表与详情预检支持 `AbortSignal`、加载态和按钮防重复点击；创作台项目详情与 stage-state 恢复请求可取消，大视频预览在恢复期间不挂载。验证：`npm --prefix frontend run typecheck`、`npm --prefix frontend run build` 通过。 |
| ARCH-017 | Done | 架构审查 Agent | P0 | 审查 project-scoped 长任务接口统一鉴权边界：哪些接口必须校验真实 `projectId` 归属，哪些遗留 `studio-current` 只能兼容读取/保存 stage-state；校验必须发生在 dedupe、并发计数、任务持久化、外部 provider 调用之前。 | 已完成审查：`render-final`、`lipsync-tasks`、`package-render-tasks`、`pd-events`、`detect-cut-points` 均必须在入口最前面校验 `video_projects.id + user_id`；`stage-state` 和 `lipsync-assets/resolve` 已在 `StagedWorkflowService` 校验。跨账号统一返回 `404`，越权请求不得创建 task、不得占用并发、不得触发 provider。 |
| QA-044 | Done | 测试验收 Agent | P0 | 验证创作任务容器全链路：创建任务、改名、刷新恢复、跨账号隔离、重复任务名、归档、旧 `studio-current` 兼容和第三步包装。 | 2026-05-25 复测通过：执行 `npm --prefix backend run test -- video-project-render.service.spec.ts video-projects.service.spec.ts video-projects.controller.spec.ts staged-workflow.service.spec.ts --runInBand`（4 suites/29 tests passed）、`npm --prefix backend run build`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run build`、`npm run check:staged-db`、SQLite `video_projects` 表/索引检查；临时启动当前构建 API 到 `3100`，双账号验证创建、重复任务名、改名、归档、列表、`stage-state` 保存/恢复、旧 `studio-current` 兼容均通过。B 账号访问 A 项目的 `detect-cut-points`、`render-final`、`lipsync-tasks`、`package-render-tasks`、`pd-events` 均返回 `404`，且 `task_statuses` 无新增记录。未跑本地 Docker；未触发真实 provider。 |
| BE-066 | Done | 后端功能逻辑开发 Agent | P0 | 所有带 `projectId` 的长任务创建接口必须先校验 `video_projects.user_id = 当前用户`，至少覆盖 `package-render-tasks`，并检查 `render-final`、`lipsync-tasks`、`pd-events`、`detect-cut-points` 是否同类缺口；跨账号访问必须返回 `404`，不得创建或持久化 task。 | 已完成：`VideoProjectRenderService` 新增统一 `assertOwnedProject(userId, projectId)`，并在 `detect-cut-points`、`render-final`、`lipsync-tasks`、`package-render-tasks`、`pd-events` 入口最前面执行（在 dedupe/并发/persist 前）；越权统一返回 `404`，不会创建内存 task 或写入 `task_statuses`。验证：`npm --prefix backend run test -- video-project-render.service.spec.ts --runInBand`、`npm --prefix backend run build` 通过。 |
| BE-067 | Done | 后端功能逻辑开发 Agent | P1 | 新建创作任务尚未保存智能剪辑文案配置时，`GET /api/v1/video-script/:projectId` 不应返回红色 404；正常空状态应返回 `200 data=null`，真实保存失败或权限问题仍按原逻辑处理。 | 已完成：`VideoScriptController.detail()` 改为使用 `getOptionalByVideoId()`，缺失配置返回 `200 { code:0, data:null }`；兼容旧路径 `/api/video-script/:projectId`。验证：`npm --prefix backend run test -- video-script.controller.spec.ts video-script.service.spec.ts --runInBand`、`npm --prefix backend run build`、临时 `3100` API 登录测试账号请求 v1/legacy 路径均返回 `200 data=null`。 |
| FE-067 | Done | 前端 UI + 业务开发 Agent | P1 | 前端智能剪辑文案配置 API 统一走 `/api/v1/video-script/*`，并兼容后端 `data=null` 空状态，避免新任务进入第二页时 Network 出现可误解的 404。 | 已完成：`saveVideoScript()` 和 `getVideoScript()` 切换到 `v1/video-script` 路径，`getVideoScript()` 类型允许 `data:null`；`loadSmartClipScriptConfig()` 已按空数据返回 false 继续流程。验证：`npm --prefix frontend run typecheck`、`npm --prefix frontend run build` 通过。 |
| FE-068 | Done | 前端 UI + 业务开发 Agent | P2 | 清理 `/studio` 第一步到第三步旧残留：移除不可达旧音色校验分支和未使用的 `listSavedVideos()` 前端包装；不得改变真实 `projectId` 主流程。 | 已完成：`CreativeStudioView` 删除被 `buildVoiceGenerationStateV2()` 截断的旧校验死代码；`frontend/src/api/task.ts` 删除未使用的 `listSavedVideos()` 包装，保留当前抖音落盘后的 `transcribeSavedVideo()` 用户归属链路。验证：`npm --prefix frontend run lint`、`npm --prefix frontend run typecheck`、`npm --prefix frontend run build` 通过。 |
| QA-045 | Done | 测试验收 Agent | P1 | 统一检测 `/studio` 第一步到第三步是否仍残留旧主流程：旧 `video-script` 路径、`studio-current` 新流程依赖、历史口型自动匹配、旧 saved-videos 前端调用和长任务越权入口。 | 已完成：执行 `rg` 静态扫描、前端 lint/typecheck/build、后端 `video-script`/`video-project-render`/`video-projects`/`staged-workflow` 相关单测和后端 build；结论为前端 active flow 不再调用 `lipsync-assets/resolve`，不再使用 `studio-current` 作为新任务主键，`video-script` 前端统一为 `v1`，旧兼容仅保留在后端兼容路由和 legacy stage-state/resolve 处。未跑 Docker；未触发真实 provider。 |
| FE-PERF-009 | Done | 前端优化 Agent | P1 | 优化 `/studio` 第二步和第三步长任务轮询：口型任务、最终包装任务、标题素材任务不得产生并发轮询、重复定时器或离开页面后残留定时器；切换 `projectId`、离开路由、组件卸载、任务完成/失败/超时均必须清理。 | 已完成：口型轮询增加 in-flight `AbortController`；标题素材轮询改为单 `markId` 单 timeout 链、单 in-flight 请求，增加 6 个活跃轮询上限、150 次/5 分钟超时；路由离开、项目切换、卸载、完成/失败/超时统一清理。验证：`npm --prefix frontend run lint`、`npm --prefix frontend run build` 通过。 |
| FE-PERF-010 | Done | 前端优化 Agent | P1 | 优化 `/studio` 第二步到第三步保存请求频率：`video-script/save`、`subtitle-tracks/:id/cues`、`stage-state` patch 只在内容 hash 变化或关键操作时提交；重复进入第三步、模板切换、快速点击生成不得造成连续相同 payload 写入。 | 已完成：新增稳定 payload key 去重，`stage-state`、`video-script/save`、`subtitle-tracks/:id/cues` 对 pending/done 相同内容跳过，失败时释放 pending 并保留错误提示；相关 API 支持 `AbortSignal`。验证：`npm --prefix frontend run lint`、`npm --prefix frontend run build` 通过。 |
| BE-PERF-009 | Done | 后端优化 Agent | P1 | 优化长任务状态查询抗压：`GET /api/v1/render-tasks/:taskId` 与 `GET /api/v1/title-assets/render-tasks/:taskId` 必须是轻量查询，不触发 provider/文件读取；缓存和内存 task map 要有上限/清理策略，频繁轮询不能导致内存持续增长。 | 验收通过：静态检查确认 render/title 状态查询为轻量读取并设置 no-store/Retry-After；`npm --prefix backend run test` 通过（24 suites / 146 tests），`npm --prefix backend run build` 通过。 |
| BE-PERF-010 | Done | 后端优化 Agent | P1 | 增加大 payload 和参数风险防护：限制 `video-script/save` 文案长度、marks 数量、highlight/title 字段长度；限制字幕 cues 数量和文本长度；限制包装/标题渲染请求中的嵌套样式对象大小，超限返回明确 4xx。 | 验收通过：静态检查确认 `video-script`、subtitle cues、`subtitleVisualStyle/titleLayout` 均有数量/长度/深度/节点/字节预算限制；`npm --prefix backend run test` 通过（24 suites / 146 tests），`npm --prefix backend run build` 通过。 |
| QA-PERF-002 | Done | 测试验收 Agent | P1 | 验收 `FE-PERF-009`、`FE-PERF-010`、`BE-PERF-009`、`BE-PERF-010`：重点检查请求频率、参数上限、轮询清理、内存/缓存增长和跨账号隔离；不触发真实付费 provider，不跑本地 Docker。 | 2026-05-25 验收通过：执行 `npm --prefix frontend run lint`、`npm --prefix frontend run build`、`npm --prefix backend run test`、`npm --prefix backend run build` 均通过；静态检查覆盖前端轮询 in-flight/AbortController/上限/超时、保存 payload key 去重、后端 no-store 状态轮询和 payload 上限。未跑 Docker；未触发真实 provider；未做浏览器 Network 录制（本地未安装 Playwright/浏览器自动化依赖）。 |
| BE-068 | Done | 后端功能逻辑开发 Agent | P0 | 修复“生成字幕轴只按 ASR 分成 2 段”的问题：`POST /api/v1/audio-assets/:id/subtitle-track` 支持接收 `projectId`、`scriptText`、`scriptSegments`，优先按口播文案分段数量生成字幕 cues；使用 ASR 总时长/分段时间对齐到每个文案段，保证 `startTime/endTime` 秒级、递增、不重叠。 | 已完成：接口支持 body 入参；当 `scriptSegments` 有值时按分段数生成字幕轨，ASR 时间作为时长边界并兜底音频时长，结果保证递增且无重叠；保留 `projectId` 归属校验。已补 controller/service 单测并通过后端 test + build。 |
| FE-069 | Blocked | 前端 UI + 业务开发 Agent | P0 | 生成字幕轴时不再空 body 调用接口；从第二步当前口播文案取 `scriptText` 和 `extractedScriptLines`/用户分段结果作为 `scriptSegments` 传给后端，同时传真实 `projectId`；返回后按后端 cues 渲染字幕编辑列表。 | 联调失败：用户提供 `GET /api/v1/subtitle-tracks/track_392a4e65-434c-4ccb-aef0-ab5eb20102ca` 返回 `source=asr` 且只有 3 条字幕，说明当前页面实际读取的仍是 ASR 原始轨道，不是按 `scriptSegments` 生成的 `tts_alignment` 轨道；转 `FE-070`/`BE-069` 返工。 |
| BE-069 | Done | 后端功能逻辑开发 Agent | P0 | 收敛字幕轨来源：音频生成阶段自动创建的 ASR 字幕轨不得被当作“按文案分段字幕轴”返回给前端；显式 `POST /api/v1/audio-assets/:id/subtitle-track` 传入 `scriptSegments` 时，响应和持久化结果必须是 `source=tts_alignment`，且 `subtitles.length === scriptSegments.length`。必要时补充 `requestedSegmentCount/cueCount/alignmentSource` 诊断字段或日志，方便 QA 判定。 | 已完成：仅在显式传入 `scriptSegments` 时走分段对齐并强制 `source=tts_alignment`；自动创建字幕轨回归 `source=asr`；新增日志 `requestedSegmentCount/cueCount/alignmentSource`；显式创建后同步更新 `audio_assets.subtitle_track_id` 与 `video_project_stage_states.subtitle_track_id`，避免页面误读旧 ASR 轨。验证：`npm --prefix backend run test -- staged-workflow.controller.spec.ts staged-workflow.service.spec.ts --runInBand`、`npm --prefix backend run build` 通过。 |
| FE-070 | Review | 前端 UI + 业务开发 Agent | P0 | 字幕轴生成结果防错：显式生成字幕轴后只接受本次 POST 返回的新 track；如果 GET 返回 `source=asr`、字幕条数与 `scriptSegments.length` 不一致，必须显示“字幕轴未按文案分段生成”，不得写入当前 `subtitleTrackId`，也不得进入第三步可用状态；避免音频生成阶段返回的 `audioAsset.subtitleTrackId` 覆盖本次字幕轴。 | 已完成前端拦截：仅接受本次 POST track 且强校验 `source=tts_alignment` + 条数一致；校验失败时提示“字幕轴未按文案分段生成”、状态置 failed、不写入新 `subtitleTrackId`；音频阶段不再回填 `audioAsset.subtitleTrackId`。已执行 `npm --prefix frontend run build` 通过。待 `BE-069` + `QA-046` 抓包联调验收。 |
| QA-046 | Blocked | 测试验收 Agent | P0 | 验收字幕轴按口播文案分段对齐：准备一段 ASR 原始返回只有少量大段、口播文案被切成多段的样例；验证接口返回字幕条数等于文案分段数，时间从 0 开始附近递增、无重叠、最后 endTime 接近音频时长，第三步最终成片使用该字幕轨道。 | 当前验收失败并阻塞：用户提供返回数据为 `source=asr`、3 条字幕，不满足按 `scriptSegments` 对齐。等 `BE-069`、`FE-070` 完成后复测；必须同时抓取 POST `/subtitle-track` 响应和后续 GET `/subtitle-tracks/:id`，确认 trackId、`source=tts_alignment`、条数一致。 |
| ARCH-018 | Done | 架构审查 Agent | P0 | 审查“创建任务文案快照”轻量方案：不新增表、不新增复杂版本系统、不按文案/音频/数字人做历史匹配；以现有 `video_scripts.script_text` 作为项目初始文案快照，`video_project_stage_states.script_hash` 只做一致性校验。 | 审查通过：现有 `video_scripts` 已按 `user_id + video_id` 唯一保存完整文案，`video_project_stage_states` 已按 `user_id + project_id` 唯一保存阶段快照和 `script_hash`，无需数据库迁移。必改点：`FE-071` 必须在创建项目成功后、调用 `restoreProjectContextFromRoute()` 前保存文案快照和 `scriptHash`；保存失败不得进入第二步。后续优化：可在保存成功后记录一次快照来源日志，但不引入版本表。 |
| FE-071 | Done | 前端 UI + 业务开发 Agent | P0 | 修复创建任务后文案丢失/变化：`onConfirmCreateProject()` 在创建后、恢复项目前先保存脚本文案与 `scriptHash`，保存成功才进入第二步。保存失败停留第一步并提示重试。 | 已完成：新增第一步文案冻结；`createVideoProject` 成功后先调用 `saveVideoScript` 与 `saveProjectStageState({ scriptHash })`，再写入路由并恢复项目上下文进入第二步；失败时不会进入第二步。验证：`npm --prefix frontend run build` 通过。 |
| QA-047 | Ready | 测试验收 Agent | P0 | 验收创建任务文案快照：第一步输入文案后创建任务，进入第二步文案不变化；刷新 `/studio?projectId=<id>` 后恢复同一文案；生成音频、字幕、口型时使用同一个 `scriptHash`；修改文案后旧音频/字幕/口型应按既有逻辑失效或提示重新生成。 | 待 `FE-071` 完成后执行；不触发真实付费 provider，可用本地/mock 资产验证 hash 和 UI 状态。 |
| DOC-018 | Ready | 指挥官 Agent | P1 | `FE-071` 落地后同步 `PROJECT_STATE.md`、`docs/API.md`、`docs/TEST_PLAN.md`：明确创建任务时必须保存初始文案快照，第二步之后的音频、字幕、口型都以该快照和后续用户编辑为准。 | 待开发完成后复核。 |
| DOC-017 | Ready | 指挥官 Agent | P1 | BE-068/FE-069 落地后同步 `docs/API.md`、`docs/TEST_PLAN.md`、`docs/CHANGELOG.md`，把字幕轴生成规则明确为“ASR 定时 + 口播文案分段对齐”。 | 待开发完成后复核。 |
| DOC-016 | Ready | 指挥官 Agent | P1 | 代码落地后同步 API、数据库、UI、测试和变更日志；清理所有把新流程描述为 `studio-current` 的文档示例。 | 待开发完成后复核。 |

## Recently Completed

| Task ID | Status | Owner Agent | Result |
|---|---|---|---|
| ARCH-018 | Done | 架构审查 Agent | 通过创建任务文案快照轻量方案：复用 `video_scripts.script_text` 保存完整文案，复用 `video_project_stage_states.script_hash` 做一致性校验；不新增表、不新增文案版本系统、不恢复历史口型视频、不按文案/音频/数字人做自动匹配。 |
| ARCH-017 | Done | 架构审查 Agent | 通过 project-scoped 长任务统一鉴权边界：`VideoProjectRenderService` 需要新增统一 `assertOwnedProject(userId, projectId)`，并在所有 project-scoped 长任务入口的第一步调用；`studio-current` 只允许遗留 stage-state/resolve 兼容，不允许新长任务创建接口绕过真实项目归属。 |
| ARCH-016 | Done | 架构审查 Agent | 通过“创作任务容器”方案：新增 `video_projects` 作为项目主实体；任务名只做展示和搜索，不做匹配主键；`projectId` 统一绑定文案、音频、字幕、口型视频、模板和包装成片；禁止恢复逻辑按音频、文案、数字人或链接自动匹配旧结果。 |
| RETENTION-001 | Done | 指挥官 Agent | 已调整留存策略：第二步只自动恢复音频和字幕时间轴，不再自动匹配历史口型视频。 |
| ARCH-015 | Done | 架构审查 Agent | 通过轻量 stage-state 方案，避免新建复杂项目系统，保持三段式生成流程。 |
| BE-059 | Done | 后端功能逻辑开发 Agent | 已实现 `GET/PUT /api/v1/video-projects/:projectId/stage-state`，按 `userId + projectId` 隔离保存。 |
| BE-060 | Done | 后端功能逻辑开发 Agent | 兼容遗留接口 `GET /api/v1/video-projects/:projectId/lipsync-assets/resolve` 已存在，但当前前端工作流不再调用该接口自动恢复口型视频。 |
| BE-PERF-008 | Done | 后端优化 Agent | 已为 stage-state 增加唯一约束和常用查询索引。 |
| FE-060 | Done | 前端 UI + 业务开发 Agent | `/studio` 初始化和进入第二步时自动恢复音频、字幕时间轴；口型视频不再自动恢复。 |
| FE-061 | Done | 前端 UI + 业务开发 Agent | 口型任务成功后自动写回 stage-state，文案、音频或数字人变更时清理不再匹配的预览。 |
| FE-062 | Done | 前端 UI + 业务开发 Agent | 已移除第二步历史口型视频自动匹配：`/studio` 不再调用 `lipsync-assets/resolve`，刷新后只恢复音频和字幕时间轴，不再按音频素材、数字人视频或画幅自动塞入旧生成视频；输入变更时仍清空当前口型预览，避免第三步误用。 |
| FE-PERF-007 | Done | 前端优化 Agent | stage-state、音频、字幕恢复查询支持 `AbortSignal`，降低重复请求和陈旧回填风险。 |
| QA-043 | Done | 测试验收 Agent | 已通过接口夹具和浏览器验证：刷新恢复、跨账号隔离、缺失文件拒绝复用、预览弹窗、第三步入口。 |
| FE-LIPSYNC-PREVIEW-059 | Done | 前端 UI + 业务开发 Agent | 本地生成口型视频后可预览，Vite `/uploads` 代理和大预览弹窗已接入。 |
| BE-061 | Done | 后端功能逻辑开发 Agent | 修复第三步“立即剪辑”包装成片报错 `ENOENT: no such file or directory, mkdtemp ...uploads/tmp/package-render-XXXXXX`；后端创建 `package-render-*` 和 `audio-probe-*` 临时目录前会先递归创建运行临时根目录。验证：`npm --prefix backend run test -- staged-workflow.service.spec.ts --runInBand`、`npm --prefix backend run build` 通过。 |
| BE-062 | Done | 后端功能逻辑开发 Agent | 为 `GET /api/v1/video-projects/:projectId/stage-state` 增加 `no-store` 响应头，避免浏览器缓存协商导致创作台阶段状态出现 `304` 并误用本地缓存。验证：`npm --prefix backend run test -- video-projects.controller.spec.ts --runInBand`、`npm --prefix backend run build` 通过。 |
| BE-063 | Done | 后端功能逻辑开发 Agent | 统一待审核账号访问业务接口的 `403` 返回结构，新增机器可识别错误码 `ACCOUNT_PENDING`，便于前端精确识别并跳转待审核页。验证：`npm --prefix backend run test -- account-active.guard.spec.ts --runInBand`、`npm --prefix backend run build` 通过。 |
| BE-ASR-057 | Done | 后端功能逻辑开发 Agent | TTS 音频进入 ASR 前统一转为 `16kHz mono wav`，避免容器/扩展名不一致导致空字幕。 |
| FE-AUDIO-ERROR-058 | Done | 前端 UI + 业务开发 Agent | 第二步音频生成失败时在当前区域展示后端错误原因。 |
| BE-052 | Done | 后端功能逻辑开发 Agent | 字幕模板支持公版只读、复制后编辑、用户模板读写隔离。 |
| BE-054 | Done | 后端功能逻辑开发 Agent | 包装成片读取字幕模板画幅、字幕样式、标题样式和安全 clamp 后参与渲染。 |

## ARCH-016 Creation Task Container

结论：采用轻量 `video_projects` 创作任务容器，不用音频名称、文案内容、数字人视频、爬取链接或其他启发式字段自动匹配历史结果。

核心规则：

- `video_projects.id` 是创作任务唯一主键；任务名只是用户可编辑的展示和搜索字段，允许重复。
- 第一步文案确认后创建任务，后续音频、字幕、口型、模板和包装成片都写入同一个 `projectId`。
- `video_project_stage_states` 继续作为阶段快照表，但必须绑定真实 `projectId`，不再作为新任务根实体。
- 旧 `studio-current` 仅保留遗留兼容；新流程不得新增依赖。
- 用户从任务列表进入时，只按 `projectId + userId` 恢复该任务内容；跨账号访问返回 `403` 或 `404`。
- 新建任务即使使用相同音频、文案、数字人视频或链接，也不能自动复用另一个任务的口型结果，除非后续有明确“复制任务”功能。
- 现有 `task_statuses` 仍只表示异步执行任务，不能和产品层“创作任务”混用。

## ARCH-017 Project-Scoped Long Task Boundary

结论：所有带 `projectId` 的长任务创建接口，都必须先校验创作任务归属，再进入任何任务逻辑。

必须校验的入口：

- `POST /api/v1/video-projects/:projectId/render-final`
- `POST /api/v1/video-projects/:projectId/lipsync-tasks`
- `POST /api/v1/video-projects/:projectId/package-render-tasks`
- `POST /api/v1/video-projects/:projectId/pd-events`
- `POST /api/v1/video-projects/:projectId/detect-cut-points`

校验顺序：

1. 读取并校验 `projectId`。
2. 查询 `video_projects WHERE id = ? AND user_id = ?`。
3. 不存在时返回 `404`，不暴露项目是否属于其他账号。
4. 通过后才允许计算 dedupe key、查找可复用 task、检查并发、写入 `task_statuses` 或调用外部 provider。

遗留兼容：

- `studio-current` 只允许用于旧阶段状态和旧 resolve 兼容。
- 新建 `video-render`、`video-lipsync`、`video-package`、`pd-event` 不应接受 `studio-current` 绕过真实项目校验。

修复落点：

- `BE-066` 在 `VideoProjectRenderService` 增加统一 `assertOwnedProject(userId, projectId)`。
- `BE-066` 覆盖跨账号单测：越权请求返回 `404`，且不会创建内存 task、不会写入 `task_statuses`、不会占用并发额度。

## Subtitle Timeline Segment Alignment

结论：当前字幕轴只按 ASR 返回的 `segments` 生成，所以 ASR 返回 2 段时页面只得到 2 条字幕。下一步要改为“ASR 负责时间，口播文案分段负责字幕条数和文本”。

2026-05-25 联调证据：

- 用户提供的 `GET /api/v1/subtitle-tracks/track_392a4e65-434c-4ccb-aef0-ab5eb20102ca` 返回 `source=asr`、`subtitles.length=3`。
- 这说明当前页面读取的是 ASR 原始轨道，不是按本次 `scriptSegments` 生成的字幕轨；正确结果必须返回 `source=tts_alignment`，且字幕条数等于前端传入的 `scriptSegments.length`。
- 本轮返工拆给 `BE-069`、`FE-070`，`QA-046` 在两项完成前保持阻塞。

分发规则：

- `BE-068`：后端接收 `scriptSegments`，将 ASR 时间轴对齐到文案分段，写入 `subtitle_tracks.cues_json`。
- `FE-069`：前端生成字幕轴时传当前第二步文案分段，不再空 body 调用。
- `BE-069`：后端收敛自动 ASR 轨道与显式分段轨道的返回边界。
- `FE-070`：前端校验字幕轨来源和条数，避免误用 ASR 原始轨道。
- `QA-046`：用 ASR 2 段、文案多段的样例验收条数、时间和第三步成片使用。
- `DOC-017`：开发完成后同步接口、测试和变更记录。

## Creation Task Script Snapshot

结论：创建任务时必须把第一步确认的口播文案保存为当前 `projectId` 的初始文案快照，否则进入第二步的恢复流程会清空本地草稿，导致后续音频、字幕、口型使用的文案 hash 不稳定。

轻量方案：

- 不新增数据表，不新增文案版本系统，不恢复历史口型视频。
- 复用现有 `video_scripts` 保存完整文案，复用 `video_project_stage_states.script_hash` 保存当前文案指纹。
- 创建任务成功后，先保存文案快照和 `scriptHash`，再执行项目恢复并进入第二步。
- 如果快照保存失败，停留在第一步提示重试，不允许继续生成音频、字幕或口型。

分发规则：

- `ARCH-018`：确认该方案不破坏 `projectId` 容器边界，且不引入冗余模块。
- `FE-071`：在创建任务流程中冻结并保存第一步文案快照。
- `QA-047`：验收文案一致性、刷新恢复和旧资产失效提示。
- `DOC-018`：落地后同步文档。

## LipSync Video Parameter Preservation

结论：当前生成口型视频会改动原视频尺寸，是因为前端把 9:16 模板映射为 `renderMode=1080x1920`，后端在口型生成前和第三步包装前都会执行 FFmpeg `scale/pad` 归一化。

诊断证据：

- `C:\Users\Public\共享文档\素材样品\错误口型视频.mp4`：`width=1080`、`height=1920`、`coded_width=1088`、`fps=30/1`、色彩元数据为 `unknown`。
- 同目录疑似源素材 `ef29e81564eb7d6f96b7fd1f8ca70b0b.mp4`：`width=720`、`height=1280`、`fps≈28.95`、色彩元数据为 `bt709`。
- `prepareVideoForAliLipSync()` 在 `renderMode=1080x1920` 时使用 `scale=1080:1920...pad=1080:1920...setsar=1`。
- `adaptive` 路径也会重编码并 `scale='trunc(iw/2)*2':'trunc(ih/2)*2'`、`setsar=1`，所以也不等于“完全不改参数”。

分发规则：

- `ARCH-019`：先审查第二步口型保真和第三步包装画幅的边界，避免把字幕模板画幅强塞到口型生成阶段。
- `BE-070`：后端实现真正的 `preserveSourceAspect`，不得裁剪、不得强制 1080x1920，尽量保留宽高、SAR/DAR、fps、pix_fmt 和色彩元数据。
- `FE-072`：第二步默认传 `preserveSourceAspect`，第三步画幅转换只在用户明确选择最终输出画幅时发生。
- `QA-048`：用 ffprobe 做原视频、口型输出、包装成片三段对比验收。
- `DOC-019`：完成后同步 API、UI、测试和变更记录。

## LipSync Regeneration Invalidation

结论：点击“重新生成”后旧视频被再次调出，是当前重新生成流程没有打穿前后端 dedupe 与异步回填边界。

定位：

- 前端 `onRegenerateStageTwoLipSyncFromRestored()` 清空了本地和 stage-state 中的 `lipsyncTaskId/digitalHumanVideoAssetId/videoUrl`。
- 下一次 `onGenerateStepTwoLipSync()` 调用 `createSmartClipLipSyncTask()` 时没有传 `forceRetry`，也没有新的 regeneration key。
- 后端 `findReusableActiveTask()` 对 `video-lipsync` 允许复用最近 completed 任务，因此相同 `projectId + audioAssetId + avatarResourceId + renderMode` 会命中旧任务。
- 旧任务 DTO 会带回旧 `outputUrl/digitalHumanVideoAssetId`，前端同步任务状态后旧预览和旧资产就被重新写回。

已知风险：

- 用户以为旧口型视频已删除或失效，实际仍可被当前流程继续使用。
- 第三步包装可能把旧 `digitalHumanVideoAssetId` 带入最终成片，造成成片内容不是用户刚刚生成的结果。
- 文案、音频、数字人或画幅变化后，旧口型视频与当前输入不一致，导致口型、字幕、配音错位。
- 删除/重新生成语义不可信，可能造成隐私、合规和用户投诉风险。
- 旧轮询请求或旧 stage-state 保存请求晚到，会把已清空状态覆盖回旧视频。
- 后端 completed dedupe 命中会掩盖真实重新生成失败，QA 和日志无法判断用户看到的是新产物还是旧产物。
- 费用和资源统计失真：用户以为触发了重新生成，但后端可能直接返回旧任务；反过来如果重复点击又可能造成不必要队列压力。
- 多任务/多标签页下旧 taskId 复活，可能污染当前创作任务的可用资产。

分发规则：

- `ARCH-020`：已审查通过；轻量方案是不新增版本表，历史资产保留审计，当前阶段旧结果通过 stage-state 解绑和前端 generation token 失效。
- `FE-073`：前端业务流传 `forceRetry` 和 regeneration key，并阻断第三步旧资产。
- `FE-PERF-011`：前端优化旧轮询、旧请求、乱序保存的防回填；所有异步回写必须校验 generation token。
- `BE-074`：后端功能逻辑确保显式重新生成绕过 completed task 复用。
- `BE-PERF-011`：后端优化 dedupe 策略和日志，避免 completed cache 复活旧任务；`forceRetry` 不能绕过 active task 复用，避免重复付费任务。
- `QA-050`：用 mock/provider stub 验证新 task、新资产、旧响应不回填。
- `DOC-020`：落地后同步 API、测试和变更记录。

## ARCH-021 VideoRetalk Provider State Model

结论：Aliyun VideoRetalk `RUNNING` 超过本地轮询预算，不等于真实失败。当前系统把 `pollAliyunTask()` timeout throw 交给业务 catch 后写成 `failed`，会丢失 provider taskId 的结构化恢复能力。

状态语义：

- `RUNNING_TIMEOUT`：本地前台轮询预算耗尽，但 provider 最近状态仍是 `RUNNING` 或未返回终态；这是可恢复状态，不是失败。
- `FAILED`：provider 明确返回 `FAILED/UNKNOWN`，或本地预提交校验失败，或 provider 成功后下载/格式合同恢复失败；这是终态失败。
- `SUCCEEDED`：必须完成 provider 结果下载、源视频格式合同恢复、最终产物发布、`digital_human_video_assets` 写入和 stage-state 回写后才成立。

任务模型：

- 顶层 `video-lipsync` task 建议新增或兼容 `provider_running` 状态；如果短期不改顶层枚举，也必须在 `result_json.provider.taskStatus=RUNNING_TIMEOUT` 中明确可恢复语义，且前端不能按普通 `failed` 处理。
- `provider_running` 应继续被视为同项目/同输入的 active task，防止重复提交 Aliyun 任务。
- `provider_running` 不应长期占用普通短任务并发名额；可设置独立 `recoverUntil` 和恢复轮询并发。

持久化字段：

- provider：`name/requestId/taskId/taskStatus/errorCode/errorMessage/submittedAt/lastPolledAt/runningTimeoutAt/recoverUntil/lastResponse`。
- input：`inputMode/videoUrl/audioUrl/videoExtension/avatarResourceId/audioAssetId/renderMode/projectId`。
- media contract：`sourceContract/preparedContract/audioContract/providerOutputContract/finalOutputContract`。
- result：`providerVideoUrl/finalVideoUrl/digitalHumanVideoAssetId/durationSeconds`。

恢复边界：

- 恢复逻辑不能依赖临时 `draftDir` 仍存在；必须依赖稳定资源引用、provider 输出 URL 和已持久化 sourceContract。
- 后台恢复任务只查询已存在的 provider task，不重新提交 provider。
- 超过 `recoverUntil` 后仍未终态，才转为明确失败或需要人工处理的 `expired` 类错误。

分发规则：

- `BE-077`：实现 provider metadata 持久化、`provider_running` 状态、后台/手动恢复和最终资产写回。
- `BE-PERF-013`：实现调用 provider 前的媒体体检和阈值拦截，减少长时间 RUNNING。
- `FE-075`：前端区分 provider-running timeout 与真实失败。
- `OPS-038`：补充轮询、恢复、阈值和日志排查手册。
- `QA-052`：用 mock/provider stub 验证 RUNNING_TIMEOUT -> SUCCEEDED 恢复链路。

## Current Result Reuse Rule

第二步不再自动匹配历史口型视频。当前规则：

- 刷新或重新进入创作台时，只自动恢复已保存的音频资产和字幕时间轴。
- 不再按 `audioAssetId`、`avatarResourceId`、`renderMode`、文案 hash、音频名称或数字人名称查找旧口型视频。
- 第三步只能使用当前页面本次明确生成成功后得到的 `digitalHumanVideoAssetId`。
- 用户修改文案、音频、数字人或画幅后，前端清空当前口型预览和 `digitalHumanVideoAssetId`，要求重新生成。
- 后端已有历史 resolve 接口仅作为兼容遗留能力，不作为当前前端工作流入口。

## Assignment Rules

| 任务涉及内容 | 分发给 |
|---|---|
| 页面、按钮、表单、弹窗、路由、接口调用 | 前端 UI + 业务开发 Agent |
| 页面卡顿、首屏慢、组件过大、图片视频加载慢、预览等待过久 | 前端优化 Agent |
| 接口、数据库、鉴权、业务流程、任务状态、用户隔离 | 后端功能逻辑开发 Agent |
| 高并发、队列、缓存、慢查询、内存占用、重复付费调用防护 | 后端优化 Agent |
| Docker、Nginx、服务器、环境变量、部署、日志、监控、回滚 | 运维环境 + 服务器维护 Agent |
| 前后端联调、接口验证、E2E、冒烟测试、线上只读验收 | 测试验收 Agent |
| 模块边界、技术选型、长任务架构、代码结构、大规模重构 | 架构审查 Agent |

## Update Rules

- 新任务必须有任务 ID、负责人 Agent、优先级、验收标准和测试结果。
- 任何跨前后端任务开发完成后必须进入测试验收 Agent。
- 任何数据库表、长任务、队列、缓存、权限、生产部署相关任务必须先经过架构审查或运维审查。
- `Done` 只表示验收通过；未测试只能是 `Review` 或 `Blocked`。
## 2026-05-25 Backend Perf Completion

| Task ID | Status | Owner Agent | Result |
|---|---|---|---|
| BE-PERF-009 | Done | 后端优化 Agent | 已将 `GET /api/v1/render-tasks/:taskId` 与 `GET /api/v1/title-assets/render-tasks/:taskId` 收敛为轻量状态读取路径；标题任务轮询接口补充 `no-store` 与轮询建议头，避免轮询放大缓存与内存压力。验证：`npm --prefix backend run test`、`npm --prefix backend run build` 通过。 |
| BE-PERF-010 | Done | 后端优化 Agent | 已新增大 payload 防护：`video-script/save` highlights 数量与字段限制、标题标记 layout 复杂度限制、字幕 cues 数量/总文本长度/单项限制、`subtitleVisualStyle/titleLayout` 对象深度/节点/字节预算。超限统一返回 4xx。验证：`npm --prefix backend run test`、`npm --prefix backend run build` 通过。 |
