#!/usr/bin/env bash
# =============================================================================
# 全新 / 重装 ECS 一键部署（建议 root 执行）
#
# 典型用法（阿里云已重装或已手动清空旧项目后）：
#
#   sudo bash deploy/oneclick-fresh-install.sh \
#     --repo-url https://github.com/你的用户/shuziren.git
#
# 若代码已在目录中（例如 scp 过），不要克隆：
#
#   sudo bash deploy/oneclick-fresh-install.sh --no-clone --install-dir /root/shuziren
#
# 若目录里曾有 Docker Compose，想删掉 MySQL 等数据卷重来：
#
#   sudo bash deploy/oneclick-fresh-install.sh --repo-url ... --purge-volumes
#
# 也可用环境变量：INSTALL_DIR、REPO_URL（与命令行二选一）
# =============================================================================

set -euo pipefail

# 通过 curl | bash 运行时 BASH_SOURCE 可能为 -，不能依赖脚本所在目录
_THIS="${BASH_SOURCE[0]:-}"
if [[ -n "$_THIS" && "$_THIS" != "-" && "$_THIS" != "/dev/stdin" && -f "$_THIS" ]]; then
  ONECLICK_DIR="$(cd "$(dirname "$_THIS")" && pwd)"
else
  ONECLICK_DIR=""
fi
unset _THIS

INSTALL_DIR="${INSTALL_DIR:-/opt/shuziren}"
REPO_URL="${REPO_URL:-}"
PURGE_VOLUMES=0
NO_CLONE=0

usage() {
  cat <<'EOF'
用法: sudo bash deploy/oneclick-fresh-install.sh [选项]
  --repo-url <url>       克隆地址（目录须为空）；也可 export REPO_URL=
  --install-dir <path>   默认 /opt/shuziren；也可 export INSTALL_DIR=
  --purge-volumes        若目录内已有 docker-compose：先 docker compose down -v
  --no-clone             不克隆，要求 INSTALL_DIR 已是完整项目
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url)
      REPO_URL="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --purge-volumes)
      PURGE_VOLUMES=1
      shift
      ;;
    --no-clone)
      NO_CLONE=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "请使用 root 执行，例如：sudo bash $0 ..." >&2
  exit 1
fi

ensure_git_curl() {
  if command -v git &>/dev/null && command -v curl &>/dev/null; then
    return 0
  fi
  if command -v dnf &>/dev/null; then
    dnf install -y git curl ca-certificates
  elif command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y git curl ca-certificates
  else
    echo "请手动安装 git 与 curl。" >&2
    exit 1
  fi
}

ensure_docker_for_purge() {
  if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    return 0
  fi
  local setup=""
  [[ -n "$ONECLICK_DIR" ]] && setup="$ONECLICK_DIR/setup-docker-alinux.sh"
  if [[ -n "$setup" && -f "$setup" ]] && command -v dnf &>/dev/null; then
    bash "$setup"
  else
    echo ">>> 使用 get.docker.com 安装 Docker…" >&2
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker 2>/dev/null || true
  fi
}

compose_in_dir() {
  local d="$1"
  shift
  (cd "$d" && docker compose "$@")
}

echo ">>> 安装目录: $INSTALL_DIR" >&2

ensure_git_curl
ensure_docker_for_purge

if [[ "$PURGE_VOLUMES" -eq 1 ]] && [[ -f "$INSTALL_DIR/docker-compose.yml" ]]; then
  echo ">>> 停止并删除该目录下 Compose 数据卷（--purge-volumes）…" >&2
  compose_in_dir "$INSTALL_DIR" down -v 2>/dev/null || true
fi

if [[ "$NO_CLONE" -eq 1 ]]; then
  if [[ ! -f "$INSTALL_DIR/docker-compose.yml" ]]; then
    echo "--no-clone 已指定，但 $INSTALL_DIR 下没有 docker-compose.yml" >&2
    exit 1
  fi
else
  if [[ -z "$REPO_URL" ]]; then
    echo "未指定 --repo-url 且未设置 REPO_URL；若无需克隆请加 --no-clone" >&2
    exit 1
  fi
  if [[ -d "$INSTALL_DIR" ]] && [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
    echo "目录非空: $INSTALL_DIR 。请先清空该目录，或换 --install-dir，或改用 --no-clone。" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$INSTALL_DIR")"
  echo ">>> 克隆仓库: $REPO_URL" >&2
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

if [[ ! -f "$INSTALL_DIR/deploy/quickstart-server.sh" ]]; then
  echo "未找到 $INSTALL_DIR/deploy/quickstart-server.sh，项目不完整。" >&2
  exit 1
fi

echo ">>> 调用一键启动（生成 .env、防火墙、docker compose up）…" >&2
export QUICKSTART_ROOT="$INSTALL_DIR"
bash "$INSTALL_DIR/deploy/quickstart-server.sh"
