# API

## Core Flow API Contract

Only project-scoped current APIs are allowed in the core flow.

1. Script and project
   - `POST /api/v1/tools/transcript-preview`, or the Douyin download/transcribe flow, extracts the script.
   - `POST /api/v1/video-projects` creates the project.
   - `POST /api/v1/video-script/save` saves the current project script.
   - `PUT /api/v1/video-projects/:projectId/stage-state` saves `scriptHash`.
2. Voice and audio
   - `POST /api/v1/resources/voices/clone` or `POST /api/v1/resources/voices/clone-upload` creates/imports a user voice.
   - `POST /api/v1/audio-assets/generate` generates the current project audio. This is the canonical audio entrypoint.
   - `projectId` is required and must be a real `video_projects.id` (legacy `studio-current` is not allowed on this endpoint).
   - `POST /api/v1/tools/voice-preview` is a legacy endpoint and returns `410` by default. Do not use it in the core flow.
3. Subtitle timeline
   - `POST /api/v1/audio-assets/:id/subtitle-track` must include the current `projectId`, `scriptText`, and `scriptSegments`.
   - `projectId` is required and must be a real `video_projects.id` (legacy `studio-current` is not allowed on this endpoint).
   - Explicit subtitle generation must return `source=tts_alignment`.
   - Subtitle count must equal `scriptSegments.length`.
   - `GET /api/v1/subtitle-tracks/:id` must read the new `subtitleTrackId` returned by the POST call.
4. Lip-sync video
   - `POST /api/v1/video-projects/:projectId/lipsync-tasks` creates the lip-sync task.
   - `GET /api/v1/render-tasks/:taskId` reads task status.
   - Success must write `digitalHumanVideoAssetId` and stage-state.
5. Subtitle template and final package render
   - `GET /api/v1/resources/subtitle-templates` lists available templates.
   - `POST /api/v1/video-projects/:projectId/package-render-tasks` renders the final video from the current lip-sync video, subtitle track, and template style.
   - Package render validates asset consistency: `subtitleTrackId` and `digitalHumanVideoAssetId` must match the current `audioAssetId`.

Forbidden in the core flow:

- Do not call legacy `POST /api/v1/tasks`, `POST /api/v1/tools/voice-preview`, `POST /api/v1/tools/lip-sync-preview`, or `POST /api/v1/tools/ali-lip-sync`.
- Do not use `studio-current`, audio name, script text, avatar name, or source URL to auto-restore a lip-sync video.

## 2026-05-26 LipSync Source Format Contract

- `POST /api/v1/video-projects/:projectId/lipsync-tasks` 鍦ㄦ湭鏄惧紡閫夋嫨杈撳嚭鐢诲箙鏃讹紝榛樿涓斿繀椤讳娇鐢?`renderMode=preserveSourceAspect`銆?- 鍚庣鍦ㄦ彁浜ゅ彛鍨?provider 鍓嶅繀椤昏褰曟簮瑙嗛/棰勫鐞嗚棰戠殑 ffprobe 鎽樿锛歝ontainer銆亀idth銆乭eight銆乧oded_width銆乧oded_height銆丼AR/DAR銆乫ps銆乸ix_fmt銆乧olor_range銆乧olor_space銆乧olor_transfer銆乧olor_primaries銆乤udio streams銆乨uration銆?- provider 杩斿洖缁撴灉鍙兘浣滀负涓存椂鏂囦欢锛涙渶缁堝啓鍏?`digital_human_video_assets` 鍜岀粰鍓嶇棰勮鐨勬枃浠跺繀椤绘弧瓒虫簮瑙嗛鏍煎紡鍚堝悓銆傞櫎鍢撮儴杩愬姩鍙樺寲澶栵紝涓嶅厑璁告敼鍙樼敾骞呫€佹瘮渚嬨€佸抚鐜囥€佸儚绱犳牸寮忋€佽壊褰╁厓鏁版嵁鍜岄煶杞ㄧ瓥鐣ャ€?- 濡傛灉 provider 杈撳嚭鍙互閫氳繃瀹夊叏杞皝瑁呮垨杞爜鎭㈠鍒版簮瑙嗛鍚堝悓锛屽悗绔簲鎭㈠鍚庡啀鍙戝竷锛涘鏋滄棤娉曟仮澶嶏紝浠诲姟蹇呴』杩斿洖 `failed`锛岄敊璇俊鎭鏄庘€滃彛鍨嬭緭鍑烘湭淇濇寔婧愯棰戞牸寮忊€濓紝涓嶅緱鍒涘缓鎴愬姛璧勪骇銆?- 鏄惧紡 `renderMode=1080x1920` 浠呭湪鐢ㄦ埛鏄庣‘閫夋嫨绔栫増杈撳嚭鏃跺厑璁告敼鍙樼敾甯冦€?
## Conventions

- Base URL锛氬悗绔寕杞藉湪 `/api` 涓嬶紝涓氬姟鎺ュ彛缁熶竴浣跨敤 `/api/v1/...`銆?- 閴存潈锛氶櫎鍋ュ悍妫€鏌ャ€佺櫥褰曘€佹敞鍐屻€佸瘑鐮佹仮澶嶅锛岄粯璁ら渶瑕?JWT銆?- 鐢ㄦ埛闅旂锛氭墍鏈夎祫婧愩€侀樁娈电姸鎬併€佺敓鎴愯祫浜у拰妯℃澘鍐欐搷浣滃繀椤讳娇鐢ㄥ綋鍓?JWT 鐢ㄦ埛銆?- 闀夸换鍔★細鍒涘缓鎺ュ彛鍙繑鍥?`taskId/status`锛屽墠绔€氳繃鐘舵€佹帴鍙ｈ疆璇€?- 鏃堕棿鍗曚綅锛氬瓧骞曘€佹爣棰樺拰瑙嗛鏃堕棿缁熶竴浣跨敤绉掞紝瀛楁鍛藉悕浼樺厛浣跨敤 `startTime/endTime/duration`銆?
### Legacy Tools Endpoint Policy (2026-05-27)

- Default behavior: legacy high-risk direct tools endpoints are disabled and return `410 Gone`.
- Feature flag (test environment only): `ENABLE_LEGACY_TOOLS_ENDPOINTS=true`.
- Disabled endpoints:
  - `POST /api/v1/tools/generate-video-preview`
  - `POST /api/v1/tools/seedance-i2v-async`
  - `POST /api/v1/tools/ark-i2v-task`
  - `POST /api/v1/tools/upload-video`
  - `POST /api/v1/tools/upload-audio`
  - `POST /api/v1/tools/generate-lip-sync-video`
  - `POST /api/v1/tools/ali-lip-sync`
  - `POST /api/v1/tools/lip-sync-preview`
  - `POST /api/v1/tools/voice-preview`

### Legacy Tasks/Works Pipeline Policy (2026-05-27)

- Default behavior: legacy v1 tasks/works mutating endpoints are disabled and return `410 Gone`.
- Feature flag (test environment only): `ENABLE_LEGACY_TASKS_ENDPOINTS=true`.
- Disabled endpoints:
  - `POST /api/v1/tasks`
  - `POST /api/v1/tasks/:id/photo`
  - `POST /api/v1/tasks/:id/extract`
  - `POST /api/v1/tasks/:id/retry`
  - `POST /api/v1/tasks/:id/rewrite/suggest`
  - `POST /api/v1/tasks/:id/rewrite`
  - `POST /api/v1/tasks/:id/render`
  - `PATCH /api/v1/works/:id`
- Read-only compatibility endpoints kept for historical lookup:
  - `GET /api/v1/tasks/:id`
  - `GET /api/v1/tasks/:id/transcript`
  - `GET /api/v1/tasks/:id/result`
  - `GET /api/v1/tasks/:id/download/subtitle`
  - `GET /api/v1/tasks/:id/download/script`
  - `GET /api/v1/works`

## Auth

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/register` | Public | 娉ㄥ唽璐﹀彿锛屽寘鍚敤鎴峰悕銆佸瘑鐮併€佹墜鏈哄彿銆佽韩浠借瘉鏍￠獙瀛楁銆?|
| POST | `/api/v1/auth/login` | Public | 鐧诲綍骞惰繑鍥?token銆?|
| GET | `/api/v1/auth/me` | JWT | 鏌ヨ褰撳墠鐢ㄦ埛銆佽鑹插拰璐﹀彿鐘舵€併€?|
| POST | `/api/v1/auth/change-password` | JWT | 鐧诲綍鐘舵€佷笅淇敼瀵嗙爜銆?|
| POST | `/api/v1/auth/reset-password` | Public | 浣跨敤鎵嬫満鍙峰拰韬唤璇佹牎楠屽悗閲嶇疆瀵嗙爜銆?|

鏅€氱敤鎴烽粯璁ら渶瑕佺鐞嗗憳寮€閫氭潈闄愬悗鎵嶈兘浣跨敤鏍稿績鍒涗綔鑳藉姏銆?
## Resources

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/resources/avatars` | JWT | 鏌ヨ鎺ㄨ崘鏁板瓧浜哄拰褰撳墠鐢ㄦ埛鏁板瓧浜鸿祫婧愩€?|
| POST | `/api/v1/resources/avatars` | JWT | 鏂板缓鏁板瓧浜鸿祫婧愩€?|
| POST | `/api/v1/resources/avatars/upload` | JWT | 涓婁紶鏁板瓧浜鸿棰戙€?|
| GET | `/api/v1/resources/avatars/upload-videos` | JWT | 鏌ヨ褰撳墠鐢ㄦ埛宸蹭繚瀛樿棰戙€?|
| GET | `/api/v1/resources/avatar-video-files/:fileName/stream` | JWT | 鎾斁褰撳墠鐢ㄦ埛鏈夋潈闄愮殑瑙嗛鏂囦欢銆?|
| GET | `/api/v1/resources/avatar-video-files/:fileName/preview-stream` | JWT | 鎾斁杞婚噺棰勮瑙嗛銆?|
| PATCH | `/api/v1/resources/avatars/:id` | JWT | 淇敼褰撳墠鐢ㄦ埛鏁板瓧浜鸿祫婧愩€?|
| DELETE | `/api/v1/resources/avatars/:id` | JWT | 鍒犻櫎褰撳墠鐢ㄦ埛鏁板瓧浜鸿祫婧愩€?|
| GET | `/api/v1/resources/voices` | JWT | 鏌ヨ鎺ㄨ崘闊宠壊鍜屽綋鍓嶇敤鎴烽煶鑹层€?|
| POST | `/api/v1/resources/voices` | JWT | 鏂板缓闊宠壊銆?|
| POST | `/api/v1/resources/voices/clone` | JWT | 鍒涘缓鍏嬮殕闊宠壊浠诲姟銆?|
| GET | `/api/v1/resources/voice-files/:fileName/stream` | JWT | 鎾斁褰撳墠鐢ㄦ埛鏈夋潈闄愮殑闊抽鏂囦欢銆?|
| GET | `/api/v1/resources/subtitle-templates` | JWT | 鏌ヨ鍏増鍜屽綋鍓嶇敤鎴峰瓧骞曟ā鏉匡紝鏀寔 `scope=all|recommended|mine`銆?|
| POST | `/api/v1/resources/subtitle-templates/:id/copy` | JWT | 澶嶅埗鍏増鎴栨湰浜烘ā鏉匡紝杩斿洖鍙紪杈戝壇鏈€?|
| PATCH | `/api/v1/resources/subtitle-templates/:id` | JWT | 淇敼褰撳墠鐢ㄦ埛妯℃澘銆傚叕鐗堟ā鏉夸笉鍙慨鏀广€?|
| DELETE | `/api/v1/resources/subtitle-templates/:id` | JWT | 鍒犻櫎褰撳墠鐢ㄦ埛妯℃澘銆傚叕鐗堟ā鏉夸笉鍙垹闄ゃ€?|

璧勬簮鎺ュ彛涓嶅緱杩斿洖鍏朵粬鐢ㄦ埛绉佹湁璧勬簮銆傛帹鑽愯祫婧愬繀椤绘樉寮忔爣璁帮紝涓嶈兘娣峰叆鐢ㄦ埛绉佹湁璧勪骇銆?
## Staged Workflow

### Audio Asset

`POST /api/v1/audio-assets/upload-complete`

鐢ㄤ簬鍓嶇鐩翠紶 OSS 鎴栨湰鍦颁笂浼犲畬鎴愬悗鐧昏闊抽璧勪骇銆?
`POST /api/v1/audio-assets/generate`

鏍规嵁鏂囨銆侀煶鑹插拰鍙傛暟鐢熸垚 TTS 闊抽銆?
```json
{
  "projectId": "vp_001",
  "text": "鍙ｆ挱鏂囨",
  "voiceResourceId": "voice_001",
  "voiceRate": 1.15,
  "idempotencyKey": "audio:vp_001:click-001"
}
```

瑙勫垯锛?- 鐢熸垚闊抽缁熶竴璧伴樋閲屼簯 CosyVoice SpeechSynthesizer銆?- `voiceRate` 涓虹敤鎴疯閫熷€嶇巼锛屽綋鍓嶆敮鎸?`0.5 - 1.5`锛屽悗绔細閫忎紶涓洪樋閲屼簯 `input.rate`銆?- 鑻ラ煶鑹?`provider_voice` 涓?`qwen-tts-*`锛堝０闊冲鍒?璁捐闊宠壊锛夛紝鍚庣浼氫紭鍏堜娇鐢ㄨ闊宠壊缁戝畾鐨?`providerModel`锛岄伩鍏?`voice` 涓?`model` 鐗堟湰涓嶅尮閰嶅鑷?400銆?
鍝嶅簲锛?
```json
{
  "audioAssetId": "audio_001",
  "status": "success",
  "duration": 12.4,
  "previewUrl": "/api/v1/resources/voice-files/audio_001.mp3/stream"
}
```

BE-073 note: Aliyun TTS currently applies speed-only tuning via `voiceRate`.
`voiceEmotion`, `voiceEmotionIntensity`, `voiceVolume`, `voicePitch` are ignored by backend.
Canonical endpoint: `POST /api/v1/audio-assets/generate`.
Legacy `POST /api/v1/tools/generate-tts-audio` is compatibility-only and internally forwards to the same generation path.
Qwen custom voices (`provider_voice` starts with `qwen-tts-`) are synthesized via `/services/aigc/multimodal-generation/generation`; CosyVoice uses `/services/audio/tts/SpeechSynthesizer`.

`GET /api/v1/audio-assets/:id`

鏌ヨ褰撳墠鐢ㄦ埛闊抽璧勪骇鐘舵€併€佽瘯鍚湴鍧€銆佹椂闀垮拰閿欒淇℃伅銆?
瑙勫垯锛?- 鏂版祦绋嬪繀椤讳紶鐪熷疄 `projectId`锛堟潵鑷?`video_projects.id`锛夈€?- 鑻ヨ姹傛湭浼?`projectId`锛屽悗绔粎鎸夐仐鐣欏吋瀹瑰啓鍏?`studio-current`銆?- 浼犲叆闈?`studio-current` 鐨?`projectId` 鏃讹紝鍚庣浼氭牎楠岃椤圭洰褰掑睘褰撳墠鐧诲綍鐢ㄦ埛锛涗笉瀛樺湪鎴栨棤鏉冮檺杩斿洖 `404`銆?
### Subtitle Track

`POST /api/v1/audio-assets/:id/subtitle-track`

BE-069 琛ュ厖锛坴1.0锛夛細
- 鍙湁鏄惧紡浼犲叆闈炵┖ `scriptSegments` 鏃讹紝杞ㄩ亾 `source` 鎵嶄細鏄?`tts_alignment`銆?- 鑻ユ湭浼?`scriptSegments`锛岃鎺ュ彛鎸?ASR 鍘熷鍒嗘鐢熸垚骞舵爣璁?`source=asr`锛堢敤浜庤嚜鍔ㄨ建閬擄紝涓嶄綔涓烘枃妗堝垎娈佃建閬撻獙鏀朵緷鎹級銆?- 鏄惧紡鍒嗘鐢熸垚鍚庯紝鍚庣浼氬悓姝ユ洿鏂?`audio_assets.subtitle_track_id` 涓?`video_project_stage_states.subtitle_track_id` 涓烘渶鏂?trackId銆?
BE-068 琛ュ厖锛坴1.0锛夛細
- 璇锋眰浣撴敮鎸?`projectId`銆乣scriptText`銆乣scriptSegments`銆?- `scriptSegments` 涓洪潪绌烘暟缁勬椂锛屽悗绔紭鍏堟寜鍏堕暱搴︾敓鎴?`cues`銆?- `scriptSegments` 鏈紶鎴栦负绌烘椂锛屽悗绔洖閫€涓?`scriptText` 鑷姩鍒囧彞锛涘啀鍥為€€鍒?ASR 鍏ㄦ枃銆?- 褰撹姹備紶鍏ラ潪绌?`scriptSegments` 鏃讹紝杩斿洖杞ㄩ亾蹇呴』鏍囪涓?`source=tts_alignment`锛涘鏋滃悗缁?`GET /subtitle-tracks/:id` 杩斿洖 `source=asr`锛岃鏄庤鍙栫殑鏄?ASR 鍘熷杞ㄩ亾锛屼笉鑳戒綔涓烘湰娆″垎娈靛瓧骞曡酱浣跨敤銆?- 鐢熸垚鏃堕棿杞存椂浣跨敤 ASR `segments` 鎬绘椂闀胯竟鐣屽苟浠ラ煶棰戞椂闀垮厹搴曪紝淇濊瘉 `startTime/endTime` 閫掑涓旀棤閲嶅彔銆?- 鏍￠獙闊抽璧勪骇蹇呴』灞炰簬褰撳墠 `projectId`锛屼笉涓€鑷磋繑鍥?`400`銆?
鍩轰簬闊抽鐢熸垚瀛楀箷鏃堕棿杞淬€?
璇锋眰浣撳彲閫夛細

```json
{
  "projectId": "project_001",
  "scriptText": "瀹屾暣鍙ｆ挱鏂囨",
  "scriptSegments": [
    "鎴掕壊瀵硅韩浣撶殑褰卞搷鍒板簳鏈夊澶э紵",
    "鏈変汉璇存垝鑹叉槸涓€绉嶈嚜寰嬶紝鏄湪绉敀鑳介噺銆?
  ]
}
```

瑙勫垯锛?
- `projectId` 蹇呴』涓庨煶棰戣祫浜у綊灞炰竴鑷淬€?- 濡傛灉鎻愪緵 `scriptSegments`锛屽瓧骞曟潯鏁板簲浼樺厛涓?`scriptSegments.length` 瀵归綈銆?- 鍓嶇蹇呴』浣跨敤鏄惧紡鍒涘缓瀛楀箷杞存帴鍙ｈ繑鍥炵殑 trackId 缁х画鏌ヨ锛涗笉寰楃敤闊抽鐢熸垚闃舵鑷姩杩斿洖鐨?ASR track 瑕嗙洊褰撳墠瀛楀箷杞ㄣ€?- ASR 杩斿洖鐨?`segments` 鐢ㄤ簬鎻愪緵鏃堕棿杈圭晫锛涙枃鏈互鐢ㄦ埛褰撳墠鍙ｆ挱鏂囨鍒嗘涓哄噯銆?- 褰?ASR 鍙繑鍥炲皯閲忓ぇ娈垫椂锛屽悗绔渶瑕佹寜瀛楃鍗犳瘮鎴栧彞娈靛崰姣旀妸澶ф鏃堕棿鍒囧垎鍒版瘡涓枃妗堟銆?- 鐢熸垚缁撴灉蹇呴』淇濊瘉 `startTime/endTime` 閫掑銆佷笉閲嶅彔锛屾渶鍚庝竴娈?`endTime` 涓嶈秴杩囬煶棰戞椂闀跨殑鍚堢悊璇樊鑼冨洿銆?
`GET /api/v1/subtitle-tracks/:id`

杩斿洖褰撳墠鐢ㄦ埛瀛楀箷杞ㄩ亾锛?
```json
{
  "id": "subtitle_001",
  "audioAssetId": "audio_001",
  "cues": [
    {
      "id": "cue_001",
      "startTime": 0,
      "endTime": 2.52,
      "text": "鎴掕壊瀵硅韩浣撶殑褰卞搷鍒板簳鏈夊澶э紵"
    }
  ]
}
```

`PATCH /api/v1/subtitle-tracks/:id/cues`

淇濆瓨鐢ㄦ埛缂栬緫鍚庣殑瀛楀箷鏂囨湰鍜屾椂闂淬€傛渶缁堟垚鐗囧繀椤昏鍙栬繖閲岀殑鏈€鏂版暟鎹€?
瑙勫垯锛?- `subtitle_tracks.project_id` 涓庢潵婧愰煶棰戣祫浜т繚鎸佸悓涓€ `projectId`銆?- 绂佹灏嗘煇椤圭洰闊抽璧勪骇鍐欏叆鍙︿竴椤圭洰瀛楀箷杞ㄩ亾锛堣繑鍥?`400`锛夈€?
## Video Projects

### Creation Task

`POST /api/v1/video-projects`

鍒涘缓鍒涗綔浠诲姟銆備换鍔″悕鍙紪杈戙€佸彲閲嶅锛屼笉浣滀负鏁版嵁涓婚敭锛沗projectId` 鏄敮涓€涓婚敭銆?
```json
{
  "name": "鎴掕壊涓婚鍙ｆ挱 2026-05-25"
}
```

鍝嶅簲锛?
```json
{
  "projectId": "project_6f5f4f0a-7ef5-4f55-839d-2d3654d1ce5f",
  "name": "鎴掕壊涓婚鍙ｆ挱 2026-05-25",
  "archived": false,
  "archivedAt": null,
  "createdAt": "2026-05-25T08:00:00.000Z",
  "updatedAt": "2026-05-25T08:00:00.000Z"
}
```

`GET /api/v1/video-projects?scope=active|archived|all&limit=&offset=`

鍒嗛〉鏌ヨ褰撳墠鐢ㄦ埛鑷繁鐨勫垱浣滀换鍔″垪琛ㄣ€?- 榛樿 `scope=active`
- 榛樿 `limit=20`
- 鏈€澶?`limit=50`

`GET /api/v1/video-projects/:projectId`

璇诲彇褰撳墠鐢ㄦ埛鎸囧畾鍒涗綔浠诲姟璇︽儏銆?
`PATCH /api/v1/video-projects/:projectId`

浠呮洿鏂颁换鍔″悕銆傚悗绔繀椤绘牎楠屽綋鍓嶇敤鎴峰綊灞炪€?
`POST /api/v1/video-projects/:projectId/archive`

褰掓。鎴栧彇娑堝綊妗ｅ綋鍓嶇敤鎴蜂换鍔★紝涓嶅垹闄ら煶棰戙€佽棰戙€佸瓧骞曠瓑搴曞眰璧勪骇銆?
```json
{
  "archived": true
}
```

瑙勫垯锛?
- `projectId` 蹇呴』鏉ヨ嚜 `video_projects.id`銆?- 鏂版祦绋嬩笉寰椾娇鐢?`studio-current` 鍒涘缓闃舵鏁版嵁锛涜鍊间粎鐢ㄤ簬閬楃暀鍏煎銆?- 浠诲姟鍚嶅厑璁搁噸澶嶏紱绂佹鐢ㄤ换鍔″悕銆侀煶棰戝悕銆佹枃妗堛€佹暟瀛椾汉瑙嗛鎴栭摼鎺ュ尮閰嶅叾浠栦换鍔°€?- `task_statuses` 涓殑 `taskId` 鍙〃绀哄紓姝ユ墽琛屼换鍔★紝涓嶇瓑浜庡垱浣滀换鍔°€?- 鍚庣瀵?`projectId` 鎵ц鐢ㄦ埛褰掑睘鏍￠獙锛氳法璐﹀彿璁块棶缁熶竴杩斿洖 `404`锛堜笉鏆撮湶璧勬簮瀛樺湪鎬э級銆?- 鎵€鏈?project-scoped 闀夸换鍔″垱寤烘帴鍙ｏ紙`detect-cut-points`銆乣render-final`銆乣lipsync-tasks`銆乣package-render-tasks`銆乣pd-events`锛夐兘浼氬湪 dedupe銆佸苟鍙戞牎楠屻€佷换鍔℃寔涔呭寲涔嬪墠鍏堝仛椤圭洰褰掑睘鏍￠獙锛涜秺鏉冭姹備笉浼氬垱寤轰换浣曚换鍔¤褰曘€?- 鎵€鏈?project-scoped 闀夸换鍔″垱寤烘帴鍙ｅ繀椤诲厛鏍￠獙 `video_projects.id + 褰撳墠鐢ㄦ埛`锛屽啀鎵ц dedupe銆佸苟鍙戝垽鏂€佷换鍔℃寔涔呭寲鍜?provider 璋冪敤銆?- 瓒婃潈闀夸换鍔¤姹備笉寰楄繑鍥?`taskId`锛屼笉寰楀啓鍏?`task_statuses`锛屼笉寰楀崰鐢ㄥ綋鍓嶇敤鎴峰苟鍙戦搴︺€?
### Stage State

`GET /api/v1/video-projects/:projectId/stage-state`

璇诲彇褰撳墠鐢ㄦ埛鍦ㄩ」鐩噷鐨勯樁娈电姸鎬併€?璇ユ帴鍙ｈ繑鍥?`Cache-Control: no-store`锛岄伩鍏嶆祻瑙堝櫒瀵瑰垱浣滃彴闃舵鏁版嵁杩斿洖 `304` 骞惰鐢ㄧ紦瀛樸€?
`PUT /api/v1/video-projects/:projectId/stage-state`

淇濆瓨鎴栧眬閮ㄦ洿鏂伴樁娈电姸鎬併€?
```json
{
  "audioAssetId": "audio_001",
  "subtitleTrackId": "subtitle_001",
  "avatarResourceId": "avatar_001",
  "renderMode": "portrait",
  "lipsyncTaskId": "task_001",
  "digitalHumanVideoAssetId": "dhv_001",
  "scriptHash": "sha256:..."
}
```

瑙勫垯锛?- `audioAssetId/subtitleTrackId/digitalHumanVideoAssetId` 蹇呴』灞炰簬褰撳墠 `projectId`锛屽惁鍒欒繑鍥?`400`銆?- `projectId=studio-current` 浠呯敤浜庨仐鐣欏吋瀹癸紱legacy 璧勪骇 `project_id IS NULL` 鎸?`studio-current` 澶勭悊銆?
Stage-state validation (v1.0):
- `audioAssetId` / `subtitleTrackId` / `digitalHumanVideoAssetId` must belong to current `projectId`, otherwise `400`.
- `avatarResourceId` must be an avatar owned by current user:
  - not found -> `404`
  - owned by another user -> `403`
- Invalid `avatarResourceId` is rejected at `PUT /stage-state`, so it cannot flow into later project-scoped long tasks.

### Lipsync Task

`POST /api/v1/video-projects/:projectId/lipsync-tasks`

琛ュ厖锛坴1.0锛夛細
- 鏂板鍙€夊瓧娈碉細`regenerationKey?: string`銆?- 褰?`forceRetry=true` 鎴?`regenerationKey` 瀛樺湪鏃讹紝鍚庣浼氳烦杩?`video-lipsync` completed 浠诲姟澶嶇敤銆?- 鍚屾椂鍚庣浼氬湪鏂颁换鍔″垱寤哄墠娓呯┖褰撳墠 `projectId` 鐨?stage-state锛歚lipsyncTaskId`銆乣digitalHumanVideoAssetId`銆乣videoUrl`锛岄槻姝㈡棫鍙ｅ瀷缁撴灉鍥炲～褰撳墠闃舵銆?- 绗簩姝ュ彛鍨嬩换鍔￠粯璁?`renderMode=preserveSourceAspect`锛屽悗绔細灏介噺淇濈暀婧愯棰戝楂樸€丼AR/DAR銆乫ps 鍜岃壊褰╁厓鏁版嵁锛屼笉鍋氶粯璁よ鍓紝涓嶅己鍒?1080x1920銆?- `renderMode=1080x1920` 浠呭湪鐢ㄦ埛鏄庣‘瑕佹眰绔栫増杈撳嚭鏃剁敓鏁堬紙缂╂斁 + pad 鍒?1080x1920锛夈€?- Aliyun VideoRetalk 杈撳叆鏂囦欢锛堣棰?闊抽锛夊崟鏂囦欢澶у皬榛樿蹇呴』灏忎簬 300MB銆?- 鍚庣浼氬湪鎻愪氦 provider 鍓嶅仛鍓嶇疆鏍￠獙锛涜秴闄愮洿鎺ヨ繑鍥?`400`锛屼笉鍐嶅垱寤衡€滈暱鏃堕棿杞鍚庡け璐モ€濈殑 provider 浠诲姟銆?- 鍙€氳繃鐜鍙橀噺 `ALI_VIDEORETALK_INPUT_MAX_BYTES` 璋冩暣璇ヤ笂闄愶紙鍗曚綅锛氬瓧鑺傦級銆?
鍒涘缓鍙ｅ瀷鐢熸垚浠诲姟銆傝姹傚繀椤诲紩鐢ㄥ凡缁忎繚瀛樼殑闊抽璧勪骇鍜屽綋鍓嶇敤鎴峰彲鐢ㄧ殑鏁板瓧浜鸿棰戙€?
璇ユ帴鍙ｆ槸 project-scoped 闀夸换鍔″叆鍙ｏ紝蹇呴』鍦ㄤ换鍔″垱寤哄墠鏍￠獙褰撳墠鐢ㄦ埛鎷ユ湁 `projectId`銆?
`GET /api/v1/render-tasks/:taskId`

鏌ヨ `video-lipsync`銆乣video-package`銆乣video-render` 绛変换鍔＄姸鎬併€?
鐘舵€佸€硷細

- `pending`
- `processing`
- `provider_running`锛圓liyun provider 浠嶅湪澶勭悊锛屽悗绔細鍚庡彴鎭㈠锛屼笉绛夊悓澶辫触锛?- `completed`
- `failed`

`video-lipsync` 浠诲姟鍦?`provider_running` 鐘舵€佷笅锛宍result_json.provider` 浼氭寔涔呭寲 provider 鎭㈠涓婁笅鏂囷紙渚嬪 `name/requestId/taskId/taskStatus/inputMode/videoUrl/audioUrl/submittedAt/lastPolledAt/recoverUntil/inputMeta/sourceContract/preparedContract/audioContract/lastResponse`锛夈€?
瑙勫垯锛?- 浠诲姟鍏ュ弬涓殑 `audioAssetId` 蹇呴』灞炰簬褰撳墠 `projectId`锛坙egacy `studio-current` 鍏煎 `NULL`锛夈€?- 鍙ｅ瀷浜х墿 `digital_human_video_assets.project_id` 涓庝换鍔?`projectId` 寮轰竴鑷村啓鍏ャ€?
### Lipsync Asset Resolve

`GET /api/v1/video-projects/:projectId/lipsync-assets/resolve?audioAssetId=&avatarResourceId=&renderMode=`

鍏煎閬楃暀鎺ュ彛銆傚綋鍓嶅墠绔伐浣滄祦涓嶅啀璋冪敤璇ユ帴鍙ｈ嚜鍔ㄥ尮閰嶅巻鍙插彛鍨嬭棰戯紱鍒锋柊鍚庡彧鎭㈠闊抽鍜屽瓧骞曟椂闂磋酱锛屽彛鍨嬭棰戦渶瑕佺敤鎴烽噸鏂扮敓鎴愩€?
瑙勫垯锛?- 鏌ヨ涓ユ牸鎸?`userId + projectId + audioAssetId + avatarResourceId + renderMode`銆?- `projectId=studio-current` 鏃跺吋瀹瑰懡涓?`project_id IS NULL` 鐨勯仐鐣欐暟鎹€?
### Package Render

`POST /api/v1/video-projects/:projectId/package-render-tasks`

鍒涘缓鏈€缁堝寘瑁呮垚鐗囦换鍔°€傝鎺ュ彛鍙仛鍖呰娓叉煋锛屼笉閲嶆柊鐢熸垚闊抽鎴栧彛鍨嬨€?璇ユ帴鍙ｆ槸 project-scoped 闀夸换鍔″叆鍙ｏ紝蹇呴』鍦ㄤ换鍔″垱寤哄墠鏍￠獙褰撳墠鐢ㄦ埛鎷ユ湁 `projectId`銆?
```json
{
  "digitalHumanVideoAssetId": "dhv_001",
  "audioAssetId": "audio_001",
  "subtitleTrackId": "subtitle_001",
  "subtitleTemplateId": "tpl_user_001",
  "includeSubtitle": true,
  "includeTitleAssets": true,
  "renderOptions": {
    "renderMode": "portrait",
    "aspectRatio": "9:16"
  }
}
```

瑙勫垯锛?- `digitalHumanVideoAssetId/audioAssetId/subtitleTrackId` 蹇呴』灞炰簬褰撳墠 `projectId`锛屽惁鍒欒繑鍥?`400`銆?- 鍖呰娓叉煋涓嶄細璺ㄩ」鐩鐢ㄨ祫浜э紝涓嶄細鑷姩鍥炲～鍏朵粬椤圭洰缁撴灉銆?- 璺ㄨ处鍙?`projectId` 杩斿洖 `404`锛屽苟涓斾笉寰楀垱寤?`pkg_*` 浠诲姟銆?
## Video Script And Title Assets

`POST /api/v1/video-script/save`

淇濆瓨鎸囧畾 `videoId/projectId` 鐨勬櫤鑳藉壀杈戞枃妗堛€佸瓧骞曟ā鏉垮拰楂樹寒閰嶇疆銆?
`GET /api/v1/video-script/:videoId`

璇诲彇鎸囧畾 `videoId/projectId` 鐨勬櫤鑳藉壀杈戞枃妗堥厤缃紱褰撴柊寤轰换鍔″皻鏈繚瀛橀厤缃椂杩斿洖 `200`锛宍data=null`锛岄伩鍏嶆妸姝ｅ父绌虹姸鎬佸綋浣滄帴鍙ｉ敊璇€?
`POST /api/v1/video-script/mark-title`

鍦ㄦ枃妗?marks 涓垱寤?`title_effect` 鏍囪銆?
`POST /api/v1/title-assets/render`

涓烘寚瀹?title mark 鍒涘缓閫忔槑鏍囬绱犳潗娓叉煋浠诲姟銆?
`GET /api/v1/title-assets/render-tasks/:taskId`

鏌ヨ鏍囬绱犳潗浠诲姟鐘舵€佸拰杈撳嚭鍦板潃銆?
鏍囬绱犳潗瑕佹眰锛?
- 閫忔槑鑳屾櫙銆?- 榛樿妯℃澘 `tech_card_pop`銆?- 杈撳嚭浼樺厛 WebM VP9 alpha锛涘け璐ユ椂鍙蛋 PNG 搴忓垪鍏滃簳銆?- 鏈€缁堟垚鐗囬€氳繃 FFmpeg overlay 鍙犲姞銆?
## Admin

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/admin/stats` | Admin | 绯荤粺缁熻銆?|
| GET | `/api/v1/admin/users` | Admin | 鐢ㄦ埛鍒楄〃銆?|
| PATCH | `/api/v1/admin/users/:id` | Admin | 淇敼鐢ㄦ埛鐘舵€併€佹潈闄愭垨瑙掕壊銆?|
| GET | `/api/v1/admin/audit-logs` | Admin | 瀹¤鏃ュ織銆?|
| GET | `/api/v1/admin/resources` | Admin | 绠＄悊璧勬簮鍒楄〃銆?|

## Error Rules

- `401`锛氭湭鐧诲綍鎴?token 鏃犳晥銆?- `403`锛氳处鍙锋湭寮€閫氭潈闄愩€佽法璐﹀彿璁块棶銆侀潪绠＄悊鍛樿闂鐞嗗憳鎺ュ彛銆?  - 褰撹处鍙蜂负寰呭鏍哥姸鎬佹椂锛屽悗绔繑鍥烇細
  ```json
  {
    "statusCode": 403,
    "message": {
      "code": "ACCOUNT_PENDING",
      "message": "璐﹀彿寰呭鏍稿紑閫氾紝瀹℃牳閫氳繃鍚庢柟鍙娇鐢ㄦ暟瀛椾汉銆佸彛鎾€佷换鍔′笌浣滃搧绛夊姛鑳?
    },
    "error": "Forbidden"
  }
  ```
- `404`锛氳祫婧愪笉瀛樺湪鎴栧綋鍓嶇敤鎴锋棤鏉冭闂椂閮藉彲杩斿洖锛岄伩鍏嶆毚闇蹭粬浜鸿祫婧愬瓨鍦ㄦ€с€?- `409`锛氬箓绛夊啿绐佹垨浠诲姟鐘舵€佷笉鍏佽閲嶅鍒涘缓銆?- `422`锛氳姹傚瓧娈靛悎娉曚絾涓氬姟鏉′欢涓嶆弧瓒筹紝渚嬪瀛楀箷鏃堕棿鏃犳晥銆?- `500`锛氬閮?provider銆丗Fmpeg 鎴栧唴閮ㄥ紓甯革紝蹇呴』杩斿洖鍙睍绀虹殑 `message`銆?
# API

- Do not use `studio-current`, audio name, script text, avatar name, or source URL to auto-restore a lip-sync video.
