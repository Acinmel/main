# Shuziren Technical Index

## Project

AI 数字人口播视频生成平台，当前处于 V1.0 后优化与稳定性迭代。

## Main Stack

- Frontend：Vue 3、Vite、TypeScript、Pinia、Vue Router、Naive UI。
- Backend：NestJS 11、TypeScript、SQLite/MySQL、FFmpeg。
- Deployment：Docker Compose、Nginx、持久化上传目录，可选 OSS。

## Main Modules

- `frontend/src/views/CreativeStudioView.vue`：创作台主入口。
- `frontend/src/components/studio`：创作台步骤组件、字幕和模板编辑组件。
- `frontend/src/api`：前端 API 封装。
- `backend/src/modules/tools`：音频、字幕、口型、包装成片、标题素材。
- `backend/src/modules/resources`：数字人、音色、字幕模板资源。
- `backend/src/modules/auth`：登录、注册、改密、找回密码。
- `backend/src/modules/admin`：管理员后台接口。
- `backend/src/database/database.service.ts`：SQLite/MySQL 表结构和兼容迁移。

## Canonical Docs

- `PROJECT_STATE.md`
- `TASK_BOARD.md`
- `ROADMAP.md`
- `AGENTS.md`
- `ACCEPTANCE.md`
- `docs/PRD.md`
- `docs/API.md`
- `docs/DATABASE.md`
- `docs/UI_GUIDE.md`
- `docs/DEPLOY.md`
- `docs/TEST_PLAN.md`
- `docs/CHANGELOG.md`

旧接口、旧任务页和历史调试流程不再写入本文档。
