# Database Guide

## 鏁版嵁搴撴ā寮?
鍚庣閫氳繃 `backend/src/database/database.service.ts` 绠＄悊鎸佷箙鍖栥€?
杩愯绛栫暐锛?
- 璁剧疆 `MYSQL_DATABASE` 鏃朵娇鐢?MySQL銆?- 鏈缃?`MYSQL_DATABASE` 鏃跺洖閫€鍒?SQLite銆?- MySQL 鐢ㄤ簬鐢熶骇鍜?Docker Compose銆?- SQLite 鐢ㄤ簬鏈湴闆朵緷璧栬皟璇曘€?
榛樿 Docker Compose锛?
- Host锛歚mysql`
- Port锛歚3306`
- Database锛歚koubo`
- User锛歚koubo`
- Password锛歚koubo`

## 杩炴帴姹?
MySQL 浣跨敤 `mysql2/promise` pool銆?
| 閰嶇疆 | 榛樿鍊?| 璇存槑 |
|---|---:|---|
| `MYSQL_HOST` | `127.0.0.1` 鎴?compose 涓?`mysql` | 鏁版嵁搴撳湴鍧€ |
| `MYSQL_PORT` | `3306` | 鏁版嵁搴撶鍙?|
| `MYSQL_USER` | `root` | 鐢ㄦ埛鍚?|
| `MYSQL_PASSWORD` | 绌?| 瀵嗙爜 |
| `MYSQL_DATABASE` | 鏃?| 鏈夊€煎垯鍚敤 MySQL |
| `MYSQL_CONNECTION_LIMIT` | `10` | 杩炴帴姹犱笂闄?|
| `SQLITE_PATH` | `backend/data/app.db` | SQLite 鏂囦欢璺緞 |

## 琛ㄧ粨鏋?
### users

鐢ㄩ€旓細鐢ㄦ埛璐﹀彿銆佽鑹插拰璐﹀彿鐘舵€併€?
| 瀛楁 | MySQL | SQLite | 璇存槑 |
|---|---|---|---|
| `id` | `VARCHAR(36) PRIMARY KEY` | `TEXT PRIMARY KEY` | 鐢ㄦ埛 ID |
| `email` | `VARCHAR(255) UNIQUE NOT NULL` | `TEXT UNIQUE NOT NULL` | 鐧诲綍閭 |
| `password_hash` | `VARCHAR(255) NOT NULL` | `TEXT NOT NULL` | bcrypt hash |
| `created_at` | `VARCHAR(64) NOT NULL` | `TEXT NOT NULL` | ISO 鏃堕棿 |
| `role` | `VARCHAR(16) DEFAULT 'user'` | `TEXT DEFAULT 'user'` | `user` 鎴?`admin` |
| `account_status` | `VARCHAR(16) DEFAULT 'active'` | `TEXT DEFAULT 'active'` | `pending`銆乣active`銆乣disabled` |

绱㈠紩锛?
- `uq_users_email`
- `idx_users_created`

### digital_human_templates

鐢ㄩ€旓細姣忎釜鐢ㄦ埛淇濆瓨涓€涓暟瀛椾汉妯℃澘銆?
| 瀛楁 | 璇存槑 |
|---|---|
| `user_id` | 涓婚敭锛屽叧鑱?`users.id` |
| `style_id` | 鏁板瓧浜洪鏍?|
| `output_relative_path` | 鐢熸垚鍥剧浉瀵硅矾寰?|
| `selfie_relative_path` | 鑷媿鐓х浉瀵硅矾寰?|
| `created_at` | 鍒涘缓鏃堕棿 |
| `updated_at` | 鏇存柊鏃堕棿 |

绾︽潫涓庣储寮曪細

- `user_id` 澶栭敭锛岀敤鎴峰垹闄ゆ椂绾ц仈鍒犻櫎銆?- `idx_dh_templates_updated`

### user_works

鐢ㄩ€旓細鐢ㄦ埛浣滃搧鍜屼换鍔′骇鍑烘矇娣€銆?
| 瀛楁 | 璇存槑 |
|---|---|
| `id` | 浣滃搧 ID |
| `user_id` | 鎵€灞炵敤鎴?|
| `title` | 鏍囬 |
| `content` | 澶囨敞鎴栬鏄?|
| `transcript_text` | 杞啓鏂囨湰 |
| `rewrite_text` | 鏀瑰啓鏂囨湰 |
| `source_video_url` | 婧愯棰?URL |
| `output_video_url` | 鎴愮墖 URL |
| `digital_human_style_id` | 鏁板瓧浜洪鏍?|
| `status` | 浠诲姟/浣滃搧鐘舵€?|
| `task_payload_json` | 浠诲姟蹇収 JSON |
| `created_at` | 鍒涘缓鏃堕棿 |
| `updated_at` | 鏇存柊鏃堕棿 |

绱㈠紩锛?
- `idx_user_works_user`
- `idx_user_works_user_updated`
- `idx_user_works_updated`

### task_statuses

鐢ㄩ€旓細闀夸换鍔＄姸鎬佺紦瀛樻垨鎸佷箙鍖栬褰曘€?
| 瀛楁 | 璇存槑 |
|---|---|
| `id` | 浠诲姟鐘舵€?ID |
| `user_id` | 鐢ㄦ埛 ID |
| `kind` | 浠诲姟绫诲瀷 |
| `status` | `pending`銆乣processing`銆乣completed`銆乣failed` |
| `progress` | 0 鍒?100 |
| `payload_json` | 鍏ュ弬蹇収 |
| `result_json` | 缁撴灉 |
| `error` | 閿欒淇℃伅 |
| `created_at` | 鍒涘缓鏃堕棿 |
| `updated_at` | 鏇存柊鏃堕棿 |
| `expires_at` | 杩囨湡鏃堕棿 |

绱㈠紩锛?
- `idx_task_statuses_user_updated`
- `idx_task_statuses_status_updated`
- `idx_task_statuses_expires`

补充约定：
- `kind=voice-preview` 用于配音试听异步任务。
- 该类任务状态使用 `queued`、`running`、`succeeded`、`failed`，并复用 `result_json` 保存 `fileName/durationSeconds/hint/ttsMode/voiceLabel`。

### avatar_resources

鐢ㄩ€旓細澶村儚/鏁板瓧浜鸿棰戣祫婧愩€?
| 瀛楁 | 璇存槑 |
|---|---|
| `id` | 璧勬簮 ID |
| `user_id` | 鐢ㄦ埛 ID锛岀┖琛ㄧず鎺ㄨ崘璧勬簮 |
| `name` | 鍚嶇О |
| `is_recommended` | 鏄惁鎺ㄨ崘 |
| `cover_url` | 灏侀潰 |
| `source_video_url` | 婧愯棰?|
| `style_id` | 椋庢牸 |
| `expires_at` | 鐢ㄦ埛涓婁紶璧勬簮杩囨湡鏃堕棿 |
| `created_at` | 鍒涘缓鏃堕棿 |
| `updated_at` | 鏇存柊鏃堕棿 |

绱㈠紩锛?
- `idx_avatar_resources_user`
- `idx_avatar_resources_updated`
- `idx_avatar_resources_user_updated`
- `idx_avatar_resources_rec_updated`
- `idx_avatar_resources_expires`

补充约定（BE-016）：
- `source_video_url` 若为本地上传视频文件名，仅允许 `avatar-upload_*` 命名作为“添加数字人-已保存视频”来源。
- “添加数字人-已保存视频”列表必须按 `avatar_resources.user_id` 过滤，只返回当前用户资源，不可回退到全局目录枚举。

### voice_resources

鐢ㄩ€旓細澹伴煶璧勬簮鍜屽０闊冲厠闅嗗厓鏁版嵁銆?
| 瀛楁 | 璇存槑 |
|---|---|
| `id` | 璧勬簮 ID |
| `user_id` | 鐢ㄦ埛 ID锛岀┖琛ㄧず鎺ㄨ崘璧勬簮 |
| `name` | 鍚嶇О |
| `is_recommended` | 鏄惁鎺ㄨ崘 |
| `audio_url` | 闊抽鏍锋湰棰勮 URL锛屽彲涓虹┖锛涗笉鍐嶄娇鐢ㄥ閮ㄩ煶涔愪綔涓哄厹搴?|
| `clone_status` | `ready`銆乣processing`銆乣failed` 绛?|
| `provider` | provider 鍚嶇О |
| `provider_voice` | provider voice ID |
| `provider_model` | provider model |
| `sample_duration_ms` | 鏍锋湰鏃堕暱 |
| `clone_error` | 鍏嬮殕澶辫触鍘熷洜 |
| `expires_at` | 鐢ㄦ埛涓婁紶璧勬簮杩囨湡鏃堕棿 |
| `created_at` | 鍒涘缓鏃堕棿 |
| `updated_at` | 鏇存柊鏃堕棿 |

绱㈠紩锛?
- `idx_voice_resources_user`
- `idx_voice_resources_updated`
- `idx_voice_resources_user_updated`
- `idx_voice_resources_rec_updated`
- `idx_voice_resources_expires`

### subtitle_template_resources

鐢ㄩ€旓細瀛楀箷妯℃澘璧勬簮銆?
| 瀛楁 | 璇存槑 |
|---|---|
| `id` | 妯℃澘 ID |
| `user_id` | 鐢ㄦ埛 ID锛岀┖琛ㄧず鎺ㄨ崘妯℃澘 |
| `name` | 鍚嶇О |
| `is_recommended` | 鏄惁鎺ㄨ崘 |
| `cover_url` | 灏侀潰 |
| `preview_url` | 棰勮 URL |
| `style_json` | 瀛楀箷鏍峰紡 JSON |
| `created_at` | 鍒涘缓鏃堕棿 |
| `updated_at` | 鏇存柊鏃堕棿 |

瀛楁绫诲瀷绾﹀畾锛?- MySQL 涓?`cover_url` 鍜?`preview_url` 浣跨敤 `LONGTEXT`锛岀敤浜庡吋瀹规帹鑽愬瓧骞曟ā鏉跨殑鍐呰仈 SVG data URL銆?- MySQL 涓?`style_json` 浣跨敤 `LONGTEXT NOT NULL`锛屾棫琛ㄥ惎鍔ㄨ縼绉绘椂浼氳ˉ榻愮┖鍊间负 `{}`銆?
绱㈠紩锛?
- `idx_subtitle_template_resources_user`
- `idx_subtitle_template_resources_updated`
- `idx_subtitle_template_resources_user_updated`
- `idx_subtitle_template_resources_rec_updated`

### audit_logs

鐢ㄩ€旓細鐢ㄦ埛鍏抽敭鎿嶄綔瀹¤銆?
| 瀛楁 | 璇存槑 |
|---|---|
| `id` | 瀹¤ ID |
| `user_id` | 鐢ㄦ埛 ID |
| `action` | 鎿嶄綔绫诲瀷 |
| `detail` | 鎿嶄綔璇︽儏 |
| `ip` | 璇锋眰 IP |
| `created_at` | 鍒涘缓鏃堕棿 |

绱㈠紩锛?
- `idx_audit_logs_user`
- `idx_audit_logs_user_action`
- `idx_audit_logs_action`
- `idx_audit_logs_created`

## 杩佺Щ瑙勫垯

- 褰撳墠杩佺Щ鍦ㄥ簲鐢ㄥ惎鍔ㄦ椂鎵ц銆?- 鏂板瓧娈靛繀椤诲悓鏃惰ˉ MySQL 鍜?SQLite銆?- 鏂板瓧娈靛繀椤诲叿澶囬粯璁ゅ€兼垨鍏煎鏃ф暟鎹殑 `ALTER TABLE` 閫昏緫銆?- 鏂拌〃蹇呴』鍚屾椂鍐欏叆 `migrateMysql()` 鍜?`migrateSqlite()`銆?- 宸蹭笂绾垮瓧娈典笉鐩存帴鏀瑰悕锛屾柊澧炲瓧娈靛悗杩佺Щ鏁版嵁锛屽啀鍒犻櫎鏃у瓧娈点€?
## 鏌ヨ瑙勫垯

- 鍒楄〃鎺ュ彛蹇呴』闄愬埗 `limit`锛屽悗鍙伴粯璁?30 鍒?80锛岀敤鎴疯祫婧愭渶澶т笉搴旇秴杩?100銆?- 璧勬簮鍒楄〃浣跨敤 cursor 鎴?offset 鏃跺繀椤讳緷璧栧搴旂储寮曘€?- 绠＄悊鍚庡彴妯＄硦鎼滅储搴旈伩鍏嶅叏琛ㄥぇ鑼冨洿鎵弿锛屽悗缁彲寮曞叆鍏ㄦ枃绱㈠紩鎴栨悳绱㈡湇鍔°€?- 楂橀鐘舵€佹煡璇紭鍏堟煡 `task_statuses.id` 鎴?`task_statuses_user_updated`銆?
## 澶囦唤涓庢仮澶?
Docker Compose 鏁版嵁鍗凤細

- `mysql_data`锛歁ySQL 鏁版嵁銆?- `uploads_data`锛氫笂浼犳枃浠躲€?- `video_downloads`锛氫繚瀛樼殑婧愯棰戙€?- `digital_human_storage`锛氭暟瀛椾汉鍥剧墖鍜岃嚜鎷嶇収銆?
鐢熶骇鍥炴粴涓嶅緱鍒犻櫎浠ヤ笂鏁版嵁鍗枫€?
MySQL 澶囦唤绀轰緥锛?
```bash
docker compose exec mysql mysqldump -ukoubo -p koubo > backup.sql
```

MySQL 鎭㈠绀轰緥锛?
```bash
docker compose exec -T mysql mysql -ukoubo -p koubo < backup.sql
```

## Agent 淇敼鏁版嵁搴撴椂蹇呴』鍚屾

- `backend/src/database/database.service.ts`
- `docs/DATABASE.md`
- `docs/API.md`，如果接口响应结构变化
- `docs/TEST_PLAN.md`，如果新增验证路径

### recent_extractions

鐢ㄩ€旓細鍒涗綔椤点€屾渶杩戞彁鍙栬褰曘€嶏紝鎸夌敤鎴烽殧绂汇€?
| 瀛楁 | 璇存槑 |
|---|---|
| `id` | 璁板綍 ID |
| `user_id` | 鎵€灞炵敤鎴凤紙澶栭敭锛?|
| `source_url` | 鎻愬彇鏉ユ簮閾炬帴 |
| `platform` | 骞冲彴鍚嶇О |
| `title` | 鏍囬 |
| `summary` | 鎽樿 |
| `cover_url` | 灏侀潰鍥鹃摼鎺?|
| `video_url` | 瑙嗛閾炬帴 |
| `extracted_at` | 鎻愬彇鏃堕棿 |
| `created_at` | 鍒涘缓鏃堕棿 |
| `updated_at` | 鏇存柊鏃堕棿 |

绾︽潫涓庣储寮曪細
- 唯一键：`(user_id, source_url)`，同用户重复提取时做 upsert。
- 索引：`idx_recent_extractions_user_extracted`、`idx_recent_extractions_user_updated`。
