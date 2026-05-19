# Acceptance Criteria

本文件是所有 Agent 的统一验收门禁。

## 通用完成定义

任务只有同时满足以下条件才能标记为 `Done`：

- 需求目标已实现。
- 影响范围已说明。
- 相关文档已同步。
- 已执行对应测试，或明确说明无法执行的原因。
- 没有引入真实密钥、Cookie、用户上传文件或大体积生成产物。
- 没有回滚他人未关联改动。

## v1.0 后测试方向

从 `v1.0` 起，测试验收 Agent 默认不再重复执行模块核心功能全链路测试。除非用户明确要求，测试重点切换为性能、请求、安全参数和资源释放风险。

必须检查：

- 请求频率：页面进入、切换、hover、输入、防抖、轮询、重试、重复点击是否造成过多请求、并发风暴或重复 provider 调用。
- 参数风险：接口 method、url、query、body、headers 是否包含越权 ID、未校验文件名、外部 URL、过大 payload、可注入字段或不必要敏感信息。
- 数据保存风险：上传、转写、缓存、任务状态、音视频文件、object URL、Blob、base64、大 JSON 是否可能常驻内存或无限增长。
- 资源释放：一次性组件、弹窗、预览播放器、上传控件、轮询 timer、事件监听、AbortController、WebSocket、object URL、临时文件是否在关闭、路由离开、任务失败后销毁。
- 部署运行风险：日志量、临时目录、队列积压、磁盘增长、进程内缓存、健康检查和反代 Range/Header 是否存在可观察风险。

默认不再检查：

- 已在 v1.0 验收通过的主流程是否能再次完整跑通。
- 每个按钮、下拉框、输入框的基础可点击性。
- 业务模块的常规 happy path，除非该路径与性能、参数、安全或资源释放风险直接相关。

## 自动执行边界

可由 Agent 自动执行：

- 开发、测试、返工。
- 本地或 staging 测试环境部署。
- 非破坏性文档、脚本、配置样例更新。
- 非生产环境日志查看、健康检查、冒烟测试。

必须人工确认：

- 产品方向：MVP 范围、核心流程取舍、商业化策略。
- 数据库破坏性变更：删表、删字段、改字段类型、清空数据、不可逆迁移、删除数据卷。
- 生产发布：生产部署、生产重启、生产回滚、生产 Nginx/DNS/证书调整。
- 付费接口密钥：配置、替换、删除真实付费密钥，或执行可能产生费用的真实 provider 调用。

人工确认项的验收要求：

- 执行前说明影响范围。
- 执行前说明失败风险。
- 执行前准备备份或回滚方案。
- 执行后运行 smoke test 或等价验证。

## 前端验收

适用范围：`frontend/src`、`frontend/vite.config.ts`、前端 Dockerfile、前端 API 封装。

必须检查：

```bash
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

若新增 `lint` 脚本，则必须执行：

```bash
npm --prefix frontend run lint
```

页面验收：

- 桌面宽度 1440px 无错位、遮挡、不可读文本。
- 移动宽度 375px 无横向滚动、按钮文字溢出。
- 加载中、失败、空数据、成功状态均可见。
- 长任务有进度或等待反馈。
- API 错误能给用户明确提示。

## 后端验收

适用范围：`backend/src`、`backend/test`、后端 Dockerfile、后端脚本。

必须检查：

```bash
npm --prefix backend ci
npm --prefix backend run test
npm --prefix backend run build
```

非破坏性 lint：

```bash
cd backend
npx eslint "{src,apps,libs,test}/**/*.ts"
```

接口验收：

```bash
curl -fsS http://127.0.0.1:3000/api
curl -fsS http://127.0.0.1:3000/api/v1/tools/digital-human-env
```

若接口需要登录：

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/v1/auth/me
```

## 数据库验收

适用范围：`backend/src/database` 和所有 service SQL。

必须检查：

- MySQL DDL 与 SQLite DDL 字段语义一致。
- 新字段有默认值或迁移兼容逻辑。
- 列表查询必须有分页或上限。
- 高频查询必须检查索引。
- 外键删除行为符合业务预期。

## API 验收

适用范围：控制器、API client、接口文档。

必须检查：

- 控制器路径与 `frontend/src/api` 封装一致。
- 鉴权规则清楚：公开接口必须有 `@Public()`，其他接口默认 JWT。
- 失败路径返回 4xx 或 5xx，不吞异常。
- 上传接口有文件大小限制。
- Server-side fetch 必须做 URL 安全校验，禁止 SSRF。

## 部署验收

适用范围：`docker-compose.yml`、`compose.runtime.yml`、`deploy/`、`scripts/`。

必须检查：

```bash
docker compose config
bash scripts/smoke-test.sh
```

生产环境必须设置：

- `JWT_SECRET`
- `CORS_ORIGINS`
- `MYSQL_*`
- `PUBLIC_BASE_URL`
- `PUBLIC_UPLOAD_BASE_URL`
- 所需 AI provider 密钥

## Smoke Test 门禁

默认 Docker 环境：

```bash
FRONTEND_URL=http://127.0.0.1:8080 API_BASE_URL=http://127.0.0.1:8080/api bash scripts/smoke-test.sh
```

默认本地开发环境：

```bash
FRONTEND_URL=http://127.0.0.1:5173 API_BASE_URL=http://127.0.0.1:3000/api bash scripts/smoke-test.sh
```

通过标准：

- 前端 `/` 返回 2xx 或 3xx。
- 后端 `/api` 返回 2xx。
- 核心公开 API `/api/v1/tools/digital-human-env` 返回 JSON。
- 如果提供 `SMOKE_TOKEN`，`/api/v1/auth/me` 返回当前用户。

## 回滚验收

回滚只允许切换版本和重启服务，不允许删除数据卷。

必须确认：

- MySQL 卷保留。
- uploads 卷保留。
- video downloads 卷保留。
- digital human storage 卷保留。
- 回滚后 smoke test 通过。
