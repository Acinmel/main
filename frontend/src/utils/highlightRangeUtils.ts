import type { SmartClipHighlightRange, SmartClipSubtitle } from "@/api/task";

export interface HighlightStyle {
  color: string;
  fontSizeScale: number;
  fontWeight: number;
}

export interface ScriptHighlightRange {
  id: string;
  start: number;
  end: number;
  text: string;
  style: HighlightStyle;
}

export interface TextPiece {
  text: string;
  start: number;
  end: number;
  highlight?: ScriptHighlightRange;
}

export function isRangeOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
) {
  return aStart < bEnd && bStart < aEnd;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSingleRange(range: ScriptHighlightRange, text: string) {
  const start = clamp(Math.floor(range.start), 0, text.length);
  const end = clamp(Math.floor(range.end), 0, text.length);
  if (end <= start) return null;
  const piece = text.slice(start, end);
  if (!piece.trim()) return null;
  return {
    ...range,
    start,
    end,
    text: piece,
  };
}

export function mergeHighlightRanges(
  highlights: ScriptHighlightRange[],
  text: string,
): ScriptHighlightRange[] {
  const normalized = highlights
    .map((item) => normalizeSingleRange(item, text))
    .filter((item): item is ScriptHighlightRange => Boolean(item))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  if (!normalized.length) return [];

  const merged: ScriptHighlightRange[] = [];
  for (const current of normalized) {
    const last = merged[merged.length - 1];
    if (
      last &&
      (isRangeOverlap(last.start, last.end, current.start, current.end) ||
        last.end === current.start)
    ) {
      const mergedEnd = Math.max(last.end, current.end);
      last.end = mergedEnd;
      last.text = text.slice(last.start, mergedEnd);
      last.style = current.style;
      continue;
    }
    merged.push({ ...current });
  }
  return merged;
}

function createHighlightId() {
  return `hl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function applyHighlightRange(
  text: string,
  highlights: ScriptHighlightRange[],
  range: { start: number; end: number },
  style: HighlightStyle,
) {
  const start = clamp(Math.floor(range.start), 0, text.length);
  const end = clamp(Math.floor(range.end), 0, text.length);
  if (end <= start) return highlights;
  const next = highlights.concat({
    id: createHighlightId(),
    start,
    end,
    text: text.slice(start, end),
    style,
  });
  return mergeHighlightRanges(next, text);
}

export function removeHighlightRange(
  text: string,
  highlights: ScriptHighlightRange[],
  range: { start: number; end: number },
) {
  const start = clamp(Math.floor(range.start), 0, text.length);
  const end = clamp(Math.floor(range.end), 0, text.length);
  if (end <= start) return highlights;

  const next: ScriptHighlightRange[] = [];
  for (const item of mergeHighlightRanges(highlights, text)) {
    if (!isRangeOverlap(item.start, item.end, start, end)) {
      next.push(item);
      continue;
    }
    if (item.start < start) {
      next.push({
        ...item,
        id: createHighlightId(),
        start: item.start,
        end: start,
        text: text.slice(item.start, start),
      });
    }
    if (end < item.end) {
      next.push({
        ...item,
        id: createHighlightId(),
        start: end,
        end: item.end,
        text: text.slice(end, item.end),
      });
    }
  }
  return mergeHighlightRanges(next, text);
}

export function remapHighlightsForTextChange(
  prevText: string,
  nextText: string,
  highlights: ScriptHighlightRange[],
) {
  if (prevText === nextText) return mergeHighlightRanges(highlights, nextText);
  const prevLen = prevText.length;
  const nextLen = nextText.length;
  let prefix = 0;
  while (
    prefix < prevLen &&
    prefix < nextLen &&
    prevText.charCodeAt(prefix) === nextText.charCodeAt(prefix)
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < prevLen - prefix &&
    suffix < nextLen - prefix &&
    prevText.charCodeAt(prevLen - 1 - suffix) ===
      nextText.charCodeAt(nextLen - 1 - suffix)
  ) {
    suffix += 1;
  }

  const oldChangeStart = prefix;
  const oldChangeEnd = prevLen - suffix;
  const delta = nextLen - prevLen;
  const remapped: ScriptHighlightRange[] = [];

  for (const item of highlights) {
    if (item.end <= oldChangeStart) {
      remapped.push({ ...item });
      continue;
    }
    if (item.start >= oldChangeEnd) {
      remapped.push({
        ...item,
        start: item.start + delta,
        end: item.end + delta,
      });
      continue;
    }
  }

  return mergeHighlightRanges(remapped, nextText);
}

export function splitTextByHighlights(
  text: string,
  highlights: ScriptHighlightRange[],
): TextPiece[] {
  const merged = mergeHighlightRanges(highlights, text);
  if (!merged.length) {
    return [{ text, start: 0, end: text.length }];
  }
  const pieces: TextPiece[] = [];
  let cursor = 0;
  for (const item of merged) {
    if (cursor < item.start) {
      pieces.push({
        text: text.slice(cursor, item.start),
        start: cursor,
        end: item.start,
      });
    }
    pieces.push({
      text: text.slice(item.start, item.end),
      start: item.start,
      end: item.end,
      highlight: item,
    });
    cursor = item.end;
  }
  if (cursor < text.length) {
    pieces.push({
      text: text.slice(cursor),
      start: cursor,
      end: text.length,
    });
  }
  return pieces;
}

export function mapHighlightsToSubtitleRanges(
  scriptText: string,
  subtitles: SmartClipSubtitle[],
  highlights: ScriptHighlightRange[],
): SmartClipSubtitle[] {
  const merged = mergeHighlightRanges(highlights, scriptText);
  if (!merged.length) {
    return subtitles.map((subtitle) => ({
      ...subtitle,
      highlightRanges: [],
    }));
  }

  let searchCursor = 0;
  return subtitles.map((subtitle) => {
    const text = subtitle.text || "";
    const localStart = scriptText.indexOf(text, searchCursor);
    const start =
      localStart >= 0 ? localStart : Math.max(0, searchCursor);
    const end = Math.min(scriptText.length, start + text.length);
    searchCursor = end;

    const localRanges: SmartClipHighlightRange[] = [];
    for (const item of merged) {
      if (!isRangeOverlap(start, end, item.start, item.end)) continue;
      const localRangeStart = Math.max(0, item.start - start);
      const localRangeEnd = Math.min(text.length, item.end - start);
      if (localRangeEnd <= localRangeStart) continue;
      localRanges.push({
        start: localRangeStart,
        end: localRangeEnd,
        color: item.style.color,
        fontWeight: item.style.fontWeight,
      });
    }
    return {
      ...subtitle,
      highlightRanges: localRanges,
    };
  });
}
