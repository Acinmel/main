# VPS 部署说明（Docker Compose）

本仓库已支持 **前端静态站 + Nginx 反代 + Nest API + Whisper + MySQL** 的一体化部署。应用代码**未使用 Redis**，服务器上的 Redis 可留给其他服务，无需为本项目单独配置。

## 0. 关于「远程代部署」与本机自动化

- 从本机 **SSH 连接服务器** 需要 **公钥认证** 或你在终端里 **手动输入密码**；自动化环境不能使用聊天里的密码，也无法代替你完成交互式登录。
- 请在本机生成密钥并登记到服务器（示例）：
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_koubo -N ""
  ssh-copy-id -i ~/.ssh/id_ed25519_koubo.pub root@你的服务器IP
  ssh -i ~/.ssh/id_ed25519_koubo root@你的服务器IP
  ```
- 连上服务器后，先 **克隆或 rsync 完整项目** 到如 `/opt/koubo-remake`，再在**仓库根目录**执行：
  ```bash
  git clone 'https://你的仓库/shuziren.git' /opt/koubo-remake
  cd /opt/koubo-remake
  bash deploy/bootstrap-server.sh
  ```
  无 git 时：将整个项目目录同步到服务器后，同样 `cd` 到该目录执行 `bash deploy/bootstrap-server.sh`（可无 `.git`，脚本会跳过 pull）。
- 脚本路径：[`deploy/bootstrap-server.sh`](./deploy/bootstrap-server.sh)。若首次自动创建 `.env`，脚本以 **退出码 2** 结束，请编辑 `.env` 后再次执行同一命令。

## 1. 服务器准备

- 安装 **Docker** 与 **Docker Compose**（插件 `docker compose`）。
- 安全组/防火墙放行：**22**（SSH）、**80/443**（Web，按你实际端口）、以及你选用的 **`WEB_PORT`**（默认 **8080**）。
- **不要在文档或聊天中发送 root / 数据库密码**；在服务器上本地编辑 `.env`。

### 阿里云 ECS · Alibaba Cloud Linux 3（2 vCPU / 2 GiB 等）

1. **安装 Docker**（在项目目录外任意路径执行均可，需 root）：
   ```bash
   cd /opt/koubo-remake    # 或你的项目根目录
   sudo bash deploy/setup-docker-alinux.sh
   ```
   若 `dnf install` 报 GPG 或源错误，请到阿里云文档「安装 Docker」按当前地域/版本核对源地址。
2. **内存**：默认 Compose 已将 Whisper 模型默认设为 **`base`**，并在 `deploy/docker.env.example` 中写明；勿在 2GB 机器上使用 `medium` 除非已加 Swap 或升配。
3. **安全组**：入方向放行 **TCP 8080**（与 `.env` 中 `WEB_PORT` 一致）。

## 2. 获取代码

```bash
git clone <你的仓库地址> shuziren
cd shuziren
```

## 3. 环境变量

```bash
cp deploy/docker.env.example .env
nano .env   # 或 vim：至少修改 MYSQL_*、JWT_SECRET
```

将 **大模型、抖音 Cookie、Whisper 模型** 等按 `backend/.env.example` 的说明，把需要的变量**追加**到根目录 `.env` 中（Compose 会把在 `api.environment` 里引用到的变量传入容器；若你新增了自定义键，需在 `docker-compose.yml` 的 `api.environment` 中增加一行 `${VAR}` 映射）。

**生产环境必须设置强随机 `JWT_SECRET`**，例如：

```bash
openssl rand -base64 48
```

## 4. 构建并启动

在**仓库根目录**：

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
docker compose logs -f api
```

## 5. 访问方式

- 默认站点：`http://服务器公网IP:8080`（若 `.env` 里 `WEB_PORT=80` 则为 `http://服务器公网IP`）。
- 前端通过同域 **`/api`** 访问后端，无需再给浏览器单独配置后端地址。

## 6. 使用「宿主机上已有的 MySQL」

若 MySQL 已装在 VPS 上、**不想**使用 compose 里的 `mysql` 服务：

1. 在 MySQL 中创建数据库与用户，并授权（库名与 `MYSQL_DATABASE` 一致）。
2. 编辑 `docker-compose.yml`：
   - 注释或删除 **`mysql`** 整个服务；
   - 在 **`api.depends_on`** 中去掉对 `mysql` 的依赖，仅保留 `whisper`；
3. 在 `.env` 中设置例如：
   - `MYSQL_HOST=host.docker.internal`
   - `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` 与宿主机实例一致。

`api` 服务已配置 `extra_hosts: host.docker.internal:host-gateway`，便于在 Linux 上访问宿主机端口。

## 7. HTTPS 与域名（简述）

常见做法：宿主机再装 **Caddy** 或 **Nginx**，监听 443，反代到 `127.0.0.1:8080`（或你改的 `WEB_PORT`），并配置证书。此时可在 `.env` 增加 `CORS_ORIGINS=https://你的域名`。

## 8. 更新发布

```bash
cd shuziren
git pull
docker compose up -d --build
```

数据卷：`mysql_data`（若使用内置 MySQL）、`video_downloads`（下载的视频缓存）会保留，除非手动 `docker volume rm`。

---

若你希望 **非 Docker**（systemd + 本机 Node/Python），可再单独拆一套脚本；当前维护路径以 Compose 为准。
