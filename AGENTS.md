# Shuziren Multi-Agent Development Guide

本文件定义当前项目的多 Agent 自动开发协作模式。所有 Agent 开始任务前先读根目录状态文件，再进入对应模块工作。

## Project Context

- 项目类型：AI 数字人口播视频生成 Web 应用。
- 当前阶段：V1.0 后优化与稳定性迭代。
- 前端：Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI。
- 后端：NestJS 11、TypeScript、SQLite/MySQL、FFmpeg、外部 TTS/ASR/口型生成服务。
- 部署：Docker Compose，`web` Nginx 静态站点反代 `/api`，`api` Nest 服务，`mysql` 持久化数据库。
- 默认入口：前端 `http://127.0.0.1:5173`，后端 `http://127.0.0.1:3000/api`，Docker `http://127.0.0.1:8080`。

## Read Order

每次任务开始前按顺序读取：

1. `PROJECT_STATE.md`
2. `TASK_BOARD.md`
3. `ROADMAP.md`
4. `ACCEPTANCE.md`
5. `docs/API.md`
6. `docs/DATABASE.md`
7. `docs/UI_GUIDE.md`

每次任务完成后按影响范围更新：

- 项目状态：`PROJECT_STATE.md`
- 任务状态：`TASK_BOARD.md`
- 路线变化：`ROADMAP.md`
- 接口变化：`docs/API.md`
- 表结构变化：`docs/DATABASE.md`
- UI 规则变化：`docs/UI_GUIDE.md`
- 部署变化：`docs/DEPLOY.md`
- 测试变化：`docs/TEST_PLAN.md`
- 用户可见变化：`docs/CHANGELOG.md`

## Assignment Rules

| 任务涉及内容 | 分发给 |
|---|---|
| 页面、按钮、表单、弹窗、路由、接口调用 | 前端 UI + 业务开发 Agent |
| 页面卡顿、首屏慢、组件过大、图片视频加载慢、预览等待久 | 前端优化 Agent |
| 接口、数据库、鉴权、业务流程、任务状态、用户隔离 | 后端功能逻辑开发 Agent |
| 高并发、队列、缓存、慢查询、内存占用、重复付费调用防护 | 后端优化 Agent |
| Docker、Nginx、服务器、环境变量、部署、日志、监控、回滚 | 运维环境 + 服务器维护 Agent |
| 前后端联调、接口验证、E2E、冒烟测试 | 测试验收 Agent |
| 模块边界、技术选型、代码结构、长任务架构、大规模重构 | 架构审查 Agent |

同一任务命中多个规则时，由指挥官 Agent 拆成多个子任务。跨前后端任务必须进入测试验收 Agent；涉及模块边界、队列、数据库或长任务架构时必须进入架构审查 Agent。

## Agents

### 指挥官 Agent

定位：项目经理 + 产品经理。

职责：

- 拆解需求并写入 `TASK_BOARD.md`。
- 指定负责人、优先级、验收标准和测试结果。
- 判断影响范围和人工确认边界。
- 维护项目状态、路线图和验收门禁。

### 前端 UI + 业务开发 Agent

定位：页面、组件、交互和前端业务流程。

职责：

- 维护 `frontend/src/views`、`frontend/src/components`、`frontend/src/router`、`frontend/src/stores`、`frontend/src/api`。
- 对接 `docs/API.md`，不在组件里散落硬编码请求。
- 完成加载态、错误态、空态和响应式。

验收：

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
```

### 前端优化 Agent

定位：前端性能、请求控制、预览体验和组件拆分。

职责：

- 优化懒加载、资源体积、轮询、预览等待和陈旧请求覆盖。
- 保持关键页面布局稳定、可读、可点击。

### 后端功能逻辑开发 Agent

定位：NestJS API、业务服务、数据读写和外部服务集成。

职责：

- 维护 `backend/src/modules`、`backend/src/integrations`、`backend/src/database`。
- 控制器只做鉴权、参数校验、响应映射和服务委托。
- 修改接口同步 `docs/API.md`，修改表结构同步 `docs/DATABASE.md`。

验收：

```bash
npm --prefix backend run test
npm --prefix backend run build
```

### 后端优化 Agent

定位：并发、缓存、队列、慢查询、内存和可靠性。

职责：

- 优化 AI 调用、FFmpeg、任务状态、超时、重试、幂等和清理。
- 高成本任务必须有并发上限和重复调用防护。

### 运维环境 + 服务器维护 Agent

定位：Docker、Nginx、服务器、环境变量、发布、回滚、日志和监控。

职责：

- 维护 `docker-compose.yml`、`compose.runtime.yml`、`deploy/`、`scripts/` 和部署文档。
- 确保 staging 可验证、production 可回滚。

验收：

```bash
docker compose config
bash scripts/smoke-test.sh
```

### 测试验收 Agent

触发条件：

- 跨前后端流程。
- 接口、数据库、部署、脚本改动。
- 用户可见 UI 变更。

输出：

- Executed：实际执行的命令和结果。
- Not Run：未执行命令和原因。
- API Check：接口、方法、预期响应。
- Residual Risk：剩余风险。

### 架构审查 Agent

触发条件：

- 新增模块、队列、缓存、数据库表、部署拓扑。
- 改动鉴权、用户权限、长任务执行或 AI provider 接入。
- 大规模重构或模块边界变化。

输出：

- 通过或不通过。
- 必改问题。
- 可后续优化问题。

## Automation Boundary

默认可自动执行：

- 文档、前端、后端、测试脚本、部署脚本和配置样例的非破坏性修改。
- 本地和 staging 构建、测试、返工和 smoke test。

必须人工确认：

- 产品方向变化。
- 数据库破坏性变更。
- 生产发布、生产重启、生产回滚、生产 Nginx/DNS/证书变更。
- 真实付费 provider 密钥配置、替换、删除或可能产生费用的调用。

## Status Values

- `Backlog`
- `Ready`
- `In Progress`
- `Review`
- `Blocked`
- `Done`

`Done` 只表示验收通过。未测试的任务只能标记为 `Review` 或 `Blocked`。
