# VPS 部署说明（Docker Compose）

本仓库已支持 **前端静态站 + Nginx 反代 + Nest API + Whisper + MySQL** 的一体化部署。应用代码**未使用 Redis**，服务器上的 Redis 可留给其他服务，无需为本项目单独配置。

## 最快：全新 ECS 一键部署（清空/空目录后）

**默认安装目录**：`/opt/shuziren`（目录须不存在或为空，脚本会 `git clone`）。

**方式 A — 两行（不依赖 raw 文件 URL，最稳）**（GitHub）：

```bash
git clone --depth 1 https://github.com/你的用户/shuziren.git /opt/shuziren
sudo bash /opt/shuziren/deploy/oneclick-fresh-install.sh --no-clone
```

**方式 B — 单条 curl**（需已 `push` 到 GitHub，分支名与 URL 一致，例如 `main`）：

```bash
curl -fsSL "https://raw.githubusercontent.com/你的用户/shuziren/main/deploy/oneclick-fresh-install.sh" | sudo bash -s -- --repo-url "https://github.com/你的用户/shuziren.git"
```

使用 **Gitee** 时，把克隆地址换成 `https://gitee.com/...`，raw 用 `https://gitee.com/.../raw/main/deploy/oneclick-fresh-install.sh` 即可。

**删库卷重来**（仅当 `$INSTALL_DIR` 里**已有** `docker-compose.yml` 时才会 `down -v`；**会清空 MySQL 卷**）：

```bash
sudo bash /opt/shuziren/deploy/oneclick-fresh-install.sh --no-clone --purge-volumes
```

若以前用 Docker 部署在**别的路径**，旧数据卷可能仍在，可到旧目录执行 `docker compose down -v`，或 `docker volume ls` 后按需删除。

脚本说明：[`deploy/oneclick-fresh-install.sh`](./deploy/oneclick-fresh-install.sh)。

---

## 已有代码：只启动容器

```bash
cd /opt/shuziren          # 改成你的项目路径
sudo bash deploy/quickstart-server.sh
```

脚本会：**按需安装 Docker**、**自动生成** `.env` 密钥、尝试放行 `firewalld`、`docker compose up -d --build`，并打印访问说明。

**公网打不开时**：安全组放行 **`TCP 8080`**（与 `.env` 中 `WEB_PORT` 一致），浏览器使用 **`http://公网IP:8080/`**。

其他：[`deploy/quickstart-server.sh`](./deploy/quickstart-server.sh)、[`deploy/bootstrap-server.sh`](./deploy/bootstrap-server.sh)（手写 `.env` 时用）。

## 0. 关于「远程代部署」与本机自动化

- 从本机 **SSH 连接服务器** 需要 **公钥认证** 或你在终端里 **手动输入密码**；自动化环境不能使用聊天里的密码，也无法代替你完成交互式登录。
- 请在本机生成密钥并登记到服务器（示例）：
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_koubo -N ""
  ssh-copy-id -i ~/.ssh/id_ed25519_koubo.pub root@你的服务器IP
  ssh -i ~/.ssh/id_ed25519_koubo root@你的服务器IP
  ```
- 连上服务器后，先 **克隆或 rsync 完整项目** 到如 `/opt/koubo-remake`，再执行上一节 **`quickstart-server.sh`** 或：
  ```bash
  git clone 'https://你的仓库/shuziren.git' /opt/koubo-remake
  cd /opt/koubo-remake
  sudo bash deploy/quickstart-server.sh
  ```
  无 git 时：将整个项目目录同步到服务器后，同样 `cd` 到该目录执行 `sudo bash deploy/quickstart-server.sh`。

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

**宿主机 Nginx 与 Docker 同时装时**：二选一，避免乱配。

- **方案 A（最简单）**：不装/停用宿主机 Nginx，安全组只放行 Docker 映射端口（默认 **8080**），浏览器访问 `http://IP:8080/`。
- **方案 B**：宿主机 Nginx 监听 **80**，整站反代到 **`127.0.0.1:8080`**（与 `.env` 里 `WEB_PORT` 一致）。参考仓库内 [`deploy/nginx-host-reverse-proxy.conf`](./deploy/nginx-host-reverse-proxy.conf)。不要用宿主机 Nginx 的 `root` 指到错误目录又去反代 API，容易 404/500。

## 7.1 网页一直 500 / 打不开：排查顺序

在**服务器**上执行（项目根目录）：

```bash
docker compose ps
curl -sS -o /dev/null -w "首页 HTTP %{http_code}\n" http://127.0.0.1:8080/
curl -sS -o /dev/null -w "API HTTP %{http_code}\n" http://127.0.0.1:8080/api
docker compose logs --tail=80 api
docker compose logs --tail=40 web
```

- **`api` 不是 `healthy` 或不断重启**：看 `api` 日志；常见是 **MySQL 密码与数据卷里旧库不一致**（曾改过 `.env`）。可 **`docker compose down`** 后确认 `.env` 与 `docker-compose.yml` 中 MySQL 一致再 **`docker compose up -d`**；开发环境可 **`docker compose down -v`** 清空库卷重来（**会丢库**）。
- **本机 `curl` 正常、公网不行**：查云安全组是否放行 **`WEB_PORT`**（及宿主机 Nginx 若占 80 则放行 80）。
- **`GET /api` 需匿名探活**：后端已为根路由加了 **`@Public()`**，返回 200 + `Hello World!` 即表示 API 进程正常。

## 8. 更新发布

```bash
cd shuziren
git pull
docker compose up -d --build
```

数据卷：`mysql_data`（若使用内置 MySQL）、`video_downloads`（下载的视频缓存）会保留，除非手动 `docker volume rm`。

---

若你希望 **非 Docker**（systemd + 本机 Node/Python），可再单独拆一套脚本；当前维护路径以 Compose 为准。
