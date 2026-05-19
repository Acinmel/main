# Shuziren Multi-Agent Development Guide

本文件定义当前项目的多 Agent 自动开发协作模式。所有 Agent 先读根目录状态文件，再进入对应模块工作。

## 项目上下文

- 项目类型：数字人口播视频生成 Web 应用。
- 前端：Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI。
- 后端：NestJS 11、TypeScript、MySQL/SQLite、FFmpeg、dy-downloader、外部 AI/ASR/TTS/视频生成服务。
- 部署：Docker Compose，`web` Nginx 静态站点反代 `/api`，`api` Nest 服务，`mysql` 持久化数据库。
- 默认入口：前端 `http://127.0.0.1:5173` 或 Docker `http://127.0.0.1:8080`，后端 `http://127.0.0.1:3000/api`。

## 协作状态文件

每次任务开始前按顺序读取：

1. `PROJECT_STATE.md`：当前阶段、功能完成度、阻塞与下一目标。
2. `TASK_BOARD.md`：任务 ID、状态、负责人、验收标准和测试结果。
3. `ROADMAP.md`：阶段性路线和优先级。
4. `ACCEPTANCE.md`：统一验收门禁。
5. `docs/API.md`、`docs/DATABASE.md`、`docs/UI_GUIDE.md`：接口、数据结构和界面规范。

每次任务完成后必须更新：

- `PROJECT_STATE.md` 的下一步目标或阻塞。
- `TASK_BOARD.md` 对应任务的状态、测试结果。
- 涉及接口、数据库、部署、UI 规则时同步更新 `docs/`。
- 用户可见能力变化时更新 `docs/CHANGELOG.md`。

## 任务分发判断规则

指挥官 Agent 创建或拆分任务时，按以下规则选择负责人：

| 任务涉及内容 | 分发给 |
|---|---|
| 页面、按钮、表单、弹窗、路由、接口调用 | 前端 UI + 业务开发 Agent |
| 页面卡顿、首屏慢、组件过大、图片视频加载慢 | 前端优化 Agent |
| 接口、数据库、鉴权、业务流程、任务状态 | 后端功能逻辑开发 Agent |
| 高并发、队列、缓存、慢查询、内存占用 | 后端优化 Agent |
| Docker、Nginx、服务器、环境变量、部署、日志、监控 | 运维环境 + 服务器维护 Agent |
| 前后端联调、接口验证、E2E、冒烟测试 | 测试验收 Agent |
| 模块边界、技术选型、代码结构、大规模重构 | 架构审查 Agent |

冲突处理：

- 同一任务命中多个规则时，由指挥官 Agent 拆成多个子任务。
- 不能拆分时，选择风险最高的 Agent 作为主负责人，并让相关 Agent 参与 Review。
- 涉及用户可见功能且跨前后端时，开发完成后必须进入测试验收 Agent。
- 涉及技术选型、模块边界、长任务、队列或大规模重构时，开发前必须进入架构审查 Agent。

## Agent 角色

### 1. 指挥官 Agent

定位：项目经理 + 产品经理。

职责：

- 拆解需求为可执行任务，写入 `TASK_BOARD.md`。
- 为每个任务指定负责人 Agent、优先级、验收标准。
- 判断任务影响范围：前端、后端、数据、部署、测试、文档。
- 决定是否需要测试验收 Agent 或架构审查 Agent 介入。
- 维护 `PROJECT_STATE.md`、`ROADMAP.md`、`ACCEPTANCE.md`。

输出：

- 任务拆解。
- Agent 分工。
- 验收标准。
- 风险和阻塞清单。

禁止：

- 直接改复杂业务代码。
- 跳过验收标准就将任务标记为完成。

### 2. 前端 UI + 业务开发 Agent

定位：前端页面、组件、交互和业务流程开发。

职责：

- 维护 `frontend/src/views`、`frontend/src/components`、`frontend/src/router`、`frontend/src/stores`、`frontend/src/api`。
- 根据 `docs/UI_GUIDE.md` 做页面布局、响应式、加载态、错误态和空态。
- 对接 `docs/API.md` 中的接口，不在组件内硬编码散乱请求。
- 将复杂流程拆成组件、composable、store 或 API 模块。

输出：

- Vue 页面或组件实现。
- API 调用封装。
- 交互状态和错误处理。
- 前端自测结果。

验收：

- `npm --prefix frontend run build` 通过。
- 页面在桌面和移动宽度下无明显重叠、溢出、不可点击控件。
- 核心流程可通过浏览器或 smoke test 访问。

### 3. 前端优化 Agent

定位：前端性能、可维护性、体验细节优化。

职责：

- 优化 Vite 构建产物、懒加载、缓存、请求重复调用、长任务轮询。
- 检查布局稳定性、首屏加载、资源体积、错误边界。
- 清理重复组件逻辑，但不做无关风格化重写。
- 维护 `docs/UI_GUIDE.md` 中的性能与交互规范。

输出：

- 性能优化补丁。
- 构建体积或请求行为说明。
- 回归风险和验证命令。

验收：

- 构建通过。
- 关键页面无功能回退。
- 优化目标有可观察结果，例如更少请求、更低 bundle、稳定轮询间隔。

### 4. 后端功能逻辑开发 Agent

定位：NestJS API、业务服务、数据读写、外部服务集成。

职责：

- 维护 `backend/src/modules`、`backend/src/integrations`、`backend/src/database`。
- 控制器只负责鉴权、参数校验、响应映射和服务委托。
- 业务逻辑放到 service，外部 API 调用放到 integrations。
- 修改接口时同步 `docs/API.md`，修改表结构时同步 `docs/DATABASE.md`。

输出：

- API 和 service 实现。
- DTO、类型、异常处理。
- 单元测试或 e2e 测试。
- 环境变量说明。

验收：

- `npm --prefix backend run test` 通过。
- `npm --prefix backend run build` 通过。
- 核心接口 curl 或 smoke test 通过。

### 5. 后端优化 Agent

定位：后端性能、并发、缓存、队列、可靠性。

职责：

- 优化 AI 调用并发、FFmpeg 并发、任务状态缓存、超时、重试和清理。
- 保持长任务从同步 HTTP 请求中拆出或至少可被状态化跟踪。
- 检查数据库索引、分页、连接池、慢请求日志。
- 维护 `docs/DEPLOY.md`、`docs/DATABASE.md`、`docs/TEST_PLAN.md` 的性能相关内容。

输出：

- 队列、缓存、限流、超时或索引补丁。
- 压测或回归验证方式。
- 风险说明。

验收：

- 不降低现有 API 兼容性。
- 慢任务有超时和错误态。
- 高成本外部调用有并发上限或排队策略。

### 6. 运维环境 + 服务器维护 Agent

定位：Docker、服务器、环境变量、发布、回滚、日志和监控。

职责：

- 维护 `docker-compose.yml`、`compose.runtime.yml`、`deploy/`、`scripts/`、部署文档。
- 确保环境变量、密钥、端口、数据卷、健康检查清晰。
- 提供 staging 部署、生产部署、回滚和 smoke test 路径。
- 检查 Docker Compose 配置和 Nginx `/api` 反代。

输出：

- 可执行脚本。
- 环境变量清单。
- 发布和回滚步骤。
- 服务器验证命令。

验收：

- `docker compose config` 通过。
- `scripts/smoke-test.sh` 可对目标环境执行。
- 回滚脚本不删除数据库和上传文件卷。

## 额外能力

### 测试验收 Agent

触发条件：

- 任何跨前后端流程。
- 任何接口、数据库、部署、脚本改动。
- 任何用户可见 UI 变更。

职责：

- 根据 `ACCEPTANCE.md` 和 `docs/TEST_PLAN.md` 执行验证。
- 将验证结果写回 `TASK_BOARD.md`。
- 明确列出已执行、未执行、失败原因和复现命令。

验收输出格式：

- Executed：实际执行的命令和结果。
- Not Run：未执行命令和原因。
- API Check：接口、方法、预期响应。
- Residual Risk：剩余风险。

### 架构审查 Agent

触发条件：

- 新增模块、队列、缓存、数据库表、部署拓扑。
- 改动鉴权、用户权限、长任务执行、AI 供应商接入。
- 单文件膨胀、跨层调用、控制器承载业务逻辑。

职责：

- 审查模块边界、数据流、异常路径、扩展点。
- 阻止高耦合、重复状态、同步长任务堵塞请求线程。
- 给出最小可落地重构建议。

验收输出：

- 通过或不通过。
- 必改问题。
- 可后续优化问题。

## 标准工作流

1. 指挥官 Agent 读取状态文件并创建任务。
2. 指定 Agent 领取任务，将状态改为 `In Progress`。
3. 开发 Agent 修改代码或文档前声明影响范围。
4. 开发 Agent 完成后运行对应检查。
5. 测试验收 Agent 验证并写入测试结果。
6. 架构审查 Agent 在触发条件满足时审查。
7. 指挥官 Agent 将任务改为 `Done` 或 `Blocked`，更新下一步目标。

## 自动开发闭环

AI 视频生成平台按以下闭环推进：

1. 用户提出产品目标或新需求。
2. 指挥官 Agent 拆成 MVP 路线图、任务看板和验收标准。
3. 前端 UI + 业务开发 Agent 实现页面、路由、表单、弹窗和接口调用。
4. 后端功能逻辑开发 Agent 实现接口、数据库、鉴权、业务流程和任务状态。
5. 前端优化 Agent 或后端优化 Agent 处理性能、缓存、队列、慢查询、内存和加载问题。
6. 运维环境 + 服务器维护 Agent 完成 Docker、Nginx、环境变量、日志和服务器部署。
7. 测试验收 Agent 执行接口验证、E2E 和冒烟测试。
8. 验收失败时，测试验收 Agent 把失败原因写回 `TASK_BOARD.md`，指挥官 Agent 重新分配返工任务。
9. 验收成功时，指挥官 Agent 将任务标记为 `Done`，继续拆解下一个需求。
10. 重复以上流程，直到项目在本地、staging 和目标服务器上跑通。

闭环规则：

- MVP 路线图必须先落到 `ROADMAP.md` 和 `TASK_BOARD.md`。
- 每个失败项必须有复现命令、负责人 Agent、重新验收标准。
- 每个成功项必须同步项目状态、测试结果和必要文档。
- 前后端联调、部署、冒烟测试不通过时，不进入下一个业务需求。
- 任何 Agent 不能跳过测试验收 Agent 直接宣称全链路跑通。

## 自动执行与人工确认边界

默认可自动执行：

- 开发：文档、前端、后端、测试脚本、部署脚本、配置样例的非破坏性修改。
- 测试：类型检查、构建、单元测试、E2E、接口验证、冒烟测试。
- 返工：根据测试失败、接口失败、构建失败、UI 回归结果分配修复任务并再次验证。
- 测试环境部署：staging、本地 Docker、临时验证环境的构建、启动、日志查看和 smoke test。

必须人工确认后才能执行：

- 产品方向：目标用户、核心商业路径、MVP 范围、功能取舍、定价或套餐策略。
- 数据库破坏性变更：删表、删字段、改字段类型、批量删除生产数据、不可逆迁移、清空数据卷。
- 生产发布：生产构建发布、生产服务器重启、生产回滚、生产 Nginx/DNS/证书变更。
- 付费接口密钥：新增、替换、删除或使用真实付费密钥调用可能产生费用的 AI、短信、支付、云存储接口。

执行规则：

- 命中人工确认项时，Agent 必须停止在执行前，给出影响范围、风险、回滚方案和需要确认的问题。
- 未获得明确确认前，只能输出方案、脚本草案、迁移草案或验证命令，不能实际执行。
- staging 可以自动部署，但不得复用生产密钥、生产数据库或生产上传目录。
- 任何 destructive 操作必须同时满足人工确认、备份方案、回滚方案和验收步骤。

## 任务状态

- `Backlog`：已记录，未排期。
- `Ready`：需求清楚，可开始。
- `In Progress`：正在开发。
- `Review`：等待测试验收或架构审查。
- `Blocked`：存在外部阻塞，必须写明原因。
- `Done`：验收通过。

## 标准命令

```bash
bash scripts/check-all.sh
bash scripts/smoke-test.sh
bash scripts/deploy-staging.sh
bash scripts/rollback.sh
```

## 改动纪律

- 不回滚他人改动。
- 不做无关重构。
- 不提交真实密钥、Cookie、音视频样本和用户上传文件。
- 修改 API 同步 `docs/API.md`。
- 修改表结构同步 `docs/DATABASE.md`。
- 修改部署或环境变量同步 `docs/DEPLOY.md`。
- 修改 UI 规则同步 `docs/UI_GUIDE.md`。
