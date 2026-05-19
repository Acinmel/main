# Roadmap

## 2026-05-19 v1.0 Milestone

状态：线上主流程已全部通过，当前版本标记为 `v1.0`。

后续路线：

- 保持 v1.0 主链路稳定，不做无关重构。
- 优先处理局部功能优化、体验细节、安全访问边界、预览性能、监控告警和测试自动化。
- Post-v1.0 权限策略：普通新注册用户默认无业务功能权限，必须由管理员开通后才能使用。
- 所有后续优化继续走 `TASK_BOARD.md` 分发、验收和记录。

## 目标

把当前数字人口播项目从单人连续开发模式升级为可持续的多 Agent 自动协作模式，同时保证业务、接口、数据、部署、测试文档同步演进。

## Phase 0：协作基线

状态：已建立

交付物：

- `AGENTS.md`
- `PROJECT_STATE.md`
- `TASK_BOARD.md`
- `ROADMAP.md`
- `ACCEPTANCE.md`
- `docs/`
- `scripts/`

完成标准：

- Agent 角色边界清晰。
- 任务状态可追踪。
- 验收标准统一。
- 检查、smoke、staging、rollback 脚本可执行。

## Phase 1：开发流程固化

优先级：P0

工作项：

- 每个需求都以 `TASK_BOARD.md` 中的任务 ID 开始。
- 前后端接口变更必须同步 `docs/API.md`。
- 数据表变更必须同步 `docs/DATABASE.md`。
- 部署和环境变量变更必须同步 `docs/DEPLOY.md`。
- 用户可见变化必须同步 `docs/CHANGELOG.md`。

完成标准：

- 新任务能由指挥官 Agent 分派到具体 Agent。
- 测试验收 Agent 能按 `docs/TEST_PLAN.md` 验证。
- 架构审查 Agent 能按触发条件介入。

## Phase 2：稳定性与性能

优先级：P1

工作项：

- 将 AI、ASR、TTS、FFmpeg、视频渲染长任务统一为可查询状态。
- 为外部 AI 调用设置明确并发、排队、超时、重试、熔断。
- 将任务状态缓存从进程内能力升级到 Redis 或数据库持久任务表。
- 加强慢请求日志和失败原因收敛。
- 为资源列表、后台列表、作品列表做分页与索引核对。

完成标准：

- 长任务不依赖单次 HTTP 长连接完成。
- 用户能看到 pending、processing、completed、failed 状态。
- 后端重启后关键任务状态可恢复或明确失败。

## Phase 3：产品能力完善

优先级：P1

工作项：

- 完善创作工作台：素材、字幕、音色、背景音乐、剪辑、画中画。
- 完善作品管理：搜索、筛选、删除、批量操作、重新生成。
- 完善资源库：推荐资源上架、用户资源到期清理、资源预览。
- 完善后台：任务审计、资源审计、失败任务追踪、用户封禁。

完成标准：

- 主流程从导入链接到生成作品可稳定完成。
- 管理员能定位用户、任务、资源、审计日志。
- 用户资源和作品可控、可清理、可恢复。

## Phase 4：发布与运维

优先级：P1

工作项：

- staging 与 production 环境变量拆分。
- 发布包构建和服务器部署流程自动化。
- 回滚演练、数据库备份、上传文件备份。
- 日志采集、健康检查、告警。

完成标准：

- `scripts/deploy-staging.sh` 能完成 staging 部署和 smoke test。
- 生产环境使用 `deploy/build-release.sh`、`deploy/deploy-runtime.sh`、`deploy/rollback.sh`。
- 回滚不删除 MySQL、uploads、download-video、digital-human 数据卷。

## Phase 5：质量体系

优先级：P2

工作项：

- 前端补充 lint 脚本或统一 ESLint 配置。
- 后端补充关键 service 单元测试和 e2e。
- 增加 API 契约测试。
- 增加核心页面 Playwright 测试。
- 将 `scripts/check-all.sh` 接入 CI。

完成标准：

- PR 或提交前可自动执行检查。
- 失败项能定位到具体模块和命令。
- 文档与代码变更不再脱节。
