#!/usr/bin/env bash
# 在 Alibaba Cloud Linux 3 / CentOS Stream / RHEL 8+ 等（有 dnf）上以 root 执行，安装 Docker CE 与 compose 插件。
# 用法：sudo bash deploy/setup-docker-alinux.sh
#
# 说明：使用阿里云镜像的 docker-ce 源；若你已用云助手「一键安装 Docker」可跳过本脚本。

set -euo pipefail

if [[ "${EUID:-0}" -ne 0 ]]; then
  echo "请用 root 执行：sudo bash $0" >&2
  exit 1
fi

if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
  docker --version
  docker compose version
  echo "Docker 与 compose 插件已可用，无需重复安装。"
  exit 0
fi

if ! command -v dnf &>/dev/null; then
  echo "未找到 dnf。本脚本适用于 Alibaba Cloud Linux 3 等；其它发行版请用 get.docker.com 或官方文档。" >&2
  exit 1
fi

dnf install -y dnf-plugins-core
dnf config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

docker --version
docker compose version
echo ""
echo "安装完成。接下来在项目根目录执行："
echo "  cp deploy/docker.env.example .env && nano .env"
echo "  bash deploy/bootstrap-server.sh"
