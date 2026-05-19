# Changelog

## 2026-05-19 BE-PROD-001

### Changed

- Reduced public `GET /api/health` payload to minimal fields: `ok`, `app`, `version`.
- Changed `GET /api/health/deep` to return a public summary by default (`checks.<item>.ok` only), removing public exposure of build file lists, git commit, runtime paths, and dependency internals.
- Added controlled detailed health mode: full diagnostics now require either loopback access or `X-Health-Token` matching `HEALTH_DEEP_TOKEN`.
- Updated `scripts/smoke-test.sh` and `scripts/verify-runtime.sh` to optionally include `X-Health-Token` via `HEALTH_DEEP_TOKEN`.
- Updated deployment/API docs for the new health exposure policy.

## 2026-05-19 BE-PROD-002

### Changed

- `GET /api/v1/tools/digital-human-env` no longer returns `arkKeyLength`.
- Response is restricted to capability booleans only: `arkConfigured`, `seedreamConfigured`, `remoteConfigured`.
- Added e2e regression assertion to prevent re-exposing key-length metadata.
- Updated API documentation for `digital-human-env` response contract.

## 2026-05-19 FE-PERF-001

### Changed

- Removed the full-file saved-video Blob preview path from avatar creation, avatar resource cards, and studio avatar cover fallback.
- `NewAvatarModal` now uses the current-user `GET /api/v1/resources/avatars/upload-videos` response and passes `previewUrl` directly to `<video preload="metadata">`.
- `AvatarLibraryView` and `CreativeStudioView` now use `/api/v1/resources/avatar-video-files/:fileName/stream` URLs instead of downloading large videos into object URLs.
- Removed the unused `fetchSavedVideoBlob()` API helper.

## 2026-05-19 BE-PERF-001

### Changed

- `GET /api/v1/resources/avatar-video-files/:fileName/stream` now supports byte range requests with `206 Partial Content`, `416`, `Content-Range`, and `Accept-Ranges: bytes` while preserving current-user ownership checks.
- `GET /api/v1/resources/avatar-video-files/:fileName/metadata` returns avatar upload video metadata without reading the full video file.
- `GET /api/v1/resources/avatars/upload-videos` now includes `mimeType` and `metadataUrl`.

## 2026-05-19 QA Strategy

### Changed

- After `v1.0`, QA no longer defaults to full module core-flow regression.
- Future acceptance focuses on request frequency, risky parameters, memory/data retention, object URL/blob cleanup, timers, listeners, polling, one-off component teardown, and deployment/runtime growth risks.
- Synced policy docs: `PROJECT_STATE.md`, `ACCEPTANCE.md`, `docs/TEST_PLAN.md`, `TASK_BOARD.md`.

## 2026-05-19 v1.0

### Milestone

- Production end-to-end flow is verified and the project is now marked as `v1.0`.
- The team focus moves from main-flow completion to targeted functional improvements, UX polish, security boundary hardening, preview performance, monitoring, and test automation.
- Thanks to all agents: Commander, Frontend UI + Business Development, Frontend Optimization, Backend Feature Development, Backend Optimization, Ops/Server Maintenance, QA Acceptance, and Architecture Review.

## 2026-05-19 BE Font Runtime Hotfix

### Changed

- Backend Docker images now install CJK fonts (`fonts-noto-cjk`, `fonts-wqy-zenhei`) and run `fc-cache -f -v` during build.
- ASS subtitle default font changed from `Microsoft YaHei` to `Noto Sans CJK SC`.
- Recommended subtitle template `fontFamily` defaults and preview SVG font stacks were aligned to `Noto Sans CJK SC`.
- Deployment doc updated: `docs/DEPLOY.md`.

## 2026-05-19 BE-016

### Changed

- Added `GET /api/v1/resources/avatars/upload-videos` for “add avatar from saved videos”; this endpoint is now user-scoped and only returns `avatar-upload_*` sources from `avatar_resources`.
- Added `GET /api/v1/resources/avatar-video-files/:fileName/stream` with ownership enforcement to prevent cross-account preview access.
- Added server-side ownership validation in avatar creation: local `originalVideoUrl` must be an owned `avatar-upload_*` file, otherwise request is rejected.
- Synced docs: `docs/API.md` and `docs/DATABASE.md`.

## 2026-05-19 BE-015

### Changed

- Added `scripts/verify-release-routes.js` to validate critical route markers in compiled backend artifacts.
- Added release-time route gate to:
  - `deploy/build-release.sh`
  - `deploy/build-release.ps1`
- Build now fails if either marker is missing in `tools.controller.js`:
  - `Get)('recent-extractions')`
  - `Post)('recent-extractions')`
- Updated release/test docs with pre-release route existence validation steps.

## 2026-05-18 Recent Extractions Hotfix
- Restored backend controller routes for `GET /api/v1/tools/recent-extractions` and `POST /api/v1/tools/recent-extractions`; the service and table already existed but the controller route was missing, causing 404 on the video creation page.
- Added e2e coverage for list/save recent extraction records. Validation passed: backend lint, unit tests, build, and targeted tools-pipeline e2e.
## 2026-05-18 Release 20260518-006

### Deployed

- Published production release `20260518-006`.
- Included backend voice-preview async task flow, signed preview audio stream with Range support, and frontend voice-preview polling/status UI.
- Validation passed: frontend build, DY-DOWNLOADER build, backend build, backend Jest, release checksum verification, preflight, migration, smoke test, and runtime verify.
- Production containers are running `shuziren-api:20260518-006` and `shuziren-web:20260518-006`.

## 2026-05-18 BE-014

### Changed

- Voice preview now uses a backend async queue; repeated clicks from the same user supersede older unfinished preview tasks and only the latest result is published.
- Preview audio streaming now requires short-lived signed access and returns `Content-Length`, `Accept-Ranges`, and `Content-Range` for browser metadata/range reads.
- Documented `VOICE_PREVIEW_QUEUE_*`, `VOICE_PREVIEW_FILE_*`, `PREVIEW_AUDIO_URL_TTL_SECONDS`, and `PREVIEW_AUDIO_STREAM_SECRET` deployment knobs.

## 2026-05-18 FE-010

### Changed

- `CreativeStudioView` 配音试听改为状态机驱动：`submitted/queued/running/saving/ready/failed/timeout`。
- 支持两种回包：同步 `audioUrl` 直出、异步 `previewTaskId + statusUrl` 轮询。
- 试听卡片改为状态可见性驱动，不再只在 `voicePreviewUrl` 存在时显示；无 URL 时禁用播放与下载按钮。
- 执行验证：`npm --prefix frontend run typecheck`、`npm --prefix frontend run build` 通过。

## 2026-05-18

### Changed

- 完成 `BE-013`：`POST /api/v1/tools/voice-preview` 改为异步任务快速返回，新增 `GET /api/v1/tools/voice-preview-tasks/:taskId` 查询 `queued/running/succeeded/failed` 状态，并将试听音频 stream 改为用户绑定的短期签名访问（`token + expires`）。
- 新增后端“最近提取记录”用户隔离：`/api/v1/tools/recent-extractions` 按当前 JWT 用户读写，记录落库 `recent_extractions`（MySQL/SQLite）。
- 浼樺寲鍓嶇涓庨儴缃蹭綋绉細瀛椾綋鏀逛负 `@fontsource` latin 瀛愰泦锛岃惤鍦伴〉骞冲彴 logo 浠?512px 鍘嬬缉鍒?128px锛岀Щ闄ゆ湭寮曠敤鐨勫墠绔敓鎴?`.js` 鍓湰鍜?PNG 澶囦唤锛屽墠绔?`dist` 浠?4,434,344 bytes 闄嶅埌 2,451,825 bytes銆?- 绉婚櫎鍚庣 `ffmpeg-static` / `ffprobe-static` npm 渚濊禆锛屾敼涓虹户缁娇鐢?`FFMPEG_BIN`銆佹湰鍦?`backend/ffmpeg/bin` 鎴?PATH 涓殑绯荤粺 ffmpeg锛屽悗绔?`node_modules` 浠庣害 626MiB 闄嶅埌绾?211MiB銆?- 鏀舵暃 Docker build context锛氬拷鐣ユ湰鍦?ffmpeg銆佷笂浼犳枃浠躲€佽繍琛屾暟鎹€佹棩蹇椼€佸獟浣撲复鏃舵枃浠跺拰鍓嶇鐢熸垚鍓湰锛岄伩鍏嶆妸鏈湴杩愯浜х墿閫佸叆闀滃儚鏋勫缓銆?- 淇澹伴煶璧勬簮缂哄け鏍锋湰鏃剁粺涓€鎾斁鍚屼竴娈靛閮ㄩ煶涔愮殑闂锛涙棫鐨勫厹搴曢煶棰?URL 浼氬湪璧勬簮鍒濆鍖栨椂娓呯悊涓虹┖銆?- 鏈€缁堟覆鏌撳悗绔吋瀹归《灞?`voiceRate` 璇€熷弬鏁帮紝骞朵紭鍏堣鐩栨棫鐨?`voiceTuning.speechRate`锛屼緵鍓嶇鎺ュ叆鐢ㄦ埛鑷€夎閫熴€?- 鍒涗綔椤佃閫熸帶浠堕粯璁ゅ€艰皟鏁翠负 `1.0`锛岃寖鍥村榻?`0.5` 鍒?`1.5`锛屾渶缁堟垚鐗囪姹備細鍦?payload 椤跺眰浼?`voiceRate`銆?- 鍚屾鍒涗綔椤?JS 鍓湰涓殑璇€熼粯璁ゅ€硷紝骞惰 Vite 鏃犳墿灞曞鍏ヤ紭鍏堣В鏋?TS/Vue 婧愭枃浠讹紝閬垮厤鍚屽悕 JS 鍓湰瑕嗙洊鍓嶇婧愮爜鏀瑰姩銆?- 鍓嶇鏂板 `npm --prefix frontend run lint` 闂ㄧ锛屽綋鍓嶅鐢?`vue-tsc -b` 杩涜绫诲瀷鍜岀粍浠跺绾︽鏌ャ€?- 淇 `local-upload` 闊宠壊濂戠害锛氬厠闅嗗け璐ヤ細鍥為€€鍒涘缓鏈湴闊宠壊锛宍voice-preview` 涓?`render-final` 鍙鐢ㄦ牱鏈煶棰戯紝涓嶅啀琚悗绔洿鎺ユ嫆缁濄€?- 澹伴煶鏍锋湰瀛樺偍鏂板 `local/oss` 鍙屾ā寮忥細褰?`VOICE_SAMPLE_STORAGE=oss` 鏃讹紝鏍锋湰鍐欏叆 OSS 涓斾繚鎸?`voice-files/*/stream` 涓?`provider-stream` 鎺ュ彛涓嶅彉銆?- 浼樺寲 OSS 澹伴煶鏍锋湰鍥炶锛氳瘯鍚拰 provider 璁块棶鏀逛负娴佸紡杩斿洖锛岄檷浣庡悗绔唴瀛樺崰鐢ㄥ拰棣栧瓧鑺傜瓑寰呫€?- 淇绾夸笂 OSS 澹伴煶鏍锋湰娴佸紡璇诲彇鍏煎闂锛氬吋瀹?`ali-oss getStream()` 杩斿洖 `{ stream }` 鐨勭粨鏋勶紝`voice-files/*/stream` 浠?404 鎭㈠涓?200銆?- 澶村儚璧勬簮鍒楄〃鏂板缁熶竴鐢熸垚鍒ゅ畾瀛楁 `canUseForRender`銆乣renderUnavailableReason`銆乣renderMode=source-video`锛屽悗绔細璇嗗埆鏈湴鏂囦欢缂哄け涓庢棤鏁堣棰戝湴鍧€骞惰繑鍥炴槑纭師鍥犮€?- 鍒涗綔椤电浜屾鏂板璧勬簮鐘舵€佺鐢ㄥ師鍥犲睍绀猴紱鏁板瓧浜烘坊鍔犲脊绐楄鍙?`/api/v1/tools/saved-videos` 澶辫触鏃跺睍绀洪敊璇拰閲嶈瘯鍏ュ彛锛屼笉鍐嶉潤榛樺垏鎹㈠埌鎵嬪姩 URL銆?- 淇 `/studio` 璇€?闊抽噺婊戞潌缁勪欢娉ㄥ唽锛岃ˉ榻?`NSlider` 瀵煎叆锛涗慨澶嶆暟瀛椾汉娣诲姞寮圭獥鍒濇鎵撳紑鏃朵笉璇锋眰宸蹭繚瀛樿棰戝垪琛ㄧ殑闂銆?- 淇 `/studio` 绗簩姝ユ粦鏉嗚瑕嗙洊鏍峰紡闅愯棌鐨勯棶棰橈紝璇€熷拰闊抽噺璋冭妭鐜板湪鍙锛岃閫熷彲浠庨粯璁?`1.00` 鎷栧姩璋冩暣銆?- 淇 `/api/health/deep` 鏈湴鍋ュ悍妫€鏌ヤ竴鑷存€э細ffmpeg 鎺㈡祴澶嶇敤涓氬姟閾捐矾閫昏緫锛宻chema 妫€鏌ユ寜 MySQL/SQLite 鏂硅█鍒嗘敮鎵ц銆?- 浼樺寲璧勬簮搴撴暟瀛椾汉瑙嗛棰勮鍔犺浇锛氶灞忎笉鍐嶅叏閲忔媺鍙栬棰戞祦锛屽崱鐗?hover 鎸夐渶鍔犺浇锛屽苟澶嶇敤浼氳瘽绾ч瑙堢紦瀛樸€?- 鍙戝竷绾夸笂鐗堟湰 `20260518-005`锛岄儴缃插悗 `/api/health` 涓?`/api/health/deep` 鍧囪繑鍥?`ok=true`銆?- 淇鍒涗綔椤碘€滄渶杩戞彁鍙栬褰曗€濊法璐﹀彿鍙闂锛氳褰曟敼涓烘寜褰撳墠鐧诲綍璐﹀彿闅旂瀛樺偍锛屾棫鐨勫叏灞€娴忚鍣ㄧ紦瀛樹笉鍐嶈鍙栥€?
- 浼樺寲 `/resources` 绱犳潗搴撹棰戦瑙堝姞杞界瓥鐣ワ細绉婚櫎鍒楄〃鍙樻洿鏃剁殑鍗＄墖鍏ㄩ噺棰勫姞杞斤紝鏀逛负鍗＄墖 hover 鎸夐渶鍔犺浇锛涙柊澧炰細璇濈骇棰勮缂撳瓨锛岃法椤甸潰杩斿洖绱犳潗搴撴椂澶嶇敤宸插姞杞介瑙堬紝鍑忓皯鍙嶅鈥滃姞杞介瑙堜腑鈥濄€?- 淇 FE-008 杩斿伐闂锛氫細璇濈紦瀛?key 浠?`id + updatedAt + originalVideoUrl` 璋冩暣涓?`id + originalVideoUrl`锛岄伩鍏?SPA 璺敱杩斿洖鍚庡悓涓€鍗＄墖浜屾 hover 浠嶉噸澶嶈姹傚悓涓€ stream銆?
## 2026-05-17

### Added

- 鏂板澶?Agent 鍗忎綔鍏ュ彛 `AGENTS.md`銆?- 鏂板椤圭洰鐘舵€佹枃浠?`PROJECT_STATE.md`銆?- 鏂板浠诲姟鐪嬫澘 `TASK_BOARD.md`銆?- 鏂板璺嚎鍥?`ROADMAP.md`銆?- 鏂板缁熶竴楠屾敹鏍囧噯 `ACCEPTANCE.md`銆?- 鏂板 PRD銆丄PI銆佹暟鎹簱銆乁I銆侀儴缃层€佹祴璇曡鍒掓枃妗ｃ€?- 鏂板 `scripts/check-all.sh`锛岀敤浜庡墠绔€佸悗绔€丏ocker 閰嶇疆鍏ㄩ噺妫€鏌ャ€?- 鏂板 `scripts/smoke-test.sh`锛岀敤浜庡墠绔€佸悗绔仴搴峰拰鏍稿績 API smoke test銆?- 鏂板 `scripts/deploy-staging.sh`锛岀敤浜庢湰鍦?staging compose 鍙戝竷鍜?smoke test銆?- 鏂板 `scripts/rollback.sh`锛岀敤浜庡鎵樼幇鏈夌敓浜?runtime 鍥炴粴鑴氭湰銆?- 鏂板浠诲姟鍒嗗彂鍒ゆ柇瑙勫垯锛屾槑纭〉闈€佹€ц兘銆佹帴鍙ｃ€佸苟鍙戙€侀儴缃层€佽仈璋冨拰鏋舵瀯绫讳换鍔＄殑璐熻矗浜?Agent銆?- 鏂板鑷姩寮€鍙戦棴鐜紝鏄庣‘鐢ㄦ埛鐩爣鍒?MVP 鎷嗚В銆佸紑鍙戙€佷紭鍖栥€侀儴缃层€佹祴璇曘€佸け璐ヨ繑宸ャ€佹垚鍔熸帹杩涚殑娴佺▼銆?- 鏂板鑷姩鎵ц涓庝汉宸ョ‘璁よ竟鐣岋細寮€鍙戙€佹祴璇曘€佽繑宸ャ€佹祴璇曠幆澧冮儴缃插彲鑷姩鎵ц锛涗骇鍝佹柟鍚戙€佹暟鎹簱鐮村潖鎬у彉鏇淬€佺敓浜у彂甯冦€佷粯璐规帴鍙ｅ瘑閽ュ繀椤讳汉宸ョ‘璁ゃ€?
### Changed

- 新增后端“最近提取记录”用户隔离：`/api/v1/tools/recent-extractions` 按当前 JWT 用户读写，记录落库 `recent_extractions`（MySQL/SQLite）。
- 閲嶅啓 `docs/DATABASE.md`锛屼笌褰撳墠 `DatabaseService` 涓殑 MySQL/SQLite 琛ㄧ粨鏋勫拰绱㈠紩瀵归綈銆?- 淇璧勬簮搴撴帹鑽愬瓧骞曟ā鏉垮垵濮嬪寲鏃?`cover_url` / `preview_url` 瀛楁闀垮害涓嶈冻瀵艰嚧鎺ュ彛 500 鐨勯棶棰樸€?
### Operational Notes

- 鍓嶇鏃╂湡娌℃湁 `lint` 鑴氭湰鏃讹紝`scripts/check-all.sh` 浼氫互 `npm --prefix frontend run typecheck` 浣滀负 lint 鍏滃簳锛?026-05-18 璧?`package.json` 宸叉彁渚?`lint` gate銆?- 鍚庣 `package.json` 鐨?lint 鑴氭湰鍖呭惈 `--fix`锛宍scripts/check-all.sh` 浣跨敤 `npx eslint` 鍋氶潪鐮村潖鎬?lint锛岄伩鍏嶈嚜鍔ㄦ敼鍐欐枃浠躲€?



# 2026-05-19

- Deployed release `20260519-003`. Runtime verify and smoke test passed; public `/api/health/deep` now returns summary fields only; static asset cache headers are active online.
- OPS-PROD-001: Added repo-side production HTTPS hardening. Docker web no longer emits HSTS on internal HTTP; Compose can bind web to loopback with `WEB_BIND_HOST=127.0.0.1`; production deploy rejects non-HTTPS public origins by default; host Nginx HTTPS template/setup script and HTTPS smoke checks were added.
- OPS-PROD-002: Added production static cache headers. `/assets/*` now returns `Cache-Control: public, max-age=31536000, immutable`; `/index.html` and SPA fallback return `Cache-Control: no-cache`; smoke test now verifies both policies.
- Documented production health monitoring contract: public `/api/health/deep` monitors should use summary fields only, while detailed diagnostics require `X-Health-Token`.
