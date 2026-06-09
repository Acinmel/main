# Development To Server Release Flow

本文档保留发布流程摘要。详细规则以 `docs/DEPLOY.md` 和 `docs/TEST_PLAN.md` 为准。

## Local Or CI Build

```bash
npm --prefix frontend install
npm --prefix frontend run build
npm --prefix backend install
npm --prefix backend run test
npm --prefix backend run build
```

## Staging Release

```bash
bash scripts/check-all.sh
bash scripts/deploy-staging.sh
bash scripts/smoke-test.sh
```

staging 必须使用独立数据库、独立上传目录和非生产密钥。

## Production Release

production 发布前必须人工确认：

- 版本和变更范围。
- 数据库影响。
- 环境变量影响。
- 回滚方案。
- smoke test 计划。

未确认前不得执行生产发布、重启或回滚。
