import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  readPositiveInt,
  runWithRuntimeLimit,
} from '../../common/runtime-limits.util';
import { DatabaseService } from '../../database/database.service';
import {
  FfmpegAudioService,
  type TimedOverlayAsset,
} from '../../integrations/media/ffmpeg-audio.service';
import { TaskStatusCacheService } from './task-status-cache.service';
import {
  VideoScriptService,
  type TitleLayout,
  type TitleLayoutAnchor,
} from './video-script.service';

export type TitleRenderTaskStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed';

type TitleAssetTaskStatusRow = {
  id: string;
  user_id: string;
  kind: string;
  status: TitleRenderTaskStatus;
  payload_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type TitleAssetRow = {
  id: string;
  user_id: string;
  video_id: string;
  mark_id: string;
  text: string;
  template_id: string;
  theme_id: string;
  start_time: number;
  end_time: number;
  duration: number;
  position: string;
  layout_json: string | null;
  status: TitleRenderTaskStatus;
  transparent_asset_url: string | null;
  preview_url: string | null;
  error_message: string | null;
  is_active: number | null;
  created_at: string;
  updated_at: string;
};

type TitleRenderTaskDto = {
  taskId: string;
  status: TitleRenderTaskStatus;
  assetUrl?: string;
  previewUrl?: string;
  errorMessage?: string;
};

export type ActiveTitleOverlayAsset = {
  assetId: string;
  videoId: string;
  markId: string;
  startTime: number;
  endTime: number;
  inputPath: string;
};

type ThemeStyle = {
  fontColor: string;
  borderColor: string;
  boxColor: string;
};

const TITLE_THEME_STYLES: Record<string, ThemeStyle> = {
  tech_green: {
    fontColor: '0xFFFFFF',
    borderColor: '0x000000',
    boxColor: '0x00FF66@0.35',
  },
  impact_red: {
    fontColor: '0xFFFFFF',
    borderColor: '0x000000',
    boxColor: '0xFF3B30@0.35',
  },
  classic_yellow: {
    fontColor: '0xFFFFFF',
    borderColor: '0x000000',
    boxColor: '0xFFD400@0.35',
  },
  business_blue: {
    fontColor: '0xFFFFFF',
    borderColor: '0x000000',
    boxColor: '0x2F80ED@0.35',
  },
};

@Injectable()
export class TitleAssetsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TitleAssetsService.name);
  private pollTimer: NodeJS.Timeout | null = null;
  private readonly runningTaskIds = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly cache: TaskStatusCacheService,
    private readonly config: ConfigService,
    private readonly videoScript: VideoScriptService,
    private readonly ffmpeg: FfmpegAudioService,
  ) {}

  onModuleInit(): void {
    const intervalMs = readPositiveInt(
      this.config.get('TITLE_ASSET_POLL_INTERVAL_MS'),
      5_000,
    );
    this.pollTimer = setInterval(() => {
      void this.processPendingTasks();
    }, intervalMs);
    this.pollTimer.unref?.();
    void this.processPendingTasks();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async createRenderTask(
    userId: string,
    payload: { videoId: unknown; markId: unknown },
  ): Promise<{ taskId: string; status: TitleRenderTaskStatus }> {
    const videoId = this.normalizeVideoId(payload.videoId);
    const markId = this.normalizeMarkId(payload.markId);
    const mark = await this.videoScript.getTitleMark(userId, videoId, markId);
    const now = new Date().toISOString();
    const taskId = `title_task_${randomUUID().slice(0, 12)}`;
    const assetId = await this.upsertTitleAssetRow(userId, videoId, markId, {
      text: mark.text,
      templateId: mark.effect.templateId,
      themeId: mark.effect.themeId,
      position: mark.effect.position,
      duration: mark.effect.duration,
      startTime: mark.startTime,
      endTime: mark.endTime,
      layout: mark.effect.layout,
    });

    await this.persistTask({
      id: taskId,
      userId,
      status: 'pending',
      payload: { videoId, markId, assetId },
      result: {},
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    void this.runRenderTask(taskId);

    return { taskId, status: 'pending' };
  }

  async getRenderTask(
    userId: string,
    taskIdRaw: unknown,
  ): Promise<TitleRenderTaskDto> {
    const taskId =
      typeof taskIdRaw === 'string' && taskIdRaw.trim() ? taskIdRaw.trim() : '';
    if (!taskId) {
      throw new BadRequestException('taskId 不能为空');
    }

    const cached = await this.cache.get<{
      userId: string;
      dto: TitleRenderTaskDto;
    }>(taskId);
    if (cached?.userId === userId) {
      return cached.dto;
    }

    const row = await this.db.queryOne<TitleAssetTaskStatusRow>(
      `SELECT id, user_id, kind, status, payload_json, result_json, error, created_at, updated_at
       FROM task_statuses
       WHERE id = ? AND user_id = ?`,
      [taskId, userId],
    );
    if (!row || row.kind !== 'title-asset-render') {
      throw new NotFoundException('标题素材渲染任务不存在');
    }
    const result =
      this.parseJson<Record<string, unknown>>(row.result_json) || {};
    return this.cacheAndReturn(taskId, userId, {
      taskId,
      status: this.resolveTaskStatus(row.status, result),
      assetUrl: this.readResultString(result, 'assetUrl') ?? undefined,
      previewUrl: this.readResultString(result, 'previewUrl') ?? undefined,
      errorMessage: row.error ?? undefined,
    });
  }

  async listActiveSuccessAssetsForVideo(
    userId: string,
    videoIdRaw: unknown,
  ): Promise<ActiveTitleOverlayAsset[]> {
    const videoId = this.normalizeVideoId(videoIdRaw);
    const rows = await this.db.queryAll<TitleAssetRow>(
      `SELECT id, user_id, video_id, mark_id, text, template_id, theme_id, start_time, end_time, duration, position, layout_json,
              status, transparent_asset_url, preview_url, error_message, is_active, created_at, updated_at
       FROM video_title_asset
       WHERE user_id = ? AND video_id = ? AND status = ? AND is_active = 1
       ORDER BY start_time ASC, updated_at ASC`,
      [userId, videoId, 'success'],
    );
    const overlays: ActiveTitleOverlayAsset[] = [];
    for (const row of rows) {
      const p = this.resolveLocalAssetPath(row.transparent_asset_url);
      if (!p || !existsSync(p)) continue;
      overlays.push({
        assetId: row.id,
        videoId: row.video_id,
        markId: row.mark_id,
        startTime: Math.max(0, Number(row.start_time) || 0),
        endTime: Math.max(0, Number(row.end_time) || 0),
        inputPath: p,
      });
    }
    return overlays.filter((item) => item.endTime > item.startTime);
  }

  async overlayAssetsOnVideo(params: {
    inputVideoPath: string;
    outputVideoPath: string;
    overlays: ActiveTitleOverlayAsset[];
  }): Promise<void> {
    const list: TimedOverlayAsset[] = params.overlays.map((item) => ({
      inputPath: item.inputPath,
      startTime: item.startTime,
      endTime: item.endTime,
    }));
    await this.ffmpeg.overlayTimedVideoAssets({
      inputVideoPath: params.inputVideoPath,
      outputVideoPath: params.outputVideoPath,
      overlays: list,
    });
  }

  private async processPendingTasks(): Promise<void> {
    await this.failTimedOutProcessingTasks();
    const rows = await this.db.queryAll<Pick<TitleAssetTaskStatusRow, 'id'>>(
      `SELECT id
       FROM task_statuses
       WHERE kind = 'title-asset-render' AND status = 'pending'
       ORDER BY updated_at ASC
       LIMIT 20`,
      [],
    );
    for (const row of rows) {
      void this.runRenderTask(row.id);
    }
  }

  private async runRenderTask(taskId: string): Promise<void> {
    if (this.runningTaskIds.has(taskId)) return;
    this.runningTaskIds.add(taskId);
    try {
      const row = await this.db.queryOne<TitleAssetTaskStatusRow>(
        `SELECT id, user_id, kind, status, payload_json, result_json, error, created_at, updated_at
       FROM task_statuses
       WHERE id = ?`,
        [taskId],
      );
      if (!row || row.kind !== 'title-asset-render') return;
      if (row.status !== 'pending') return;
      const payload =
        this.parseJson<Record<string, unknown>>(row.payload_json) || {};
      const assetId =
        typeof payload.assetId === 'string' && payload.assetId.trim()
          ? payload.assetId.trim()
          : '';
      if (!assetId) {
        await this.persistTask({
          id: taskId,
          userId: row.user_id,
          status: 'failed',
          payload,
          result: {},
          error: 'Invalid title asset render payload: missing assetId',
          createdAt: row.created_at,
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      const asset = await this.db.queryOne<TitleAssetRow>(
        `SELECT id, user_id, video_id, mark_id, text, template_id, theme_id, start_time, end_time, duration, position, layout_json,
              status, transparent_asset_url, preview_url, error_message, is_active, created_at, updated_at
       FROM video_title_asset
       WHERE id = ? AND user_id = ?`,
        [assetId, row.user_id],
      );
      if (!asset) {
        await this.persistTask({
          id: taskId,
          userId: row.user_id,
          status: 'failed',
          payload,
          result: {},
          error: 'Title asset row not found',
          createdAt: row.created_at,
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      if (asset.status === 'success') return;

      await this.persistTask({
        id: taskId,
        userId: row.user_id,
        status: 'processing',
        payload,
        result: { assetId },
        error: null,
        createdAt: row.created_at,
        updatedAt: new Date().toISOString(),
      });
      await this.updateAssetStatus(asset.id, 'processing', {
        errorMessage: null,
        assetUrl: null,
        previewUrl: null,
      });

      try {
        const result = await runWithRuntimeLimit(
          'title-asset-render',
          {
            concurrency: readPositiveInt(
              this.config.get('TITLE_ASSET_QUEUE_CONCURRENCY'),
              1,
            ),
            queueLimit: readPositiveInt(
              this.config.get('TITLE_ASSET_QUEUE_LIMIT'),
              20,
            ),
          },
          async () => this.executeRenderTask(asset),
        );

        await this.updateAssetStatus(asset.id, 'success', {
          errorMessage: null,
          assetUrl: result.assetUrl,
          previewUrl: result.previewUrl,
        });
        await this.persistTask({
          id: taskId,
          userId: row.user_id,
          status: 'success',
          payload,
          result: {
            assetId: asset.id,
            assetUrl: result.assetUrl,
            previewUrl: result.previewUrl,
            pixFmt: result.pixFmt,
            alphaMode: result.alphaMode,
          },
          error: null,
          createdAt: row.created_at,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.updateAssetStatus(asset.id, 'failed', {
          errorMessage: message,
          assetUrl: null,
          previewUrl: null,
        });
        await this.persistTask({
          id: taskId,
          userId: row.user_id,
          status: 'failed',
          payload,
          result: { assetId: asset.id },
          error: message,
          createdAt: row.created_at,
          updatedAt: new Date().toISOString(),
        });
        this.logger.warn(`Title asset render failed (${taskId}): ${message}`);
      }
    } finally {
      this.runningTaskIds.delete(taskId);
    }
  }

  private async executeRenderTask(asset: TitleAssetRow): Promise<{
    assetUrl: string;
    previewUrl: string;
    pixFmt: string;
    alphaMode: string | null;
  }> {
    const outputDir = this.titleAssetOutputDir();
    const tempRoot = this.titleAssetTempDir();
    await Promise.all([
      fs.mkdir(outputDir, { recursive: true }),
      fs.mkdir(tempRoot, { recursive: true }),
    ]);
    const tempDir = await fs.mkdtemp(path.join(tempRoot, 'job-'));
    try {
      const duration = this.normalizeDuration(asset.duration);
      const fileBase = `${asset.video_id}_${asset.mark_id}_${Date.now()}_${randomUUID().slice(0, 6)}`;
      const outputWebm = path.join(outputDir, `${fileBase}.webm`);
      const outputPreview = path.join(outputDir, `${fileBase}_preview.mp4`);
      const theme = this.resolveThemeStyle(asset.theme_id);
      const layout = this.resolveTitleLayout(asset);
      const drawExpr = this.layoutToDrawExpressions(layout, asset.position);
      const timeoutMs = this.titleRenderTimeoutMs();
      const deadline = Date.now() + timeoutMs;
      const layoutScale = layout?.scale ?? 1;
      const fontSize = Math.max(24, Math.round(62 * layoutScale));
      const boxBorderWidth = Math.max(8, Math.round(24 * layoutScale));

      await this.ffmpeg.renderTransparentTitleCardWebm({
        text: asset.text,
        durationSeconds: duration,
        outputWebmPath: outputWebm,
        width: 1080,
        height: 1920,
        fps: 30,
        fontFile: this.config.get<string>('TITLE_ASSET_FONT_FILE') || null,
        fontFamily:
          this.config.get<string>('TITLE_ASSET_FONT_FAMILY') ||
          'Noto Sans CJK SC',
        fontSize,
        fontColor: theme.fontColor,
        borderColor: theme.borderColor,
        borderWidth: 3,
        boxColor: theme.boxColor,
        boxBorderWidth,
        xExpression: drawExpr.xExpression,
        yExpression: drawExpr.yExpression,
        timeoutMs: this.remainingRenderBudgetMs(deadline),
      });
      const alphaProbe = await this.ffmpeg.probeVideoAlphaInfo(outputWebm);
      const pixFmt = alphaProbe.pixFmt ?? '';
      const alphaMode = alphaProbe.alphaMode;
      const hasAlpha = pixFmt === 'yuva420p' || alphaMode === '1';
      if (!hasAlpha) {
        const fallbackDir = path.join(outputDir, `${fileBase}_fallback`);
        await fs.mkdir(fallbackDir, { recursive: true });
        const fallbackPng = path.join(fallbackDir, 'frame_0001.png');
        await this.ffmpeg.renderTitleFallbackPngFrame({
          text: asset.text,
          outputPngPath: fallbackPng,
          width: 1080,
          height: 1920,
          fontFile: this.config.get<string>('TITLE_ASSET_FONT_FILE') || null,
          fontFamily:
            this.config.get<string>('TITLE_ASSET_FONT_FAMILY') ||
            'Noto Sans CJK SC',
          fontSize,
          fontColor: theme.fontColor,
          borderColor: theme.borderColor,
          borderWidth: 3,
          boxColor: theme.boxColor,
          boxBorderWidth,
          xExpression: drawExpr.xExpression,
          yExpression: drawExpr.yExpression,
          timeoutMs: this.remainingRenderBudgetMs(deadline),
        });
        await fs.writeFile(
          path.join(fallbackDir, 'manifest.json'),
          JSON.stringify(
            {
              version: 1,
              fps: 30,
              width: 1080,
              height: 1920,
              pattern: 'frame_%04d.png',
              frameCount: 1,
              createdAt: new Date().toISOString(),
            },
            null,
            2,
          ),
          'utf8',
        );
        throw new Error(
          `WebM alpha check failed: pix_fmt=${pixFmt || 'unknown'}, alpha_mode=${alphaMode || 'unknown'}`,
        );
      }
      await this.ffmpeg.buildPreviewMp4FromTransparentWebm({
        inputWebmPath: outputWebm,
        outputMp4Path: outputPreview,
        durationSeconds: duration,
        width: 1080,
        height: 1920,
        timeoutMs: this.remainingRenderBudgetMs(deadline),
      });

      return {
        assetUrl: this.fileToUploadUrl(outputWebm),
        previewUrl: this.fileToUploadUrl(outputPreview),
        pixFmt,
        alphaMode,
      };
    } finally {
      await fs
        .rm(tempDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  private async upsertTitleAssetRow(
    userId: string,
    videoId: string,
    markId: string,
    data: {
      text: string;
      templateId: string;
      themeId: string;
      position: 'center' | 'top' | 'bottom';
      layout?: TitleLayout;
      duration: number;
      startTime: number;
      endTime: number;
    },
  ): Promise<string> {
    const now = new Date().toISOString();
    const existing = await this.db.queryOne<{ id: string }>(
      `SELECT id
       FROM video_title_asset
       WHERE user_id = ? AND video_id = ? AND mark_id = ? AND is_active = 1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, videoId, markId],
    );
    if (existing) {
      await this.db.execute(
        `UPDATE video_title_asset
         SET text = ?, template_id = ?, theme_id = ?, start_time = ?, end_time = ?, duration = ?, position = ?, layout_json = ?,
             status = ?, transparent_asset_url = NULL, preview_url = NULL, error_message = NULL, updated_at = ?
         WHERE id = ?`,
        [
          data.text,
          data.templateId,
          data.themeId,
          data.startTime,
          data.endTime,
          data.duration,
          data.position,
          data.layout ? JSON.stringify(data.layout) : null,
          'pending',
          now,
          existing.id,
        ],
      );
      return existing.id;
    }

    const id = `vta_${randomUUID().slice(0, 12)}`;
    await this.db.execute(
      `INSERT INTO video_title_asset
       (id, user_id, video_id, mark_id, text, template_id, theme_id, start_time, end_time, duration, position, layout_json, status,
        transparent_asset_url, preview_url, error_message, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?)`,
      [
        id,
        userId,
        videoId,
        markId,
        data.text,
        data.templateId,
        data.themeId,
        data.startTime,
        data.endTime,
        data.duration,
        data.position,
        data.layout ? JSON.stringify(data.layout) : null,
        'pending',
        now,
        now,
      ],
    );
    return id;
  }

  private async persistTask(task: {
    id: string;
    userId: string;
    status: TitleRenderTaskStatus;
    payload: Record<string, unknown>;
    result: Record<string, unknown>;
    error: string | null;
    createdAt: string;
    updatedAt: string;
  }): Promise<void> {
    const payloadJson = JSON.stringify(task.payload);
    const resultJson = JSON.stringify({
      ...task.result,
      assetStatus: task.status,
    });
    const expiresAt = new Date(
      Date.now() +
        readPositiveInt(
          this.config.get('TASK_STATUS_TTL_MS'),
          24 * 60 * 60_000,
        ),
    ).toISOString();
    const exists = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM task_statuses WHERE id = ?`,
      [task.id],
    );
    if (exists) {
      await this.db.execute(
        `UPDATE task_statuses
         SET status = ?, progress = ?, payload_json = ?, result_json = ?, error = ?, updated_at = ?, expires_at = ?
         WHERE id = ?`,
        [
          task.status,
          task.status === 'pending'
            ? 0
            : task.status === 'processing'
              ? 50
              : 100,
          payloadJson,
          resultJson,
          task.error,
          task.updatedAt,
          expiresAt,
          task.id,
        ],
      );
    } else {
      await this.db.execute(
        `INSERT INTO task_statuses
         (id, user_id, kind, status, progress, payload_json, result_json, error, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          task.userId,
          'title-asset-render',
          task.status,
          task.status === 'pending'
            ? 0
            : task.status === 'processing'
              ? 50
              : 100,
          payloadJson,
          resultJson,
          task.error,
          task.createdAt,
          task.updatedAt,
          expiresAt,
        ],
      );
    }
    await this.cache.set(task.id, {
      userId: task.userId,
      dto: {
        taskId: task.id,
        status: task.status,
        assetUrl:
          typeof task.result.assetUrl === 'string'
            ? task.result.assetUrl
            : undefined,
        previewUrl:
          typeof task.result.previewUrl === 'string'
            ? task.result.previewUrl
            : undefined,
        errorMessage: task.error ?? undefined,
      } satisfies TitleRenderTaskDto,
    });
  }

  private async updateAssetStatus(
    assetId: string,
    status: TitleRenderTaskStatus,
    patch: {
      assetUrl: string | null;
      previewUrl: string | null;
      errorMessage: string | null;
    },
  ): Promise<void> {
    await this.db.execute(
      `UPDATE video_title_asset
       SET status = ?, transparent_asset_url = ?, preview_url = ?, error_message = ?, updated_at = ?
       WHERE id = ?`,
      [
        status,
        patch.assetUrl,
        patch.previewUrl,
        patch.errorMessage,
        new Date().toISOString(),
        assetId,
      ],
    );
  }

  private cacheAndReturn(
    taskId: string,
    userId: string,
    dto: TitleRenderTaskDto,
  ): TitleRenderTaskDto {
    void this.cache.set(taskId, { userId, dto });
    return dto;
  }

  private readResultString(
    result: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = result[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private resolveTaskStatus(
    taskStatus: TitleRenderTaskStatus,
    result: Record<string, unknown>,
  ): TitleRenderTaskStatus {
    const assetStatus = this.readResultString(result, 'assetStatus');
    if (
      assetStatus === 'pending' ||
      assetStatus === 'processing' ||
      assetStatus === 'success' ||
      assetStatus === 'failed'
    ) {
      return assetStatus;
    }
    return taskStatus;
  }

  private parseJson<T>(value: string | null): T | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
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

  private normalizeMarkId(value: unknown): string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    throw new BadRequestException('markId 不能为空');
  }

  private resolveThemeStyle(themeIdRaw: string): ThemeStyle {
    const key = themeIdRaw?.trim();
    return TITLE_THEME_STYLES[key] ?? TITLE_THEME_STYLES.tech_green;
  }

  private normalizeDuration(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1.8;
    return Math.max(0.6, Math.min(8, n));
  }

  private titleRenderTimeoutMs(): number {
    return readPositiveInt(
      this.config.get('TITLE_ASSET_RENDER_TIMEOUT_MS'),
      30_000,
    );
  }

  private remainingRenderBudgetMs(deadlineMs: number): number {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `Title asset render timeout after ${this.titleRenderTimeoutMs()}ms`,
      );
    }
    return remaining;
  }

  private async failTimedOutProcessingTasks(): Promise<void> {
    const timeoutMs = this.titleRenderTimeoutMs();
    const rows = await this.db.queryAll<
      Pick<
        TitleAssetTaskStatusRow,
        'id' | 'user_id' | 'payload_json' | 'created_at' | 'updated_at'
      >
    >(
      `SELECT id, user_id, payload_json, created_at, updated_at
       FROM task_statuses
       WHERE kind = 'title-asset-render' AND status = 'processing'
       ORDER BY updated_at ASC
       LIMIT 20`,
      [],
    );
    const now = Date.now();
    for (const row of rows) {
      if (this.runningTaskIds.has(row.id)) continue;
      const updatedMs = Date.parse(row.updated_at || row.created_at);
      if (!Number.isFinite(updatedMs) || now - updatedMs < timeoutMs) continue;

      const payload =
        this.parseJson<Record<string, unknown>>(row.payload_json) || {};
      const assetId =
        typeof payload.assetId === 'string' && payload.assetId.trim()
          ? payload.assetId.trim()
          : '';
      const message = `Title asset render timeout after ${timeoutMs}ms`;
      if (assetId) {
        await this.updateAssetStatus(assetId, 'failed', {
          errorMessage: message,
          assetUrl: null,
          previewUrl: null,
        });
      }
      await this.persistTask({
        id: row.id,
        userId: row.user_id,
        status: 'failed',
        payload,
        result: assetId ? { assetId } : {},
        error: message,
        createdAt: row.created_at,
        updatedAt: new Date().toISOString(),
      });
      this.logger.warn(`Title asset task timeout failed (${row.id})`);
    }
  }

  private resolveTitleLayout(asset: TitleAssetRow): TitleLayout | undefined {
    const parsed = this.parseJson<unknown>(asset.layout_json);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const data = parsed as Record<string, unknown>;
    const xPct = this.readFiniteNumber(data.xPct);
    const yPct = this.readFiniteNumber(data.yPct);
    if (xPct === null || yPct === null) return undefined;
    const anchor = this.normalizeLayoutAnchor(data.anchor);
    return {
      xPct: this.roundNum(this.clamp(xPct, 0, 100)),
      yPct: this.roundNum(this.clamp(yPct, 0, 100)),
      anchor,
      scale: this.roundNum(
        this.clamp(this.readFiniteNumber(data.scale) ?? 1, 0.7, 1.8),
      ),
      safeAreaPct: this.roundNum(
        this.clamp(this.readFiniteNumber(data.safeAreaPct) ?? 6, 0, 24),
      ),
      maxWidthPct: this.roundNum(
        this.clamp(this.readFiniteNumber(data.maxWidthPct) ?? 82, 20, 100),
      ),
    };
  }

  private layoutToDrawExpressions(
    layout: TitleLayout | undefined,
    legacyPositionRaw: string,
  ): { xExpression: string; yExpression: string } {
    if (!layout) {
      return {
        xExpression: '(w-text_w)/2',
        yExpression: this.positionToYExpression(legacyPositionRaw),
      };
    }
    const width = 1080;
    const height = 1920;
    const safePct = this.clamp(layout.safeAreaPct ?? 6, 0, 24);
    const minXPct = safePct;
    const maxXPct = 100 - safePct;
    const minYPct = safePct;
    const maxYPct = 100 - safePct;
    const xPct = this.clamp(layout.xPct, minXPct, maxXPct);
    const yPct = this.clamp(layout.yPct, minYPct, maxYPct);
    const xPx = Math.round((xPct / 100) * width);
    const yPx = Math.round((yPct / 100) * height);
    const xExpr = this.anchorToXExpression(layout.anchor, xPx);
    const yExpr = this.anchorToYExpression(layout.anchor, yPx);
    return {
      xExpression: this.wrapDrawExprWithClamp(xExpr, 'w', 'text_w'),
      yExpression: this.wrapDrawExprWithClamp(yExpr, 'h', 'text_h'),
    };
  }

  private anchorToXExpression(anchor: TitleLayoutAnchor, xPx: number): string {
    switch (anchor) {
      case 'top-left':
      case 'bottom-left':
      case 'left-center':
        return `${xPx}`;
      case 'top-right':
      case 'bottom-right':
      case 'right-center':
        return `${xPx}-text_w`;
      default:
        return `${xPx}-text_w/2`;
    }
  }

  private anchorToYExpression(anchor: TitleLayoutAnchor, yPx: number): string {
    switch (anchor) {
      case 'top-left':
      case 'top-center':
      case 'top-right':
        return `${yPx}`;
      case 'bottom-left':
      case 'bottom-center':
      case 'bottom-right':
        return `${yPx}-text_h`;
      default:
        return `${yPx}-text_h/2`;
    }
  }

  private wrapDrawExprWithClamp(
    expr: string,
    axisTotal: 'w' | 'h',
    textAxis: 'text_w' | 'text_h',
  ): string {
    return `max(0,min(${axisTotal}-${textAxis},${expr}))`;
  }

  private positionToYExpression(positionRaw: string): string {
    const position = (positionRaw || '').trim().toLowerCase();
    if (position === 'top') return 'h*0.22-text_h/2';
    if (position === 'bottom') return 'h*0.78-text_h/2';
    return '(h-text_h)/2';
  }

  private normalizeLayoutAnchor(value: unknown): TitleLayoutAnchor {
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

  private roundNum(value: number): number {
    return Number(value.toFixed(3));
  }

  private titleAssetOutputDir(): string {
    const uploadRoot = path.resolve(
      this.config.get<string>('UPLOAD_DIR')?.trim() || 'uploads',
    );
    const configured = this.config
      .get<string>('TITLE_ASSET_OUTPUT_DIR')
      ?.trim();
    return path.resolve(configured || path.join(uploadRoot, 'title-assets'));
  }

  private titleAssetTempDir(): string {
    const configured = this.config.get<string>('TITLE_ASSET_TEMP_DIR')?.trim();
    return path.resolve(configured || path.join('data', 'tmp', 'title-assets'));
  }

  private fileToUploadUrl(filePath: string): string {
    const uploadRoot = path.resolve(
      this.config.get<string>('UPLOAD_DIR')?.trim() || 'uploads',
    );
    const relative = path.relative(uploadRoot, path.resolve(filePath));
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return filePath;
    }
    const normalized = relative.replace(/\\/g, '/');
    const configuredBase = this.config
      .get<string>('PUBLIC_UPLOAD_BASE_URL')
      ?.trim();
    if (configuredBase) {
      return `${configuredBase.replace(/\/+$/, '')}/${normalized}`;
    }
    return `/uploads/${normalized}`;
  }

  private resolveLocalAssetPath(assetUrl: string | null): string | null {
    if (!assetUrl || !assetUrl.trim()) return null;
    const value = assetUrl.trim();
    if (path.isAbsolute(value)) {
      return value;
    }
    if (value.startsWith('/uploads/')) {
      const uploadRoot = path.resolve(
        this.config.get<string>('UPLOAD_DIR')?.trim() || 'uploads',
      );
      const relative = value.slice('/uploads/'.length);
      return path.resolve(path.join(uploadRoot, relative));
    }
    if (/^https?:\/\//i.test(value)) {
      const publicBase = this.config
        .get<string>('PUBLIC_UPLOAD_BASE_URL')
        ?.trim();
      if (publicBase && value.startsWith(publicBase)) {
        const relative = value.slice(publicBase.length).replace(/^\/+/, '');
        const uploadRoot = path.resolve(
          this.config.get<string>('UPLOAD_DIR')?.trim() || 'uploads',
        );
        return path.resolve(path.join(uploadRoot, relative));
      }
    }
    return null;
  }
}
