# syntax=docker/dockerfile:1
# Nest API：ffmpeg + yt-dlp（PyPI；勿依赖仓库根 yt-dlp-master，该目录在 .gitignore 中，克隆后不存在）
# 构建上下文应为仓库根目录：docker build -f backend/Dockerfile .

FROM node:22-bookworm-slim AS deps
# slim 镜像无 Python：better-sqlite3 在 prebuild 下载超时后会走 node-gyp，需 python3 + 编译工具 + sqlite 头文件
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

COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/DY-DOWNLOADER ./backend/DY-DOWNLOADER
# 构建上下文必须为仓库根；若报错 ENOENT 表示上下文里缺子包——请 git status 确认已提交并推送 backend/DY-DOWNLOADER/package.json
RUN test -f /workspace/backend/DY-DOWNLOADER/package.json

WORKDIR /workspace/backend
ARG USE_CN_MIRROR=1
RUN if [ "$USE_CN_MIRROR" = "1" ]; then npm config set registry https://registry.npmmirror.com; fi \
  && npm ci
# 与子依赖 dy-downloader（file:）：须在子目录内产出 dist（显式 cd + set -e，避免静默 cd 失败后 npm 误判 cwd）
RUN set -eux \
  && test -f /workspace/backend/DY-DOWNLOADER/package.json \
  && cd /workspace/backend/DY-DOWNLOADER \
  && npm run build \
  && test -f ./dist/index.js

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
     make g++ libsqlite3-dev \
  && ln -sf /usr/bin/python3 /usr/bin/python \
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
# 须先有完整子包（含 package.json），再覆盖 dist；否则 node_modules 里 file: 链接会指向残缺目录 → ENOENT
RUN test -f /workspace/backend/DY-DOWNLOADER/package.json \
  && test -f /workspace/backend/DY-DOWNLOADER/dist/index.js

WORKDIR /workspace/backend
# 禁止在此阶段 npm run build：Nest 已在上方 build 阶段编译；若误加会拉全量 devDependencies 且易缺 DY-DOWNLOADER 源码
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
