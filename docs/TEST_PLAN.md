# Test Plan

## v1.0 后测试策略

v1.0 主链路已作为基线通过。后续默认不再做模块核心功能全链路测试，测试验收 Agent 只在用户明确要求时才复测完整业务流程。

默认测试重点：

- 请求频率：记录页面进入、路由切换、hover、输入、重复点击、轮询和重试触发的请求次数；标记无防抖、无取消、重复并发、长轮询过密和 provider 重复调用。
- 参数风险：拦截请求并检查 method、url、query、body、headers；标记越权 ID、未归属校验文件名、外部 URL、过大 payload、敏感字段泄露、可注入字段。
- 内存与保存风险：检查 Blob/base64/object URL、大 JSON、音视频缓存、任务状态缓存、临时文件、上传文件是否无限增长或常驻。
- 释放与销毁：检查弹窗、一次性组件、播放器、上传控件、timer、事件监听、AbortController、轮询、WebSocket、object URL 在关闭、路由离开、失败和重试后是否释放。
- 运行风险：检查队列积压、日志量、磁盘增长、临时目录清理、Range/Header、健康检查和反代行为。

默认输出格式：

- Scope：本次只测的风险面。
- Commands：实际执行命令、浏览器脚本或抓包方式。
- Request Frequency：请求次数、重复请求、并发和轮询间隔。
- Parameter Risk：method、url、payload、headers 风险。
- Memory/Data Risk：内存、Blob、object URL、缓存、临时文件和数据库增长风险。
- Cleanup Risk：组件卸载、路由离开、弹窗关闭后的资源释放结果。
- Dispatch：失败项分发给前端优化、后端优化、后端功能逻辑或运维 Agent。

## 测试分层

| 层级 | 目标 | 命令 |
|---|---|---|
| 前端类型与构建 | 确认 Vue/TS 可构建 | `npm --prefix frontend run typecheck && npm --prefix frontend run build` |
| 后端单元测试 | 验证 service 和工具函数 | `npm --prefix backend run test` |
| 后端构建 | 验证 Nest 编译 | `npm --prefix backend run build` |
| 后端 e2e | 验证 API 流程 | `npm --prefix backend run test:e2e` |
| Docker 配置 | 验证 compose | `docker compose config` |
| Smoke | 验证部署可访问 | `bash scripts/smoke-test.sh` |

## 全量检查

```bash
bash scripts/check-all.sh
```

脚本执行内容：

- frontend install。
- frontend lint，如果没有 lint 脚本则执行 typecheck。
- frontend build。
- backend/DY-DOWNLOADER install/build，如果目录存在。
- backend install。
- backend 非破坏性 lint。
- backend test。
- backend build。
- docker compose config。

## Smoke Test

Docker 默认：

```bash
FRONTEND_URL=http://127.0.0.1:8080 API_BASE_URL=http://127.0.0.1:8080/api bash scripts/smoke-test.sh
```

本地开发：

```bash
FRONTEND_URL=http://127.0.0.1:5173 API_BASE_URL=http://127.0.0.1:3000/api bash scripts/smoke-test.sh
```

检查项：

- `GET $FRONTEND_URL/`
- `GET $API_BASE_URL`
- `GET $API_BASE_URL/v1/tools/digital-human-env`
- 如果有 `SMOKE_TOKEN`：`GET $API_BASE_URL/v1/auth/me`

## API 手工验证

注册：

```bash
curl -fsS -X POST http://127.0.0.1:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

登录：

```bash
TOKEN="$(curl -fsS -X POST http://127.0.0.1:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.parse(s).token))")"
```

当前用户：

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/v1/auth/me
```

资源列表：

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:3000/api/v1/resources/avatars?scope=all&limit=20"
```

数字人 provider：

```bash
curl -fsS http://127.0.0.1:3000/api/v1/tools/digital-human-env
```

转写链路：

```bash
curl -fsS -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/api/v1/tools/transcribe-pipeline-health
```

## 前端回归清单

- `/` 可访问。
- `/digital-human` 未登录时跳转 `/login`。
- `/resources` 未登录时跳转 `/login`。
- `/studio` 已登录且账号 active 时可访问。
- `/admin/dashboard` 非管理员跳转 `/forbidden-admin`。
- 上传控件显示进度和失败原因。
- 长任务轮询中断后能重试。

## 后端回归清单

- 无 token 访问私有接口返回 401。
- pending 用户访问受限业务页返回或跳转为待审核状态。
- disabled 用户无法继续访问私有 API。
- 上传接口限制文件大小。
- `sourceVideoUrl` 做归一化和 URL 安全校验。
- AI provider 未配置时返回明确错误或 mock fallback。

## 部署回归清单

- `docker compose config` 通过。
- `docker compose up -d --build` 后 `api` health 为 healthy。
- `web` 可访问 `/`。
- `web` 可反代 `/api`。
- `mysql_data` 等数据卷未被删除。
- 回滚后 smoke test 通过。

## Release Route Existence Check (BE-015)

Before uploading release package, run route gate checks:

```bash
node scripts/verify-release-routes.js --backend-dist-dir backend/dist --context manual-backend-dist
node scripts/verify-release-routes.js --backend-dist-dir dist-release/<package>/backend/dist --context manual-package-dist
```

Pass criteria:

- output contains `[OK] [manual-backend-dist]`
- output contains `[OK] [manual-package-dist]`
- process exits with status `0`

Fail criteria:

- any `[X]` output
- missing `GET/POST /api/v1/tools/recent-extractions` route markers
- non-zero exit code blocks release upload
