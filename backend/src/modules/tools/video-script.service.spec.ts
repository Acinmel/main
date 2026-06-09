import { VideoScriptService } from './video-script.service';

function makeService() {
  const db = {
    queryOne: jest.fn(),
    execute: jest.fn(),
  };
  const resources = {
    getSubtitleTemplate: jest.fn().mockResolvedValue({
      id: 'rec-subtitle-b-white-green-tech',
      styleJson: { highlightColor: '#00FF66' },
    }),
  };
  const service = new VideoScriptService(db as never, resources as never);
  return { service, db, resources };
}

describe('VideoScriptService', () => {
  it('saves script and visual style with normalized highlights', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce(null);

    const result = await service.save('user-1', {
      videoId: 1001,
      scriptText: '普通人做AI视频，最缺的不是工具，而是一套完整的生产流程。',
      subtitleTemplateId: 'tech_green',
      highlights: [{ id: 'hl_001', start: 4, end: 6 }],
      subtitleVisualStyle: {
        normalColor: '#FFFFFF',
        highlightColor: '#00FF66',
        layout: { xPct: 50, yPct: 84, anchor: 'bottom-center' },
      },
    });

    expect(result.videoId).toBe('1001');
    expect(result.subtitleTemplateId).toBe('rec-subtitle-b-white-green-tech');
    expect(result.highlights).toHaveLength(1);
    const firstHighlight = result.highlights[0];
    expect(firstHighlight).toMatchObject({
      id: 'hl_001',
      start: 4,
      end: 6,
      text: 'AI',
    });
    expect(firstHighlight?.style?.color).toBe('#00FF66');
    expect(result.subtitleVisualStyle?.normalColor).toBe('#FFFFFF');
    expect(result.subtitleVisualStyle?.highlightColor).toBe('#00FF66');
    const layout = result.subtitleVisualStyle?.layout as
      | { xPct?: number; yPct?: number }
      | undefined;
    expect(layout?.xPct).toBe(50);
    expect(layout?.yPct).toBe(84);
    expect(result.marks).toEqual([]);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('reads saved script and visual style by user and video', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce({
      id: 'vs_1',
      user_id: 'user-1',
      video_id: '1001',
      script_text: 'abc工具def',
      subtitle_template_id: 'rec-subtitle-e-white-blue-pro',
      highlights_json: JSON.stringify([{ id: 'h1', start: 3, end: 5 }]),
      visual_style_json: JSON.stringify({
        normalColor: '#FFFFFF',
        layout: { xPct: 48, yPct: 82, anchor: 'bottom-center' },
      }),
      marks_json: '[]',
      created_at: '2026-05-21T00:00:00.000Z',
      updated_at: '2026-05-21T00:00:00.000Z',
    });

    const data = await service.getByVideoId('user-1', '1001');
    expect(data.videoId).toBe('1001');
    expect(data.highlights[0]).toMatchObject({
      start: 3,
      end: 5,
      text: '工具',
    });
    expect(data.subtitleVisualStyle?.normalColor).toBe('#FFFFFF');
    const dataLayout = data.subtitleVisualStyle?.layout as
      | { xPct?: number; yPct?: number }
      | undefined;
    expect(dataLayout?.xPct).toBe(48);
    expect(dataLayout?.yPct).toBe(82);
    expect(data.marks).toEqual([]);
  });

  it('creates title mark with optional layout and updates marks_json', async () => {
    const { service, db } = makeService();
    db.queryOne
      .mockResolvedValueOnce({ id: 'vs_owner' })
      .mockResolvedValueOnce({
        id: 'vs_1',
        user_id: 'user-1',
        video_id: '1001',
        script_text: '普通人做AI视频，最缺的是工具。',
        subtitle_template_id: 'rec-subtitle-b-white-green-tech',
        highlights_json: '[]',
        visual_style_json: '{}',
        marks_json: '[]',
        created_at: '2026-05-21T00:00:00.000Z',
        updated_at: '2026-05-21T00:00:00.000Z',
      });

    const mark = await service.markTitle('user-1', {
      videoId: '1001',
      start: 4,
      end: 6,
      text: 'AI',
      templateId: 'tech_card_pop',
      themeId: 'tech_green',
      position: 'center',
      layout: { xPct: 52, yPct: 26, anchor: 'top-center', scale: 1.1 },
      duration: 1.8,
    });

    expect(mark.type).toBe('title_effect');
    expect(mark.text.trim()).toBe('AI');
    expect(mark.effect.layout).toMatchObject({
      xPct: 52,
      yPct: 26,
      anchor: 'top-center',
      scale: 1.1,
    });
    expect(mark.startTime).toBeGreaterThanOrEqual(0);
    expect(mark.endTime).toBeGreaterThan(mark.startTime);
    expect(db.execute).toHaveBeenCalledTimes(1);
    const executeCalls = db.execute.mock.calls as unknown[][];
    const updateSql = executeCalls[0]?.[0];
    if (typeof updateSql !== 'string') {
      throw new Error('expected update sql string');
    }
    expect(updateSql).toContain('UPDATE video_scripts');
  });

  it('rejects too many highlights in save payload', async () => {
    const { service, db } = makeService();
    db.queryOne.mockResolvedValueOnce(null);

    const highlights = Array.from({ length: 401 }, (_, index) => ({
      id: `hl_${index}`,
      start: index,
      end: index + 1,
    }));

    await expect(
      service.save('user-1', {
        videoId: 1001,
        scriptText: 'a'.repeat(1000),
        subtitleTemplateId: 'tech_green',
        highlights,
      }),
    ).rejects.toThrow(/too many highlights/);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('rejects too deep layout object in mark-title payload', async () => {
    const { service, db } = makeService();
    db.queryOne
      .mockResolvedValueOnce({ id: 'vs_owner' })
      .mockResolvedValueOnce({
        id: 'vs_1',
        user_id: 'user-1',
        video_id: '1001',
        script_text: 'abcdefg',
        subtitle_template_id: 'rec-subtitle-b-white-green-tech',
        highlights_json: '[]',
        visual_style_json: '{}',
        marks_json: '[]',
        created_at: '2026-05-21T00:00:00.000Z',
        updated_at: '2026-05-21T00:00:00.000Z',
      });

    await expect(
      service.markTitle('user-1', {
        videoId: '1001',
        start: 0,
        end: 2,
        text: 'ab',
        layout: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } as never,
      }),
    ).rejects.toThrow(/layout is too deep/);
    expect(db.execute).not.toHaveBeenCalled();
  });
});
