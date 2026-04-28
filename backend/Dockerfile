# syntax=docker/dockerfile:1
# Nest API：ffmpeg + yt-dlp（PyPI；勿依赖仓库根 yt-dlp-master，该目录在 .gitignore 中，克隆后不存在）
# 构建上下文应为仓库根目录：docker build -f backend/Dockerfile .

FROM node:22-bookworm-slim AS deps
WORKDIR /workspace
COPY backend/package.json backend/package-lock.json ./backend/
# file:./DY-DOWNLOADER 本地依赖，npm ci 前必须存在
COPY backend/DY-DOWNLOADER ./backend/DY-DOWNLOADER
WORKDIR /workspace/backend
ARG USE_CN_MIRROR=1
RUN if [ "$USE_CN_MIRROR" = "1" ]; then npm config set registry https://registry.npmmirror.com; fi \
  && npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /workspace/backend
COPY --from=deps /workspace/backend/node_modules ./node_modules
COPY backend/ .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /workspace
ENV NODE_ENV=production

ARG USE_CN_MIRROR=1
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    --mount=type=cache,target=/root/.cache/pip,sharing=locked \
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
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-pip \
  && if [ "$USE_CN_MIRROR" = "1" ]; then \
       pip3 install --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple 'yt-dlp>=2024.1.0'; \
     else \
       pip3 install --break-system-packages 'yt-dlp>=2024.1.0'; \
     fi \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/DY-DOWNLOADER ./backend/DY-DOWNLOADER
WORKDIR /workspace/backend
RUN if [ "$USE_CN_MIRROR" = "1" ]; then npm config set registry https://registry.npmmirror.com; fi \
  && npm ci --omit=dev
COPY --from=build /workspace/backend/dist ./dist

EXPOSE 3000
ENV PORT=3000
ENV YTDLP_BIN=/usr/local/bin/yt-dlp
ENV FFMPEG_BIN=/usr/bin/ffmpeg
CMD ["node", "dist/main.js"]
