# OSS 接入任务看板（2026-05-18）

说明：本看板用于 OSS 接入与回归验证，不涉及前端 UI 改动。

| 任务 ID | 任务标题 | 状态 | 负责人 Agent | 优先级 | 验收标准 | 备注 |
|---|---|---|---|---|---|---|
| OPS-OSS-001 | 服务器 OSS 基础配置 | Done | 运维环境 + 服务器维护 Agent | P0 | 补齐 `ALI_OSS_*` 与 `VOICE_SAMPLE_STORAGE=oss`，并通过连通性验证 | 已完成，线上镜像 `20260518-003` |
| OPS-OSS-002 | 部署变量与文档对齐 | Done | 运维环境 + 服务器维护 Agent | P0 | `.env.example`、`docs/DEPLOY.md`、预检脚本对齐 OSS 配置 | 已完成 |
| OPS-OSS-003 | OSS 密钥权限收敛与轮换 | Done | 运维环境 + 服务器维护 Agent | P1 | RAM 子账号最小权限 + AK 轮换 + 复测 | 已完成，旧 AK 已禁用 |
| BE-OSS-001 | 存储层抽象切换（本地/OSS） | Done | 后端功能逻辑开发 Agent | P0 | 上传与读取按环境切换，本地/OSS 接口语义一致 | 已完成 |
| BE-OSS-002 | 上传与回读链路统一 | Done | 后端功能逻辑开发 Agent | P0 | 资源 URL、路径、元数据持久化一致 | 已完成 |
| BE-OSS-003A | 声音样本 OSS 流式回读优化（首轮） | Done | 后端优化 Agent | P1 | `voice-files/*/stream` 改为流式返回 | 已完成 |
| QA-OSS-001 | OSS 全链路回归 | Done | 测试验收 Agent | P1 | 上传视频→上传音频→口型生成→成片下载通过 | 已执行通过，成片下载 200 |
| QA-OSS-002 | 声音样本 OSS 专项验收 | Blocked | 测试验收 Agent | P0 | 上传样本后可在资源库可见且 `voice-files/*/stream` 可播放 | 已执行，`clone-upload` 成功但 stream 404 |
| BE-OSS-003B | OSS 模式接口回归修复支持 | Review | 后端功能逻辑开发 Agent | P1 | 仅修后端逻辑/日志，不改前端 | 已修复 `getStream()` 返回 `{ stream }` 兼容，待线上部署复测 |
| DOC-OSS-001 | OSS 运维说明补充 | Done | 运维环境 + 服务器维护 Agent | P2 | 记录配置、验证命令、回滚方式，不记录真实密钥 | 已完成 |

## 本轮实测结果（2026-05-18）

- 测试账号：`qa-oss-1779095017702@example.com`
- `POST /api/v1/resources/voices/clone-upload`：成功，返回资源 `ec390927-acb0-4849-bcb7-6a0b706e6acf`
- `GET /api/v1/resources/voices?scope=all&limit=40`：成功，可查到上述资源
- `GET /api/v1/resources/voice-files/voice-sample_1779095030324_3fcbc366.mp3/stream`：404（失败项）
- `POST /api/v1/tools/voice-preview`：201（成功）
- `POST /api/v1/tools/lip-sync-preview`：201（成功，provider task `SUCCEEDED`）
- `POST /api/v1/tools/generate-lip-sync-video`：成功，返回 `outputVideoUrl`
- 成片下载：200，文件 `output_1779095486568_f6f5441c-6.mp4`，`1494697` bytes

## 下一步

1. 运维将 `BE-OSS-003B` 修复部署到线上。
2. 复测 `QA-OSS-002` 的 `voice-files/*/stream`，预期从 404 恢复为 200。
3. 通过后回写主看板 `QA-004` 与 `BE-009` 状态。
