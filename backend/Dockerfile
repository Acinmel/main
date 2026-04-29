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
# 与子依赖 dy-downloader（file:）：须产出 dist/*.js（与 backend/dist 同源，供 runner COPY）
WORKDIR /workspace/backend/DY-DOWNLOADER
RUN npm run build

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
# deps 阶段已构建的 dist 覆盖上下文（宿主常无 dist/），避免只靠 runner 缓存导致运行时缺入口
COPY --from=deps /workspace/backend/DY-DOWNLOADER/dist ./backend/DY-DOWNLOADER/dist

WORKDIR /workspace/backend
RUN if [ "$USE_CN_MIRROR" = "1" ]; then npm config set registry https://registry.npmmirror.com; fi \
  && npm ci --omit=dev \
  && node --input-type=module -e \
  "import('dy-downloader').then(()=>console.log('[Dockerfile] dy-downloader import ok')).catch(e=>{console.error(e);process.exit(1);})"
COPY --from=build /workspace/backend/dist ./dist

EXPOSE 3000
ENV PORT=3000
ENV YTDLP_BIN=/usr/local/bin/yt-dlp
ENV FFMPEG_BIN=/usr/bin/ffmpeg
CMD ["node", "dist/main.js"]
