import type { VoiceTuningOptions } from '../../integrations/ai/speech-ai.service';

export interface VoiceTuningRequest {
  voiceLanguage?: unknown;
  language?: unknown;
  voiceEmotion?: unknown;
  emotion?: unknown;
  voiceEmotionIntensity?: unknown;
  emotionIntensity?: unknown;
  voiceRate?: unknown;
  speechRate?: unknown;
  rate?: unknown;
  voiceVolume?: unknown;
  volume?: unknown;
  voicePitch?: unknown;
  pitch?: unknown;
  voiceTuning?: Partial<VoiceTuningOptions> | null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampNumber(value: unknown, min: number, max: number): number | null {
  const parsed = readFiniteNumber(value);
  if (parsed === null) return null;
  return Math.min(max, Math.max(min, Number(parsed.toFixed(2))));
}

function cleanShortText(value: unknown, maxLength = 32): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

export function normalizeVoiceTuning(
  body: VoiceTuningRequest | null | undefined,
): VoiceTuningOptions {
  const nested = body?.voiceTuning ?? {};
  return {
    language: cleanShortText(
      firstDefined(body?.voiceLanguage, body?.language, nested.language),
    ),
    emotion: cleanShortText(
      firstDefined(body?.voiceEmotion, body?.emotion, nested.emotion),
    ),
    emotionIntensity: clampNumber(
      firstDefined(
        body?.voiceEmotionIntensity,
        body?.emotionIntensity,
        nested.emotionIntensity,
      ),
      0.6,
      1.5,
    ),
    speechRate: clampNumber(
      firstDefined(
        body?.voiceRate,
        body?.speechRate,
        body?.rate,
        nested.speechRate,
      ),
      0.5,
      1.5,
    ),
    volume: clampNumber(
      firstDefined(body?.voiceVolume, body?.volume, nested.volume),
      0.5,
      1.5,
    ),
    pitch: clampNumber(
      firstDefined(body?.voicePitch, body?.pitch, nested.pitch),
      0.5,
      2,
    ),
  };
}
