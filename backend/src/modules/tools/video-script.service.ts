import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { ResourcesService } from '../resources/resources.service';
import {
  defaultSubtitleStyle,
  normalizeSubtitleTemplateId,
} from './subtitle-color-templates';
import {
  type ScriptHighlightRange,
  normalizeScriptHighlights,
} from './highlight-range-utils';

const MAX_HIGHLIGHTS_COUNT = 400;
const MAX_HIGHLIGHT_TEXT_LENGTH = 500;
const MAX_TITLE_MARKS_COUNT = 200;
const MAX_TITLE_TEXT_LENGTH = 120;
const MAX_OBJECT_BYTES = 8_192;
const MAX_OBJECT_NODES = 160;
const MAX_OBJECT_DEPTH = 6;
const MAX_TEMPLATE_ID_LENGTH = 64;
const MAX_THEME_ID_LENGTH = 64;

type VideoScriptRow = {
  id: string;
  user_id: string;
  video_id: string;
  script_text: string;
  subtitle_template_id: string;
  highlights_json: string | null;
  visual_style_json: string | null;
  marks_json: string | null;
  created_at: string;
  updated_at: string;
};

export interface SaveVideoScriptInput {
  videoId: unknown;
  scriptText: unknown;
  subtitleTemplateId: unknown;
  highlights?: unknown;
  subtitleVisualStyle?: unknown;
}

export interface MarkTitleInput {
  videoId: unknown;
  start: unknown;
  end: unknown;
  text?: unknown;
  templateId?: unknown;
  themeId?: unknown;
  position?: unknown;
  layout?: unknown;
  duration?: unknown;
}

export type TitleLayoutAnchor =
  | 'center'
  | 'top-center'
  | 'bottom-center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'left-center'
  | 'right-center';

export interface TitleLayout {
  xPct: number;
  yPct: number;
  anchor: TitleLayoutAnchor;
  scale: number;
  safeAreaPct: number;
  maxWidthPct: number;
}

export interface VideoScriptMark {
  id: string;
  type: 'title_effect';
  start: number;
  end: number;
  text: string;
  effect: {
    templateId: string;
    themeId: string;
    position: 'center' | 'top' | 'bottom';
    layout?: TitleLayout;
    duration: number;
    enterAnimation: 'pop';
    exitAnimation: 'fade';
  };
  startTime: number;
  endTime: number;
}

export interface SavedVideoScript {
  videoId: string;
  scriptText: string;
  subtitleTemplateId: string;
  highlights: ScriptHighlightRange[];
  subtitleVisualStyle: Record<string, unknown> | null;
  marks: VideoScriptMark[];
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class VideoScriptService {
  constructor(
    private readonly db: DatabaseService,
    private readonly resources: ResourcesService,
  ) {}

  async save(
    userId: string,
    payload: SaveVideoScriptInput,
  ): Promise<SavedVideoScript> {
    const videoId = this.normalizeVideoId(payload.videoId);
    const scriptText = this.normalizeScriptText(payload.scriptText);
    this.assertRawHighlightsBudget(payload.highlights);
    this.assertObjectPayloadBudget(
      payload.subtitleVisualStyle,
      'subtitleVisualStyle',
    );
    const template = await this.resolveTemplate(
      userId,
      payload.subtitleTemplateId,
    );
    const highlights = normalizeScriptHighlights({
      highlights: payload.highlights,
      scriptText,
      defaultColor: template.highlightColor,
      defaultFontSizeScale: defaultSubtitleStyle.highlightFontSizeScale,
      defaultFontWeight: defaultSubtitleStyle.highlightFontWeight,
    });
    this.assertHighlightLimits(highlights);
    const subtitleVisualStyle = this.normalizeSubtitleVisualStyle(
      payload.subtitleVisualStyle,
    );

    const now = new Date().toISOString();
    const existing = await this.db.queryOne<
      Pick<VideoScriptRow, 'id' | 'marks_json'>
    >(
      `SELECT id, marks_json FROM video_scripts WHERE user_id = ? AND video_id = ?`,
      [userId, videoId],
    );
    const marks = this.normalizeTitleMarks(
      safeParseJsonArray(existing?.marks_json ?? null),
      scriptText,
    );

    if (existing) {
      await this.db.execute(
        `UPDATE video_scripts
         SET script_text = ?, subtitle_template_id = ?, highlights_json = ?, visual_style_json = ?, marks_json = ?, updated_at = ?
         WHERE user_id = ? AND video_id = ?`,
        [
          scriptText,
          template.id,
          JSON.stringify(highlights),
          subtitleVisualStyle ? JSON.stringify(subtitleVisualStyle) : '{}',
          JSON.stringify(marks),
          now,
          userId,
          videoId,
        ],
      );
    } else {
      await this.db.execute(
        `INSERT INTO video_scripts
         (id, user_id, video_id, script_text, subtitle_template_id, highlights_json, visual_style_json, marks_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `vs_${videoId}_${Date.now()}`,
          userId,
          videoId,
          scriptText,
          template.id,
          JSON.stringify(highlights),
          subtitleVisualStyle ? JSON.stringify(subtitleVisualStyle) : '{}',
          JSON.stringify(marks),
          now,
          now,
        ],
      );
    }

    return {
      videoId,
      scriptText,
      subtitleTemplateId: template.id,
      highlights,
      subtitleVisualStyle,
      marks,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getByVideoId(
    userId: string,
    videoIdRaw: unknown,
  ): Promise<SavedVideoScript> {
    const videoId = this.normalizeVideoId(videoIdRaw);
    const row = await this.db.queryOne<VideoScriptRow>(
      `SELECT id, user_id, video_id, script_text, subtitle_template_id, highlights_json, visual_style_json, marks_json, created_at, updated_at
       FROM video_scripts
       WHERE user_id = ? AND video_id = ?`,
      [userId, videoId],
    );
    if (!row) {
      throw new NotFoundException('未找到当前视频文案');
    }
    return this.rowToDto(row);
  }

  async getOptionalByVideoId(
    userId: string,
    videoId: string,
  ): Promise<SavedVideoScript | null> {
    const row = await this.db.queryOne<VideoScriptRow>(
      `SELECT id, user_id, video_id, script_text, subtitle_template_id, highlights_json, visual_style_json, marks_json, created_at, updated_at
       FROM video_scripts
       WHERE user_id = ? AND video_id = ?`,
      [userId, videoId],
    );
    return row ? this.rowToDto(row) : null;
  }

  async markTitle(
    userId: string,
    payload: MarkTitleInput,
  ): Promise<VideoScriptMark> {
    const videoId = this.normalizeVideoId(payload.videoId);
    await this.assertVideoOwnedByUser(userId, videoId);
    const saved = await this.getOptionalByVideoId(userId, videoId);
    if (!saved) {
      throw new NotFoundException('请先保存当前文案后再创建标题');
    }

    const scriptText = saved.scriptText;
    const scriptLength = scriptText.length;
    const start = this.normalizeRangePoint(payload.start, 0, scriptLength);
    const end = this.normalizeRangePoint(payload.end, 0, scriptLength);
    if (end <= start) {
      throw new BadRequestException('标题选区无效');
    }

    const selectedText = scriptText.slice(start, end);
    if (selectedText.trim().length > MAX_TITLE_TEXT_LENGTH) {
      throw new BadRequestException(
        `title text too long, max=${MAX_TITLE_TEXT_LENGTH}`,
      );
    }
    if (!selectedText.trim()) {
      throw new BadRequestException('标题选区不能为空白字符');
    }

    const requestText =
      typeof payload.text === 'string' ? payload.text.trim() : '';
    if (requestText && requestText !== selectedText.trim()) {
      throw new BadRequestException('标题选区与文案内容不匹配，请刷新后重试');
    }

    this.assertObjectPayloadBudget(payload.layout, 'layout');
    const duration = this.normalizeDuration(payload.duration);
    const timing = this.estimateMarkTimingByRange(scriptText, start, duration);
    const mark: VideoScriptMark = {
      id: `mark_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'title_effect',
      start,
      end,
      text: selectedText,
      effect: {
        templateId: this.normalizeTemplateId(payload.templateId),
        themeId: this.normalizeThemeId(payload.themeId),
        position: this.normalizePosition(payload.position),
        layout: this.normalizeTitleLayout(payload.layout),
        duration,
        enterAnimation: 'pop',
        exitAnimation: 'fade',
      },
      startTime: timing.startTime,
      endTime: timing.endTime,
    };

    const mergedMarks = this.mergeTitleMarks(saved.marks, mark, scriptText);
    if (mergedMarks.length > MAX_TITLE_MARKS_COUNT) {
      throw new BadRequestException(
        `too many title marks, max=${MAX_TITLE_MARKS_COUNT}`,
      );
    }
    await this.db.execute(
      `UPDATE video_scripts
       SET marks_json = ?, updated_at = ?
       WHERE user_id = ? AND video_id = ?`,
      [JSON.stringify(mergedMarks), new Date().toISOString(), userId, videoId],
    );
    return mark;
  }

  async getTitleMark(
    userId: string,
    videoIdRaw: unknown,
    markIdRaw: unknown,
  ): Promise<VideoScriptMark> {
    const videoId = this.normalizeVideoId(videoIdRaw);
    const markId =
      typeof markIdRaw === 'string' && markIdRaw.trim() ? markIdRaw.trim() : '';
    if (!markId) {
      throw new BadRequestException('markId 不能为空');
    }
    const saved = await this.getByVideoId(userId, videoId);
    const mark = saved.marks.find((item) => item.id === markId);
    if (!mark) {
      throw new NotFoundException('未找到对应标题标记');
    }
    return mark;
  }

  private async resolveTemplate(
    userId: string,
    rawValue: unknown,
  ): Promise<{ id: string; highlightColor: string }> {
    if (typeof rawValue !== 'string' || !rawValue.trim()) {
      throw new BadRequestException('subtitleTemplateId 不能为空');
    }
    const resolved = normalizeSubtitleTemplateId(rawValue.trim());
    const tpl = await this.resources.getSubtitleTemplate(userId, resolved);
    const style = tpl.styleJson ?? {};
    const highlightColor =
      typeof style.highlightColor === 'string' && style.highlightColor.trim()
        ? style.highlightColor.trim()
        : '#FFD400';
    return { id: resolved, highlightColor };
  }

  private normalizeVideoId(value: unknown): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    throw new BadRequestException('videoId 不能为空');
  }

  private normalizeScriptText(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('scriptText 不能为空');
    }
    const scriptText = value.replace(/\r\n/g, '\n');
    if (scriptText.trim().length < 2) {
      throw new BadRequestException('scriptText 过短');
    }
    if (scriptText.length > 50_000) {
      throw new BadRequestException('scriptText 超长（上限 50000）');
    }
    return scriptText;
  }

  private rowToDto(row: VideoScriptRow): SavedVideoScript {
    const scriptText =
      typeof row.script_text === 'string' ? row.script_text : '';
    const rawHighlights = safeParseJsonArray(row.highlights_json);
    const rawMarks = safeParseJsonArray(row.marks_json);
    const highlights = normalizeScriptHighlights({
      highlights: rawHighlights,
      scriptText,
      defaultColor: '#FFD400',
      defaultFontSizeScale: defaultSubtitleStyle.highlightFontSizeScale,
      defaultFontWeight: defaultSubtitleStyle.highlightFontWeight,
    });
    const marks = this.normalizeTitleMarks(rawMarks, scriptText);
    return {
      videoId: row.video_id,
      scriptText,
      subtitleTemplateId: row.subtitle_template_id,
      highlights,
      subtitleVisualStyle: this.normalizeSubtitleVisualStyle(
        safeParseJsonObject(row.visual_style_json),
      ),
      marks,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private normalizeTitleMarks(
    input: unknown[],
    scriptText: string,
  ): VideoScriptMark[] {
    const scriptLength = scriptText.length;
    const marks: VideoScriptMark[] = [];
    for (const raw of input) {
      if (!raw || typeof raw !== 'object') continue;
      const data = raw as Record<string, unknown>;
      if (data.type !== 'title_effect') continue;

      const start = this.normalizeRangePoint(data.start, 0, scriptLength);
      const end = this.normalizeRangePoint(data.end, 0, scriptLength);
      if (end <= start) continue;
      const text = scriptText.slice(start, end);
      if (!text.trim()) continue;

      const effectRaw =
        data.effect && typeof data.effect === 'object'
          ? (data.effect as Record<string, unknown>)
          : {};
      const duration = this.normalizeDuration(effectRaw.duration);
      const estimated = this.estimateMarkTimingByRange(
        scriptText,
        start,
        duration,
      );
      const startTimeRaw = this.readFiniteNumber(data.startTime);
      const endTimeRaw = this.readFiniteNumber(data.endTime);
      const startTime =
        startTimeRaw !== null && startTimeRaw >= 0
          ? this.roundSeconds(startTimeRaw)
          : estimated.startTime;
      const endTime =
        endTimeRaw !== null && endTimeRaw > startTime
          ? this.roundSeconds(endTimeRaw)
          : this.roundSeconds(startTime + duration);

      marks.push({
        id:
          typeof data.id === 'string' && data.id.trim()
            ? data.id.trim()
            : `mark_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'title_effect',
        start,
        end,
        text,
        effect: {
          templateId: this.normalizeTemplateId(effectRaw.templateId),
          themeId: this.normalizeThemeId(effectRaw.themeId),
          position: this.normalizePosition(effectRaw.position),
          layout: this.normalizeTitleLayout(effectRaw.layout),
          duration,
          enterAnimation: 'pop',
          exitAnimation: 'fade',
        },
        startTime,
        endTime,
      });
      if (marks.length >= MAX_TITLE_MARKS_COUNT) {
        break;
      }
    }

    return marks.sort((a, b) =>
      a.start === b.start ? a.end - b.end : a.start - b.start,
    );
  }

  private mergeTitleMarks(
    currentMarks: VideoScriptMark[],
    incoming: VideoScriptMark,
    scriptText: string,
  ): VideoScriptMark[] {
    const filtered = currentMarks.filter(
      (item) =>
        !(item.start === incoming.start && item.end === incoming.end) &&
        item.id !== incoming.id,
    );
    return this.normalizeTitleMarks([...filtered, incoming], scriptText);
  }

  private normalizeRangePoint(
    value: unknown,
    min: number,
    max: number,
  ): number {
    const n = this.readFiniteNumber(value);
    if (n === null) return min;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  private normalizeDuration(value: unknown): number {
    const n = this.readFiniteNumber(value);
    if (n === null) return 1.8;
    return this.roundSeconds(Math.max(0.6, Math.min(8, n)));
  }

  private normalizeTemplateId(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, MAX_TEMPLATE_ID_LENGTH);
    }
    return 'tech_card_pop';
  }

  private normalizeThemeId(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, MAX_THEME_ID_LENGTH);
    }
    return 'tech_green';
  }

  private normalizePosition(value: unknown): 'center' | 'top' | 'bottom' {
    if (value === 'top' || value === 'bottom' || value === 'center') {
      return value;
    }
    return 'center';
  }

  private normalizeTitleLayout(value: unknown): TitleLayout | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const data = value as Record<string, unknown>;
    const xPct = this.readFiniteNumber(data.xPct);
    const yPct = this.readFiniteNumber(data.yPct);
    if (xPct === null || yPct === null) return undefined;
    const anchor = this.normalizeTitleLayoutAnchor(data.anchor);
    return {
      xPct: this.roundLayoutValue(this.clamp(xPct, 0, 100)),
      yPct: this.roundLayoutValue(this.clamp(yPct, 0, 100)),
      anchor,
      scale: this.roundLayoutValue(
        this.clamp(this.readFiniteNumber(data.scale) ?? 1, 0.7, 1.8),
      ),
      safeAreaPct: this.roundLayoutValue(
        this.clamp(this.readFiniteNumber(data.safeAreaPct) ?? 6, 0, 24),
      ),
      maxWidthPct: this.roundLayoutValue(
        this.clamp(this.readFiniteNumber(data.maxWidthPct) ?? 82, 20, 100),
      ),
    };
  }

  private normalizeTitleLayoutAnchor(value: unknown): TitleLayoutAnchor {
    if (typeof value !== 'string') return 'center';
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
        return 'center';
    }
  }

  private readFiniteNumber(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private roundLayoutValue(value: number): number {
    return Number(value.toFixed(3));
  }

  private normalizeSubtitleVisualStyle(
    value: unknown,
  ): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const colorKeys = [
      'normalColor',
      'highlightColor',
      'strokeColor',
      'backgroundColor',
    ] as const;
    for (const key of colorKeys) {
      const v = raw[key];
      if (typeof v === 'string' && this.isSafeColor(v)) {
        out[key] = v.trim();
      }
    }
    const numberMap: Array<[string, number, number]> = [
      ['fontSize', 20, 96],
      ['strokeWidth', 0, 12],
      ['fontWeight', 300, 900],
      ['lineHeight', 1, 2.2],
    ];
    for (const [key, min, max] of numberMap) {
      const n = this.readFiniteNumber(raw[key]);
      if (n !== null) out[key] = this.roundLayoutValue(this.clamp(n, min, max));
    }
    const layout = this.normalizeTitleLayout(raw.layout);
    if (layout) out.layout = layout;
    return Object.keys(out).length > 0 ? out : null;
  }

  private isSafeColor(value: string): boolean {
    const text = value.trim();
    if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) return true;
    return /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|0?\.\d+|1))?\s*\)$/.test(
      text,
    );
  }

  private assertHighlightLimits(highlights: ScriptHighlightRange[]): void {
    if (highlights.length > MAX_HIGHLIGHTS_COUNT) {
      throw new BadRequestException(
        `too many highlights, max=${MAX_HIGHLIGHTS_COUNT}`,
      );
    }
    for (const item of highlights) {
      if (item.text.length > MAX_HIGHLIGHT_TEXT_LENGTH) {
        throw new BadRequestException(
          `highlight text too long, max=${MAX_HIGHLIGHT_TEXT_LENGTH}`,
        );
      }
    }
  }

  private assertRawHighlightsBudget(rawHighlights: unknown): void {
    if (
      Array.isArray(rawHighlights) &&
      rawHighlights.length > MAX_HIGHLIGHTS_COUNT
    ) {
      throw new BadRequestException(
        `too many highlights, max=${MAX_HIGHLIGHTS_COUNT}`,
      );
    }
  }

  private assertObjectPayloadBudget(value: unknown, field: string): void {
    if (!value || typeof value !== 'object') {
      return;
    }
    const seen = new Set<unknown>();
    let nodes = 0;
    const walk = (current: unknown, depth: number): void => {
      if (!current || typeof current !== 'object') {
        return;
      }
      if (seen.has(current)) {
        return;
      }
      seen.add(current);
      nodes += 1;
      if (nodes > MAX_OBJECT_NODES) {
        throw new BadRequestException(
          `${field} is too complex, maxNodes=${MAX_OBJECT_NODES}`,
        );
      }
      if (depth > MAX_OBJECT_DEPTH) {
        throw new BadRequestException(
          `${field} is too deep, maxDepth=${MAX_OBJECT_DEPTH}`,
        );
      }
      if (Array.isArray(current)) {
        for (const item of current) {
          walk(item, depth + 1);
        }
        return;
      }
      for (const item of Object.values(current as Record<string, unknown>)) {
        walk(item, depth + 1);
      }
    };
    walk(value, 1);
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (bytes > MAX_OBJECT_BYTES) {
      throw new BadRequestException(
        `${field} is too large, maxBytes=${MAX_OBJECT_BYTES}`,
      );
    }
  }

  private roundSeconds(value: number): number {
    return Number(Math.max(0, value).toFixed(3));
  }

  private estimateMarkTimingByRange(
    scriptText: string,
    start: number,
    duration: number,
  ): { startTime: number; endTime: number } {
    const compactScript = scriptText.replace(/\s+/g, '');
    const effectiveLength = Math.max(1, compactScript.length);
    const estimatedTotalSeconds = Math.max(
      3,
      Math.min(180, effectiveLength * 0.22),
    );
    const ratio = start / Math.max(1, scriptText.length);
    const startTime = this.roundSeconds(
      Math.max(0, estimatedTotalSeconds * ratio - 0.2),
    );
    const endTime = this.roundSeconds(
      Math.max(startTime + 0.4, startTime + duration),
    );
    return { startTime, endTime };
  }

  private async assertVideoOwnedByUser(
    userId: string,
    videoId: string,
  ): Promise<void> {
    const savedScript = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM video_scripts WHERE user_id = ? AND video_id = ?`,
      [userId, videoId],
    );
    if (savedScript) return;
    const work = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM user_works WHERE id = ? AND user_id = ?`,
      [videoId, userId],
    );
    if (!work) {
      throw new NotFoundException('当前视频不存在或无权限访问');
    }
  }
}

function safeParseJsonArray(input: string | null): unknown[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseJsonObject(input: string | null): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
