# 开发环境到服务器发布流程

本文档说明开发人员如何从本地开发环境或 CI 构建发布包，并把制品部署到生产服务器。开发环境只上传一个 zip 包；生产服务器不接收源码，只接收前端 `dist`、后端 `dist`、运行依赖清单和运行期 Dockerfile。

## 1. 开发环境准备

开发机或 CI 需要：

- Node.js 与 npm
- Git
- Python 3
- `sha256sum`

确认当前工作区状态：

```bash
git status --short
```

正式发布要求工作区干净。如果需要临时测试未提交代码，可以显式设置：

```bash
export ALLOW_DIRTY_RELEASE=1
```

设置版本号：

```bash
export APP_VERSION=20260501-001
```

版本号格式必须是 `YYYYMMDD-NNN`。

## 2. 发布前验证

在源码仓库根目录执行：

```bash
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix backend ci
npm --prefix backend run build
```

如果后端单元测试在当前分支稳定可用，执行：

```bash
RUN_BACKEND_TESTS=1 APP_VERSION=20260501-001 bash deploy/build-release.sh
```

如果只做构建校验，不运行后端测试：

```bash
APP_VERSION=20260501-001 bash deploy/build-release.sh
```

通过标准：

- 前端构建成功。
- 后端构建成功。
- `backend/DY-DOWNLOADER` 构建成功。
- 生成 `dist-release/shuziren-release-20260501-001.zip`。
- 生成 `dist-release/shuziren-release-20260501-001.zip.sha256`，用于开发环境留档或人工核对；生产服务器只需要接收 zip。

## 3. 构建发布包

标准命令：

```bash
APP_VERSION=20260501-001 bash deploy/build-release.sh
```

如果构建机在海外，可关闭国内镜像源配置：

```bash
USE_CN_MIRROR=0 APP_VERSION=20260501-001 bash deploy/build-release.sh
```

如果需要调整浏览器访问 API 的构建变量：

```bash
VITE_API_BASE_URL=/api APP_VERSION=20260501-001 bash deploy/build-release.sh
```

输出目录：

```text
dist-release/
├── shuziren-release-20260501-001/
│   ├── frontend/dist/
│   ├── backend/dist/
│   ├── backend/DY-DOWNLOADER/dist/
│   ├── compose.runtime.yml
│   ├── deploy-runtime.sh
│   └── rollback.sh
├── shuziren-release-20260501-001.zip
└── shuziren-release-20260501-001.zip.sha256
```

只需要上传：

```text
dist-release/shuziren-release-20260501-001.zip
```

## 4. 上传服务器

确保服务器已创建运行目录：

```bash
ssh root@服务器IP 'mkdir -p /opt/shuziren-runtime/incoming /opt/shuziren-runtime/releases'
```

上传发布包：

```bash
scp dist-release/shuziren-release-20260501-001.zip root@服务器IP:/opt/shuziren-runtime/incoming/
```

如果使用专用发布用户：

```bash
scp dist-release/shuziren-release-20260501-001.zip deploy@服务器IP:/opt/shuziren-runtime/incoming/
```

## 5. 服务器部署

登录服务器：

```bash
ssh root@服务器IP
```

确认服务器本地环境文件存在：

```bash
test -f /opt/shuziren-runtime/.env
test -f /opt/shuziren-runtime/backend.env || touch /opt/shuziren-runtime/backend.env
chmod 600 /opt/shuziren-runtime/.env /opt/shuziren-runtime/backend.env
```

部署：

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

部署脚本会自动：

- 校验发布包内部文件。
- 在服务器基于 zip 内的构建产物执行 Docker 镜像构建。
- 更新 `/opt/shuziren-runtime/current`。
- 启动 `web`、`api`、`mysql`。
- 执行 HTTP 健康检查。
- 写入发布记录。

## 6. 部署后验证

服务器执行：

```bash
docker compose -p shuziren -f /opt/shuziren-runtime/current/compose.runtime.yml ps
curl -i http://127.0.0.1:8080/
curl -i http://127.0.0.1:8080/api
```

浏览器验证：

```text
http://服务器公网IP:8080/
```

通过标准：

- 首页可打开。
- 登录、注册、数字人形象上传等核心页面可访问。
- `/api` 返回后端探活。
- 容器无持续重启。

查看日志：

```bash
docker compose -p shuziren -f /opt/shuziren-runtime/current/compose.runtime.yml logs --tail=100 web
docker compose -p shuziren -f /opt/shuziren-runtime/current/compose.runtime.yml logs --tail=100 api
```

## 7. 回滚

如果部署后验证失败：

```bash
cd /opt/shuziren-runtime/current
bash rollback.sh
```

回滚后再次验证：

```bash
docker compose -p shuziren -f /opt/shuziren-runtime/current/compose.runtime.yml ps
curl -i http://127.0.0.1:8080/
curl -i http://127.0.0.1:8080/api
```

禁止执行：

```bash
docker compose down -v
```

`-v` 会删除生产数据卷，可能导致数据库和上传文件丢失。

## 8. 发布记录

每次发布后查看：

```bash
tail -40 /opt/shuziren-runtime/releases.log
```

记录内容包含：

```text
版本号
发布时间
Git Commit
发布包 SHA256
验证结果
是否回滚
```

## 9. 源码下线确认

完成首次制品部署并验证通过后，在维护窗口执行：

```bash
sudo mv /opt/shuziren /opt/shuziren-src-backup-$(date +%Y%m%d)
docker compose -p shuziren -f /opt/shuziren-runtime/current/compose.runtime.yml --env-file /opt/shuziren-runtime/.env restart
curl -i http://127.0.0.1:8080/
curl -i http://127.0.0.1:8080/api
```

确认服务不依赖源码目录后，观察 24 到 72 小时，再删除备份源码目录。

生产服务器最终只保留 `/opt/shuziren-runtime`、Docker 镜像和 Docker 数据卷。
