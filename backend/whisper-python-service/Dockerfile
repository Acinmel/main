# syntax=docker/dockerfile:1
# Python Whisper API（与主后端 WHISPER_HTTP_URL 对接）
FROM python:3.11-slim-bookworm

# 国内构建：Debian 官方源常极慢；换阿里云后再 apt（海外：compose/build-arg 设 USE_CN_MIRROR=0）
ARG USE_CN_MIRROR=1
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; \
  if [ "$USE_CN_MIRROR" = "1" ]; then \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
      sed -i 's|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
      sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list; \
      sed -i 's|security.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list; \
    fi; \
  fi; \
  apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
  set -eux; \
  if [ "$USE_CN_MIRROR" = "1" ]; then \
    pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt; \
  else \
    pip install -r requirements.txt; \
  fi

COPY server.py .
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8010
ENV WHISPER_MODEL=base
ENV WHISPER_PRELOAD=0

ENTRYPOINT ["/docker-entrypoint.sh"]
