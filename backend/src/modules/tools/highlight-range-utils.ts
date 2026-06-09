import { randomUUID } from 'node:crypto';

export interface ScriptHighlightStyle {
  color: string;
  fontSizeScale: number;
  fontWeight: number;
}

export interface ScriptHighlightRange {
  id: string;
  start: number;
  end: number;
  text: string;
  style: ScriptHighlightStyle;
}

export interface HighlightRangeInput {
  id?: unknown;
  start?: unknown;
  end?: unknown;
  text?: unknown;
  style?: unknown;
}

export interface SubtitleHighlightRange {
  start: number;
  end: number;
  color?: string;
  fontWeight?: number;
  fontSizeScale?: number;
}

export function isRangeOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function normalizeScriptHighlights(params: {
  highlights: unknown;
  scriptText: string;
  defaultColor: string;
  defaultFontSizeScale: number;
  defaultFontWeight: number;
}): ScriptHighlightRange[] {
  const items = Array.isArray(params.highlights)
    ? (params.highlights as HighlightRangeInput[])
    : [];
  const len = params.scriptText.length;

  const normalized = items
    .map((item, index) => {
      const start = clampInt(item.start, 0, len);
      const end = clampInt(item.end, 0, len);
      if (end <= start) return null;

      const rawText = params.scriptText.slice(start, end);
      if (!rawText.trim()) return null;

      const styleObj =
        item.style && typeof item.style === 'object'
          ? (item.style as Record<string, unknown>)
          : {};
      const color = readColor(styleObj.color, params.defaultColor);
      const fontSizeScale = clampNumber(
        readNumber(styleObj.fontSizeScale, params.defaultFontSizeScale),
        1,
        1.6,
      );
      const fontWeight = clampNumber(
        readNumber(styleObj.fontWeight, params.defaultFontWeight),
        400,
        900,
      );

      const idRaw =
        typeof item.id === 'string' && item.id.trim()
          ? item.id.trim()
          : `hl_${index + 1}_${randomUUID().slice(0, 8)}`;

      return {
        id: idRaw,
        start,
        end,
        text: rawText,
        style: { color, fontSizeScale, fontWeight },
      } satisfies ScriptHighlightRange;
    })
    .filter((item): item is ScriptHighlightRange => Boolean(item))
    .sort((a, b) => (a.start === b.start ? a.end - b.end : a.start - b.start));

  if (!normalized.length) return [];
  const merged: ScriptHighlightRange[] = [];
  for (const current of normalized) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push(current);
      continue;
    }
    if (current.start <= last.end) {
      const nextEnd = Math.max(last.end, current.end);
      last.end = nextEnd;
      last.text = params.scriptText.slice(last.start, nextEnd);
      last.style = {
        color: current.style.color || last.style.color,
        fontSizeScale: Math.max(
          readNumber(last.style.fontSizeScale, params.defaultFontSizeScale),
          readNumber(current.style.fontSizeScale, params.defaultFontSizeScale),
        ),
        fontWeight: Math.max(
          readNumber(last.style.fontWeight, params.defaultFontWeight),
          readNumber(current.style.fontWeight, params.defaultFontWeight),
        ),
      };
      continue;
    }
    merged.push(current);
  }
  return merged;
}

export function projectHighlightsToSubtitle(params: {
  subtitleText: string;
  subtitleScriptStart: number;
  highlights: ScriptHighlightRange[];
}): SubtitleHighlightRange[] {
  const subtitleEnd = params.subtitleScriptStart + params.subtitleText.length;
  if (!params.highlights.length || !params.subtitleText) return [];

  return params.highlights
    .flatMap((highlight) => {
      if (
        !isRangeOverlap(
          params.subtitleScriptStart,
          subtitleEnd,
          highlight.start,
          highlight.end,
        )
      ) {
        return [];
      }
      const start = Math.max(0, highlight.start - params.subtitleScriptStart);
      const end = Math.min(
        params.subtitleText.length,
        highlight.end - params.subtitleScriptStart,
      );
      if (end <= start) return [];
      return [
        {
          start,
          end,
          color: highlight.style.color,
          fontWeight: highlight.style.fontWeight,
          fontSizeScale: highlight.style.fontSizeScale,
        },
      ];
    })
    .sort((a, b) => (a.start === b.start ? a.end - b.end : a.start - b.start));
}

function readNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.floor(readNumber(value, min));
  return Math.max(min, Math.min(max, n));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) return trimmed;
  if (/^rgba?\([^)]+\)$/i.test(trimmed)) return trimmed;
  return fallback;
}
