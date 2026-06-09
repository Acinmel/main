import {
  isRangeOverlap,
  normalizeScriptHighlights,
  projectHighlightsToSubtitle,
} from './highlight-range-utils';

describe('highlight-range-utils', () => {
  it('merges overlapped script highlights and keeps positions', () => {
    const scriptText =
      '普通人做AI视频，最缺的不是工具，而是一套完整的生产流程。';
    const highlights = normalizeScriptHighlights({
      scriptText,
      highlights: [
        { start: 4, end: 8, style: { color: '#00FF66' } },
        { start: 6, end: 10, style: { color: '#00FF66' } },
      ],
      defaultColor: '#FFD400',
      defaultFontSizeScale: 1.18,
      defaultFontWeight: 900,
    });
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({
      start: 4,
      end: 10,
      text: scriptText.slice(4, 10),
    });
  });

  it('projects script-level range to local subtitle range', () => {
    const mapped = projectHighlightsToSubtitle({
      subtitleText: '最缺的不是工具',
      subtitleScriptStart: 9,
      highlights: [
        {
          id: 'hl-1',
          start: 13,
          end: 15,
          text: '工具',
          style: { color: '#00FF66', fontSizeScale: 1.18, fontWeight: 900 },
        },
      ],
    });
    expect(mapped).toEqual([
      expect.objectContaining({ start: 4, end: 6, color: '#00FF66' }),
    ]);
  });

  it('checks overlap by half-open interval', () => {
    expect(isRangeOverlap(0, 2, 2, 4)).toBe(false);
    expect(isRangeOverlap(0, 2, 1, 4)).toBe(true);
  });
});
