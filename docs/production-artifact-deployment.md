# 制品化生产部署运维手册

本文档用于生产环境。目标是让服务器只保留构建产物、环境变量和数据卷，不保留项目源码。开发环境只上传一个 zip 包，服务器基于 zip 内的构建产物执行 Docker 镜像构建和部署。

## 部署原则

- 生产服务器不保留 Git 仓库和源码目录。
- 生产服务器不执行前端/后端源码构建命令，例如 `npm run build`。
- 构建机或 CI 负责生成前端 `dist`、后端 `dist`，并打成 zip 发布包。
- 生产服务器只执行解压 zip、基于构建产物 `docker compose up -d --build`、健康检查和必要回滚。
- `.env` 与 `backend.env` 只保留在服务器本地，不进入 Git，不进入发布包。
- 禁止在生产执行 `docker compose down -v`，避免删除 MySQL 和业务文件数据卷。

## 生产目录

推荐目录：

```bash
/opt/shuziren-runtime
├── .env
├── backend.env
├── current -> /opt/shuziren-runtime/releases/20260501-001
├── incoming/
├── previous-version
├── releases/
└── releases.log
```

首次准备：

```bash
sudo mkdir -p /opt/shuziren-runtime/incoming /opt/shuziren-runtime/releases
sudo cp /opt/shuziren/.env /opt/shuziren-runtime/.env
sudo cp /opt/shuziren/backend/.env /opt/shuziren-runtime/backend.env
sudo chmod 600 /opt/shuziren-runtime/.env /opt/shuziren-runtime/backend.env
```

如果当前服务器没有 `backend/.env`，可以创建空文件：

```bash
sudo touch /opt/shuziren-runtime/backend.env
sudo chmod 600 /opt/shuziren-runtime/backend.env
```

## 运行清单

生产使用仓库根目录的 `compose.runtime.yml`。该文件只允许使用 `image:`，不允许出现 `build:`。

运行时必须固定 Compose 项目名为 `shuziren`：

```bash
docker compose -p shuziren -f /opt/shuziren-runtime/current/compose.runtime.yml ps
```

原因：当前生产数据卷名称为 `shuziren_mysql_data`、`shuziren_video_downloads`、`shuziren_digital_human_storage`。项目名变化会导致 Compose 创建新数据卷，表现为数据库或业务文件“丢失”。

## 发布包内容

每个发布包命名为：

```text
shuziren-release-YYYYMMDD-NNN.zip
```

发布包内包含：

```text
shuziren-release-YYYYMMDD-NNN/
├── VERSION
├── SHA256SUMS
├── compose.runtime.yml
├── deploy-runtime.sh
├── rollback.sh
├── frontend/
│   ├── Dockerfile
│   ├── nginx-web.conf
│   └── dist/
└── backend/
    ├── Dockerfile
    ├── package.json
    ├── package-lock.json
    ├── dist/
    └── DY-DOWNLOADER/
        ├── package.json
        ├── package-lock.json
        └── dist/
```

## 部署步骤

开发环境只上传一个 zip 发布包到服务器：

```bash
scp dist-release/shuziren-release-20260501-001.zip root@服务器IP:/opt/shuziren-runtime/incoming/
```

服务器执行：

```bash
cd /opt/shuziren-runtime/incoming
rm -rf shuziren-release-20260501-001
unzip shuziren-release-20260501-001.zip
cd shuziren-release-20260501-001
bash deploy-runtime.sh
```

如果服务器没有 `unzip`，可用 Python 解压：

```bash
cd /opt/shuziren-runtime/incoming
rm -rf shuziren-release-20260501-001
python3 -m zipfile -e shuziren-release-20260501-001.zip .
cd shuziren-release-20260501-001
bash deploy-runtime.sh
```

部署脚本会：

- 校验发布包内部文件。
- 将发布版本复制到 `/opt/shuziren-runtime/releases/<版本号>`。
- 在服务器基于 `frontend/dist` 和 `backend/dist` 构建 Docker 镜像。
- 更新 `/opt/shuziren-runtime/current`。
- 使用 `compose.runtime.yml` 执行 `docker compose up -d --build` 启动服务。
- 检查首页和 `/api`。
- 写入 `/opt/shuziren-runtime/releases.log`。

## 健康检查

```bash
docker compose -p shuziren -f /opt/shuziren-runtime/current/compose.runtime.yml ps
curl -i http://127.0.0.1:8080/
curl -i http://127.0.0.1:8080/api
```

通过标准：

- `mysql` 为 healthy。
- `api` 为 healthy。
- `web` 为 running。
- 首页返回 HTML。
- `/api` 返回后端探活结果。

## 回滚

如果发布后验证失败：

```bash
cd /opt/shuziren-runtime/current
bash rollback.sh
```

回滚脚本只切换镜像版本并重启容器，不删除数据卷。

禁止使用：

```bash
docker compose down -v
```

## 源码下线迁移

首次迁移时，先完成一次制品化部署和健康检查。验证通过后执行：

```bash
sudo mv /opt/shuziren /opt/shuziren-src-backup-$(date +%Y%m%d)
docker compose -p shuziren -f /opt/shuziren-runtime/current/compose.runtime.yml --env-file /opt/shuziren-runtime/.env restart
curl -i http://127.0.0.1:8080/
curl -i http://127.0.0.1:8080/api
```

观察 24 到 72 小时后，确认无需回退源码部署，再删除源码备份：

```bash
sudo rm -rf /opt/shuziren-src-backup-YYYYMMDD
```

删除前必须确认：

- `/opt/shuziren-runtime/.env` 已存在且内容正确。
- `/opt/shuziren-runtime/backend.env` 已存在。
- `/opt/shuziren-runtime/current` 指向有效发布版本。
- `docker compose -p shuziren -f /opt/shuziren-runtime/current/compose.runtime.yml ps` 正常。

## 故障处理

如果 API 连接 MySQL 失败，优先检查 `/opt/shuziren-runtime/.env` 中的 `MYSQL_*` 是否与既有数据卷初始化时一致。不要重新生成 MySQL 密码覆盖生产值。

如果公网不可访问，但服务器本机 `curl http://127.0.0.1:8080/` 正常，检查云安全组是否放行 `WEB_PORT`。

如果 `APP_VERSION is required`，说明没有通过 `deploy-runtime.sh` 启动，或手动执行 Compose 时未导出版本号。应使用：

```bash
cd /opt/shuziren-runtime/current
export APP_VERSION=$(awk -F= '$1=="APP_VERSION"{print $2}' VERSION)
docker compose -p shuziren --env-file /opt/shuziren-runtime/.env -f compose.runtime.yml up -d --build
```
