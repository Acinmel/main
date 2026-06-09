# Database

## Storage Engines

- 本地开发默认 SQLite。
- 生产部署使用 MySQL。
- `DatabaseService` 在启动时创建缺失表、索引和兼容字段。
- 生产破坏性变更必须人工确认，且必须有备份和回滚方案。

## Core Tables

### users

用户、角色和账号状态表。

关键字段：

- `id`
- `username`
- `password_hash`
- `role`
- `account_status`
- `phone_number`
- `id_card_hash`
- `id_card_last4`
- `created_at`
- `updated_at`

规则：

- 普通新注册用户默认不可使用核心功能。
- `phone_number` 和身份证哈希只用于找回密码，不在接口中返回完整身份证信息。

### avatar_resources

数字人视频资源表。

关键字段：

- `id`
- `user_id`
- `name`
- `file_url`
- `video_cover_url`
- `video_duration_seconds`
- `video_oss_key`
- `asset_status`
- `is_recommended`
- `created_at`
- `updated_at`

规则：

- 用户私有数字人视频必须有 `user_id`。
- 推荐数字人可为空用户归属，但读取时必须明确标记推荐。
- 视频流接口按当前用户和推荐标记校验权限。

### voice_resources

音色资源表。

关键字段：

- `id`
- `user_id`
- `name`
- `sample_url`
- `provider`
- `provider_voice`
- `provider_model`
- `sample_duration_ms`
- `clone_error`
- `is_recommended`
- `created_at`
- `updated_at`

规则：

- 用户只看到自己的音色和推荐音色。
- 找不到音频文件的音色不应继续在前端显示为可用。

### subtitle_template_resources

字幕模板资源表。

关键字段：

- `id`
- `user_id`
- `name`
- `cover_url`
- `preview_url`
- `style_json`
- `style_config_json`
- `base_template_id`
- `is_recommended`
- `created_at`
- `updated_at`

规则：

- 公版模板：`is_recommended=1`，只读。
- 用户副本：`user_id=currentUserId`，`base_template_id` 指向公版或被复制模板。
- 最终成片优先读取 `style_config_json`，兼容旧 `style_json`。
- 模板预览图不能使用内联 `data:image` 作为生产数据。

### video_projects

创作任务主表。每一条记录表示用户的一次视频创作容器。

关键字段：

- `id`
- `user_id`
- `name`
- `status`
- `archived_at`
- `created_at`
- `updated_at`

状态：

- `active`
- `archived`

规则：

- `id` 是唯一数据关联点；任务名 `name` 可重复，只用于展示和搜索。
- 所有读写必须按 `user_id + id` 校验归属。
- 第一阶段创建任务后，音频、字幕、口型、模板和包装成片都写入同一个 `projectId`（后续任务继续落地）。
- 不允许按音频名称、文案 hash、数字人视频、爬取链接或画幅自动匹配其他任务结果。
- `task_statuses` 只表示异步执行任务，不替代 `video_projects`。

### audio_assets

音频资产表。

关键字段：

- `id`
- `user_id`
- `project_id`
- `source_type`
- `voice_resource_id`
- `text_hash`
- `file_url`
- `duration_seconds`
- `status`
- `error_message`
- `metadata_json`
- `created_at`
- `updated_at`

规则：

- TTS 和上传音频都要登记为音频资产。
- 后续字幕、口型和包装成片都引用 `audio_assets.id`。

### subtitle_tracks

字幕时间轴表。

关键字段：

- `id`
- `user_id`
- `project_id`
- `audio_asset_id`
- `source_type`
- `status`
- `full_text`
- `cues_json`
- `error_message`
- `created_at`
- `updated_at`

规则：

- `cues_json` 保存秒级 `startTime/endTime/text`。
- 用户手动修改字幕时间后，最终成片必须读取最新 `cues_json`。

### digital_human_video_assets

口型视频资产表。

关键字段：

- `id`
- `user_id`
- `project_id`
- `avatar_resource_id`
- `audio_asset_id`
- `source_task_id`
- `render_mode`
- `file_url`
- `duration_seconds`
- `status`
- `error_message`
- `metadata_json`
- `created_at`
- `updated_at`

规则：

- 第二步预览和第三步包装成片以 `digitalHumanVideoAssetId` 为主要引用。
- 复用查询必须按 `user_id + project_id + avatar_resource_id + audio_asset_id + render_mode + status` 匹配。
- 文件缺失或源任务失败时不能复用。

### video_project_stage_states

创作台阶段状态表。

关键字段：

- `id`
- `user_id`
- `project_id`
- `audio_asset_id`
- `subtitle_track_id`
- `avatar_resource_id`
- `render_mode`
- `lipsync_task_id`
- `digital_human_video_asset_id`
- `script_hash`
- `state_json`
- `created_at`
- `updated_at`

规则：

- `user_id + project_id` 唯一。
- 保存当前项目已完成的阶段结果，不替代 `video_projects` 和资产表。
- 恢复时先读 stage state，再用资产表校验可复用性。
- 新流程的 `project_id` 必须来自 `video_projects.id`；`studio-current` 只允许作为遗留兼容值。

### video_scripts

文案、视觉样式和 mark 表。

关键字段：

- `id`
- `user_id`
- `script_text`
- `marks_json`
- `visual_style_json`
- `created_at`
- `updated_at`

规则：

- `marks_json` 支持 `highlight` 和 `title_effect`。
- 标题 mark 删除后，对应标题素材应标记为不参与最终合成。

### video_title_asset

标题透明素材表。

关键字段：

- `id`
- `user_id`
- `video_id`
- `mark_id`
- `text`
- `template_id`
- `theme_id`
- `start_time`
- `end_time`
- `duration`
- `position`
- `status`
- `transparent_asset_url`
- `preview_url`
- `layout_json`
- `is_active`
- `error_message`
- `created_at`
- `updated_at`

规则：

- 标题素材生成是异步任务。
- `status` 使用 `pending|processing|success|failed`。
- 透明素材失败不影响文案保存和字幕高亮。

### task_statuses

异步任务状态表。

关键字段：

- `id`
- `user_id`
- `kind`
- `status`
- `progress`
- `result_json`
- `error_message`
- `dedupe_key`
- `expires_at`
- `created_at`
- `updated_at`

现行任务类型：

- `video-lipsync`
- `video-package`
- `video-render`
- `pd-event`

规则：

- 高成本任务必须有幂等键或复用策略。
- `video-lipsync` 支持近期 completed 复用，避免重复付费调用。

### recent_extractions

最近提取记录表。

规则：

- 必须按 `user_id` 查询。
- 不允许任何账号看到其他账号的提取记录。

### saved_videos

已保存视频表。

规则：

- 仅保留当前用户可用的视频引用。
- 新功能优先使用 `avatar_resources` 和 `digital_human_video_assets`，避免继续扩散旧 saved video 语义。

### oss_upload_grants

前端直传授权表。

规则：

- 每个授权绑定当前用户、对象 key、过期时间和状态。
- 上传完成后必须登记到对应业务资产表。

### audit_logs

审计日志表。

规则：

- 记录管理员操作、权限变更、敏感资源变更和关键失败。

## Required Indexes

- `idx_audio_assets_user_project_updated`
- `idx_subtitle_tracks_user_project`
- `idx_dvh_assets_reuse_lookup`
- `idx_video_project_stage_states_user_project`
- `idx_video_projects_user_updated`
- `idx_video_projects_user_status_updated`
- `idx_video_title_asset_user_video`
- `idx_video_title_asset_active_time`
- `idx_avatar_resources_user_updated`
- `idx_voice_resources_user_updated`
- `idx_subtitle_template_resources_user_updated`
- `idx_task_statuses_user_updated`
- `idx_task_statuses_status_updated`

## Migration Rules

- 非破坏性新增字段和索引可以自动迁移。
- 删除表、删字段、改字段类型、批量删除生产数据必须人工确认。
- 修改表结构后同步更新本文件、`docs/API.md` 和测试计划。
- 推荐模板预览 URL 可执行非破坏性回填：

```bash
npm run backfill:subtitle-template-urls
npm run check:subtitle-template-db
```

## task_statuses 补充（BE-077）

- `video-lipsync` 任务状态支持 `provider_running`（provider 仍在处理、可恢复态）。
- `provider_running` 时，`task_statuses.result_json.provider` 持久化 provider 恢复上下文（`name/requestId/taskId/taskStatus/inputMode/videoUrl/audioUrl/submittedAt/lastPolledAt/recoverUntil/inputMeta/sourceContract/preparedContract/audioContract/lastResponse`）。

## Local Checks

```bash
npm run check:staged-db
npm run check:subtitle-template-db
npm --prefix backend run test
npm --prefix backend run build
```
