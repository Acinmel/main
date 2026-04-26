# Python Whisper API（与主后端 WHISPER_HTTP_URL 对接）
FROM python:3.11-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8010
ENV WHISPER_MODEL=base
ENV WHISPER_PRELOAD=0

ENTRYPOINT ["/docker-entrypoint.sh"]
