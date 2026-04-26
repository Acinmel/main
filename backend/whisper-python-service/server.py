"""
本地 openai-whisper HTTP 服务：与 Nest `WHISPER_HTTP_URL` 对齐。

- POST /transcribe，multipart 字段名 `file`
- JSON 响应：fullText, language, segments[{ startMs, endMs, text }]

启动（需已安装 PyTorch 等 whisper 依赖）：
  set WHISPER_MODEL=medium
  uvicorn server:app --host 127.0.0.1 --port 8010
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import whisper
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse

app = FastAPI(title="Local Whisper HTTP")
_model = None


def get_model():
    global _model
    if _model is None:
        name = os.environ.get("WHISPER_MODEL", "medium").strip() or "medium"
        _model = whisper.load_model(name)
    return _model


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    suffix = Path(file.filename or "upload").suffix
    if not suffix:
        suffix = ".bin"
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        model = get_model()
        result = model.transcribe(tmp_path)
        segs = result.get("segments") or []
        segments = []
        for s in segs:
            segments.append(
                {
                    "startMs": int(float(s["start"]) * 1000),
                    "endMs": int(float(s["end"]) * 1000),
                    "text": (s.get("text") or "").strip(),
                }
            )
        full = (result.get("text") or "").strip()
        lang = (result.get("language") or "und").strip() or "und"
        return JSONResponse(
            {"fullText": full, "language": lang, "segments": segments}
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.get("/health")
def health():
    return {"ok": True}
