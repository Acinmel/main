# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim

WORKDIR /workspace
ENV NODE_ENV=production
ENV FFMPEG_BIN=/usr/bin/ffmpeg
ENV FFPROBE_BIN=/usr/bin/ffprobe
ENV YTDLP_BIN=/usr/local/bin/yt-dlp
ENV ASR_PYTHON_BIN=python3
ENV ASR_FUNASR_SCRIPT=/workspace/scripts/dashscope_funasr_transcribe.py

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
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-pip make g++ libsqlite3-dev \
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

RUN if [ "$USE_CN_MIRROR" = "1" ]; then npm config set registry https://registry.npmmirror.com; fi \
  && npm ci --omit=dev \
  && node --input-type=module -e \
  "import('dy-downloader').then(()=>console.log('[artifact-backend] dy-downloader import ok')).catch(e=>{console.error(e);process.exit(1);})"

COPY dist ./dist
COPY scripts ./scripts
COPY BUILD_INFO.json ./BUILD_INFO.json
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
  yt-dlp --version >/dev/null

EXPOSE 3000
ENV PORT=3000
ENV FFMPEG_BIN=/usr/bin/ffmpeg

CMD ["node", "dist/main.js"]
