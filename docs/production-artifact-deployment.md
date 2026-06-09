# Production Artifact Deployment

生产环境推荐使用构建产物发布，而不是在服务器上保留完整源码并现场构建。

## Artifact Content

- 前端 `frontend/dist`。
- 后端 `backend/dist`。
- 运行所需 package manifests。
- Dockerfile 和 compose runtime 文件。
- Nginx 配置。
- 版本号和校验信息。

真实 `.env`、生产密钥、数据库备份和上传文件不进入发布包。

## Production Rules

- 服务器只保存当前版本、上一版本、持久化数据和环境变量。
- 发布前必须备份或确认数据库无破坏性变更。
- 回滚只切换应用版本，不删除数据库或上传卷。
- 发布、重启、回滚必须人工确认。

## Verification

```bash
docker compose config
curl -fsS http://127.0.0.1:8080/api/health
bash scripts/smoke-test.sh
```

线上 smoke 在未确认前只执行只读检查。
