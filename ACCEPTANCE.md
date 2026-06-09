# Acceptance Criteria

本文件是所有 Agent 的统一验收门禁。当前阶段为 V1.0 后优化与稳定性迭代。

## Temporary Core Flow Gate

当前项目临时恢复“完整主链路必测”。在 `QA-CORE-001` 通过前，旧规则中“V1.0 后默认不重复完整主链路回归”暂停执行。

核心流程必须逐步验收：

1. 文案阶段：提取或手写文案后创建 `projectId`，保存 `video-script` 和 `scriptHash`，刷新后不丢文案。
2. 音频阶段：当前项目生成 `audioAssetId`，试听 URL 可播放，语速参数生效或有明确兼容说明。
3. 字幕阶段：字幕轨必须由当前 `audioAssetId + scriptSegments` 生成，`source=tts_alignment`，字幕条数等于口播分段数，`startTime/endTime` 秒级递增、不重叠。
4. 口型阶段：当前 `audioAssetId + avatarResourceId + projectId` 生成口型任务，成功后写回 `digitalHumanVideoAssetId`，刷新或重新进入不会复活旧视频。
5. 包装阶段：最终渲染只使用当前 `digitalHumanVideoAssetId + subtitleTrackId + subtitleTemplateId`，字幕模板样式参与输出，失败时返回明确错误。

通过标准：

- QA 必须记录每一步请求 URL、方法、关键 payload、响应中的产物 ID、UI 状态和失败日志。
- 任一步失败，相关任务只能保持 `Ready/Review/Blocked`，不能标 `Done`。
- 真实付费 provider 调用必须先人工确认；本地可先用 mock/stub 完成状态机验收，但最终仍要有一次 staging 主流程验证。

## Definition Of Done

任务只有同时满足以下条件才能标记为 `Done`：

- 需求目标已实现。
- 影响范围已说明。
- 相关文档已同步。
- 对应测试已执行，或明确说明不能执行的原因。
- 没有引入真实密钥、Cookie、用户上传文件或大体积生成产物。
- 没有回滚他人无关改动。
- 跨前后端或用户可见功能已由测试验收 Agent 验证。

## V1.0+ Test Focus

V1.0 后默认不重复执行完整主链路回归，除非用户明确要求。测试重点转为：

- 请求频率和重复点击是否导致风暴或重复 provider 调用。
- 参数是否包含越权 ID、未校验文件名、外部 URL、过大 payload 或敏感信息。
- 上传、转码、缓存、任务状态、Blob、Object URL、临时文件是否释放。
- 资源流、素材库、模板库、最近记录是否按用户隔离。
- 队列、日志、临时目录、磁盘、健康检查和 Nginx Range/Header 是否可观察。

## Frontend Gate

适用范围：`frontend/src`、前端 API 封装、路由、组件、样式和前端部署配置。

必跑：

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
```

页面验收：

- 桌面宽度无错位、遮挡、不可读文本。
- 移动宽度无横向滚动和按钮文字溢出。
- 加载、失败、空数据和成功状态可见。
- 长任务有进度或等待反馈。
- API 错误靠近触发区域展示。

## Backend Gate

适用范围：`backend/src`、`backend/test`、后端脚本和后端 Dockerfile。

必跑：

```bash
npm --prefix backend run test
npm --prefix backend run build
```

接口验收：

- 控制器路径和 `frontend/src/api` 封装一致。
- 非公开接口默认需要 JWT。
- 失败路径返回 4xx 或 5xx，不吞异常。
- 上传接口有大小和类型限制。
- Server-side fetch 做 URL 安全校验，避免 SSRF。

## Database Gate

适用范围：`backend/src/database` 和 service SQL。

必须检查：

- SQLite 和 MySQL 字段语义一致。
- 新字段有默认值或兼容迁移。
- 列表查询有分页或上限。
- 高频查询有索引。
- 跨账号数据访问有 `user_id` 过滤。

破坏性数据库变更必须人工确认。

## Creation Project Gate

适用范围：创作任务、阶段状态、音频、字幕、口型、模板和最终成片之间的关联。

必须检查：

- 新流程使用真实 `video_projects.id`，不得继续把 `studio-current` 当作新任务主键。
- 任务名只做展示和搜索，允许重复，不能作为恢复或复用依据。
- 所有项目详情、列表、阶段状态和资产指针都按 `user_id + projectId` 校验。
- 刷新或从任务列表进入时，只恢复该 `projectId` 的内容。
- 不按音频名称、文案、数字人视频、来源链接或画幅自动匹配其他任务的口型结果。
- `render-final`、`lipsync-tasks`、`package-render-tasks`、`pd-events`、`detect-cut-points` 必须在 dedupe、并发、持久化和 provider 调用前校验 `video_projects.id + user_id`。
- 跨账号 project-scoped 长任务请求统一返回 `404`，不得创建内存 task、不得写入 `task_statuses`、不得占用并发额度。
- `studio-current` 只允许作为遗留 stage-state/resolve 兼容，不得作为新长任务创建接口的绕过入口。

## Media And Task Gate

适用范围：TTS、ASR、口型、标题素材、包装成片和 FFmpeg。

必须检查：

- 长任务只返回 `taskId`，不阻塞 HTTP 请求线程。
- 任务状态可查询，失败原因可展示。
- 高成本 provider 调用有幂等键或复用策略。
- 临时文件成功、失败、超时后清理。
- 视频和音频资源流必须鉴权。
- 如后续显式提供复用或复制任务能力，口型资产复用必须按当前用户、项目、音频、数字人和渲染模式匹配，且不能作为默认自动恢复逻辑。

## Title Asset Gate

必须检查：

- `POST /api/v1/video-script/mark-title` 只创建 `title_effect`，不覆盖 `highlight`。
- `POST /api/v1/title-assets/render` 只创建异步任务。
- 标题素材查询、任务状态和最终合成都校验当前用户归属。
- 透明 WebM 必须通过 alpha 通道校验；失败记录错误。
- 多个标题素材按各自时间叠加。
- 标题失败不影响文案保存、字幕高亮和无标题成片。

## Deploy Gate

适用范围：`docker-compose.yml`、`compose.runtime.yml`、`deploy/`、`scripts/`、Nginx 配置。

必跑：

```bash
docker compose config
bash scripts/smoke-test.sh
```

生产环境必须设置：

- `JWT_SECRET`
- `CORS_ORIGIN` 或 `CORS_ORIGINS`
- `MYSQL_*`
- `PUBLIC_BASE_URL`
- `PUBLIC_UPLOAD_BASE_URL`
- 所需 AI provider 密钥

生产发布、重启和回滚必须人工确认。

## Smoke Gate

本地开发：

```bash
FRONTEND_URL=http://127.0.0.1:5173 API_BASE_URL=http://127.0.0.1:3000/api bash scripts/smoke-test.sh
```

Docker：

```bash
FRONTEND_URL=http://127.0.0.1:8080 API_BASE_URL=http://127.0.0.1:8080/api bash scripts/smoke-test.sh
```

通过标准：

- 前端返回 2xx 或 3xx。
- 后端 health 返回成功。
- 若提供 token，`/api/v1/auth/me` 返回当前用户。
- 不触发真实付费 provider，除非用户明确确认。
