# syntax=docker/dockerfile:1
# Nest API：ffmpeg + yt-dlp（PyPI）。
# 构建上下文为 backend 目录（见 docker-compose api.build.context）。
# 手动：在项目根 docker compose build api；仅在 backend：docker build -f Dockerfile .

FROM node:22-bookworm-slim AS deps
# slim 无 Python：better-sqlite3 在 prebuild 超时后会 node-gyp，需 python3 + 编译工具 + sqlite 头文件
ARG USE_CN_MIRROR=1
WORKDIR /workspace
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
  && apt-get install -y --no-install-recommends \
       python3 make g++ \
       libsqlite3-dev \
  && ln -sf /usr/bin/python3 /usr/bin/python \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY DY-DOWNLOADER ./DY-DOWNLOADER
RUN test -f /workspace/DY-DOWNLOADER/package.json

WORKDIR /workspace
ARG USE_CN_MIRROR=1
RUN if [ "$USE_CN_MIRROR" = "1" ]; then npm config set registry https://registry.npmmirror.com; fi \
  && npm ci
RUN set -eux \
  && test -f /workspace/DY-DOWNLOADER/package.json \
  && cd /workspace/DY-DOWNLOADER \
  && npm run build \
  && test -f ./dist/index.js

FROM node:22-bookworm-slim AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
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
     make g++ libsqlite3-dev \
  && ln -sf /usr/bin/python3 /usr/bin/python \
  && if [ "$USE_CN_MIRROR" = "1" ]; then \
       pip3 install --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple 'yt-dlp>=2024.1.0'; \
     else \
       pip3 install --break-system-packages 'yt-dlp>=2024.1.0'; \
     fi \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY DY-DOWNLOADER ./DY-DOWNLOADER
COPY --from=deps /workspace/DY-DOWNLOADER/dist ./DY-DOWNLOADER/dist

RUN test -f /workspace/DY-DOWNLOADER/package.json \
  && test -f /workspace/DY-DOWNLOADER/dist/index.js

WORKDIR /workspace
RUN if [ "$USE_CN_MIRROR" = "1" ]; then npm config set registry https://registry.npmmirror.com; fi \
  && npm ci --omit=dev \
  && node --input-type=module -e \
  "import('dy-downloader').then(()=>console.log('[Dockerfile] dy-downloader import ok')).catch(e=>{console.error(e);process.exit(1);})"
COPY --from=build /workspace/dist ./dist

EXPOSE 3000
ENV PORT=3000
ENV YTDLP_BIN=/usr/local/bin/yt-dlp
ENV FFMPEG_BIN=/usr/bin/ffmpeg
CMD ["node", "dist/main.js"]
