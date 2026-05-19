# syntax=docker/dockerfile:1
# Nest API：ffmpeg + yt-dlp（PyPI）。
# 构建上下文为 backend 目录（见 docker-compose api.build.context）。
# 手动：在项目根 docker compose build api；仅在 backend：docker build -f Dockerfile .

FROM node:22-bookworm-slim AS deps
# slim 无 Python：better-sqlite3 在 prebuild 超时后会 node-gyp，需 python3 + 编译工具 + sqlite 头文件
ARG USE_CN_MIRROR=1
WORKDIR /workspace
ENV FFMPEG_BIN=/usr/bin/ffmpeg
ENV FFPROBE_BIN=/usr/bin/ffprobe
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
       ffmpeg \
       python3 make g++ \
       libsqlite3-dev \
       fontconfig \
       fonts-noto-cjk \
       fonts-wqy-zenhei \
  && ln -sf /usr/bin/python3 /usr/bin/python \
  && fc-cache -f -v \
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
  && if [ ! -f ./dist/index.js ]; then npm run build; fi \
  && test -f ./dist/index.js

FROM node:22-bookworm-slim AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN set -eux; \
  if [ -f tsconfig.json ]; then \
    npm run build; \
  elif [ -f dist/main.js ]; then \
    echo "[Dockerfile] Reusing prebuilt backend dist"; \
  else \
    echo "[Dockerfile] Missing tsconfig.json and prebuilt dist/main.js" >&2; \
    exit 1; \
  fi

FROM node:22-bookworm-slim AS runner
WORKDIR /workspace
ENV NODE_ENV=production
ENV FFMPEG_BIN=/usr/bin/ffmpeg
ENV FFPROBE_BIN=/usr/bin/ffprobe
ENV YTDLP_BIN=/usr/local/bin/yt-dlp
ENV ASR_PYTHON_BIN=python3
ENV ASR_FUNASR_SCRIPT=/workspace/scripts/dashscope_funasr_transcribe.py

ARG USE_CN_MIRROR=1
ARG APP_VERSION=local
ARG GIT_COMMIT=unknown
ARG BUILD_TIME_UTC=unknown
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
     fontconfig \
     fonts-noto-cjk \
     fonts-wqy-zenhei \
  && ln -sf /usr/bin/python3 /usr/bin/python \
  && fc-cache -f -v \
  && if [ "$USE_CN_MIRROR" = "1" ]; then \
       pip3 install --break-system-packages -i https://pypi.tuna.tsinghua.edu.cn/simple 'yt-dlp>=2024.1.0' 'dashscope>=1.24.0'; \
     else \
       pip3 install --break-system-packages 'yt-dlp>=2024.1.0' 'dashscope>=1.24.0'; \
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
COPY --from=build /workspace/scripts ./scripts
RUN set -eux; \
  mkdir -p \
    /workspace/public \
    /workspace/templates \
    /workspace/storage \
    /workspace/tmp \
    /workspace/uploads/video \
    /workspace/uploads/audio \
    /workspace/uploads/output \
    /workspace/data/download-video \
    /workspace/data/preview-videos \
    /workspace/data/preview-audios \
    /workspace/data/lip-sync-public \
    /workspace/data/voice-samples \
    /workspace/data/digital-humans; \
  test -f /workspace/scripts/dashscope_funasr_transcribe.py; \
  python3 -c "import dashscope; print('dashscope ok')"; \
  ffmpeg -version >/dev/null; \
  yt-dlp --version >/dev/null; \
  APP_VERSION="$APP_VERSION" GIT_COMMIT="$GIT_COMMIT" BUILD_TIME_UTC="$BUILD_TIME_UTC" node -e "const fs=require('fs'); const info={buildTime:process.env.BUILD_TIME_UTC||'unknown',gitCommit:process.env.GIT_COMMIT||'unknown',version:process.env.APP_VERSION||'local',includedFiles:['dist/main.js','scripts/dashscope_funasr_transcribe.py','public/','templates/','storage/','tmp/','uploads/','data/download-video/','data/preview-videos/','data/preview-audios/','data/lip-sync-public/','data/voice-samples/','data/digital-humans/']}; fs.writeFileSync('/workspace/BUILD_INFO.json', JSON.stringify(info,null,2)+'\n')"

EXPOSE 3000
ENV PORT=3000
ENV FFMPEG_BIN=/usr/bin/ffmpeg
CMD ["node", "dist/main.js"]
