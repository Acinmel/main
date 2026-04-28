#!/usr/bin/env bash
# 服务器上一键：装 Docker（如需）→ 生成 .env 密钥 → 启动全部容器
# 用法（在项目根目录，root 或 sudo）：
#   sudo bash deploy/quickstart-server.sh
#
# 公网访问不了时，请看脚本结束处的「安全组」说明。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${QUICKSTART_ROOT:-}" ]]; then
  ROOT="$(cd "$QUICKSTART_ROOT" && pwd)"
else
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$ROOT"

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

ensure_env() {
  local need_gen=0
  if [[ ! -f "$ROOT/.env" ]]; then
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
ensure_env

WEB_PORT=$(grep -E '^WEB_PORT=' "$ROOT/.env" | head -1 | cut -d= -f2 | tr -d '\r' || true)
WEB_PORT=${WEB_PORT:-8080}
open_firewall_port "$WEB_PORT"

echo ">>> 构建并启动容器（首次较慢，请等待）…" >&2
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
