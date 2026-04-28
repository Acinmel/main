#!/usr/bin/env bash
# 国内 ECS 拉 Docker Hub 超时：配置镜像加速（需 root）
#
# ① 阿里云：控制台 → 容器镜像服务 ACR → 镜像工具 → 镜像加速器 → 复制专属地址
# ② 执行（可多个地址，空格分隔，越靠前越优先）：
#    sudo bash deploy/setup-docker-registry-mirror.sh https://你的ID.mirror.aliyuncs.com
#
# ③ 验证：
#    docker info | grep -A5 'Registry Mirrors'
#    docker pull hello-world
#
set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "请使用 root：sudo bash $0 <镜像地址…>" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "用法: sudo bash $0 <镜像地址> [更多镜像地址…]" >&2
  echo "示例: sudo bash $0 https://xxxx.mirror.aliyuncs.com" >&2
  echo "可选追加（公共镜像，不保证长期可用）: https://docker.m.daocloud.io" >&2
  exit 1
fi

python3 - "$@" <<'PY'
import json, shutil, sys
from datetime import datetime
from pathlib import Path

mirrors = sys.argv[1:]
path = Path("/etc/docker/daemon.json")
path.parent.mkdir(parents=True, exist_ok=True)

data = {}
if path.exists():
    backup = path.with_name(f"daemon.json.bak.{datetime.now():%Y%m%d%H%M%S}")
    shutil.copy2(path, backup)
    print(f"已备份: {backup}", file=sys.stderr)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        data = {}

data["registry-mirrors"] = mirrors
data.setdefault("max-concurrent-downloads", 10)
path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("已写入:", path, file=sys.stderr)
print(path.read_text(encoding="utf-8"), file=sys.stderr)
PY

systemctl daemon-reload
systemctl restart docker
echo ">>> Docker 已重启。请执行: docker info | grep -A5 'Registry Mirrors'" >&2
