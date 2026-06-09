import type {
  HighlightRangeDto,
  SubtitleVisualStyleDto,
  VisualOverlayAnchor,
} from './video-project-render.types';

const ASS_CANVAS_WIDTH = 720;
const ASS_CANVAS_HEIGHT = 1280;

type SubtitleCueLike = {
  id?: string;
  startTime: number;
  endTime: number;
  text: string;
  highlightRanges?: HighlightRangeDto[];
};

type SubtitleLayout = {
  xPct: number;
  yPct: number;
  anchor: VisualOverlayAnchor;
  safeAreaPct: number;
};

export function buildSubtitleAss(params: {
  cues: SubtitleCueLike[];
  templateStyle: Record<string, unknown>;
  subtitleVisualStyle?: SubtitleVisualStyleDto;
}): string {
  const style = mergeStyle(params.templateStyle, params.subtitleVisualStyle);
  const fontFamily = readString(style.fontFamily, 'Noto Sans CJK SC');
  const fontSize = clamp(readNumber(style.size, 38), 24, 64);
  const outline = clamp(readNumber(style.strokeWidth, 2.2), 0.8, 6);
  const marginBottom = clamp(readNumber(style.marginBottom, 72), 24, 180);
  const spacing = clamp(readNumber(style.letterSpacing, 0), 0, 4);
  const weight = readNumber(style.weight, 700);
  const hasBackground =
    typeof style.background === 'string' && style.background.trim().length > 0;
  const fallbackAnchor = legacyPositionToAnchor(
    readString(style.position, 'bottom'),
  );
  const layout = resolveLayout(style.layout);
  const alignment = anchorToAssAlignment(layout?.anchor ?? fallbackAnchor);

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${ASS_CANVAS_WIDTH}`,
    `PlayResY: ${ASS_CANVAS_HEIGHT}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.601',
    '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    [
      'Style: Default',
      fontFamily,
      Math.round(fontSize),
      toAssColor(readString(style.color, '#FFFFFF')),
      toAssColor(
        readString(style.highlightColor, readString(style.color, '#FFFFFF')),
      ),
      toAssColor(readString(style.stroke, '#111827')),
      toAssColor(readString(style.background, '#00000000')),
      weight >= 700 ? -1 : 0,
      0,
      0,
      0,
      100,
      100,
      spacing,
      0,
      hasBackground ? 3 : 1,
      outline,
      hasBackground ? 0.2 : 0.8,
      alignment,
      38,
      38,
      Math.round(marginBottom),
      1,
    ].join(','),
    '',
    '[Events]',
    'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ].join('\n');

  const events = params.cues
    .filter((cue) => cue.text?.trim() && cue.endTime > cue.startTime)
    .map((cue) => {
      const text = buildDialogueText(
        cue.text,
        cue.highlightRanges,
        Math.round(fontSize),
        style,
      );
      return `Dialogue: 0,${toAssTime(Math.round(cue.startTime * 1000))},${toAssTime(
        Math.round(cue.endTime * 1000),
      )},Default,,0,0,0,,${buildAssPositionTag(layout)}${text}`;
    })
    .join('\n');

  return `${header}\n${events}\n`;
}

function buildDialogueText(
  text: string,
  ranges: HighlightRangeDto[] | undefined,
  baseFontSize: number,
  style: Record<string, unknown>,
): string {
  const normalized = normalizeHighlightRanges(ranges, text.length, style);
  if (!normalized.length) return escapeAssText(text);

  const normalColor = toAssOverrideColor(readString(style.color, '#FFFFFF'));
  const highlightScale = clamp(
    readNumber(style.highlightFontSizeScale, 1.18),
    1,
    1.6,
  );
  let cursor = 0;
  let output = '';

  for (const range of normalized) {
    if (range.start > cursor) {
      output += `{\\c${normalColor}\\fs${baseFontSize}\\b0}${escapeAssSegment(
        text.slice(cursor, range.start),
      )}`;
    }
    const fs = Math.round(
      baseFontSize * (range.fontSizeScale ?? highlightScale),
    );
    output += `{\\c${toAssOverrideColor(range.color || '#FFD94A')}\\fs${fs}\\b${
      (range.fontWeight ?? 900) >= 700 ? 1 : 0
    }}${escapeAssSegment(text.slice(range.start, range.end))}`;
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) {
    output += `{\\c${normalColor}\\fs${baseFontSize}\\b0}${escapeAssSegment(
      text.slice(cursor),
    )}`;
  }
  return output || escapeAssText(text);
}

function mergeStyle(
  templateStyle: Record<string, unknown>,
  visualStyle?: SubtitleVisualStyleDto,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...templateStyle };
  if (!visualStyle || typeof visualStyle !== 'object') return merged;
  if (isSafeColor(visualStyle.normalColor))
    merged.color = visualStyle.normalColor;
  if (isSafeColor(visualStyle.highlightColor)) {
    merged.highlightColor = visualStyle.highlightColor;
  }
  if (isSafeColor(visualStyle.strokeColor))
    merged.stroke = visualStyle.strokeColor;
  if (isSafeColor(visualStyle.backgroundColor)) {
    merged.background = visualStyle.backgroundColor;
  }
  if (isFiniteNumber(visualStyle.fontSize)) merged.size = visualStyle.fontSize;
  if (isFiniteNumber(visualStyle.strokeWidth)) {
    merged.strokeWidth = visualStyle.strokeWidth;
  }
  if (isFiniteNumber(visualStyle.fontWeight))
    merged.weight = visualStyle.fontWeight;
  if (isFiniteNumber(visualStyle.lineHeight))
    merged.lineHeight = visualStyle.lineHeight;
  if (visualStyle.layout && typeof visualStyle.layout === 'object') {
    merged.layout = visualStyle.layout;
  }
  return merged;
}

function resolveLayout(raw: unknown): SubtitleLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const xPct = readNumber(data.xPct, NaN);
  const yPct = readNumber(data.yPct, NaN);
  if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) return null;
  const safeAreaPct = clamp(readNumber(data.safeAreaPct, 6), 0, 24);
  const minPct = safeAreaPct;
  const maxPct = 100 - safeAreaPct;
  return {
    xPct: clamp(xPct, minPct, maxPct),
    yPct: clamp(yPct, minPct, maxPct),
    anchor: normalizeAnchor(data.anchor),
    safeAreaPct,
  };
}

function normalizeAnchor(value: unknown): VisualOverlayAnchor {
  if (typeof value !== 'string') return 'bottom-center';
  const anchor = value.trim().toLowerCase();
  switch (anchor) {
    case 'center':
    case 'top-center':
    case 'bottom-center':
    case 'top-left':
    case 'top-right':
    case 'bottom-left':
    case 'bottom-right':
    case 'left-center':
    case 'right-center':
      return anchor;
    default:
      return 'bottom-center';
  }
}

function legacyPositionToAnchor(position: string): VisualOverlayAnchor {
  const value = (position || '').trim().toLowerCase();
  if (value === 'top') return 'top-center';
  if (value === 'middle') return 'center';
  return 'bottom-center';
}

function anchorToAssAlignment(anchor: VisualOverlayAnchor): number {
  switch (anchor) {
    case 'top-left':
      return 7;
    case 'top-center':
      return 8;
    case 'top-right':
      return 9;
    case 'left-center':
      return 4;
    case 'center':
      return 5;
    case 'right-center':
      return 6;
    case 'bottom-left':
      return 1;
    case 'bottom-center':
      return 2;
    case 'bottom-right':
      return 3;
    default:
      return 2;
  }
}

function buildAssPositionTag(layout: SubtitleLayout | null): string {
  if (!layout) return '';
  const x = Math.round((layout.xPct / 100) * ASS_CANVAS_WIDTH);
  const y = Math.round((layout.yPct / 100) * ASS_CANVAS_HEIGHT);
  const an = anchorToAssAlignment(layout.anchor);
  return `{\\an${an}\\pos(${x},${y})}`;
}

function normalizeHighlightRanges(
  ranges: HighlightRangeDto[] | undefined,
  textLength: number,
  style: Record<string, unknown>,
): HighlightRangeDto[] {
  if (!Array.isArray(ranges) || !ranges.length) return [];
  const defaultHighlightColor = readString(style.highlightColor, '#FFD94A');
  return ranges
    .map((item) => ({
      start: Math.max(
        0,
        Math.min(textLength, Math.floor(readNumber(item.start, 0))),
      ),
      end: Math.max(
        0,
        Math.min(textLength, Math.ceil(readNumber(item.end, 0))),
      ),
      color:
        typeof item.color === 'string' && item.color.trim()
          ? item.color.trim()
          : defaultHighlightColor,
      fontWeight: clamp(readNumber(item.fontWeight, 900), 400, 900),
      fontSizeScale: clamp(
        readNumber(
          item.fontSizeScale,
          readNumber(style.highlightFontSizeScale, 1.18),
        ),
        1,
        1.6,
      ),
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => (a.start === b.start ? a.end - b.end : a.start - b.start));
}

function toAssTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const centiseconds = Math.floor((total % 1_000) / 10);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(
    seconds,
  ).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, '\\N')
    .replace(/[{}]/g, '')
    .trim();
}

function escapeAssSegment(text: string): string {
  return text
    .replace(/\r\n|\r|\n/g, '\\N')
    .replace(/[{}]/g, '')
    .trim();
}

function toAssColor(input: string): string {
  const { r, g, b, a } = parseColor(input);
  const alpha = Math.round((1 - a) * 255);
  return `&H${hexByte(alpha)}${hexByte(b)}${hexByte(g)}${hexByte(r)}&`;
}

function toAssOverrideColor(input: string): string {
  const { r, g, b } = parseColor(input);
  return `&H${hexByte(b)}${hexByte(g)}${hexByte(r)}&`;
}

function parseColor(input: string): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  const trimmed = input.trim();
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) {
    const hex = trimmed.slice(1);
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    };
  }
  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i,
  );
  if (rgbaMatch) {
    return {
      r: clamp(Number(rgbaMatch[1]), 0, 255),
      g: clamp(Number(rgbaMatch[2]), 0, 255),
      b: clamp(Number(rgbaMatch[3]), 0, 255),
      a: rgbaMatch[4] === undefined ? 1 : clamp(Number(rgbaMatch[4]), 0, 1),
    };
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

function hexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .toUpperCase()
    .padStart(2, '0');
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) return true;
  return /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|0?\.\d+|1))?\s*\)$/.test(
    text,
  );
}
