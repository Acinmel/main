# Deploy Guide

## 部署拓扑

Docker Compose 服务：

- `web`：Nginx，托管前端静态资源，反代 `/api` 到 `api:3000`。
- `api`：NestJS 后端，端口 `3000`，对外由 web 反代。
- `mysql`：MySQL 8，存储用户、资源、作品、审计、任务状态。

默认外部访问：

- Web：`http://127.0.0.1:8080`
- API：`http://127.0.0.1:8080/api`

## 本地开发

安装依赖：

```bash
npm --prefix frontend ci
npm --prefix backend ci
```

启动后端：

```bash
npm run dev:backend
```

启动前端：

```bash
npm run dev:frontend
```

访问：

```text
http://127.0.0.1:5173
http://127.0.0.1:3000/api
```

## 本地 Docker

```bash
docker compose up -d --build
docker compose ps
bash scripts/smoke-test.sh
```

构建上下文说明：

- 前端镜像只需要 `src`、`public`、`index.html`、Vite/TS 配置和 package 文件；`frontend/.dockerignore` 会排除 `dist`、`node_modules`、生成 `.js` 副本和未使用 PNG 备份。
- 后端镜像通过 apt 安装系统 `ffmpeg`，不再依赖 `ffmpeg-static` / `ffprobe-static` npm 包；`backend/.dockerignore` 会排除本地 `ffmpeg/`、`uploads/`、`data/`、日志和媒体临时文件。

停止：

```bash
docker compose down
```

注意：不要使用 `docker compose down -v`，除非明确要删除数据库和上传数据。

## Staging

使用独立 project 和默认避让端口：

- `COMPOSE_PROJECT_NAME=shuziren-staging`
- `WEB_PORT=18080`
- `MYSQL_HOST_PORT=13306`

执行：

```bash
bash scripts/deploy-staging.sh
```

访问：

```text
http://127.0.0.1:18080
http://127.0.0.1:18080/api
```

可覆盖：

```bash
WEB_PORT=19080 MYSQL_HOST_PORT=13307 bash scripts/deploy-staging.sh
```

## 生产发布

开发机或 CI 构建 release 包：

```bash
APP_VERSION=20260517-001 bash deploy/build-release.sh
```

上传 `dist-release/shuziren-release-20260517-001.zip` 到服务器并解压。

服务器运行：

```bash
SHUZIREN_RUNTIME_DIR=/opt/shuziren-runtime bash deploy-runtime.sh
```

生产 env 文件默认：

```text
/opt/shuziren-runtime/.env
/opt/shuziren-runtime/backend.env
```

## 必填生产环境变量

| 变量 | 用途 |
|---|---|
| `JWT_SECRET` | JWT 签名密钥，生产必填 |
| `CORS_ORIGINS` | 浏览器允许来源，生产必填 |
| `MYSQL_ROOT_PASSWORD` | MySQL root 密码 |
| `MYSQL_DATABASE` | 业务库，默认 `koubo` |
| `MYSQL_USER` | 业务用户 |
| `MYSQL_PASSWORD` | 业务用户密码 |
| `PUBLIC_BASE_URL` | 后端对外可访问根地址 |
| `PUBLIC_UPLOAD_BASE_URL` | 上传文件对外访问地址 |
| `DASHSCOPE_API_KEY` | ASR/TTS 供应商 |
| `ARK_API_KEY` | Ark 图像/视频供应商 |
| `DY_DOWNLOADER_COOKIE` | 抖音下载能力 |

## OSS（声音样本可选）

当 `VOICE_SAMPLE_STORAGE=oss` 时，声音样本会存到 OSS，`/api/v1/resources/voice-files/*/stream` 继续可用。后端会以流式方式代理 OSS 对象，避免试听和 provider 回读时把完整音频先读入内存。

| 变量 | 用途 |
|---|---|
| `VOICE_SAMPLE_STORAGE` | `local` 或 `oss` |
| `VOICE_SAMPLE_OSS_PREFIX` | OSS 对象前缀，默认 `voice-samples` |
| `ALI_OSS_ACCESS_KEY_ID` | OSS AccessKeyId |
| `ALI_OSS_ACCESS_KEY_SECRET` | OSS AccessKeySecret |
| `ALI_OSS_BUCKET` | OSS Bucket |
| `ALI_OSS_REGION` | OSS Region（如 `oss-cn-hangzhou`） |
| `ALI_OSS_ENDPOINT` | OSS Endpoint（可替代 region） |

### 线上 OSS 当前配置

当前线上声音样本已切换到 OSS：

```text
VOICE_SAMPLE_STORAGE=oss
VOICE_SAMPLE_OSS_PREFIX=voice-samples
ALI_OSS_BUCKET=shuziren-acc
ALI_OSS_REGION=oss-cn-beijing
ALI_OSS_ENDPOINT=https://oss-cn-beijing-internal.aliyuncs.com
```

说明：

- AccessKey 只保存在服务器 `/opt/shuziren-runtime/.env` 和 `/opt/shuziren-runtime/backend.env`，不要写入仓库。
- 服务器在阿里云 ECS 上时优先使用内网 endpoint，避免 OSS 公网流量。
- Bucket 保持私有，浏览器侧不直接访问 OSS；前端继续通过后端 `voice-files/*/stream` 和 provider stream 接口读取。

验证命令：

```bash
cd /opt/shuziren-runtime/current
docker compose --env-file .deploy.env -p shuziren -f compose.runtime.yml ps
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS http://127.0.0.1:8080/api/health/deep
docker exec -i shuziren-api-1 node - <<'NODE'
const OSS = require('ali-oss');
const client = new OSS({
  accessKeyId: process.env.ALI_OSS_ACCESS_KEY_ID,
  accessKeySecret: process.env.ALI_OSS_ACCESS_KEY_SECRET,
  bucket: process.env.ALI_OSS_BUCKET,
  region: process.env.ALI_OSS_REGION,
  endpoint: process.env.ALI_OSS_ENDPOINT,
});
const key = `${process.env.VOICE_SAMPLE_OSS_PREFIX || 'voice-samples'}/ops-check/${Date.now()}.txt`;
(async () => {
  await client.put(key, Buffer.from('oss-ok'));
  const got = await client.get(key);
  const body = Buffer.isBuffer(got.content) ? got.content.toString('utf8') : String(got.content || '');
  if (body !== 'oss-ok') throw new Error(`unexpected content: ${body}`);
  await client.delete(key);
  console.log(JSON.stringify({ ok: true, bucket: process.env.ALI_OSS_BUCKET, keyDeleted: key }));
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
NODE
```

回滚到本地声音样本：

```bash
sed -i 's/^VOICE_SAMPLE_STORAGE=.*/VOICE_SAMPLE_STORAGE=local/' /opt/shuziren-runtime/.env /opt/shuziren-runtime/backend.env
cd /opt/shuziren-runtime/current
docker compose --env-file .deploy.env -p shuziren -f compose.runtime.yml up -d api
```

密钥权限要求：

- 推荐使用 RAM 子账号，不使用主账号 AccessKey。
- 权限范围收敛到 `acs:oss:*:*:shuziren-acc/voice-samples/*`。
- 需要允许 `oss:PutObject`、`oss:GetObject`、`oss:DeleteObject`，如需列举排查可临时允许 `oss:ListObjects`。
- 如果 AccessKey 曾暴露在聊天或工单中，应在 RAM 控制台轮换密钥，并更新服务器 env 后重启 API。

当前线上已创建专用 RAM 用户 `shuziren-oss-runtime` 和自定义策略 `ShuzirenVoiceSamplesOssAccess`。服务器已切换到该用户的新 AccessKey，并验证 OSS 写入/读取/删除通过。旧 AK 前缀为 `LTAI5t7j` 的 AccessKey 已由用户在阿里云 RAM 控制台禁用；如确认不再需要回滚，可继续在 RAM 控制台删除旧 AccessKey。

## 可选性能环境变量

| 变量 | 默认值 | 用途 |
|---|---:|---|
| `AI_API_MAX_CONCURRENCY` | `4` | AI 调用并发 |
| `FFMPEG_MAX_CONCURRENCY` | `2` | FFmpeg 并发 |
| `RENDER_QUEUE_CONCURRENCY` | `1` | 渲染并发 |
| `RATE_LIMIT_AUTH_MAX` | `20` | auth 限流 |
| `RATE_LIMIT_AI_MAX` | `60` | tools 限流 |
| `HTTP_SLOW_LOG_MS` | `800` | 慢请求日志阈值 |

## Smoke Test

Docker 默认环境：

```bash
FRONTEND_URL=http://127.0.0.1:8080 API_BASE_URL=http://127.0.0.1:8080/api bash scripts/smoke-test.sh
```

本地开发环境：

```bash
FRONTEND_URL=http://127.0.0.1:5173 API_BASE_URL=http://127.0.0.1:3000/api bash scripts/smoke-test.sh
```

带 token 的鉴权检查：

```bash
SMOKE_TOKEN="$TOKEN" bash scripts/smoke-test.sh
```

## 回滚

生产回滚：

```bash
bash scripts/rollback.sh
```

实际委托：

```bash
bash deploy/rollback.sh
```

回滚逻辑：

- 读取 `/opt/shuziren-runtime/previous-version`。
- 切换 `/opt/shuziren-runtime/current` 软链接。
- 使用上一版本 `compose.runtime.yml` 重启。
- 执行 web 和 api health check。
- 不删除数据卷。

## 日志查看

本地 Docker：

```bash
docker compose logs -f api
docker compose logs -f web
docker compose logs -f mysql
```

staging：

```bash
docker compose -p shuziren-staging logs -f api
```

生产 runtime：

```bash
docker compose -p shuziren --env-file /opt/shuziren-runtime/.env -f /opt/shuziren-runtime/current/compose.runtime.yml logs -f api
```

## Ops Deployment Guardrails

Deployment now fails before user traffic when runtime dependencies are missing.

Required flow:

```bash
bash scripts/preflight-check.sh
docker compose --env-file .deploy.env config
docker compose --env-file .deploy.env build
docker compose --env-file .deploy.env up -d mysql
bash scripts/run-migrations.sh
docker compose --env-file .deploy.env up -d
bash scripts/smoke-test.sh
bash scripts/verify-runtime.sh
```

Production source deploy:

```bash
cp .env.example .env
# Fill secrets on the server. Do not commit .env.
bash scripts/deploy-prod.sh
```

Artifact deploy:

```bash
APP_VERSION=20260517-001 bash deploy/build-release.sh
# Upload and unzip dist-release/shuziren-release-20260517-001.zip
bash deploy-runtime.sh
```

Important checks:

- Deployment scripts generate `.deploy.env` from the server env file plus `VERSION`, then every `docker compose` command must use `--env-file .deploy.env`.
- `scripts/verify-runtime.sh` prints `APP_VERSION`, `GIT_COMMIT`, `BUILD_TIME_UTC`, and `VITE_API_BASE_URL`; it exits immediately if `APP_VERSION` is empty.
- `.env` must define public URLs, MySQL credentials, `JWT_SECRET`, storage directories, `FFMPEG_BIN`, `YTDLP_BIN`, `ASR_PYTHON_BIN`, and `ASR_FUNASR_SCRIPT`.
- `backend/scripts/dashscope_funasr_transcribe.py` must be present in the release package and backend image.
- `database/migrations/*.sql` is executed automatically by deployment scripts. Do not manually run `ALTER TABLE` on production.
- `/api/health` must stay public-minimal (`ok`, `app`, `version` only). `/api/health/deep` must return summary by default and expose detailed diagnostics only with `X-Health-Token` (or loopback access).
- `BUILD_INFO.json` is generated during release packaging or Docker build and printed during backend startup.

## Release Route Preflight (BE-015)

To avoid deploying a package that misses critical backend routes, release build now enforces route existence checks in two places:

1. After `npm --prefix backend run build`:
   - verifies `backend/dist/modules/tools/tools.controller.js`
2. After packaging files into `dist-release/<package>/backend/dist`:
   - verifies package copy of `tools.controller.js`

Checked markers:

- `Get)('recent-extractions')` (`GET /api/v1/tools/recent-extractions`)
- `Post)('recent-extractions')` (`POST /api/v1/tools/recent-extractions`)

Manual check command:

```bash
node scripts/verify-release-routes.js --backend-dist-dir backend/dist --context manual-backend-dist
node scripts/verify-release-routes.js --backend-dist-dir dist-release/<package>/backend/dist --context manual-package-dist
```

## Subtitle Font Runtime (BE font hotfix)

- Backend Docker images now install CJK fonts: `fonts-noto-cjk` and `fonts-wqy-zenhei` (with `fontconfig`).
- Docker build runs `fc-cache -f -v` to refresh font cache.
- ASS default subtitle font is `Noto Sans CJK SC` (replacing `Microsoft YaHei`) to ensure Linux runtime consistency.

## Health Endpoint Exposure Guard (BE-PROD-001)

- Optional env: `HEALTH_DEEP_TOKEN` (recommended in production).
- Public checks:
  - `curl -fsS http://127.0.0.1:8080/api/health`
  - `curl -fsS http://127.0.0.1:8080/api/health/deep`
- Detailed checks:
  - `curl -fsS -H "X-Health-Token: ${HEALTH_DEEP_TOKEN}" http://127.0.0.1:8080/api/health/deep`
- Scripts `scripts/smoke-test.sh` and `scripts/verify-runtime.sh` now support `HEALTH_DEEP_TOKEN` and will send `X-Health-Token` automatically when the variable is set.
# Production HTTPS checklist (OPS-PROD-001)

Production must not expose login, bearer tokens, uploads, or admin requests over public HTTP.

Required public environment values:

```bash
PUBLIC_BASE_URL=https://your-domain.example
PUBLIC_UPLOAD_BASE_URL=https://your-domain.example/uploads
CORS_ORIGINS=https://your-domain.example
TRUST_PROXY=1
WEB_BIND_HOST=127.0.0.1
```

Nginx/TLS setup:

```bash
APP_DOMAIN=your-domain.example \
ACME_EMAIL=ops@example.com \
bash deploy/setup-https-nginx.sh
```

Verification:

```bash
curl -I http://your-domain.example/
curl -I https://your-domain.example/
FRONTEND_URL=https://your-domain.example REQUIRE_HTTPS=1 bash scripts/smoke-test.sh
```

Expected:

- `http://your-domain.example/` returns `301`, `302`, `307`, or `308` to HTTPS.
- HTTP redirect responses do not include `Strict-Transport-Security`.
- HTTPS responses include `Strict-Transport-Security`.
- `/api/v1/auth/login` and `/api/v1/auth/me` are only called from the HTTPS origin.

Notes:

- Browser-trusted HTTPS requires a real domain. A raw public IP cannot get a normal Let's Encrypt certificate.
- HSTS is configured at the host HTTPS Nginx layer. The Docker web container must not add HSTS on its internal HTTP port.
- In production, bind Docker web to loopback with `WEB_BIND_HOST=127.0.0.1`; otherwise users can bypass HTTPS through `http://server-ip:8080`.

## Static asset cache policy (OPS-PROD-002)

The frontend container Nginx must use different cache policies for immutable build assets and HTML entry files:

```text
/assets/*    Cache-Control: public, max-age=31536000, immutable
/index.html  Cache-Control: no-cache
SPA fallback Cache-Control: no-cache
```

Verification after deployment:

```bash
curl -I https://your-domain.example/index.html
curl -I https://your-domain.example/assets/<hashed-file>.js
FRONTEND_URL=https://your-domain.example REQUIRE_HTTPS=1 bash scripts/smoke-test.sh
```

## Health monitoring contract

Production monitoring should not depend on the old public `/api/health/deep` detail fields such as:

- `build.gitCommit`
- `build.includedFiles`
- `checks.<item>.details`
- internal paths returned by storage, ASR, Python, ffmpeg, yt-dlp, or schema checks

Public checks should use the summary contract only:

```bash
curl -fsS https://your-domain.example/api/health
curl -fsS https://your-domain.example/api/health/deep
```

Expected public `/api/health/deep` shape:

```json
{
  "ok": true,
  "app": "shuziren-api",
  "version": "20260519-002",
  "checks": {
    "database": { "ok": true },
    "storage": { "ok": true },
    "asrScript": { "ok": true },
    "python": { "ok": true },
    "ffmpeg": { "ok": true },
    "ytdlp": { "ok": true },
    "schema": { "ok": true }
  }
}
```

Detailed diagnostics are for controlled operations only. Configure a server-side secret and pass it explicitly:

```bash
HEALTH_DEEP_TOKEN=replace-with-random-long-secret
curl -fsS -H "X-Health-Token: ${HEALTH_DEEP_TOKEN}" \
  https://your-domain.example/api/health/deep
```

`scripts/smoke-test.sh` and `scripts/verify-runtime.sh` already support `HEALTH_DEEP_TOKEN`. Without it they only require valid JSON and should not parse legacy detail fields.
