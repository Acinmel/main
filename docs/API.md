# API Guide

## Base URL

鎵€鏈夊悗绔帴鍙ｇ粺涓€鍓嶇紑涓?`/api`銆?
| 鐜 | API Base |
|---|---|
| 鏈湴鍚庣 | `http://127.0.0.1:3000/api` |
| 鏈湴鍓嶇浠ｇ悊 | `/api`锛岀敱 Vite 杞彂鍒?`http://127.0.0.1:3000/api` |
| Docker Compose | `http://127.0.0.1:8080/api` |

## 閴存潈

闄?`@Public()` 鎺ュ彛澶栵紝鍏ㄩ儴鎺ュ彛闇€瑕侊細

```http
Authorization: Bearer <JWT>
```

鍏紑鎺ュ彛锛?
- `GET /api`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/tools/digital-human-env`
- `GET /api/v1/tools/lip-sync-public/:kind/:fileName/stream`
- `GET /api/v1/resources/voice-files/:fileName/provider-stream?token=...&expires=...`

## Health

生产收敛规则（BE-PROD-001）：
- `GET /api/health` 仅返回最小字段：`ok`、`app`、`version`。
- `GET /api/health/deep` 默认返回摘要：`ok`、`app`、`version`、`checks.<item>.ok`。
- `GET /api/health/deep` 详细模式仅在以下条件之一满足时返回：  
  1) 请求来自 loopback（`127.0.0.1` / `::1`）  
  2) 携带 `X-Health-Token` 且与服务端 `HEALTH_DEEP_TOKEN` 一致

| Method | Path | Auth | 用途 |
|---|---|---|---|
| GET | `/api/health` | Public | 公网最小健康检查 |
| GET | `/api/health/deep` | Public | 健康摘要（默认）或受控详细信息 |

示例：
```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/api/health/deep
curl -fsS -H "X-Health-Token: $HEALTH_DEEP_TOKEN" http://127.0.0.1:3000/api/health/deep
```

## Auth

| Method | Path | Auth | Body / Query | 杩斿洖 |
|---|---|---|---|---|
| POST | `/api/v1/auth/register` | Public | `{ "email": "...", "password": "..." }` | `{ token, user }` |
| POST | `/api/v1/auth/login` | Public | `{ "email": "...", "password": "..." }` | `{ token, user }` |
| GET | `/api/v1/auth/me` | JWT | 鏃?| `{ user }` |

鐧诲綍绀轰緥锛?
```bash
curl -fsS -X POST http://127.0.0.1:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## Tasks

鍏稿瀷娴佺▼锛?
1. `POST /api/v1/tasks`
2. `POST /api/v1/tasks/:id/photo`
3. `POST /api/v1/tasks/:id/extract`
4. 杞 `GET /api/v1/tasks/:id`
5. `GET /api/v1/tasks/:id/transcript`
6. `POST /api/v1/tasks/:id/rewrite/suggest`
7. `POST /api/v1/tasks/:id/rewrite`
8. `POST /api/v1/tasks/:id/render`
9. `GET /api/v1/tasks/:id/result`

| Method | Path | Auth | Body / Query | 鐢ㄩ€?|
|---|---|---|---|---|
| POST | `/api/v1/tasks` | JWT | `{ sourceVideoUrl, initialTranscript? }` | 鍒涘缓浠诲姟 |
| GET | `/api/v1/tasks/:id` | JWT | 鏃?| 鑾峰彇浠诲姟璇︽儏 |
| POST | `/api/v1/tasks/:id/photo` | JWT | multipart `file`锛屾渶澶?8MB | 涓婁紶褰㈣薄鐓х墖 |
| POST | `/api/v1/tasks/:id/extract` | JWT | 鏃?| 鍚姩鎻愬彇 |
| POST | `/api/v1/tasks/:id/retry` | JWT | 鏃?| 閲嶈瘯澶辫触浠诲姟 |
| GET | `/api/v1/tasks/:id/transcript` | JWT | 鏃?| 鑾峰彇杞啓缁撴灉 |
| POST | `/api/v1/tasks/:id/rewrite/suggest` | JWT | `{ style }` | 鑾峰彇鏀瑰啓寤鸿 |
| POST | `/api/v1/tasks/:id/rewrite` | JWT | `{ text, style }` | 淇濆瓨鏀瑰啓 |
| POST | `/api/v1/tasks/:id/render` | JWT | `{ mode, aspect, voiceStyleId, subtitleStyleId }` | 鎻愪氦娓叉煋 |
| GET | `/api/v1/tasks/:id/result` | JWT | 鏃?| 鑾峰彇鎴愮墖缁撴灉 |
| GET | `/api/v1/tasks/:id/download/subtitle` | JWT | 鏃?| 涓嬭浇 SRT |
| GET | `/api/v1/tasks/:id/download/script` | JWT | 鏃?| 涓嬭浇鑴氭湰 |

## Tools

| Method | Path | Auth | Body / Query | 鐢ㄩ€?|
|---|---|---|---|---|
| POST | `/api/v1/tools/generate-video-preview` | JWT | `{ script, sourceVideoUrl?, imageDataUrl?, imageUrl? }` | 鏂囨浼樺寲鍜岃棰戦瑙?|
| POST | `/api/v1/tools/seedance-i2v-async` | JWT | provider body | Seedance 鍥剧敓瑙嗛寮傛浠诲姟 |
| POST | `/api/v1/tools/ark-i2v-task` | JWT | `{ prompt, imageUrl, model? }` | Ark 鍥剧敓瑙嗛浠诲姟 |
| POST | `/api/v1/tools/upload-video` | JWT | multipart `file` | 涓婁紶瑙嗛 |
| POST | `/api/v1/tools/upload-audio` | JWT | multipart `file` | 涓婁紶闊抽 |
| POST | `/api/v1/tools/generate-tts-audio` | JWT | `{ text, voiceResourceId?, voice*? }` | 鐢熸垚 TTS 闊抽 |
| POST | `/api/v1/tools/generate-lip-sync-video` | JWT | `{ videoPath?, videoUrl?, audioPath?, audioUrl? }` | 鐢熸垚瀵瑰彛鍨嬭棰?|
| POST | `/api/v1/tools/ali-lip-sync` | JWT | multipart `video` | 涓婁紶瑙嗛骞惰皟鐢ㄩ樋閲屽鍙ｅ瀷 |
| POST | `/api/v1/tools/lip-sync-preview` | JWT | `{ script, avatarResourceId, voiceResourceId }` | 瀵瑰彛鍨嬮瑙?|
| GET | `/api/v1/tools/lip-sync-readiness` | JWT | 鏃?| 瀵瑰彛鍨嬭兘鍔涙鏌?|
| POST | `/api/v1/tools/voice-preview` | JWT | `{ script, voiceResourceId, voice*? }` | 配音试听任务创建（快速返回 `previewTaskId`） |
| GET | `/api/v1/tools/voice-preview-tasks/:taskId` | JWT | 鏃?| 查询配音试听任务状态 |
| POST | `/api/v1/tools/subtitle-workflow-preview` | JWT | `{ script, avatarResourceId, voiceResourceId, subtitleTemplateId?, subtitlesEnabled? }` | 瀛楀箷宸ヤ綔娴侀瑙?|
| POST | `/api/v1/tools/subtitle-workflow-finalize` | JWT | `{ draftId }` | 瀛楀箷宸ヤ綔娴佹垚鐗?|
| GET | `/api/v1/tools/digital-human-styles` | JWT | 鏃?| 鏁板瓧浜洪鏍煎垪琛?|
| GET | `/api/v1/tools/digital-human-template` | JWT | 鏃?| 褰撳墠鐢ㄦ埛鏁板瓧浜烘ā鏉?|
| GET | `/api/v1/tools/digital-human-image` | JWT | 鏃?| 褰撳墠鐢ㄦ埛鏁板瓧浜哄浘鐗?blob |
| DELETE | `/api/v1/tools/digital-human-template` | JWT | 鏃?| 鍒犻櫎褰撳墠鐢ㄦ埛鏁板瓧浜烘ā鏉?|
| POST | `/api/v1/tools/digital-human-generate` | JWT | multipart `selfie` + `styleId` | 鐢熸垚鏁板瓧浜哄舰璞?|
| GET | `/api/v1/tools/digital-human-env` | Public | 鏃?| 数字人能力环境探测（仅布尔能力位） |
| GET | `/api/v1/tools/dy-downloader-cookie` | JWT | 鏃?| 妫€鏌ユ姈闊?Cookie 鏄惁閰嶇疆 |
| POST | `/api/v1/tools/douyin-homepage-learn` | JWT | `{ homepageUrl }` | 瀛︿範鎶栭煶涓婚〉鏍锋湰 |
| GET | `/api/v1/tools/asr-health` | JWT | 鏃?| ASR 鍋ュ悍妫€鏌?|
| GET | `/api/v1/tools/transcribe-pipeline-health` | JWT | 鏃?| 杞啓閾捐矾鍋ュ悍妫€鏌?|
| GET | `/api/v1/tools/transcripts/:transcriptId` | JWT | 鏃?| 鑾峰彇宸蹭繚瀛?transcript |
| POST | `/api/v1/tools/transcribe` | JWT | multipart `file` | 涓婁紶闊宠棰戣浆鍐?|
| POST | `/api/v1/tools/douyin-transcribe-rewrite` | JWT | `{ sourceVideoUrl, rewriteStyle? }` | 鎶栭煶涓嬭浇銆佽浆鍐欍€佹敼鍐?|
| POST | `/api/v1/tools/transcribe-url` | JWT | `{ sourceVideoUrl }` | 閾炬帴涓嬭浇骞惰浆鍐?|
| POST | `/api/v1/tools/transcript-preview` | JWT | `{ sourceVideoUrl }` | 閾炬帴杞啓棰勮 |
| POST | `/api/v1/tools/optimize-oral-script` | JWT | `{ sourceText, sourceVideoUrl? }` | 鍙ｆ挱鏂囨浼樺寲 |
| POST | `/api/v1/tools/video-meta` | JWT | `{ sourceVideoUrl }` | 鎶撳彇瑙嗛鍏冧俊鎭?|
| POST | `/api/v1/tools/source-video-file` | JWT | `{ sourceVideoUrl, transcribe? }` | 涓嬭浇婧愯棰戝苟鍙€夎浆鍐?|
| GET | `/api/v1/tools/saved-videos` | JWT | 鏃?| 鍒楀嚭淇濆瓨鐨勮棰?|
| GET | `/api/v1/tools/saved-videos/:fileName/stream` | JWT | 鏃?| 璇诲彇淇濆瓨瑙嗛 |
| GET | `/api/v1/tools/preview-videos/:fileName/stream` | JWT | 鏃?| 璇诲彇棰勮瑙嗛 |
| GET | `/api/v1/tools/lip-sync-public/:kind/:fileName/stream` | Public | `kind=videos|audios` | provider 鍙闂獟浣撴祦 |
| GET | `/api/v1/tools/preview-audios/:fileName/stream` | JWT | `token`, `expires` | 读取预览音频（短期签名） |
| POST | `/api/v1/tools/transcribe-saved-video` | JWT | `{ fileName }` | 瀵瑰凡淇濆瓨瑙嗛杞啓 |

### Voice Preview Task

- `POST /api/v1/tools/voice-preview`
  - 行为：创建配音试听任务并快速返回，不阻塞等待 TTS 完成。
  - 关键返回字段：`previewTaskId`、`status`（`queued|running|succeeded|failed`）、`pollPath`。

- `GET /api/v1/tools/voice-preview-tasks/:taskId`
  - 行为：查询当前用户自己的试听任务状态。
  - 返回字段：`status`、`audioUrl`、`durationSeconds`、`hint`、`error`。

- `GET /api/v1/tools/preview-audios/:fileName/stream?token=...&expires=...`
  - 必须携带 JWT + 短期签名参数；签名与当前用户绑定，跨账号不可直接访问他人试听音频。

### Digital Human Env (BE-PROD-002)

- `GET /api/v1/tools/digital-human-env`
  - Auth: Public
  - 返回字段仅包含能力布尔位：
    - `arkConfigured`
    - `seedreamConfigured`
    - `remoteConfigured`
  - 不返回密钥长度、密钥片段或其它内部配置细节（例如 `arkKeyLength`）。

## Video Projects

| Method | Path | Auth | Body | 鐢ㄩ€?|
|---|---|---|---|---|
| POST | `/api/v1/video-projects/:projectId/detect-cut-points` | JWT | `{ mode, config, avatarResourceId?, sourceVideoUrl? }` | 妫€娴嬫櫤鑳藉壀杈戠偣 |
| POST | `/api/v1/video-projects/:projectId/render-final` | JWT | render payload | 鎻愪氦鏈€缁堝壀杈戞覆鏌?|
| GET | `/api/v1/render-tasks/:taskId` | JWT | 鏃?| 鏌ヨ娓叉煋浠诲姟 |

`render-final` 璇煶鍙傛暟绾﹀畾锛?
- 鎺ㄨ崘鍓嶇鍦?payload 椤跺眰浼?`voiceRate`锛岃寖鍥?`0.5` 鍒?`1.5`锛宍1.0` 琛ㄧず姝ｅ父璇€燂紱鐢ㄦ埛鏈€夋嫨鏃朵紶 `1.0` 鎴栦笉浼犮€?- 鍚庣鍏煎椤跺眰鍒悕 `speechRate` / `rate` 鍜屾棫缁撴瀯 `voiceTuning.speechRate`锛涘綋椤跺眰璇€熷弬鏁颁笌 `voiceTuning.speechRate` 鍚屾椂瀛樺湪鏃讹紝浠ラ《灞傚弬鏁颁负鍑嗐€?- 鍏朵粬鍙€夊弬鏁帮細`voiceLanguage` / `voiceTuning.language`銆乣voiceEmotion` / `voiceTuning.emotion`銆乣voiceEmotionIntensity`銆乣voiceVolume`銆乣voicePitch`銆?
## Resources

鍒楄〃 query锛?
- `scope=all|mine|recommended`
- `cursor=<cursor>`
- `limit=<number>`

鍝嶅簲绾﹀畾锛?- 瀛楀箷妯℃澘璧勬簮鐨?`coverUrl` / `previewCoverUrl` 鍙兘鏄緝闀跨殑 `data:image/svg+xml` URL锛屽鎴风搴旀寜鏅€氬浘鐗?URL 浣跨敤锛屼笉搴旀埅鏂€?- 澶村儚璧勬簮缁熶竴杩斿洖鐢熸垚鍒ゅ畾瀛楁锛歚canUseForRender`銆乣renderUnavailableReason`銆乣renderMode(source-video)`銆傚墠绔祫婧愰€夋嫨涓庣敓鎴愭寜閽鐢ㄨ浣跨敤杩欎簺瀛楁锛屼笉鍐嶄粎渚濊禆 `originalVideoUrl` 鏄惁闈炵┖銆?- 澹伴煶璧勬簮鐨?`audioUrl` 鍙〃绀哄彲鎾斁鐨勬牱鏈瑙堝湴鍧€锛涙帹鑽愰煶鑹叉湭鍐呯疆鏍锋湰鏃惰繑鍥炵┖瀛楃涓诧紝浣嗕粛鍙€氳繃 `providerVoice` 鍙備笌 TTS 鐢熸垚銆?- 鐢ㄦ埛涓婁紶鏍锋湰鍦ㄥ厠闅嗗け璐ユ椂浼氬洖閫€涓?`provider="local-upload"` 鐨勬湰鍦伴煶鑹诧紱璇ラ煶鑹插彲鐢ㄤ簬璇曞惉鍜屾渶缁堟垚鐗囷紝浣嗕細鐩存帴澶嶇敤涓婁紶闊抽锛屼笉浼氭寜鏂囨閲嶆柊 TTS锛屼篃涓嶄細搴旂敤 `voiceEmotion` / `voiceRate` 绛夊姩鎬佽闊冲弬鏁般€?- 澹伴煶璧勬簮缁熶竴杩斿洖鐢熸垚鍒ゅ畾瀛楁锛歚canUseForRender`銆乣renderUnavailableReason`銆乣renderMode(tts|sample-audio)`銆乣supportsDynamicTts`銆傚墠绔寜閽鐢ㄤ笌鎻愮ず璇风洿鎺ヤ娇鐢ㄨ繖浜涘瓧娈碉紝涓嶅啀閲嶅鎺ㄥ銆?
| Method | Path | Auth | Body / Query | 鐢ㄩ€?|
|---|---|---|---|---|
| GET | `/api/v1/resources/avatars` | JWT | `scope,cursor,limit` | 澶村儚璧勬簮鍒楄〃 |
| POST | `/api/v1/resources/avatars` | JWT | avatar body | 鍒涘缓澶村儚璧勬簮 |
| POST | `/api/v1/resources/avatars/upload` | JWT | multipart `file`, `name`, `coverUrl?`, `styleId?` | 涓婁紶澶村儚瑙嗛 |
| GET | `/api/v1/resources/avatars/upload-videos` | JWT | `limit?` | 仅返回当前用户“数字人上传视频”列表（不含抖音抓取/全局文件） |
| GET | `/api/v1/resources/avatar-video-files/:fileName/stream` | JWT | `Range?` | 当前用户数字人上传视频预览流（强归属校验，支持 206/416） |
| GET | `/api/v1/resources/avatar-video-files/:fileName/metadata` | JWT | 鏃?| 当前用户数字人上传视频元数据（不读取文件内容） |
| PATCH | `/api/v1/resources/avatars/:id` | JWT | `{ name }` | 閲嶅懡鍚嶅ご鍍?|
| DELETE | `/api/v1/resources/avatars/:id` | JWT | 鏃?| 鍒犻櫎澶村儚 |
| POST | `/api/v1/resources/avatars/batch-delete` | JWT | `{ ids }` | 鎵归噺鍒犻櫎澶村儚 |
| GET | `/api/v1/resources/voices` | JWT | `scope,cursor,limit` | 澹伴煶璧勬簮鍒楄〃 |
| POST | `/api/v1/resources/voices` | JWT | voice body锛屽繀椤诲寘鍚?`audioUrl` 鎴?`providerVoice` | 鍒涘缓澹伴煶璧勬簮 |
| POST | `/api/v1/resources/voices/clone` | JWT | voice clone body | 鍏嬮殕澹伴煶 |
| POST | `/api/v1/resources/voices/clone-upload` | JWT | multipart `file`, `name` | 涓婁紶鏍锋湰鍏嬮殕澹伴煶 |
| PATCH | `/api/v1/resources/voices/:id` | JWT | `{ name }` | 閲嶅懡鍚嶅０闊?|
| DELETE | `/api/v1/resources/voices/:id` | JWT | 鏃?| 鍒犻櫎澹伴煶 |
| POST | `/api/v1/resources/voices/batch-delete` | JWT | `{ ids }` | 鎵归噺鍒犻櫎澹伴煶 |
| GET | `/api/v1/resources/voice-files/:fileName/stream` | JWT | 鏃?| 璇诲彇澹伴煶鏍锋湰 |
| GET | `/api/v1/resources/voice-files/:fileName/provider-stream` | Public | `token,expires` | provider 璇诲彇澹伴煶鏍锋湰 |
| GET | `/api/v1/resources/subtitle-templates` | JWT | `scope,cursor,limit` | 瀛楀箷妯℃澘鍒楄〃 |
| POST | `/api/v1/resources/subtitle-templates` | JWT | subtitle body | 鍒涘缓瀛楀箷妯℃澘 |
| POST | `/api/v1/resources/subtitle-templates/:id/copy` | JWT | 鏃?| 澶嶅埗瀛楀箷妯℃澘 |
| PATCH | `/api/v1/resources/subtitle-templates/:id` | JWT | subtitle body | 鏇存柊瀛楀箷妯℃澘 |
| DELETE | `/api/v1/resources/subtitle-templates/:id` | JWT | 鏃?| 鍒犻櫎瀛楀箷妯℃澘 |
| POST | `/api/v1/resources/subtitle-templates/batch-delete` | JWT | `{ ids }` | 鎵归噺鍒犻櫎瀛楀箷妯℃澘 |

### Avatar Upload Videos (BE-016)

- `GET /api/v1/resources/avatars/upload-videos?limit=30`
  - Auth: JWT
  - 仅返回当前登录用户通过 `POST /api/v1/resources/avatars/upload` 上传并落库到 `avatar_resources` 的视频。
  - 返回项包含：`avatarId`、`avatarName`、`fileName`、`fileSize`、`mimeType`、`mtime`、`previewUrl`、`metadataUrl`。
  - 不返回 `source-video-file` 或 `*_douyin_dy_video.mp4` 等全局 saved-videos 文件。

- `GET /api/v1/resources/avatar-video-files/:fileName/stream`
  - Auth: JWT
  - 仅允许访问当前用户 own 的 `avatar-upload_*` 文件；跨用户或非法文件名返回 `404`。
  - 支持 `Range: bytes=start-end`，可返回 `206 Partial Content`、`Content-Range`、`Accept-Ranges: bytes`；非法或越界 Range 返回 `416` 和 `Content-Range: bytes */<size>`。

- `GET /api/v1/resources/avatar-video-files/:fileName/metadata`
  - Auth: JWT
  - 仅返回当前用户 own 的 `avatar-upload_*` 文件元数据：`fileSize`、`mimeType`、`mtime`、`previewUrl`、`metadataUrl`；不会读取视频文件内容。

- `POST /api/v1/resources/avatars`
  - 当 `originalVideoUrl` 为本地文件名时，仅允许 `avatar-upload_*` 且必须归属当前用户，否则返回 `403`。

### Recent Extractions（最近提取记录）

- `GET /api/v1/tools/recent-extractions?limit=6`
  - Auth: JWT
  - 仅返回当前登录用户自己的提取记录（按 `user_id` 过滤）。
  - `limit` 默认 `6`，最大 `20`。

- `POST /api/v1/tools/recent-extractions`
  - Auth: JWT
  - Body:
    - `sourceUrl` (required)
    - `platform`, `title`, `summary`, `coverUrl`, `videoUrl`, `extractedAt` (optional)
  - 行为：按 `(user_id, sourceUrl)` 去重 upsert，不会写入其他用户记录。

## Works

| Method | Path | Auth | Body / Query | 鐢ㄩ€?|
|---|---|---|---|---|
| GET | `/api/v1/works` | JWT | `page?`, `limit?` | 鎴戠殑浣滃搧 |
| PATCH | `/api/v1/works/:id` | JWT | `{ title?, content? }` | 鏇存柊浣滃搧鏍囬鍜屽娉?|

## Admin

鎵€鏈夊悗鍙版帴鍙ｉ渶瑕?JWT锛屽苟閫氳繃 `AdminRoleGuard`銆?
| Method | Path | Body / Query | 鐢ㄩ€?|
|---|---|---|---|
| GET | `/api/v1/admin/stats` | 鏃?| 鍏ㄥ眬缁熻 |
| GET | `/api/v1/admin/users` | `q?`, `limit?`, `offset?` | 鐢ㄦ埛鍒楄〃 |
| PATCH | `/api/v1/admin/users/:id` | `{ role?, accountStatus? }` | 淇敼鐢ㄦ埛瑙掕壊鎴栫姸鎬?|
| GET | `/api/v1/admin/audit-logs` | `q?`, `limit?`, `offset?` | 瀹¤鏃ュ織 |
| GET | `/api/v1/admin/user-works` | `q?`, `limit?`, `offset?` | 鐢ㄦ埛浣滃搧 |
| GET | `/api/v1/admin/digital-human-templates` | `q?`, `limit?`, `offset?` | 鏁板瓧浜烘ā鏉?|
| GET | `/api/v1/admin/resources` | `kind=avatars|voices|subtitle-templates`, `q?`, `limit?`, `offset?` | 璧勬簮鍒楄〃 |

## 閿欒绾﹀畾

- 鍙傛暟閿欒锛歚400`
- 鏈櫥褰曟垨 token 鏃犳晥锛歚401`
- 璐﹀彿鏈縺娲绘垨鏉冮檺涓嶈冻锛歚403`
- 璧勬簮涓嶅瓨鍦細`404`
- 闄愭祦锛歚429`
- 澶栭儴鏈嶅姟鎴栧唴閮ㄩ敊璇細`500`

鍚庣宸插惎鐢ㄥ熀纭€闄愭祦锛岄粯璁わ細

- auth锛氭瘡绐楀彛 20 娆°€?- tools锛氭瘡绐楀彛 60 娆°€?- general锛氭瘡绐楀彛 600 娆°€?
