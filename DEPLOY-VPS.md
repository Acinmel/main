# VPS Deployment Note

本文件只保留 VPS 部署入口说明。详细部署步骤以 `docs/DEPLOY.md` 为准。

## Current Runtime

- Docker Compose 编排 `web`、`api`、`mysql`。
- `web` 提供前端静态站点并反代 `/api`。
- `api` 运行 NestJS 后端。
- 媒体处理依赖 FFmpeg。
- 生产数据库和上传目录必须持久化。

## Standard Checks

```bash
docker compose config
docker compose up -d --build
bash scripts/smoke-test.sh
```

## Production Safety

- 不在生产执行 `docker compose down -v`。
- 不在生产清空数据库卷或上传卷。
- 不在未确认的情况下重启生产服务。
- 不在未确认的情况下调用真实付费 AI provider。

## See Also

- `docs/DEPLOY.md`
- `docs/TEST_PLAN.md`
- `scripts/deploy-staging.sh`
- `scripts/rollback.sh`
