#!/usr/bin/env bash
# 在 Linux 服务器上执行（需已安装 git 或已 rsync 完整项目到本机）。
# 请在仓库根目录调用：
#   bash deploy/bootstrap-server.sh
#
# 或任意路径：
#   bash /opt/koubo-remake/deploy/bootstrap-server.sh
#
# 首次部署前若自动生成 .env，脚本以退出码 2 结束，请编辑 .env 后再次执行本脚本或：
#   docker compose up -d --build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

compose() {
  if docker compose version &>/dev/null; then
    docker compose "$@"
  elif command -v docker-compose &>/dev/null; then
    docker-compose "$@"
  else
    echo "未找到 docker compose，请先安装 Docker Compose 插件。" >&2
    exit 1
  fi
}

need_docker() {
  if command -v docker &>/dev/null; then
    return 0
  fi
  echo "未检测到 Docker。正在尝试使用 get.docker.com 安装（需联网）…" >&2
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker 2>/dev/null || true
}

if [[ ! -f "$ROOT/docker-compose.yml" ]] || [[ ! -f "$ROOT/deploy/docker.env.example" ]]; then
  echo "未找到项目文件。请先：git clone <仓库> $ROOT 或将完整代码同步到 $ROOT" >&2
  exit 1
fi

need_docker

if [[ -d "$ROOT/.git" ]]; then
  git -C "$ROOT" pull --ff-only || true
fi

if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/deploy/docker.env.example" "$ROOT/.env"
  echo "========================================" >&2
  echo "已创建 $ROOT/.env ，请务必编辑密码、JWT_SECRET 与业务密钥后再执行：" >&2
  echo "  cd $ROOT && docker compose up -d --build" >&2
  echo "或再次运行： bash deploy/bootstrap-server.sh" >&2
  echo "========================================" >&2
  exit 2
fi

compose up -d --build
compose ps
echo "部署完成。Web 端口见 .env 中 WEB_PORT（默认 8080）。" >&2
