#!/bin/sh
set -e
if [ "${WHISPER_PRELOAD}" = "1" ]; then
  echo "[whisper] Preloading model: ${WHISPER_MODEL:-base}"
  python -c "import whisper; whisper.load_model('${WHISPER_MODEL:-base}')"
fi
exec uvicorn server:app --host 0.0.0.0 --port 8010
