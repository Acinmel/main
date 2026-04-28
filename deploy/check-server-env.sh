#!/usr/bin/env bash
# 服务器环境自检：Docker / Compose / .env / 容器 / 数字人密钥探测（不打印密钥明文）
# 用法：cd /opt/shuziren && bash deploy/check-server-env.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

compose() {
  if docker compose version &>/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose &>/dev/null; then
    docker-compose "$@"
  else
    echo "[X] 未找到 docker compose"
    return 1
  fi
}

echo "========== 路径 =========="
echo "项目根: $ROOT"
echo ""

echo "========== Docker =========="
if command -v docker &>/dev/null; then
  docker version --format '{{.Server.Version}}' 2>/dev/null && echo "Docker daemon: OK" || echo "[!] Docker 客户端有，daemon 可能未起"
  if docker info &>/dev/null; then
    echo "Registry Mirrors:"
    docker info 2>/dev/null | grep -A6 'Registry Mirrors' || echo "  (无或未配置)"
  else
    echo "[X] docker info 失败（权限或未启动 systemctl start docker）"
  fi
else
  echo "[X] 未安装 docker"
fi
echo ""

echo "========== 文件：.env =========="
for f in "$ROOT/.env" "$ROOT/backend/.env"; do
  if [[ ! -f "$f" ]]; then
    echo "[X] 缺失: $f"
    continue
  fi
  # grep 在无输出时 exit 1，pipefail 会导致脚本中断，故对 grep 使用 || true
  lines=$( (grep -vE '^[[:space:]]*(#|$)' "$f" 2>/dev/null || true) | wc -l | tr -d ' ')
  if [[ "${lines}" -eq 0 ]]; then
    echo "[!] 空文件（无有效键）: $f"
  else
    echo "[OK] 存在且有内容: $f (${lines} 行非注释)"
  fi
done
echo ""

check_key_in_files() {
  local key="$1"
  local ok=0
  for f in "$ROOT/.env" "$ROOT/backend/.env"; do
    [[ -f "$f" ]] || continue
    if grep -qE "^[[:space:]]*${key}=[^[:space:]#]" "$f" 2>/dev/null; then
      echo "  $key: [OK] 见于 $(basename "$(dirname "$f")")/$(basename "$f")"
      ok=1
    fi
  done
  if [[ "$ok" -eq 0 ]]; then
    echo "  $key: [X] 未在两份 .env 中发现非空配置"
  fi
}

echo "========== 关键变量（仅是否配置，不显示值）=========="
check_key_in_files "ARK_API_KEY"
check_key_in_files "SEEDREAM_HTTP_URL"
check_key_in_files "SEEDREAM_API_KEY"
check_key_in_files "DIGITAL_HUMAN_API_URL"
check_key_in_files "JWT_SECRET"
check_key_in_files "MYSQL_PASSWORD"
check_key_in_files "MYSQL_ROOT_PASSWORD"
if grep -qE '^[[:space:]]*MYSQL_HOST_PORT=' "$ROOT/.env" 2>/dev/null; then
  echo "  MYSQL_HOST_PORT: $(grep -E '^[[:space:]]*MYSQL_HOST_PORT=' "$ROOT/.env" | head -1)"
else
  echo "  MYSQL_HOST_PORT: (未设置，默认映射宿主机 3306；若冲突需在 .env 设 3307)"
fi
echo ""

echo "========== docker compose 服务 =========="
if [[ -f "$ROOT/docker-compose.yml" ]]; then
  compose ps 2>/dev/null || echo "[!] compose ps 失败"
else
  echo "[X] 无 docker-compose.yml"
fi
echo ""

echo "========== 容器内环境（api 运行中则探测）========="
if [[ -n "$(compose ps -q api 2>/dev/null || true)" ]]; then
  ark_len=$(compose exec -T api sh -lc 'echo -n "${ARK_API_KEY:-}" | wc -c' 2>/dev/null | tr -d ' \n\r' || echo 0)
  echo "  ARK_API_KEY 在 api 进程内长度: ${ark_len} 字节（0 表示未注入）"
  echo "  digital-human-env (容器内 node 调本机 3000):"
  compose exec -T api node -e "
fetch('http://127.0.0.1:3000/api/v1/tools/digital-human-env')
  .then(r=>r.text())
  .then(t=>console.log(t))
  .catch(e=>console.error('ERR', e.message));" 2>/dev/null | head -c 600 || echo "  [!] 请求失败（api 未就绪或 Node fetch 不可用）"
  echo ""
else
  echo "  [X] api 容器未运行，跳过进程内检测（先 docker compose up -d）"
fi
echo ""

echo "========== 宿主机探测 WEB 端口（默认 8080）========="
WEB_PORT=$(grep -E '^WEB_PORT=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '\r' || true)
WEB_PORT=${WEB_PORT:-8080}
if command -v curl &>/dev/null; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "http://127.0.0.1:${WEB_PORT}/" || echo 000)
  echo "  GET http://127.0.0.1:${WEB_PORT}/ → HTTP ${code}"
  dh=$(curl -sf --connect-timeout 3 "http://127.0.0.1:${WEB_PORT}/api/v1/tools/digital-human-env" 2>/dev/null || true)
  if [[ -n "$dh" ]]; then
    echo "  digital-human-env: $dh"
  else
    echo "  [!] 无法从宿主机访问 .../api/v1/tools/digital-human-env（检查 web/api 与 WEB_PORT）"
  fi
else
  echo "  (无 curl，跳过)"
fi
echo ""

echo "========== 3306 占用（MySQL 映射冲突）========="
if command -v ss &>/dev/null; then
  ss -lntp 2>/dev/null | grep ':3306 ' || echo "  3306 当前无监听（或需 root 查看）"
else
  echo "  (无 ss 命令)"
fi
echo ""
echo "完成。若 ARK 在文件里 [OK] 但进程内长度为 0：执行 docker compose up -d api --force-recreate"
echo "数字人需至少：ARK_API_KEY 或 (SEEDREAM_HTTP_URL+SEEDREAM_API_KEY) 或 DIGITAL_HUMAN_API_URL"
