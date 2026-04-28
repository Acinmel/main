#!/usr/bin/env bash
# 服务器上一键：装 Docker（如需）→ 国内自动配镜像加速 → 生成 .env → 启动全部容器
# 用法（必须在项目根目录，且建议 root，否则无法写镜像配置）：
#   cd /opt/shuziren && sudo bash deploy/quickstart-server.sh
#
# 跳过自动镜像：SKIP_AUTO_DOCKER_MIRROR=1 sudo bash deploy/quickstart-server.sh
# 公网访问不了：看脚本末尾「安全组」说明。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${QUICKSTART_ROOT:-}" ]]; then
  ROOT="$(cd "$QUICKSTART_ROOT" && pwd)"
else
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT"

# BuildKit：层缓存与 RUN --mount 缓存，国内重复构建明显更快
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

compose() {
  if docker compose version &>/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose &>/dev/null; then
    docker-compose "$@"
  else
    echo "未找到 docker compose。" >&2
    exit 1
  fi
}

ensure_docker() {
  if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    return 0
  fi
  echo ">>> 未检测到 Docker，开始安装（需要 root 权限）…" >&2
  if [[ "${EUID:-0}" -ne 0 ]]; then
    if command -v sudo &>/dev/null; then
      exec sudo env QUICKSTART_ROOT="$ROOT" bash "$ROOT/deploy/quickstart-server.sh"
    fi
    echo "请用 root 执行：sudo bash deploy/quickstart-server.sh" >&2
    exit 1
  fi
  if [[ -f "$ROOT/deploy/setup-docker-alinux.sh" ]]; then
    bash "$ROOT/deploy/setup-docker-alinux.sh"
  else
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
  fi
}

# 国内 ECS 直连 registry-1.docker.io 常超时；未配置过镜像时自动写入公共加速（可换阿里云专属地址）
ensure_docker_hub_mirror() {
  [[ "${SKIP_AUTO_DOCKER_MIRROR:-}" == "1" ]] && return 0
  [[ "${EUID:-0}" -ne 0 ]] && {
    echo ">>> 提示：请用 root 执行本脚本（sudo），否则无法自动配置 Docker 镜像加速，拉 mysql 等镜像易失败。" >&2
    return 0
  }
  if [[ -f /etc/docker/daemon.json ]] && grep -q 'registry-mirrors' /etc/docker/daemon.json 2>/dev/null; then
    return 0
  fi
  echo ">>> 未检测到 Docker 镜像加速，正在为国内网络自动配置（DaoCloud 公共源）…" >&2
  if ! command -v python3 &>/dev/null; then
    if command -v dnf &>/dev/null; then
      dnf install -y python3 >/dev/null 2>&1 || true
    elif command -v apt-get &>/dev/null; then
      apt-get update -qq && apt-get install -y python3 >/dev/null 2>&1 || true
    fi
  fi
  if [[ -f "$ROOT/deploy/setup-docker-registry-mirror.sh" ]] && command -v python3 &>/dev/null; then
    bash "$ROOT/deploy/setup-docker-registry-mirror.sh" https://docker.m.daocloud.io || true
  else
    echo ">>> 无法自动写 daemon.json（缺 python3 或脚本）。请手动执行：sudo bash deploy/setup-docker-registry-mirror.sh <你的镜像地址>" >&2
  fi
}

ensure_env() {
  local need_gen=0
  if [[ ! -f "$ROOT/.env" ]]; then
    need_gen=1
    cp "$ROOT/deploy/docker.env.example" "$ROOT/.env"
  # 仅有空行/注释：等同「空 .env」，docker 会用 compose 默认值连库，与已有 MySQL 卷密码常不一致 → 注册/登录全挂
  elif ! grep -qE '^[^#[:space:]]' "$ROOT/.env" 2>/dev/null; then
    need_gen=1
    cp "$ROOT/deploy/docker.env.example" "$ROOT/.env"
  elif grep -qE '请改为强密码|请使用 openssl' "$ROOT/.env" 2>/dev/null; then
    need_gen=1
  fi
  if [[ "$need_gen" -eq 1 ]]; then
    local rpw upw jwt
    rpw=$(openssl rand -hex 16)
    upw=$(openssl rand -hex 16)
    jwt=$(openssl rand -hex 48)
    sed -i "s/^MYSQL_ROOT_PASSWORD=.*/MYSQL_ROOT_PASSWORD=${rpw}/" "$ROOT/.env"
    sed -i "s/^MYSQL_PASSWORD=.*/MYSQL_PASSWORD=${upw}/" "$ROOT/.env"
    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${jwt}/" "$ROOT/.env"
    echo ">>> 已写入随机 MySQL 密码与 JWT_SECRET 到 .env（请自行备份 .env，勿提交 git）" >&2
    echo ">>> 【重要】若 ECS 上 MySQL 数据卷是以前用「另一套密码」初始化的，新密码与库里不一致会导致 API 连不上库（注册/登录失败、502）。" >&2
    echo ">>> 请从备份恢复当时的 MYSQL_* / JWT_SECRET，或确认可清空数据后执行：cd $ROOT && docker compose down -v && docker compose up -d" >&2
  fi
  if ! grep -qE '^BCRYPT_ROUNDS=' "$ROOT/.env" 2>/dev/null; then
    echo "BCRYPT_ROUNDS=8" >> "$ROOT/.env"
    echo ">>> 已追加 BCRYPT_ROUNDS=8（小内存机器减轻注册时 OOM/502）" >&2
  fi
}

open_firewall_port() {
  local port="${1:-8080}"
  if command -v firewall-cmd &>/dev/null && systemctl is-active firewalld &>/dev/null; then
    firewall-cmd --permanent --add-port="${port}/tcp" 2>/dev/null || true
    firewall-cmd --reload 2>/dev/null || true
    echo ">>> 已尝试放行 firewalld 端口 ${port}/tcp" >&2
  fi
}

if [[ ! -f "$ROOT/docker-compose.yml" ]] || [[ ! -f "$ROOT/deploy/docker.env.example" ]]; then
  echo "请在完整项目根目录执行（需含 docker-compose.yml）。当前：$ROOT" >&2
  exit 1
fi

ensure_docker
ensure_docker_hub_mirror
ensure_env

WEB_PORT=$(grep -E '^WEB_PORT=' "$ROOT/.env" | head -1 | cut -d= -f2 | tr -d '\r' || true)
WEB_PORT=${WEB_PORT:-8080}
open_firewall_port "$WEB_PORT"

# 数字人形象：密钥只在根 .env（git 不同步）；缺则线上一直提示未配置
if [[ -f "$ROOT/.env" ]]; then
  if ! grep -qE '^[[:space:]]*ARK_API_KEY=[^[:space:]]' "$ROOT/.env" 2>/dev/null \
    && ! grep -qE '^[[:space:]]*SEEDREAM_HTTP_URL=[^[:space:]]' "$ROOT/.env" 2>/dev/null \
    && ! grep -qE '^[[:space:]]*DIGITAL_HUMAN_API_URL=[^[:space:]]' "$ROOT/.env" 2>/dev/null; then
    echo ">>> 【重要】根目录 .env 未配置 ARK_API_KEY（或 SEEDREAM_* / DIGITAL_HUMAN_API_URL），数字人形象将提示未配置。" >&2
    echo ">>> git 不会提交 .env；请在服务器编辑 $ROOT/.env 追加密钥，或从本机 scp .env 上来。示例见 deploy/docker.env.example" >&2
  fi
else
  echo ">>> 提示：尚无 $ROOT/.env，本次将由 ensure_env 从 docker.env.example 生成（需再自行追加 ARK_API_KEY 等）。 " >&2
fi

if [[ -f "$ROOT/backend/whisper-python-service/Dockerfile" ]] && ! grep -q 'mirrors.aliyun.com' "$ROOT/backend/whisper-python-service/Dockerfile" 2>/dev/null; then
  echo ">>> 【重要】当前 Whisper Dockerfile 仍是旧版（无阿里云 apt 换源），在国内 ECS 上 apt 可能卡 1 小时以上。" >&2
  echo ">>> 请先 git pull / 同步仓库后再构建；正确文件约 1.2KB+，且含 mirrors.aliyun.com。" >&2
fi

echo ">>> 构建并启动容器（首次需拉基础镜像 + 装依赖；已启用 BuildKit。仅当日志里 apt 仍显示 deb.debian.org 说明未更新 Dockerfile）…" >&2
compose up -d --build

echo ""
echo "========== 容器状态 =========="
compose ps
echo ""

if curl -fsS -o /dev/null -w '' --connect-timeout 3 "http://127.0.0.1:${WEB_PORT}/" 2>/dev/null; then
  echo ">>> 本机检测：http://127.0.0.1:${WEB_PORT}/ 可访问"
else
  echo ">>> 本机检测：${WEB_PORT} 端口尚未响应（容器可能仍在启动），请稍后执行： docker compose ps && docker compose logs web"
fi

PUB=$(curl -fsS --connect-timeout 3 https://ifconfig.me 2>/dev/null || curl -fsS --connect-timeout 3 https://api.ipify.org 2>/dev/null || echo '（未能自动获取）')

echo ""
echo "========== 浏览器访问 =========="
echo "  地址示例: http://${PUB}:${WEB_PORT}/"
echo "  若 ${PUB} 显示异常，请用手动记录的「公网 IP」替换。"
echo ""
echo "========== 若仍无法打开网页，请检查 =========="
echo "  1) 云控制台「安全组」入方向放行 TCP ${WEB_PORT}（以及 22）。"
echo "  2) 地址必须带端口 :${WEB_PORT}（除非你把 WEB_PORT 改成 80）。"
echo "  3) 查看日志: cd $ROOT && docker compose logs -f web api"
echo ""
