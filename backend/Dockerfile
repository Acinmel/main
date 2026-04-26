# Nest API：ffmpeg + yt-dlp（源码 pip）
# 构建上下文应为仓库根目录：docker build -f backend/Dockerfile .

FROM node:22-bookworm-slim AS deps
WORKDIR /workspace
COPY backend/package.json backend/package-lock.json ./backend/
# file:./DY-DOWNLOADER 本地依赖，npm ci 前必须存在
COPY backend/DY-DOWNLOADER ./backend/DY-DOWNLOADER
WORKDIR /workspace/backend
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /workspace/backend
COPY --from=deps /workspace/backend/node_modules ./node_modules
COPY backend/ .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /workspace
ENV NODE_ENV=production

COPY yt-dlp-master /opt/yt-dlp-master
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-pip \
  && pip3 install --no-cache-dir --break-system-packages -e /opt/yt-dlp-master \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/DY-DOWNLOADER ./backend/DY-DOWNLOADER
WORKDIR /workspace/backend
RUN npm ci --omit=dev
COPY --from=build /workspace/backend/dist ./dist

EXPOSE 3000
ENV PORT=3000
ENV YTDLP_BIN=/usr/local/bin/yt-dlp
ENV FFMPEG_BIN=/usr/bin/ffmpeg
CMD ["node", "dist/main.js"]
