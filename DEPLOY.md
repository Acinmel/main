# Shuziren Project Overview

本项目是 AI 数字人口播视频生成平台。当前阶段为 V1.0 后优化与稳定性迭代。

## Core Flow

1. 用户准备文案。
2. 生成或上传音频资产。
3. 生成秒级字幕时间轴。
4. 使用当前用户的数字人视频生成口型视频。
5. 选择或编辑字幕/标题模板。
6. 最终包装成片：字幕烧录、标题叠加、音视频对齐、输出发布。

## Current Documentation

- 产品需求：`docs/PRD.md`
- 接口：`docs/API.md`
- 数据库：`docs/DATABASE.md`
- UI 规则：`docs/UI_GUIDE.md`
- 部署：`docs/DEPLOY.md`
- 测试：`docs/TEST_PLAN.md`
- 性能：`docs/PERFORMANCE.md`
- 队列和异步任务：`docs/QUEUE.md`
- 变更记录：`docs/CHANGELOG.md`

## Deployment Boundary

- local 和 staging 可以自动构建、测试、部署。
- production 发布、重启、回滚、数据库破坏性变更和真实付费 provider 调用必须人工确认。
- 旧的源码直连生产部署说明不再作为默认流程；以 `docs/DEPLOY.md` 为准。
