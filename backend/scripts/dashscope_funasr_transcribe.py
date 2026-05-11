import argparse
import json
import os
import sys
from http import HTTPStatus

import dashscope
from dashscope.audio.asr import Recognition

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def normalize_sentences(raw_sentences):
    if isinstance(raw_sentences, dict):
        raw_sentences = [raw_sentences]
    if not isinstance(raw_sentences, list):
        raw_sentences = []

    segments = []
    texts = []
    for item in raw_sentences:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        begin = item.get("begin_time")
        end = item.get("end_time")
        start_ms = int(begin) if isinstance(begin, (int, float)) else 0
        if isinstance(end, (int, float)):
            end_ms = int(end)
        else:
            end_ms = start_ms + max(600, min(8000, len(text) * 180))
        segments.append(
            {
                "startMs": max(0, start_ms),
                "endMs": max(max(0, start_ms), end_ms),
                "text": text,
            }
        )
        texts.append(text)

    return {
        "fullText": "\n".join(texts).strip(),
        "segments": segments,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--format", required=True)
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--language", default="")
    parser.add_argument("--semantic-punctuation-enabled", action="store_true")
    args = parser.parse_args()

    api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("missing DASHSCOPE_API_KEY")

    dashscope.api_key = api_key
    dashscope.base_websocket_api_url = os.environ.get(
        "DASHSCOPE_REALTIME_WS_URL",
        "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
    )

    recognition = Recognition(
        model=args.model,
        format=args.format,
        sample_rate=args.sample_rate,
        callback=None,
        semantic_punctuation_enabled=args.semantic_punctuation_enabled,
        language=(args.language or None),
    )
    result = recognition.call(args.file)
    if result.status_code != HTTPStatus.OK:
        payload = {
            "status_code": int(result.status_code),
            "request_id": getattr(result, "request_id", ""),
            "code": getattr(result, "code", ""),
            "message": getattr(result, "message", "Recognition failed"),
        }
        sys.stderr.write(json.dumps(payload, ensure_ascii=False))
        sys.exit(1)

    normalized = normalize_sentences(result.get_sentence())
    if not normalized["fullText"]:
        payload = {
            "status_code": int(result.status_code),
            "request_id": getattr(result, "request_id", ""),
            "code": getattr(result, "code", ""),
            "message": "Recognition returned empty text",
        }
        sys.stderr.write(json.dumps(payload, ensure_ascii=False))
        sys.exit(2)

    payload = {
        "requestId": getattr(result, "request_id", ""),
        "fullText": normalized["fullText"],
        "language": args.language or "zh-CN",
        "segments": normalized["segments"],
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
