import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  runWithRuntimeLimit,
  readPositiveInt,
} from '../../common/runtime-limits.util';
import { DatabaseService } from '../../database/database.service';
import {
  SpeechAiService,
  type VoiceTuningOptions,
} from '../../integrations/ai/speech-ai.service';
import { FfmpegAudioService } from '../../integrations/media/ffmpeg-audio.service';
import { ResourcesService } from '../resources/resources.service';
import { TaskStatusCacheService } from './task-status-cache.service';

export type VoicePreviewTaskStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed';

export type VoicePreviewTaskDto = {
  previewTaskId: string;
  status: VoicePreviewTaskStatus;
  queuedAt: string;
  statusUpdatedAt: string;
  audioUrl?: string;
  durationSeconds?: number;
  hint?: string;
  error?: string;
  ttsMode?: 'provider' | 'mock';
  voiceLabel?: string;
};

type TaskStatusRow = {
  id: string;
  user_id: string;
  kind: string;
  status: VoicePreviewTaskStatus;
  progress: number;
  payload_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type VoicePreviewTaskInternal = {
  id: string;
  userId: string;
  status: VoicePreviewTaskStatus;
  progress: number;
  payload: {
    script: string;
    voiceResourceId: string;
    voiceTuning?: VoiceTuningOptions;
  };
  result?: {
    fileName: string;
    durationSeconds: number;
    hint: string;
    ttsMode: 'provider' | 'mock';
    voiceLabel: string;
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type CachedVoicePreviewTask = {
  userId: string;
  dto: VoicePreviewTaskDto;
};

@Injectable()
export class VoicePreviewTaskService {
  private readonly logger = new Logger(VoicePreviewTaskService.name);
  private readonly tasks = new Map<string, VoicePreviewTaskInternal>();
  private readonly latestTaskByUser = new Map<string, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly cache: TaskStatusCacheService,
    private readonly resources: ResourcesService,
    private readonly speechAi: SpeechAiService,
    private readonly ffmpegAudio: FfmpegAudioService,
  ) {}

  createTask(
    userId: string,
    input: {
      script: string;
      voiceResourceId: string;
      voiceTuning?: VoiceTuningOptions;
    },
  ): VoicePreviewTaskDto {
    const script = input.script?.trim() ?? '';
    if (script.length < 2) {
      throw new BadRequestException('口播文案过短或为空');
    }
    const voiceResourceId = input.voiceResourceId?.trim() ?? '';
    if (!voiceResourceId) {
      throw new BadRequestException('voiceResourceId 不能为空');
    }

    const now = new Date().toISOString();
    const taskId = `voice_preview_${randomUUID().slice(0, 12)}`;
    const task: VoicePreviewTaskInternal = {
      id: taskId,
      userId,
      status: 'queued',
      progress: 0,
      payload: {
        script,
        voiceResourceId,
        voiceTuning: input.voiceTuning,
      },
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(taskId, task);
    this.latestTaskByUser.set(userId, taskId);
    this.markOlderTasksSuperseded(userId, taskId);
    this.trimInMemoryTasks();
    void this.persistTask(task);
    void this.runTask(taskId);
    return this.toDto(task);
  }

  async getTask(userId: string, taskId: string): Promise<VoicePreviewTaskDto> {
    const task = this.tasks.get(taskId);
    if (task && task.userId === userId) {
      return this.toDto(task);
    }

    const cached = await this.cache.get<CachedVoicePreviewTask>(taskId);
    if (cached?.userId === userId) {
      return cached.dto;
    }

    const row = await this.db.queryOne<TaskStatusRow>(
      `SELECT id, user_id, kind, status, progress, payload_json, result_json, error, created_at, updated_at
         FROM task_statuses
        WHERE id = ? AND user_id = ?`,
      [taskId, userId],
    );
    if (!row || row.kind !== 'voice-preview') {
      throw new NotFoundException('配音试听任务不存在');
    }
    return this.rowToDto(row);
  }

  createSignedAudioUrl(userId: string, fileName: string): string {
    const base = path.basename(fileName);
    if (
      !base ||
      base !== fileName ||
      /[\\/]/.test(fileName) ||
      fileName.includes('..')
    ) {
      throw new BadRequestException('非法预览音频文件名');
    }
    const ttlSeconds = readPositiveInt(
      this.config.get('PREVIEW_AUDIO_URL_TTL_SECONDS'),
      2 * 60 * 60,
    );
    const expires = String(Date.now() + ttlSeconds * 1000);
    const token = this.signPreviewAudio(userId, fileName, expires);
    return `/api/v1/tools/preview-audios/${encodeURIComponent(fileName)}/stream?expires=${encodeURIComponent(expires)}&token=${token}`;
  }

  assertSignedAudioAccess(
    userId: string,
    fileName: string,
    token?: string,
    expires?: string,
  ): void {
    const secret = this.previewAudioSecret();
    if (!secret || !token || !expires) {
      throw new ForbiddenException('预览音频访问令牌无效');
    }
    const expiresMs = Number(expires);
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
      throw new ForbiddenException('预览音频访问令牌已过期');
    }
    const expected = this.signPreviewAudio(userId, fileName, expires);
    const actualBuffer = Buffer.from(token, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException('预览音频访问令牌无效');
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status === 'failed' || !this.isLatestTask(task)) {
      if (task.status !== 'failed') {
        this.markTaskSuperseded(taskId);
      }
      return;
    }

    this.updateTask(taskId, { status: 'running', progress: 18 });
    try {
      const result = await runWithRuntimeLimit(
        'voice-preview',
        {
          concurrency: readPositiveInt(
            this.config.get('VOICE_PREVIEW_QUEUE_CONCURRENCY'),
            2,
          ),
          queueLimit: readPositiveInt(
            this.config.get('VOICE_PREVIEW_QUEUE_LIMIT'),
            50,
          ),
        },
        async () => this.generatePreviewAudio(task),
      );

      if (!this.isLatestTask(task)) {
        await this.cleanupPreviewAudioFile(result.fileName);
        this.markTaskSuperseded(taskId);
        return;
      }

      this.updateTask(taskId, {
        status: 'succeeded',
        progress: 100,
        result,
      });
    } catch (error) {
      if (!this.isLatestTask(task)) {
        this.markTaskSuperseded(taskId);
        return;
      }
      this.updateTask(taskId, {
        status: 'failed',
        progress: 100,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private markOlderTasksSuperseded(userId: string, latestTaskId: string): void {
    for (const [taskId, task] of this.tasks.entries()) {
      if (
        task.userId === userId &&
        taskId !== latestTaskId &&
        (task.status === 'queued' || task.status === 'running')
      ) {
        this.markTaskSuperseded(taskId);
      }
    }
  }

  private markTaskSuperseded(taskId: string): void {
    this.updateTask(taskId, {
      status: 'failed',
      progress: 100,
      error: 'Superseded by a newer voice preview request',
    });
  }

  private isLatestTask(task: VoicePreviewTaskInternal): boolean {
    return this.latestTaskByUser.get(task.userId) === task.id;
  }

  private async generatePreviewAudio(task: VoicePreviewTaskInternal): Promise<{
    fileName: string;
    durationSeconds: number;
    hint: string;
    ttsMode: 'provider' | 'mock';
    voiceLabel: string;
  }> {
    const voice = await this.resources.getVoice(
      task.userId,
      task.payload.voiceResourceId,
    );
    if (!voice.canUseForRender) {
      throw new BadRequestException(
        voice.renderUnavailableReason || '当前音色暂不可用，请稍后重试',
      );
    }

    const estimatedDurationSeconds = Math.max(
      2.8,
      Math.min(24, task.payload.script.length * 0.22),
    );

    if (voice.provider === 'local-upload') {
      const localAudio = await this.resources.readManagedVoiceSample(
        voice.audioUrl,
      );
      if (!localAudio) {
        throw new BadRequestException(
          '未找到本地上传音频文件，请重新上传音色素材',
        );
      }
      const fileName = await this.persistPreviewAudioFile({
        buffer: localAudio.buffer,
        originalname: localAudio.originalname,
      });
      return {
        fileName,
        durationSeconds: voice.sampleDurationMs
          ? Math.round((voice.sampleDurationMs ?? 0) / 1000)
          : estimatedDurationSeconds,
        hint: `已使用「${voice.name}」本地上传音频作为试听音轨。本地音频不会重新应用情绪/强度，需使用 TTS 音色才能动态生成。`,
        ttsMode: 'provider',
        voiceLabel: voice.name,
      };
    }

    const speech = await this.speechAi.synthesizeAudio({
      text: task.payload.script,
      voiceStyleId: voice.id,
      voiceName: voice.name,
      provider: voice.provider,
      providerVoice: voice.providerVoice,
      providerModel: voice.providerModel,
      voiceTuning: task.payload.voiceTuning,
    });
    const originalname = `tts-preview${this.audioExtensionForMime(speech.mimeType)}`;
    const fileName = await this.persistPreviewAudioFile({
      buffer: speech.buffer,
      originalname,
    });
    const duration =
      (await this.ffmpegAudio.probeDurationSeconds({
        buffer: speech.buffer,
        originalname,
        mimetype: speech.mimeType,
      })) ?? estimatedDurationSeconds;

    return {
      fileName,
      durationSeconds: Number(duration.toFixed(2)),
      hint: [`已用「${voice.name}」生成可试听的配音音轨。`, speech.styleHint]
        .filter(Boolean)
        .join(' '),
      ttsMode: 'provider',
      voiceLabel: voice.name,
    };
  }

  private async persistPreviewAudioFile(params: {
    buffer: Buffer;
    originalname: string;
  }): Promise<string> {
    return runWithRuntimeLimit(
      'voice-preview-file',
      {
        concurrency: readPositiveInt(
          this.config.get('VOICE_PREVIEW_FILE_CONCURRENCY'),
          2,
        ),
        queueLimit: readPositiveInt(
          this.config.get('VOICE_PREVIEW_FILE_QUEUE_LIMIT'),
          20,
        ),
      },
      async () => {
        const dir = this.previewAudioDir();
        await fs.mkdir(dir, { recursive: true });
        const ext =
          path.extname(params.originalname || '').toLowerCase() || '.mp3';
        const safeExt = /^\.[a-z0-9]{2,6}$/i.test(ext) ? ext : '.mp3';
        const fileName = `${Date.now()}_${randomUUID().slice(0, 8)}${safeExt}`;
        await fs.writeFile(path.join(dir, fileName), params.buffer);
        return fileName;
      },
    );
  }

  private async cleanupPreviewAudioFile(fileName: string): Promise<void> {
    const safeFileName = path.basename(fileName);
    if (!safeFileName || safeFileName !== fileName) return;
    await fs
      .rm(path.join(this.previewAudioDir(), safeFileName), { force: true })
      .catch(() => undefined);
  }

  private previewAudioDir(): string {
    return path.resolve(
      this.config.get<string>('PREVIEW_AUDIO_SAVE_DIR')?.trim() ||
        path.join('data', 'preview-audios'),
    );
  }

  private toDto(task: VoicePreviewTaskInternal): VoicePreviewTaskDto {
    return {
      previewTaskId: task.id,
      status: task.status,
      queuedAt: task.createdAt,
      statusUpdatedAt: task.updatedAt,
      audioUrl: task.result
        ? this.createSignedAudioUrl(task.userId, task.result.fileName)
        : undefined,
      durationSeconds: task.result?.durationSeconds,
      hint: task.result?.hint,
      error: task.error,
      ttsMode: task.result?.ttsMode,
      voiceLabel: task.result?.voiceLabel,
    };
  }

  private rowToDto(row: TaskStatusRow): VoicePreviewTaskDto {
    const result = this.parseResult(row.result_json);
    return {
      previewTaskId: row.id,
      status: row.status,
      queuedAt: row.created_at,
      statusUpdatedAt: row.updated_at,
      audioUrl: result.fileName
        ? this.createSignedAudioUrl(row.user_id, result.fileName)
        : undefined,
      durationSeconds: result.durationSeconds,
      hint: result.hint,
      error: row.error ?? undefined,
      ttsMode: result.ttsMode,
      voiceLabel: result.voiceLabel,
    };
  }

  private parseResult(value: string | null): {
    fileName?: string;
    durationSeconds?: number;
    hint?: string;
    ttsMode?: 'provider' | 'mock';
    voiceLabel?: string;
  } {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as {
        fileName?: unknown;
        durationSeconds?: unknown;
        hint?: unknown;
        ttsMode?: unknown;
        voiceLabel?: unknown;
      };
      return {
        fileName:
          typeof parsed.fileName === 'string' ? parsed.fileName : undefined,
        durationSeconds:
          typeof parsed.durationSeconds === 'number'
            ? parsed.durationSeconds
            : undefined,
        hint: typeof parsed.hint === 'string' ? parsed.hint : undefined,
        ttsMode:
          parsed.ttsMode === 'provider' || parsed.ttsMode === 'mock'
            ? parsed.ttsMode
            : undefined,
        voiceLabel:
          typeof parsed.voiceLabel === 'string' ? parsed.voiceLabel : undefined,
      };
    } catch {
      return {};
    }
  }

  private updateTask(
    taskId: string,
    patch: Partial<VoicePreviewTaskInternal>,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const next = {
      ...task,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, next);
    this.trimInMemoryTasks();
    void this.persistTask(next);
  }

  private async persistTask(task: VoicePreviewTaskInternal): Promise<void> {
    const dto = this.toDto(task);
    const now = task.updatedAt || new Date().toISOString();
    const expiresAt = new Date(
      Date.now() +
        readPositiveInt(
          this.config.get('TASK_STATUS_TTL_MS'),
          24 * 60 * 60_000,
        ),
    ).toISOString();
    const payloadJson = JSON.stringify(task.payload);
    const resultJson = JSON.stringify(task.result || {});
    try {
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
            task.progress,
            payloadJson,
            resultJson,
            task.error ?? null,
            now,
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
            'voice-preview',
            task.status,
            task.progress,
            payloadJson,
            resultJson,
            task.error ?? null,
            task.createdAt,
            now,
            expiresAt,
          ],
        );
      }
      await this.cache.set(task.id, {
        userId: task.userId,
        dto,
      } satisfies CachedVoicePreviewTask);
    } catch (error) {
      this.logger.warn(
        `Persist voice preview task status failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private trimInMemoryTasks(): void {
    const max = readPositiveInt(
      this.config.get('VOICE_PREVIEW_TASK_MEMORY_MAX'),
      500,
    );
    const ttlMs = readPositiveInt(
      this.config.get('VOICE_PREVIEW_TASK_MEMORY_TTL_MS'),
      6 * 60 * 60_000,
    );
    const now = Date.now();
    for (const [id, task] of this.tasks.entries()) {
      const done = task.status === 'succeeded' || task.status === 'failed';
      const updatedMs = Date.parse(task.updatedAt || task.createdAt);
      if (done && Number.isFinite(updatedMs) && now - updatedMs > ttlMs) {
        this.tasks.delete(id);
      }
    }
    for (const [userId, taskId] of this.latestTaskByUser.entries()) {
      if (!this.tasks.has(taskId)) {
        this.latestTaskByUser.delete(userId);
      }
    }
    if (this.tasks.size <= max) return;

    const completed = [...this.tasks.entries()]
      .filter(
        ([, task]) => task.status === 'succeeded' || task.status === 'failed',
      )
      .sort((a, b) => Date.parse(a[1].updatedAt) - Date.parse(b[1].updatedAt));
    for (const [id] of completed) {
      if (this.tasks.size <= max) return;
      this.tasks.delete(id);
    }
  }

  private audioExtensionForMime(mimeType: string): string {
    if (mimeType === 'audio/wav') return '.wav';
    if (mimeType === 'audio/aac') return '.aac';
    if (mimeType === 'audio/mp4') return '.m4a';
    if (mimeType === 'audio/ogg') return '.ogg';
    if (mimeType === 'audio/flac') return '.flac';
    if (mimeType === 'audio/webm') return '.webm';
    return '.mp3';
  }

  private previewAudioSecret(): string {
    return (
      this.config.get<string>('PREVIEW_AUDIO_STREAM_SECRET')?.trim() ||
      this.config.get<string>('JWT_SECRET')?.trim() ||
      ''
    );
  }

  private signPreviewAudio(
    userId: string,
    fileName: string,
    expires: string,
  ): string {
    const secret = this.previewAudioSecret();
    if (!secret) {
      throw new InternalServerErrorException(
        '缺少 PREVIEW_AUDIO_STREAM_SECRET/JWT_SECRET，无法签发试听音频访问令牌',
      );
    }
    return createHmac('sha256', secret)
      .update(`${userId}:${fileName}:${expires}`)
      .digest('hex');
  }
}
