import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { assertUrlSafeForServerFetch } from '../../common/url-safety.util';
import { runWithRuntimeLimit } from '../../common/runtime-limits.util';
import { DatabaseService } from '../../database/database.service';
import { SpeechAiService } from '../../integrations/ai/speech-ai.service';
import { TranscriptionAiService } from '../../integrations/ai/transcription-ai.service';
import type { TranscriptSegmentDto } from '../../integrations/transcription/transcript.types';
import { ResourcesService } from '../resources/resources.service';
import type { SubtitleTemplateResourceDto } from '../resources/resources.types';
import type {
  PackageRenderTaskBody,
  ProjectStageStateBody,
  ProjectStageStateDto,
  ResolveLipSyncAssetQuery,
  ResolvedLipSyncAssetDto,
  SubtitleVisualStyleDto,
} from './video-project-render.types';
import { normalizeVoiceTuning } from './voice-tuning.util';
import { buildSubtitleAss } from './subtitle-ass-generator';
import { FfmpegSubtitleBurnerService } from './ffmpeg-subtitle-burner.service';
import {
  TitleAssetsService,
  type ActiveTitleOverlayAsset,
} from './title-assets.service';

const requireFromService = createRequire(__filename);
const LEGACY_PROJECT_ID = 'studio-current';
const MAX_SUBTITLE_VISUAL_OBJECT_BYTES = 8_192;
const MAX_SUBTITLE_VISUAL_OBJECT_NODES = 160;
const MAX_SUBTITLE_VISUAL_OBJECT_DEPTH = 6;

type OssClient = {
  put: (...args: unknown[]) => Promise<unknown>;
  get: (...args: unknown[]) => Promise<unknown>;
  getStream?: (...args: unknown[]) => Promise<unknown>;
  signatureUrl: (name: string, options?: Record<string, unknown>) => string;
};

type AudioAssetRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  name: string;
  source_type: string;
  storage_provider: string;
  object_key: string | null;
  storage_path: string | null;
  audio_url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  status: string;
  error_message: string | null;
  subtitle_track_id: string | null;
  created_at: string;
  updated_at: string;
};

type SubtitleTrackRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  audio_asset_id: string;
  source: string;
  language: string | null;
  duration_seconds: number | null;
  cues_json: string | null;
  words_json: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type DigitalHumanVideoAssetRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  avatar_resource_id: string;
  audio_asset_id: string | null;
  render_mode: string | null;
  source_task_id: string | null;
  video_url: string | null;
  video_path: string | null;
  duration_seconds: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectStageStateRow = {
  id: string;
  user_id: string;
  project_id: string;
  script_hash: string | null;
  audio_asset_id: string | null;
  subtitle_track_id: string | null;
  avatar_resource_id: string | null;
  render_mode: string | null;
  lipsync_task_id: string | null;
  digital_human_video_asset_id: string | null;
  video_url: string | null;
  created_at: string;
  updated_at: string;
};

type LipSyncResolveCacheEntry = {
  value: ResolvedLipSyncAssetDto;
  expiresAt: number;
  touchedAt: number;
};

type SubtitleWordDto = {
  text: string;
  startTime: number;
  endTime: number;
};

type SubtitleCueDto = {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  confidence?: number;
  words?: SubtitleWordDto[];
  highlightRanges?: Array<{
    start: number;
    end: number;
    color?: string;
    fontWeight?: number;
    fontSizeScale?: number;
  }>;
};

export type AudioAssetDto = {
  audioAssetId: string;
  projectId: string | null;
  name: string;
  sourceType: 'upload' | 'tts';
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  audioUrl: string | null;
  durationSeconds: number | null;
  mimeType: string | null;
  sizeBytes: number | null;
  subtitleTrackId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubtitleTrackDto = {
  subtitleTrackId: string;
  projectId: string | null;
  audioAssetId: string;
  source: 'asr' | 'tts_alignment' | 'manual' | 'estimate';
  language: string;
  durationSeconds: number;
  subtitles: SubtitleCueDto[];
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type AudioBinary = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  localPath: string | null;
  sourceUrl: string | null;
  objectKey: string | null;
  storageProvider: 'local' | 'oss' | 'url';
};

type VideoBinary = {
  buffer: Buffer;
  fileName: string;
  localPath: string | null;
  sourceUrl: string | null;
  objectKey: string | null;
  storageProvider: 'local' | 'oss' | 'url';
};

@Injectable()
export class StagedWorkflowService {
  private readonly logger = new Logger(StagedWorkflowService.name);
  private renderOutputOssClient: OssClient | null = null;
  private voiceSampleOssClient: OssClient | null = null;
  private readonly ttsInflight = new Map<string, Promise<AudioAssetDto>>();
  private readonly ttsActiveCountByUser = new Map<string, number>();
  private readonly lipSyncResolveInflight = new Map<
    string,
    Promise<ResolvedLipSyncAssetDto>
  >();
  private readonly lipSyncResolveCache = new Map<
    string,
    LipSyncResolveCacheEntry
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly speechAi: SpeechAiService,
    private readonly transcription: TranscriptionAiService,
    private readonly resources: ResourcesService,
    private readonly subtitleBurner: FfmpegSubtitleBurnerService,
    private readonly titleAssets: TitleAssetsService,
  ) {}

  async createAudioAssetFromUploadComplete(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<AudioAssetDto> {
    const source = await this.readAudioFromPayload(payload);
    const durationSeconds = await this.probeAudioDuration(source);
    const now = new Date().toISOString();
    const audioAssetId = `audio_${randomUUID()}`;
    const projectId = await this.resolveProjectIdForWrite(
      userId,
      payload.projectId,
    );
    const name = this.normalizeName(payload.name, source.fileName);
    await this.db.execute(
      `INSERT INTO audio_assets
       (id, user_id, project_id, name, source_type, storage_provider, object_key, storage_path, audio_url, mime_type, size_bytes, duration_seconds, status, error_message, subtitle_track_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        audioAssetId,
        userId,
        projectId,
        name,
        'upload',
        source.storageProvider,
        source.objectKey,
        source.localPath,
        source.sourceUrl,
        source.mimeType,
        source.buffer.length,
        durationSeconds,
        'succeeded',
        null,
        null,
        now,
        now,
      ],
    );
    return this.getAudioAsset(userId, audioAssetId);
  }

  async createAudioAssetFromTts(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<AudioAssetDto> {
    const dedupeKey = this.buildTtsDedupeKey(userId, payload);
    const forceRetry = payload.forceRetry === true;
    if (!forceRetry) {
      const existing = this.ttsInflight.get(dedupeKey);
      if (existing) {
        return existing;
      }
    }
    this.assertUserTtsConcurrency(userId);
    this.incrementUserTtsActive(userId);
    const runner = runWithRuntimeLimit(
      'tts-audio-asset',
      {
        concurrency: this.readPositiveInt(
          this.config.get('TTS_TASK_QUEUE_CONCURRENCY'),
          2,
        ),
        queueLimit: this.readPositiveInt(
          this.config.get('TTS_TASK_QUEUE_LIMIT'),
          50,
        ),
      },
      () => this.createAudioAssetFromTtsInternal(userId, payload),
    ).finally(() => {
      this.decrementUserTtsActive(userId);
      this.ttsInflight.delete(dedupeKey);
    });
    if (!forceRetry) {
      this.ttsInflight.set(dedupeKey, runner);
    }
    return runner;
  }

  private async createAudioAssetFromTtsInternal(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<AudioAssetDto> {
    const text = this.requiredString(payload.text, 'text');
    const voiceId = this.optionalString(payload.voiceResourceId);
    const voice = voiceId
      ? await this.resources.getVoice(userId, voiceId)
      : null;
    if (voice?.provider === 'local-upload') {
      throw new BadRequestException(
        'Current voice is sample-audio only and cannot synthesize TTS.',
      );
    }
    const speech = await this.speechAi.synthesizeAudio({
      text,
      voiceStyleId: voice?.id || 'default',
      voiceName: voice?.name || undefined,
      provider: voice?.provider || undefined,
      providerVoice: voice?.providerVoice || undefined,
      providerModel: voice?.providerModel || undefined,
      voiceTuning: this.normalizeTtsSpeedOnlyTuning(payload),
    });
    const ext = this.audioExtensionForMime(speech.mimeType);
    const fileName = `tts_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
    const audioDir = this.uploadAudioDir();
    await fs.mkdir(audioDir, { recursive: true });
    const audioPath = path.join(audioDir, fileName);
    await fs.writeFile(audioPath, speech.buffer);
    const durationSeconds =
      (await this.subtitleBurner.probeDurationSeconds(audioPath)) ?? null;

    const now = new Date().toISOString();
    const audioAssetId = `audio_${randomUUID()}`;
    const projectId = await this.resolveProjectIdForWrite(
      userId,
      payload.projectId,
    );
    await this.db.execute(
      `INSERT INTO audio_assets
       (id, user_id, project_id, name, source_type, storage_provider, object_key, storage_path, audio_url, mime_type, size_bytes, duration_seconds, status, error_message, subtitle_track_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        audioAssetId,
        userId,
        projectId,
        this.normalizeName(payload.name, fileName),
        'tts',
        'local',
        null,
        audioPath,
        this.toAudioPublicUrl(fileName),
        speech.mimeType,
        speech.buffer.length,
        durationSeconds,
        'succeeded',
        null,
        null,
        now,
        now,
      ],
    );
    return this.getAudioAsset(userId, audioAssetId);
  }

  async getAudioAsset(
    userId: string,
    audioAssetId: string,
  ): Promise<AudioAssetDto> {
    const row = await this.requireAudioAssetRow(userId, audioAssetId);
    return this.toAudioAssetDto(row);
  }

  async createSubtitleTrackForAudioAsset(
    userId: string,
    audioAssetId: string,
    opts: {
      projectId?: string | null;
      scriptText?: string | null;
      scriptSegments?: string[] | null;
      requireScriptSegments?: boolean;
    } = {},
  ): Promise<SubtitleTrackDto> {
    const audioRow = await this.requireAudioAssetRow(userId, audioAssetId);
    const projectId = await this.resolveProjectIdForWrite(
      userId,
      opts.projectId ?? audioRow.project_id ?? null,
    );
    this.assertAssetProjectMatch(
      'audioAssetId',
      audioRow.project_id,
      projectId,
    );
    if (opts.requireScriptSegments && opts.scriptSegments === undefined) {
      throw new BadRequestException(
        'scriptSegments is required for explicit subtitle-track creation.',
      );
    }
    const source = await this.readAudioBinaryFromAsset(audioRow);
    const transcription = await this.transcription.transcribeMedia({
      buffer: source.buffer,
      originalname: source.fileName,
      mimetype: source.mimeType,
      size: source.buffer.length,
    });
    const requestedScriptSegments = this.normalizeRequestedScriptSegments(
      opts.scriptSegments,
    );
    const hasRequestedScriptSegments = requestedScriptSegments !== null;
    if (hasRequestedScriptSegments && requestedScriptSegments.length < 1) {
      throw new BadRequestException(
        'scriptSegments must contain at least one non-empty segment.',
      );
    }
    const cues = hasRequestedScriptSegments
      ? this.buildSubtitleCuesFromScriptSegments(
          requestedScriptSegments,
          transcription.segments,
          audioRow.duration_seconds ?? 0,
        )
      : this.buildSubtitleCuesFromSegments(
          transcription.segments,
          transcription.fullText,
          audioRow.duration_seconds ?? 0,
        );
    const durationSeconds = this.resolveSubtitleDurationSeconds(
      cues,
      audioRow.duration_seconds ?? 0,
    );
    const now = new Date().toISOString();
    const subtitleTrackId = `track_${randomUUID()}`;
    const sourceType =
      hasRequestedScriptSegments && cues.length
        ? 'tts_alignment'
        : cues.length > 0
          ? 'asr'
          : transcription.fullText.trim()
            ? 'estimate'
            : 'manual';
    if (
      hasRequestedScriptSegments &&
      requestedScriptSegments.length !== cues.length
    ) {
      throw new BadRequestException(
        'subtitle cue count mismatch with scriptSegments.',
      );
    }
    await this.db.execute(
      `INSERT INTO subtitle_tracks
       (id, user_id, project_id, audio_asset_id, source, language, duration_seconds, cues_json, words_json, status, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        subtitleTrackId,
        userId,
        projectId,
        audioAssetId,
        sourceType,
        transcription.language || 'zh-CN',
        durationSeconds,
        JSON.stringify(cues),
        null,
        'succeeded',
        null,
        now,
        now,
      ],
    );
    await this.db.execute(
      `UPDATE audio_assets
       SET subtitle_track_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [subtitleTrackId, now, audioAssetId, userId],
    );
    await this.db.execute(
      `UPDATE video_project_stage_states
       SET subtitle_track_id = ?, updated_at = ?
       WHERE user_id = ? AND project_id = ? AND audio_asset_id = ?`,
      [subtitleTrackId, now, userId, projectId, audioAssetId],
    );
    await this.saveProjectStageState(userId, projectId, {
      audioAssetId,
      subtitleTrackId,
    });
    this.logger.log(
      [
        'subtitle-track-created',
        `userId=${userId}`,
        `projectId=${projectId}`,
        `audioAssetId=${audioAssetId}`,
        `subtitleTrackId=${subtitleTrackId}`,
        `source=${sourceType}`,
        `requestedSegmentCount=${requestedScriptSegments?.length ?? 0}`,
        `cueCount=${cues.length}`,
        `alignmentSource=${hasRequestedScriptSegments ? 'script_segments' : 'asr_segments'}`,
      ].join(' '),
    );
    return this.getSubtitleTrack(userId, subtitleTrackId);
  }

  async getSubtitleTrack(
    userId: string,
    subtitleTrackId: string,
  ): Promise<SubtitleTrackDto> {
    const row = await this.requireSubtitleTrackRow(userId, subtitleTrackId);
    return this.toSubtitleTrackDto(row);
  }

  async updateSubtitleTrackCues(
    userId: string,
    subtitleTrackId: string,
    cuesRaw: unknown,
  ): Promise<SubtitleTrackDto> {
    const row = await this.requireSubtitleTrackRow(userId, subtitleTrackId);
    const cues = this.normalizeIncomingSubtitleCues(cuesRaw);
    const durationSeconds = this.resolveSubtitleDurationSeconds(
      cues,
      row.duration_seconds ?? 0,
    );
    const now = new Date().toISOString();
    await this.db.execute(
      `UPDATE subtitle_tracks
       SET cues_json = ?, source = ?, duration_seconds = ?, status = ?, error_message = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`,
      [
        JSON.stringify(cues),
        'manual',
        durationSeconds,
        'succeeded',
        now,
        subtitleTrackId,
        userId,
      ],
    );
    return this.getSubtitleTrack(userId, subtitleTrackId);
  }

  async getProjectStageState(
    userId: string,
    projectId: string,
  ): Promise<ProjectStageStateDto> {
    const resolvedProjectId = this.requiredString(projectId, 'projectId');
    await this.assertProjectAccess(userId, resolvedProjectId);
    const row = await this.db.queryOne<ProjectStageStateRow>(
      `SELECT id, user_id, project_id, script_hash, audio_asset_id, subtitle_track_id, avatar_resource_id, render_mode, lipsync_task_id, digital_human_video_asset_id, video_url, created_at, updated_at
       FROM video_project_stage_states
       WHERE user_id = ? AND project_id = ?`,
      [userId, resolvedProjectId],
    );
    if (!row) {
      return {
        projectId: resolvedProjectId,
        scriptHash: null,
        audioAssetId: null,
        subtitleTrackId: null,
        avatarResourceId: null,
        renderMode: null,
        lipsyncTaskId: null,
        digitalHumanVideoAssetId: null,
        videoUrl: null,
        updatedAt: null,
      };
    }
    return this.toProjectStageStateDto(row);
  }

  async saveProjectStageState(
    userId: string,
    projectId: string,
    body: ProjectStageStateBody,
  ): Promise<ProjectStageStateDto> {
    const resolvedProjectId = this.requiredString(projectId, 'projectId');
    await this.assertProjectAccess(userId, resolvedProjectId);
    const patchSource = body as unknown as Record<string, unknown>;
    const row = await this.db.queryOne<ProjectStageStateRow>(
      `SELECT id, user_id, project_id, script_hash, audio_asset_id, subtitle_track_id, avatar_resource_id, render_mode, lipsync_task_id, digital_human_video_asset_id, video_url, created_at, updated_at
       FROM video_project_stage_states
       WHERE user_id = ? AND project_id = ?`,
      [userId, resolvedProjectId],
    );

    const scriptHashPatch = this.readPatchNullableString(
      patchSource,
      'scriptHash',
      128,
    );
    const audioAssetPatch = this.readPatchNullableString(
      patchSource,
      'audioAssetId',
      128,
    );
    const subtitleTrackPatch = this.readPatchNullableString(
      patchSource,
      'subtitleTrackId',
      128,
    );
    const avatarPatch = this.readPatchNullableString(
      patchSource,
      'avatarResourceId',
      128,
    );
    const lipsyncTaskPatch = this.readPatchNullableString(
      patchSource,
      'lipsyncTaskId',
      128,
    );
    const digitalAssetPatch = this.readPatchNullableString(
      patchSource,
      'digitalHumanVideoAssetId',
      128,
    );
    const videoUrlPatch = this.readPatchNullableString(
      patchSource,
      'videoUrl',
      2000,
    );
    const renderModePatch = this.readPatchRenderMode(patchSource);

    const nextAudioAssetId = audioAssetPatch.has
      ? audioAssetPatch.value
      : (row?.audio_asset_id ?? null);
    const nextSubtitleTrackId = subtitleTrackPatch.has
      ? subtitleTrackPatch.value
      : (row?.subtitle_track_id ?? null);
    const nextAvatarResourceId = avatarPatch.has
      ? avatarPatch.value
      : (row?.avatar_resource_id ?? null);
    const nextDigitalHumanVideoAssetId = digitalAssetPatch.has
      ? digitalAssetPatch.value
      : (row?.digital_human_video_asset_id ?? null);
    const nextLipsyncTaskId = lipsyncTaskPatch.has
      ? lipsyncTaskPatch.value
      : (row?.lipsync_task_id ?? null);
    const nextRenderMode = renderModePatch.has
      ? renderModePatch.value
      : this.normalizeRenderMode(row?.render_mode ?? null);

    if (nextAudioAssetId) {
      const audio = await this.requireAudioAssetRow(userId, nextAudioAssetId);
      this.assertAssetProjectMatch(
        'audioAssetId',
        audio.project_id,
        resolvedProjectId,
      );
    }
    if (nextSubtitleTrackId) {
      const track = await this.requireSubtitleTrackRow(
        userId,
        nextSubtitleTrackId,
      );
      this.assertAssetProjectMatch(
        'subtitleTrackId',
        track.project_id,
        resolvedProjectId,
      );
    }
    if (nextAvatarResourceId) {
      await this.resources.getAvatar(userId, nextAvatarResourceId);
    }
    if (nextDigitalHumanVideoAssetId) {
      const video = await this.requireDigitalHumanVideoAssetRow(
        userId,
        nextDigitalHumanVideoAssetId,
      );
      this.assertAssetProjectMatch(
        'digitalHumanVideoAssetId',
        video.project_id,
        resolvedProjectId,
      );
    }
    if (nextLipsyncTaskId) {
      const task = await this.db.queryOne<{
        id: string;
        user_id: string;
        kind: string;
      }>(
        `SELECT id, user_id, kind FROM task_statuses WHERE id = ? AND user_id = ?`,
        [nextLipsyncTaskId, userId],
      );
      if (!task || task.kind !== 'video-lipsync') {
        throw new BadRequestException('lipsyncTaskId is invalid.');
      }
    }

    const now = new Date().toISOString();
    const next: ProjectStageStateRow = {
      id: row?.id || `stage_${randomUUID()}`,
      user_id: userId,
      project_id: resolvedProjectId,
      script_hash: scriptHashPatch.has
        ? scriptHashPatch.value
        : (row?.script_hash ?? null),
      audio_asset_id: nextAudioAssetId,
      subtitle_track_id: nextSubtitleTrackId,
      avatar_resource_id: nextAvatarResourceId,
      render_mode: nextRenderMode,
      lipsync_task_id: nextLipsyncTaskId,
      digital_human_video_asset_id: nextDigitalHumanVideoAssetId,
      video_url: videoUrlPatch.has
        ? videoUrlPatch.value
        : (row?.video_url ?? null),
      created_at: row?.created_at || now,
      updated_at: now,
    };

    if (row) {
      await this.db.execute(
        `UPDATE video_project_stage_states
         SET script_hash = ?, audio_asset_id = ?, subtitle_track_id = ?, avatar_resource_id = ?, render_mode = ?, lipsync_task_id = ?, digital_human_video_asset_id = ?, video_url = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [
          next.script_hash,
          next.audio_asset_id,
          next.subtitle_track_id,
          next.avatar_resource_id,
          next.render_mode,
          next.lipsync_task_id,
          next.digital_human_video_asset_id,
          next.video_url,
          next.updated_at,
          row.id,
          userId,
        ],
      );
    } else {
      await this.db.execute(
        `INSERT INTO video_project_stage_states
         (id, user_id, project_id, script_hash, audio_asset_id, subtitle_track_id, avatar_resource_id, render_mode, lipsync_task_id, digital_human_video_asset_id, video_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          next.id,
          next.user_id,
          next.project_id,
          next.script_hash,
          next.audio_asset_id,
          next.subtitle_track_id,
          next.avatar_resource_id,
          next.render_mode,
          next.lipsync_task_id,
          next.digital_human_video_asset_id,
          next.video_url,
          next.created_at,
          next.updated_at,
        ],
      );
    }
    return this.toProjectStageStateDto(next);
  }

  async resolveLatestLipSyncAsset(
    userId: string,
    projectId: string,
    query: ResolveLipSyncAssetQuery,
  ): Promise<ResolvedLipSyncAssetDto> {
    const resolvedProjectId = this.requiredString(projectId, 'projectId');
    const audioAssetId = this.requiredString(
      query.audioAssetId,
      'audioAssetId',
    );
    const avatarResourceId = this.requiredString(
      query.avatarResourceId,
      'avatarResourceId',
    );
    const renderMode = this.normalizeRenderMode(query.renderMode);
    if (!renderMode) {
      throw new BadRequestException('renderMode is invalid.');
    }
    const cacheKey = [
      userId,
      resolvedProjectId,
      audioAssetId,
      avatarResourceId,
      renderMode,
    ].join(':');
    const cached = this.getCachedLipSyncResolve(cacheKey);
    if (cached) {
      return cached;
    }
    const inflight = this.lipSyncResolveInflight.get(cacheKey);
    if (inflight) {
      return inflight;
    }
    await this.assertProjectAccess(userId, resolvedProjectId);
    const runner = this.resolveLatestLipSyncAssetFromDb(
      userId,
      resolvedProjectId,
      {
        audioAssetId,
        avatarResourceId,
        renderMode,
      },
    ).finally(() => {
      this.lipSyncResolveInflight.delete(cacheKey);
    });
    this.lipSyncResolveInflight.set(cacheKey, runner);
    return runner;
  }

  private async resolveLatestLipSyncAssetFromDb(
    userId: string,
    projectId: string,
    params: {
      audioAssetId: string;
      avatarResourceId: string;
      renderMode: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
    },
  ): Promise<ResolvedLipSyncAssetDto> {
    const useLegacyProjectFilter = this.isLegacyProjectId(projectId);
    const row = await this.db.queryOne<DigitalHumanVideoAssetRow>(
      `SELECT id, user_id, project_id, avatar_resource_id, audio_asset_id, render_mode, source_task_id, video_url, video_path, duration_seconds, status, error_message, created_at, updated_at
       FROM digital_human_video_assets
       WHERE user_id = ?
         AND ${
           useLegacyProjectFilter
             ? `(project_id = ? OR project_id IS NULL)`
             : `project_id = ?`
         }
         AND audio_asset_id = ?
         AND avatar_resource_id = ?
         AND render_mode = ?
         AND status IN ('succeeded', 'completed', 'success')
       ORDER BY updated_at DESC
       LIMIT 1`,
      [
        userId,
        projectId,
        params.audioAssetId,
        params.avatarResourceId,
        params.renderMode,
      ],
    );

    const cacheKey = [
      userId,
      projectId,
      params.audioAssetId,
      params.avatarResourceId,
      params.renderMode,
    ].join(':');
    if (row && (await this.isReusableLipSyncAssetRow(userId, row))) {
      const resolved: ResolvedLipSyncAssetDto = {
        projectId,
        audioAssetId: params.audioAssetId,
        avatarResourceId: params.avatarResourceId,
        renderMode: params.renderMode,
        digitalHumanVideoAssetId: row.id,
        videoUrl: this.resolveDigitalHumanVideoUrl(row),
        duration: this.optionalNumber(row.duration_seconds),
        sourceTaskId: row.source_task_id,
        updatedAt: row.updated_at,
      };
      this.setCachedLipSyncResolve(cacheKey, resolved);
      return resolved;
    }
    const emptyResult = this.emptyResolvedLipSyncAsset(
      projectId,
      params.audioAssetId,
      params.avatarResourceId,
      params.renderMode,
    );
    this.setCachedLipSyncResolve(cacheKey, emptyResult);
    return emptyResult;
  }

  async resolveAudioInputForLipSync(
    userId: string,
    audioAssetId: string,
    opts: { projectId?: string | null } = {},
  ): Promise<{
    audioAssetId: string;
    inputAudioPath?: string;
    inputAudioUrl?: string;
  }> {
    const row = await this.requireAudioAssetRow(userId, audioAssetId);
    if (opts.projectId !== undefined) {
      const projectId = await this.resolveProjectIdForWrite(
        userId,
        opts.projectId,
      );
      this.assertAssetProjectMatch('audioAssetId', row.project_id, projectId);
    }
    if (row.storage_provider === 'local' && row.storage_path) {
      return {
        audioAssetId,
        inputAudioPath: row.storage_path,
      };
    }
    const audioUrl = this.buildAudioAccessUrl(row);
    if (!audioUrl) {
      throw new BadRequestException('Audio asset has no playable location.');
    }
    return {
      audioAssetId,
      inputAudioUrl: audioUrl,
    };
  }

  async createDigitalHumanVideoAsset(params: {
    userId: string;
    projectId: string;
    avatarResourceId: string;
    audioAssetId?: string | null;
    renderMode?: '1080x1920' | 'adaptive' | 'preserveSourceAspect' | null;
    sourceTaskId: string;
    videoUrl: string;
    durationSeconds: number;
    metadataJson?: Record<string, unknown> | null;
  }): Promise<{ digitalHumanVideoAssetId: string }> {
    const resolvedProjectId = await this.resolveProjectIdForWrite(
      params.userId,
      params.projectId,
    );
    if (params.audioAssetId) {
      const audioRow = await this.requireAudioAssetRow(
        params.userId,
        params.audioAssetId,
      );
      this.assertAssetProjectMatch(
        'audioAssetId',
        audioRow.project_id,
        resolvedProjectId,
      );
    }
    const now = new Date().toISOString();
    const id = `dvh_${randomUUID()}`;
    const resolvedLocalPath = this.resolveOutputPathFromPublicUrl(
      params.videoUrl,
    );
    await this.db.execute(
      `INSERT INTO digital_human_video_assets
       (id, user_id, project_id, avatar_resource_id, audio_asset_id, render_mode, source_task_id, video_url, video_path, duration_seconds, metadata_json, status, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.userId,
        resolvedProjectId,
        params.avatarResourceId,
        params.audioAssetId ?? null,
        this.normalizeRenderMode(params.renderMode) ?? 'preserveSourceAspect',
        params.sourceTaskId,
        params.videoUrl,
        resolvedLocalPath,
        params.durationSeconds,
        params.metadataJson ? JSON.stringify(params.metadataJson) : null,
        'succeeded',
        null,
        now,
        now,
      ],
    );
    return { digitalHumanVideoAssetId: id };
  }

  async packageRenderFromAssets(
    userId: string,
    projectId: string,
    body: PackageRenderTaskBody,
    onProgress?: (progress: number) => void,
  ): Promise<{ videoUrl: string; duration: number; hint: string }> {
    const resolvedProjectId = await this.resolveProjectIdForWrite(
      userId,
      projectId,
    );
    const digitalHumanVideoAssetId = this.requiredString(
      body.digitalHumanVideoAssetId,
      'digitalHumanVideoAssetId',
    );
    const audioAssetId = this.requiredString(body.audioAssetId, 'audioAssetId');
    const subtitleTrackId = this.optionalString(body.subtitleTrackId);
    const subtitleTemplateId = this.optionalString(body.subtitleTemplateId);
    const requestedRenderMode = this.normalizeRenderMode(
      body.renderOptions?.renderMode,
    );
    this.assertObjectPayloadBudget(
      body.subtitleVisualStyle,
      'subtitleVisualStyle',
      MAX_SUBTITLE_VISUAL_OBJECT_BYTES,
      MAX_SUBTITLE_VISUAL_OBJECT_NODES,
      MAX_SUBTITLE_VISUAL_OBJECT_DEPTH,
    );
    this.assertObjectPayloadBudget(
      body.titleLayout,
      'titleLayout',
      MAX_SUBTITLE_VISUAL_OBJECT_BYTES,
      MAX_SUBTITLE_VISUAL_OBJECT_NODES,
      MAX_SUBTITLE_VISUAL_OBJECT_DEPTH,
    );
    const burnSubtitles = body.renderOptions?.burnSubtitles !== false;

    if (burnSubtitles && !subtitleTrackId) {
      throw new BadRequestException(
        'subtitleTrackId is required when subtitles are enabled.',
      );
    }
    if (burnSubtitles && !subtitleTemplateId) {
      throw new BadRequestException(
        'subtitleTemplateId is required when subtitles are enabled.',
      );
    }

    const videoRow = await this.requireDigitalHumanVideoAssetRow(
      userId,
      digitalHumanVideoAssetId,
    );
    const audioRow = await this.requireAudioAssetRow(userId, audioAssetId);
    const subtitleRow = subtitleTrackId
      ? await this.requireSubtitleTrackRow(userId, subtitleTrackId)
      : null;
    this.assertAssetProjectMatch(
      'digitalHumanVideoAssetId',
      videoRow.project_id,
      resolvedProjectId,
    );
    this.assertAssetProjectMatch(
      'audioAssetId',
      audioRow.project_id,
      resolvedProjectId,
    );
    if (subtitleRow) {
      this.assertAssetProjectMatch(
        'subtitleTrackId',
        subtitleRow.project_id,
        resolvedProjectId,
      );
    }
    this.assertPackageAssetAudioConsistency(
      audioAssetId,
      subtitleRow,
      videoRow,
    );
    const template = subtitleTemplateId
      ? await this.resources.getSubtitleTemplate(userId, subtitleTemplateId)
      : null;
    const templateRenderMode = this.resolveRenderModeFromTemplate(template);
    const effectiveRenderMode =
      requestedRenderMode ?? templateRenderMode ?? 'adaptive';

    onProgress?.(8);
    const [videoBinary, audioBinary] = await Promise.all([
      this.readVideoBinaryFromAsset(videoRow),
      this.readAudioBinaryFromAsset(audioRow),
    ]);
    onProgress?.(24);

    const workDir = await this.createRuntimeTempDir('package-render-');
    const outputFileName = `package-final_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`;
    const outputFilePath = path.join(this.outputDir(), outputFileName);
    await fs.mkdir(this.outputDir(), { recursive: true });
    try {
      const muxed = await this.subtitleBurner.muxVideoAndAudio({
        video: {
          buffer: videoBinary.buffer,
          originalname: videoBinary.fileName,
        },
        audio: {
          buffer: audioBinary.buffer,
          originalname: audioBinary.fileName,
        },
      });
      const muxedPath = path.join(workDir, 'muxed.mp4');
      await fs.writeFile(muxedPath, muxed.buffer);
      const normalizedPath = path.join(workDir, 'normalized.mp4');
      await this.subtitleBurner.normalizeVideoForRenderMode({
        inputVideoPath: muxedPath,
        outputVideoPath: normalizedPath,
        renderMode: effectiveRenderMode,
      });
      let workingPath = normalizedPath;
      onProgress?.(46);

      if (burnSubtitles && subtitleRow && subtitleTemplateId) {
        const safeVisualStyle = this.sanitizeSubtitleVisualStyle(
          body.subtitleVisualStyle,
        );
        const mergedStyle = this.mergeTemplateStyle(template!, safeVisualStyle);
        const assPath = path.join(workDir, 'subtitles.ass');
        const cues = this.normalizeTrackCues(subtitleRow.cues_json);
        const ass = buildSubtitleAss({
          cues,
          templateStyle: mergedStyle,
          subtitleVisualStyle: safeVisualStyle,
        });
        await fs.writeFile(assPath, ass, 'utf8');
        const burnedPath = path.join(workDir, 'burned.mp4');
        await this.subtitleBurner.burnAss({
          inputVideoPath: workingPath,
          subtitleAssPath: assPath,
          outputVideoPath: burnedPath,
        });
        workingPath = burnedPath;
      }
      onProgress?.(70);

      if (body.includeTitleAssets === true) {
        const overlays = await this.titleAssets.listActiveSuccessAssetsForVideo(
          userId,
          resolvedProjectId,
        );
        if (overlays.length > 0) {
          const overlayPath = path.join(workDir, 'with-title.mp4');
          await this.overlayTitleAssets(workingPath, overlayPath, overlays);
          workingPath = overlayPath;
        }
      }
      onProgress?.(86);

      await fs.copyFile(workingPath, outputFilePath);
      const durationSeconds =
        (await this.subtitleBurner.probeDurationSeconds(outputFilePath)) ?? 0;
      const published = await this.publishOutput(
        outputFilePath,
        outputFileName,
      );
      onProgress?.(100);
      return {
        videoUrl: published.url,
        duration: Number(durationSeconds.toFixed(2)),
        hint:
          published.storage === 'oss'
            ? 'Package render completed and uploaded to OSS.'
            : 'Package render completed on local storage.',
      };
    } finally {
      await fs
        .rm(workDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  private async overlayTitleAssets(
    inputVideoPath: string,
    outputVideoPath: string,
    overlays: ActiveTitleOverlayAsset[],
  ): Promise<void> {
    await this.subtitleBurner.overlayTimedAssets({
      inputVideoPath,
      outputVideoPath,
      overlays: overlays.map((item) => ({
        inputPath: item.inputPath,
        startTime: item.startTime,
        endTime: item.endTime,
      })),
    });
  }

  private mergeTemplateStyle(
    template: SubtitleTemplateResourceDto,
    subtitleVisualStyle?: SubtitleVisualStyleDto,
  ): Record<string, unknown> {
    const merged = this.sanitizeTemplateSubtitleStyle(
      this.getTemplateSubtitleStyle(template),
    );
    const safeVisualStyle =
      this.sanitizeSubtitleVisualStyle(subtitleVisualStyle);
    if (!safeVisualStyle) {
      return merged;
    }
    if (safeVisualStyle.normalColor) {
      merged.color = safeVisualStyle.normalColor;
    }
    if (safeVisualStyle.highlightColor) {
      merged.highlightColor = safeVisualStyle.highlightColor;
    }
    if (safeVisualStyle.strokeColor) {
      merged.stroke = safeVisualStyle.strokeColor;
    }
    if (safeVisualStyle.backgroundColor) {
      merged.background = safeVisualStyle.backgroundColor;
    }
    if (this.isFiniteNumber(safeVisualStyle.fontSize)) {
      merged.size = this.clampNumber(safeVisualStyle.fontSize, 24, 80);
    }
    if (this.isFiniteNumber(safeVisualStyle.strokeWidth)) {
      merged.strokeWidth = this.clampNumber(
        safeVisualStyle.strokeWidth,
        0.8,
        8,
      );
    }
    if (this.isFiniteNumber(safeVisualStyle.fontWeight)) {
      merged.weight = Math.round(
        this.clampNumber(safeVisualStyle.fontWeight, 400, 900),
      );
    }
    if (this.isFiniteNumber(safeVisualStyle.lineHeight)) {
      merged.lineHeight = this.clampNumber(safeVisualStyle.lineHeight, 1, 2.2);
    }
    if (safeVisualStyle.layout && typeof safeVisualStyle.layout === 'object') {
      merged.layout = safeVisualStyle.layout;
    }
    return merged;
  }

  private assertPackageAssetAudioConsistency(
    audioAssetId: string,
    subtitleRow: SubtitleTrackRow | null,
    videoRow: DigitalHumanVideoAssetRow,
  ): void {
    if (subtitleRow && subtitleRow.audio_asset_id !== audioAssetId) {
      throw new BadRequestException(
        'subtitleTrackId does not belong to current audioAssetId.',
      );
    }
    if (
      videoRow.audio_asset_id &&
      videoRow.audio_asset_id.trim() &&
      videoRow.audio_asset_id !== audioAssetId
    ) {
      throw new BadRequestException(
        'digitalHumanVideoAssetId does not match current audioAssetId.',
      );
    }
  }

  private getTemplateStyleConfig(
    template: SubtitleTemplateResourceDto | null | undefined,
  ): Record<string, unknown> {
    const value = template?.styleConfig;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value;
  }

  private getTemplateSubtitleStyle(
    template: SubtitleTemplateResourceDto,
  ): Record<string, unknown> {
    const config = this.getTemplateStyleConfig(template);
    const subtitle = config.subtitle;
    if (subtitle && typeof subtitle === 'object' && !Array.isArray(subtitle)) {
      const style = (subtitle as Record<string, unknown>).style;
      if (style && typeof style === 'object' && !Array.isArray(style)) {
        return style as Record<string, unknown>;
      }
    }
    return template.styleJson || {};
  }

  private resolveRenderModeFromTemplate(
    template: SubtitleTemplateResourceDto | null,
  ): '1080x1920' | 'adaptive' | null {
    if (!template) return null;
    const config = this.getTemplateStyleConfig(template);
    const aspectRatio = this.normalizeAspectRatio(config.aspectRatio);
    if (!aspectRatio) return null;
    return aspectRatio === '9:16' ? '1080x1920' : 'adaptive';
  }

  private normalizeAspectRatio(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    if (
      normalized === '9:16' ||
      normalized === '16:9' ||
      normalized === '1:1' ||
      normalized === '4:5' ||
      normalized === '3:4'
    ) {
      return normalized;
    }
    return null;
  }

  private normalizeRenderMode(
    value: unknown,
  ): '1080x1920' | 'adaptive' | 'preserveSourceAspect' | null {
    if (typeof value !== 'string') return null;
    const mode = value.trim();
    if (
      mode === '1080x1920' ||
      mode === 'adaptive' ||
      mode === 'preserveSourceAspect'
    ) {
      return mode;
    }
    return null;
  }

  private sanitizeTemplateSubtitleStyle(
    style: Record<string, unknown>,
  ): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...(style || {}) };
    if (this.isSafeColor(merged.color)) merged.color = merged.color.trim();
    else delete merged.color;
    if (this.isSafeColor(merged.highlightColor)) {
      merged.highlightColor = merged.highlightColor.trim();
    } else {
      delete merged.highlightColor;
    }
    if (this.isSafeColor(merged.stroke)) merged.stroke = merged.stroke.trim();
    else delete merged.stroke;
    if (this.isSafeColor(merged.background)) {
      merged.background = merged.background.trim();
    } else {
      delete merged.background;
    }
    if (this.isFiniteNumber(merged.size)) {
      merged.size = this.clampNumber(merged.size, 24, 80);
    } else {
      delete merged.size;
    }
    if (this.isFiniteNumber(merged.strokeWidth)) {
      merged.strokeWidth = this.clampNumber(merged.strokeWidth, 0.8, 8);
    } else {
      delete merged.strokeWidth;
    }
    if (this.isFiniteNumber(merged.weight)) {
      merged.weight = Math.round(this.clampNumber(merged.weight, 400, 900));
    } else {
      delete merged.weight;
    }
    if (this.isFiniteNumber(merged.lineHeight)) {
      merged.lineHeight = this.clampNumber(merged.lineHeight, 1, 2.2);
    } else {
      delete merged.lineHeight;
    }
    if (this.isFiniteNumber(merged.highlightFontSizeScale)) {
      merged.highlightFontSizeScale = this.clampNumber(
        merged.highlightFontSizeScale,
        1,
        1.6,
      );
    } else {
      delete merged.highlightFontSizeScale;
    }
    const layout = this.sanitizeLayout(merged.layout);
    if (layout) merged.layout = layout;
    else delete merged.layout;
    return merged;
  }

  private sanitizeSubtitleVisualStyle(
    style: SubtitleVisualStyleDto | undefined,
  ): SubtitleVisualStyleDto | undefined {
    if (!style || typeof style !== 'object') return undefined;
    const next: SubtitleVisualStyleDto = {};
    if (this.isSafeColor(style.normalColor))
      next.normalColor = style.normalColor;
    if (this.isSafeColor(style.highlightColor)) {
      next.highlightColor = style.highlightColor;
    }
    if (this.isSafeColor(style.strokeColor))
      next.strokeColor = style.strokeColor;
    if (this.isSafeColor(style.backgroundColor)) {
      next.backgroundColor = style.backgroundColor;
    }
    if (this.isFiniteNumber(style.fontSize)) {
      next.fontSize = this.clampNumber(style.fontSize, 24, 80);
    }
    if (this.isFiniteNumber(style.strokeWidth)) {
      next.strokeWidth = this.clampNumber(style.strokeWidth, 0.8, 8);
    }
    if (this.isFiniteNumber(style.fontWeight)) {
      next.fontWeight = Math.round(
        this.clampNumber(style.fontWeight, 400, 900),
      );
    }
    if (this.isFiniteNumber(style.lineHeight)) {
      next.lineHeight = this.clampNumber(style.lineHeight, 1, 2.2);
    }
    const layout = this.sanitizeLayout(style.layout);
    if (layout) next.layout = layout;
    return Object.keys(next).length > 0 ? next : undefined;
  }

  private sanitizeLayout(
    layout: unknown,
  ): SubtitleVisualStyleDto['layout'] | null {
    if (!layout || typeof layout !== 'object') return null;
    const data = layout as Record<string, unknown>;
    if (!this.isFiniteNumber(data.xPct) || !this.isFiniteNumber(data.yPct)) {
      return null;
    }
    const safeArea = this.isFiniteNumber(data.safeAreaPct)
      ? this.clampNumber(data.safeAreaPct, 0, 24)
      : 6;
    const minPct = safeArea;
    const maxPct = 100 - safeArea;
    const anchor = this.normalizeAnchor(data.anchor);
    const result: NonNullable<SubtitleVisualStyleDto['layout']> = {
      xPct: this.clampNumber(data.xPct, minPct, maxPct),
      yPct: this.clampNumber(data.yPct, minPct, maxPct),
      anchor,
      safeAreaPct: safeArea,
    };
    if (this.isFiniteNumber(data.scale)) {
      result.scale = this.clampNumber(data.scale, 0.6, 2);
    }
    if (this.isFiniteNumber(data.maxWidthPct)) {
      result.maxWidthPct = this.clampNumber(data.maxWidthPct, 20, 100);
    }
    return result;
  }

  private normalizeAnchor(
    value: unknown,
  ): NonNullable<SubtitleVisualStyleDto['layout']>['anchor'] {
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

  private normalizeTrackCues(cuesJson: string | null): SubtitleCueDto[] {
    if (!cuesJson) return [];
    try {
      const parsed = JSON.parse(cuesJson) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item, index) => this.normalizeSubtitleCue(item, index))
        .filter((item): item is SubtitleCueDto => Boolean(item))
        .sort((a, b) => a.startTime - b.startTime);
    } catch {
      return [];
    }
  }

  private normalizeSubtitleCue(
    item: unknown,
    index: number,
  ): SubtitleCueDto | null {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (!text) return null;
    const startTime = this.readNumber(row.startTime, 0);
    const endTime = this.readNumber(row.endTime, 0);
    if (!(endTime > startTime)) return null;
    return {
      id:
        typeof row.id === 'string' && row.id.trim()
          ? row.id.trim()
          : `sub_${index + 1}`,
      startTime: this.roundSeconds(startTime),
      endTime: this.roundSeconds(endTime),
      text,
      confidence: this.isFiniteNumber(row.confidence)
        ? Number(row.confidence)
        : undefined,
      words: Array.isArray(row.words)
        ? row.words
            .map((word) => this.normalizeSubtitleWord(word))
            .filter((word): word is SubtitleWordDto => Boolean(word))
        : undefined,
      highlightRanges: Array.isArray(row.highlightRanges)
        ? row.highlightRanges
            .map((range) => this.normalizeHighlightRange(range, text.length))
            .filter((range): range is NonNullable<typeof range> =>
              Boolean(range),
            )
        : undefined,
    };
  }

  private normalizeSubtitleWord(word: unknown): SubtitleWordDto | null {
    if (!word || typeof word !== 'object') return null;
    const row = word as Record<string, unknown>;
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (!text) return null;
    const start = this.readNumber(row.startTime, 0);
    const end = this.readNumber(row.endTime, 0);
    if (!(end > start)) return null;
    return {
      text,
      startTime: this.roundSeconds(start),
      endTime: this.roundSeconds(end),
    };
  }

  private normalizeHighlightRange(
    range: unknown,
    textLength: number,
  ): {
    start: number;
    end: number;
    color?: string;
    fontWeight?: number;
    fontSizeScale?: number;
  } | null {
    if (!range || typeof range !== 'object') return null;
    const row = range as Record<string, unknown>;
    const start = Math.max(
      0,
      Math.min(textLength, Math.floor(this.readNumber(row.start, 0))),
    );
    const end = Math.max(
      0,
      Math.min(textLength, Math.ceil(this.readNumber(row.end, 0))),
    );
    if (!(end > start)) return null;
    return {
      start,
      end,
      color: this.isSafeColor(row.color) ? row.color : undefined,
      fontWeight: this.isFiniteNumber(row.fontWeight)
        ? this.readNumber(row.fontWeight, 900)
        : undefined,
      fontSizeScale: this.isFiniteNumber(row.fontSizeScale)
        ? this.readNumber(row.fontSizeScale, 1.18)
        : undefined,
    };
  }

  private normalizeIncomingSubtitleCues(cuesRaw: unknown): SubtitleCueDto[] {
    if (!Array.isArray(cuesRaw)) {
      throw new BadRequestException('subtitles must be an array');
    }
    const maxCueCount = this.readPositiveInt(
      this.config.get('SUBTITLE_CUES_MAX_COUNT'),
      500,
    );
    if (cuesRaw.length > maxCueCount) {
      throw new BadRequestException(
        `too many subtitle cues, max=${maxCueCount}`,
      );
    }
    const maxCueTextLength = this.readPositiveInt(
      this.config.get('SUBTITLE_CUE_TEXT_MAX_LENGTH'),
      500,
    );
    const maxWordsPerCue = this.readPositiveInt(
      this.config.get('SUBTITLE_CUE_WORDS_MAX_COUNT'),
      120,
    );
    const maxHighlightRangesPerCue = this.readPositiveInt(
      this.config.get('SUBTITLE_CUE_HIGHLIGHT_MAX_COUNT'),
      32,
    );
    const maxTotalTextLength = this.readPositiveInt(
      this.config.get('SUBTITLE_CUES_TOTAL_TEXT_MAX_LENGTH'),
      60_000,
    );
    const cues = cuesRaw
      .map((item, index) => this.normalizeSubtitleCue(item, index))
      .filter((item): item is SubtitleCueDto => Boolean(item))
      .sort((a, b) => a.startTime - b.startTime);
    if (!cues.length) {
      throw new BadRequestException('subtitles cannot be empty');
    }
    let totalTextLength = 0;
    for (const cue of cues) {
      if (cue.text.length > maxCueTextLength) {
        throw new BadRequestException(
          `subtitle cue text too long, max=${maxCueTextLength}`,
        );
      }
      totalTextLength += cue.text.length;
      if (totalTextLength > maxTotalTextLength) {
        throw new BadRequestException(
          `subtitle cues total text too long, max=${maxTotalTextLength}`,
        );
      }
      if ((cue.words?.length ?? 0) > maxWordsPerCue) {
        throw new BadRequestException(
          `too many words in one cue, max=${maxWordsPerCue}`,
        );
      }
      if ((cue.highlightRanges?.length ?? 0) > maxHighlightRangesPerCue) {
        throw new BadRequestException(
          `too many highlight ranges in one cue, max=${maxHighlightRangesPerCue}`,
        );
      }
    }
    for (let i = 1; i < cues.length; i += 1) {
      if (cues[i - 1].endTime > cues[i].startTime) {
        throw new BadRequestException('subtitle ranges overlap');
      }
    }
    return cues;
  }

  private buildSubtitleCuesFromSegments(
    segments: TranscriptSegmentDto[],
    fullText: string,
    fallbackDurationSeconds: number,
  ): SubtitleCueDto[] {
    const cues = segments
      .map((segment, index) => ({
        id: `sub_${index + 1}`,
        startTime: this.roundSeconds(
          Math.max(0, (segment.startMs || 0) / 1000),
        ),
        endTime: this.roundSeconds(Math.max(0, (segment.endMs || 0) / 1000)),
        text: (segment.text || '').trim(),
        confidence: 0.9,
      }))
      .filter((item) => item.text && item.endTime > item.startTime);
    if (cues.length) return cues;

    const normalizedText = fullText.trim();
    if (!normalizedText) return [];
    const duration = Math.max(0.5, fallbackDurationSeconds || 3);
    return [
      {
        id: 'sub_1',
        startTime: 0,
        endTime: this.roundSeconds(duration),
        text: normalizedText,
        confidence: 0.5,
      },
    ];
  }

  private normalizeRequestedScriptSegments(
    scriptSegmentsRaw: string[] | null | undefined,
  ): string[] | null {
    if (scriptSegmentsRaw === undefined || scriptSegmentsRaw === null) {
      return null;
    }
    if (!Array.isArray(scriptSegmentsRaw)) {
      throw new BadRequestException('scriptSegments must be an array.');
    }
    const normalized: string[] = [];
    for (const item of scriptSegmentsRaw) {
      if (typeof item !== 'string') {
        throw new BadRequestException('scriptSegments contains invalid value.');
      }
      const text = item.trim();
      if (text) {
        normalized.push(text);
      }
    }
    return normalized;
  }

  private buildSubtitleCuesFromScriptSegments(
    scriptSegments: string[],
    asrSegments: TranscriptSegmentDto[],
    fallbackDurationSeconds: number,
  ): SubtitleCueDto[] {
    if (!scriptSegments.length) return [];
    const timelineDuration = this.resolveSubtitleTimelineDurationSeconds(
      asrSegments,
      fallbackDurationSeconds,
      scriptSegments.length,
    );
    const weights = scriptSegments.map((item) =>
      Math.max(1, this.countVisibleChars(item)),
    );
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const minStep = 0.05;
    const cues: SubtitleCueDto[] = [];
    let cursor = 0;
    for (let index = 0; index < scriptSegments.length; index += 1) {
      const text = scriptSegments[index];
      const isLast = index === scriptSegments.length - 1;
      const ratio = totalWeight > 0 ? weights[index] / totalWeight : 0;
      const rawStart = cursor;
      const rawEnd = isLast
        ? timelineDuration
        : cursor + timelineDuration * ratio;
      cursor = rawEnd;

      const prevEnd = cues[index - 1]?.endTime ?? 0;
      let startTime = this.roundSeconds(Math.max(0, rawStart));
      if (startTime < prevEnd) {
        startTime = prevEnd;
      }
      let endTime = this.roundSeconds(Math.max(startTime + minStep, rawEnd));
      if (isLast) {
        endTime = this.roundSeconds(
          Math.max(endTime, timelineDuration, startTime + minStep),
        );
      }
      cues.push({
        id: `sub_${index + 1}`,
        startTime,
        endTime,
        text,
        confidence: 0.85,
      });
    }
    return cues;
  }

  private resolveSubtitleTimelineDurationSeconds(
    asrSegments: TranscriptSegmentDto[],
    fallbackDurationSeconds: number,
    scriptSegmentCount: number,
  ): number {
    const asrEndSeconds = asrSegments.reduce((max, segment) => {
      const endMs = this.readNumber(segment.endMs, 0);
      return Math.max(max, endMs / 1000);
    }, 0);
    const minDurationBySegments = Math.max(0.5, scriptSegmentCount * 0.4);
    return this.roundSeconds(
      Math.max(
        minDurationBySegments,
        fallbackDurationSeconds || 0,
        asrEndSeconds || 0,
      ),
    );
  }

  private countVisibleChars(text: string): number {
    return text.replace(/\s+/g, '').length;
  }

  private resolveSubtitleDurationSeconds(
    cues: SubtitleCueDto[],
    fallbackDurationSeconds: number,
  ): number {
    const lastEnd = cues.reduce((max, cue) => Math.max(max, cue.endTime), 0);
    const duration = Math.max(lastEnd, fallbackDurationSeconds || 0);
    return this.roundSeconds(duration);
  }

  private async readAudioFromPayload(
    payload: Record<string, unknown>,
  ): Promise<AudioBinary> {
    const audioPath = this.optionalString(payload.audioPath);
    if (audioPath) {
      const safe = this.resolveSafeLocalAudioPath(audioPath);
      const buffer = await fs.readFile(safe);
      return {
        buffer,
        mimeType: this.guessMimeFromFilename(safe),
        fileName: path.basename(safe),
        localPath: safe,
        sourceUrl: this.toAudioPublicUrl(path.basename(safe)),
        objectKey: null,
        storageProvider: 'local',
      };
    }

    const audioUrl = this.optionalString(payload.audioUrl);
    if (audioUrl) {
      if (audioUrl.startsWith('/uploads/audio/')) {
        const fileName = decodeURIComponent(path.basename(audioUrl));
        const safe = this.resolveSafeLocalAudioPath(
          path.join(this.uploadAudioDir(), fileName),
        );
        const buffer = await fs.readFile(safe);
        return {
          buffer,
          mimeType: this.guessMimeFromFilename(safe),
          fileName,
          localPath: safe,
          sourceUrl: this.toAudioPublicUrl(fileName),
          objectKey: null,
          storageProvider: 'local',
        };
      }
      const remote = await this.fetchRemoteBinary(audioUrl, 100 * 1024 * 1024);
      return {
        buffer: remote.buffer,
        mimeType: remote.mimeType,
        fileName: remote.fileName,
        localPath: null,
        sourceUrl: audioUrl,
        objectKey: null,
        storageProvider: 'url',
      };
    }

    const objectKey = this.optionalString(payload.objectKey);
    if (objectKey) {
      const fromOss = await this.readOssObjectBinary(objectKey);
      return {
        buffer: fromOss.buffer,
        mimeType: fromOss.mimeType || this.guessMimeFromFilename(objectKey),
        fileName: path.basename(objectKey),
        localPath: null,
        sourceUrl: null,
        objectKey,
        storageProvider: 'oss',
      };
    }

    throw new BadRequestException(
      'audioPath or audioUrl or objectKey is required for upload-complete.',
    );
  }

  private async readAudioBinaryFromAsset(
    row: AudioAssetRow,
  ): Promise<AudioBinary> {
    if (row.storage_provider === 'local' && row.storage_path) {
      const safe = this.resolveSafeLocalAudioPath(row.storage_path);
      const buffer = await fs.readFile(safe);
      return {
        buffer,
        mimeType: row.mime_type || this.guessMimeFromFilename(safe),
        fileName: path.basename(safe),
        localPath: safe,
        sourceUrl: row.audio_url,
        objectKey: row.object_key,
        storageProvider: 'local',
      };
    }

    if (row.storage_provider === 'oss' && row.object_key) {
      const binary = await this.readOssObjectBinary(row.object_key);
      return {
        buffer: binary.buffer,
        mimeType:
          row.mime_type ||
          binary.mimeType ||
          this.guessMimeFromFilename(row.object_key),
        fileName: path.basename(row.object_key),
        localPath: null,
        sourceUrl: row.audio_url,
        objectKey: row.object_key,
        storageProvider: 'oss',
      };
    }

    if (row.audio_url?.trim()) {
      const remote = await this.fetchRemoteBinary(
        row.audio_url.trim(),
        100 * 1024 * 1024,
      );
      return {
        buffer: remote.buffer,
        mimeType: row.mime_type || remote.mimeType,
        fileName: remote.fileName,
        localPath: null,
        sourceUrl: row.audio_url,
        objectKey: row.object_key,
        storageProvider: 'url',
      };
    }

    throw new BadRequestException('Audio asset content is unavailable.');
  }

  private async readVideoBinaryFromAsset(
    row: DigitalHumanVideoAssetRow,
  ): Promise<VideoBinary> {
    if (row.video_path?.trim()) {
      const safe = this.resolveSafeVideoOutputPath(row.video_path.trim());
      const buffer = await fs.readFile(safe);
      return {
        buffer,
        fileName: path.basename(safe),
        localPath: safe,
        sourceUrl: row.video_url,
        objectKey: null,
        storageProvider: 'local',
      };
    }
    if (row.video_url?.trim()) {
      const local = this.resolveOutputPathFromPublicUrl(row.video_url.trim());
      if (local && existsSync(local)) {
        const buffer = await fs.readFile(local);
        return {
          buffer,
          fileName: path.basename(local),
          localPath: local,
          sourceUrl: row.video_url,
          objectKey: null,
          storageProvider: 'local',
        };
      }
      const remote = await this.fetchRemoteBinary(
        row.video_url.trim(),
        2 * 1024 * 1024 * 1024,
      );
      return {
        buffer: remote.buffer,
        fileName: remote.fileName,
        localPath: null,
        sourceUrl: row.video_url,
        objectKey: null,
        storageProvider: 'url',
      };
    }
    throw new BadRequestException(
      'Digital human video asset has no source video.',
    );
  }

  private async probeAudioDuration(
    source: AudioBinary,
  ): Promise<number | null> {
    if (source.localPath) {
      const seconds = await this.subtitleBurner.probeDurationSeconds(
        source.localPath,
      );
      return seconds ? this.roundSeconds(seconds) : null;
    }
    const tmpDir = await this.createRuntimeTempDir('audio-probe-');
    try {
      const tmpPath = path.join(tmpDir, source.fileName || 'audio.wav');
      await fs.writeFile(tmpPath, source.buffer);
      const seconds = await this.subtitleBurner.probeDurationSeconds(tmpPath);
      return seconds ? this.roundSeconds(seconds) : null;
    } finally {
      await fs
        .rm(tmpDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  private async fetchRemoteBinary(
    rawUrl: string,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    const remoteUrl = new URL(rawUrl);
    assertUrlSafeForServerFetch(remoteUrl);
    const timeoutMs = this.readPositiveInt(
      this.config.get('REMOTE_MEDIA_FETCH_TIMEOUT_MS'),
      120_000,
    );
    const response = await fetch(remoteUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new BadRequestException(
        `Failed to fetch remote media: HTTP ${response.status}`,
      );
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > maxBytes) {
      throw new BadRequestException(
        `Remote media exceeds max bytes: ${maxBytes}`,
      );
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new BadRequestException('Remote media is empty.');
    }
    if (buffer.length > maxBytes) {
      throw new BadRequestException(
        `Remote media exceeds max bytes: ${maxBytes}`,
      );
    }
    const contentType = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim();
    const fileName =
      path.basename(new URL(response.url || rawUrl).pathname) || 'remote.bin';
    return {
      buffer,
      mimeType: contentType || this.guessMimeFromFilename(fileName),
      fileName,
    };
  }

  private async readOssObjectBinary(
    objectKey: string,
  ): Promise<{ buffer: Buffer; mimeType?: string }> {
    const client = this.getVoiceSampleOssClient();
    if (typeof client.getStream === 'function') {
      const response = await client.getStream(objectKey);
      const content = this.extractOssContent(response);
      const headers = this.extractOssHeaders(response);
      const buffer = await this.readStreamIntoBuffer(content);
      return {
        buffer,
        mimeType: this.headerString(headers, 'content-type'),
      };
    }
    const response = await client.get(objectKey);
    const content = this.extractOssContent(response);
    const headers = this.extractOssHeaders(response);
    if (Buffer.isBuffer(content)) {
      return {
        buffer: content,
        mimeType: this.headerString(headers, 'content-type'),
      };
    }
    if (content instanceof Uint8Array) {
      return {
        buffer: Buffer.from(content),
        mimeType: this.headerString(headers, 'content-type'),
      };
    }
    const buffer = await this.readStreamIntoBuffer(content);
    return { buffer, mimeType: this.headerString(headers, 'content-type') };
  }

  private extractOssContent(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    if ('content' in value) {
      return (value as { content: unknown }).content;
    }
    if ('res' in value && (value as { res: { body?: unknown } }).res?.body) {
      return (value as { res: { body: unknown } }).res.body;
    }
    return value;
  }

  private extractOssHeaders(
    value: unknown,
  ): Record<string, string | string[] | undefined> | undefined {
    if (!value || typeof value !== 'object') return undefined;
    if ('res' in value) {
      const headers = (
        value as {
          res?: { headers?: Record<string, string | string[] | undefined> };
        }
      ).res?.headers;
      if (headers) return headers;
    }
    if ('headers' in value) {
      return (
        value as { headers?: Record<string, string | string[] | undefined> }
      ).headers;
    }
    return undefined;
  }

  private async readStreamIntoBuffer(content: unknown): Promise<Buffer> {
    if (Buffer.isBuffer(content)) return content;
    if (content instanceof Uint8Array) return Buffer.from(content);
    if (content && typeof (content as Readable).pipe === 'function') {
      const chunks: Buffer[] = [];
      const readable = content as Readable;
      for await (const chunk of readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    if (
      content &&
      typeof (content as NodeReadableStream<Uint8Array>).getReader ===
        'function'
    ) {
      const nodeReadable = Readable.fromWeb(
        content as NodeReadableStream<Uint8Array>,
      );
      const chunks: Buffer[] = [];
      for await (const chunk of nodeReadable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    throw new BadRequestException('Invalid OSS object stream.');
  }

  private buildAudioAccessUrl(row: AudioAssetRow): string | null {
    if (row.storage_provider === 'local' && row.storage_path) {
      return this.toAudioPublicUrl(path.basename(row.storage_path));
    }
    if (row.audio_url?.trim()) return row.audio_url.trim();
    if (row.storage_provider === 'oss' && row.object_key) {
      const publicBase = this.config
        .get<string>('RENDER_OUTPUT_OSS_PUBLIC_BASE_URL')
        ?.trim();
      if (publicBase) {
        return `${publicBase.replace(/\/+$/, '')}/${encodeURIComponent(row.object_key)}`;
      }
      const client = this.getVoiceSampleOssClient();
      const ttl = Math.max(
        60,
        this.readPositiveInt(
          this.config.get('RENDER_OUTPUT_OSS_SIGNED_URL_TTL_SECONDS'),
          2 * 60 * 60,
        ),
      );
      return client.signatureUrl(row.object_key, {
        method: 'GET',
        expires: ttl,
      });
    }
    return null;
  }

  private toAudioAssetDto(row: AudioAssetRow): AudioAssetDto {
    return {
      audioAssetId: row.id,
      projectId: row.project_id,
      name: row.name,
      sourceType: row.source_type === 'tts' ? 'tts' : 'upload',
      status: this.normalizeAssetStatus(row.status),
      audioUrl:
        row.storage_provider === 'local' && row.storage_path
          ? this.toAudioPublicUrl(path.basename(row.storage_path))
          : row.audio_url,
      durationSeconds:
        row.duration_seconds !== null && row.duration_seconds !== undefined
          ? Number(row.duration_seconds)
          : null,
      mimeType: row.mime_type,
      sizeBytes:
        row.size_bytes !== null && row.size_bytes !== undefined
          ? Number(row.size_bytes)
          : null,
      subtitleTrackId: row.subtitle_track_id,
      error: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toSubtitleTrackDto(row: SubtitleTrackRow): SubtitleTrackDto {
    return {
      subtitleTrackId: row.id,
      projectId: row.project_id,
      audioAssetId: row.audio_asset_id,
      source: this.normalizeTrackSource(row.source),
      language: row.language || 'zh-CN',
      durationSeconds: Number(row.duration_seconds || 0),
      subtitles: this.normalizeTrackCues(row.cues_json),
      status: this.normalizeAssetStatus(row.status),
      error: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toProjectStageStateDto(
    row: ProjectStageStateRow,
  ): ProjectStageStateDto {
    return {
      projectId: row.project_id,
      scriptHash: row.script_hash,
      audioAssetId: row.audio_asset_id,
      subtitleTrackId: row.subtitle_track_id,
      avatarResourceId: row.avatar_resource_id,
      renderMode: this.normalizeRenderMode(row.render_mode),
      lipsyncTaskId: row.lipsync_task_id,
      digitalHumanVideoAssetId: row.digital_human_video_asset_id,
      videoUrl: row.video_url,
      updatedAt: row.updated_at,
    };
  }

  private normalizeTrackSource(
    value: string,
  ): 'asr' | 'tts_alignment' | 'manual' | 'estimate' {
    if (
      value === 'asr' ||
      value === 'tts_alignment' ||
      value === 'manual' ||
      value === 'estimate'
    ) {
      return value;
    }
    return 'estimate';
  }

  private normalizeAssetStatus(
    value: string,
  ): 'pending' | 'processing' | 'succeeded' | 'failed' {
    const normalized = (value || '').trim().toLowerCase();
    if (
      normalized === 'pending' ||
      normalized === 'processing' ||
      normalized === 'failed'
    ) {
      return normalized;
    }
    if (
      normalized === 'completed' ||
      normalized === 'success' ||
      normalized === 'succeeded'
    ) {
      return 'succeeded';
    }
    return 'pending';
  }

  private normalizeTtsSpeedOnlyTuning(payload: Record<string, unknown>): {
    language?: string | null;
    speechRate?: number | null;
  } {
    const tuning = normalizeVoiceTuning(payload);
    return {
      language: tuning.language ?? null,
      speechRate: tuning.speechRate ?? null,
    };
  }

  private async requireAudioAssetRow(
    userId: string,
    audioAssetId: string,
  ): Promise<AudioAssetRow> {
    const row = await this.db.queryOne<AudioAssetRow>(
      `SELECT id, user_id, project_id, name, source_type, storage_provider, object_key, storage_path, audio_url, mime_type, size_bytes, duration_seconds, status, error_message, subtitle_track_id, created_at, updated_at
       FROM audio_assets
       WHERE id = ? AND user_id = ?`,
      [audioAssetId, userId],
    );
    if (!row) {
      throw new NotFoundException('Audio asset not found.');
    }
    return row;
  }

  private async requireSubtitleTrackRow(
    userId: string,
    subtitleTrackId: string,
  ): Promise<SubtitleTrackRow> {
    const row = await this.db.queryOne<SubtitleTrackRow>(
      `SELECT id, user_id, project_id, audio_asset_id, source, language, duration_seconds, cues_json, words_json, status, error_message, created_at, updated_at
       FROM subtitle_tracks
       WHERE id = ? AND user_id = ?`,
      [subtitleTrackId, userId],
    );
    if (!row) {
      throw new NotFoundException('Subtitle track not found.');
    }
    return row;
  }

  private async requireDigitalHumanVideoAssetRow(
    userId: string,
    digitalHumanVideoAssetId: string,
  ): Promise<DigitalHumanVideoAssetRow> {
    const row = await this.db.queryOne<DigitalHumanVideoAssetRow>(
      `SELECT id, user_id, project_id, avatar_resource_id, audio_asset_id, render_mode, source_task_id, video_url, video_path, duration_seconds, status, error_message, created_at, updated_at
       FROM digital_human_video_assets
       WHERE id = ? AND user_id = ?`,
      [digitalHumanVideoAssetId, userId],
    );
    if (!row) {
      throw new NotFoundException('Digital human video asset not found.');
    }
    return row;
  }

  private resolveDigitalHumanVideoUrl(
    row: DigitalHumanVideoAssetRow,
  ): string | null {
    if (row.video_url?.trim()) {
      return row.video_url.trim();
    }
    if (row.video_path?.trim()) {
      return this.toOutputPublicUrl(path.basename(row.video_path.trim()));
    }
    return null;
  }

  private async isReusableLipSyncAssetRow(
    userId: string,
    row: DigitalHumanVideoAssetRow,
  ): Promise<boolean> {
    const normalizedStatus = this.normalizeAssetStatus(row.status);
    if (normalizedStatus !== 'succeeded') {
      return false;
    }
    const resolvedVideoUrl = this.resolveDigitalHumanVideoUrl(row);
    if (!resolvedVideoUrl) {
      return false;
    }
    if (row.video_path?.trim() && !existsSync(row.video_path.trim())) {
      return false;
    }
    if (row.source_task_id?.trim()) {
      const sourceTask = await this.db.queryOne<{
        id: string;
        kind: string;
        status: string;
      }>(
        `SELECT id, kind, status
         FROM task_statuses
         WHERE id = ? AND user_id = ?`,
        [row.source_task_id.trim(), userId],
      );
      if (!sourceTask || sourceTask.kind !== 'video-lipsync') {
        return false;
      }
      const taskStatus = (sourceTask.status || '').trim().toLowerCase();
      if (
        taskStatus !== 'completed' &&
        taskStatus !== 'success' &&
        taskStatus !== 'succeeded'
      ) {
        return false;
      }
    }
    return true;
  }

  private emptyResolvedLipSyncAsset(
    projectId: string,
    audioAssetId: string,
    avatarResourceId: string,
    renderMode: '1080x1920' | 'adaptive' | 'preserveSourceAspect',
  ): ResolvedLipSyncAssetDto {
    return {
      projectId,
      audioAssetId,
      avatarResourceId,
      renderMode,
      digitalHumanVideoAssetId: null,
      videoUrl: null,
      duration: null,
      sourceTaskId: null,
      updatedAt: null,
    };
  }

  private getCachedLipSyncResolve(key: string): ResolvedLipSyncAssetDto | null {
    const row = this.lipSyncResolveCache.get(key);
    if (!row) {
      return null;
    }
    if (row.expiresAt <= Date.now()) {
      this.lipSyncResolveCache.delete(key);
      return null;
    }
    row.touchedAt = Date.now();
    this.lipSyncResolveCache.set(key, row);
    return row.value;
  }

  private setCachedLipSyncResolve(
    key: string,
    value: ResolvedLipSyncAssetDto,
  ): void {
    const now = Date.now();
    this.lipSyncResolveCache.set(key, {
      value,
      touchedAt: now,
      expiresAt:
        now +
        this.readPositiveInt(
          this.config.get('LIPSYNC_ASSET_RESOLVE_CACHE_TTL_MS'),
          2_000,
        ),
    });
    this.pruneLipSyncResolveCache();
  }

  private pruneLipSyncResolveCache(): void {
    const now = Date.now();
    for (const [key, row] of this.lipSyncResolveCache.entries()) {
      if (row.expiresAt <= now) {
        this.lipSyncResolveCache.delete(key);
      }
    }
    const max = this.readPositiveInt(
      this.config.get('LIPSYNC_ASSET_RESOLVE_CACHE_MAX'),
      1_000,
    );
    if (this.lipSyncResolveCache.size <= max) {
      return;
    }
    const sorted = [...this.lipSyncResolveCache.entries()].sort(
      (a, b) => a[1].touchedAt - b[1].touchedAt,
    );
    for (const [key] of sorted) {
      if (this.lipSyncResolveCache.size <= max) {
        break;
      }
      this.lipSyncResolveCache.delete(key);
    }
  }

  private resolveSafeLocalAudioPath(input: string): string {
    const candidate = path.resolve(input);
    const root = path.resolve(this.uploadAudioDir());
    const relative = path.relative(root, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException(
        'audioPath must stay within uploads/audio.',
      );
    }
    if (!existsSync(candidate)) {
      throw new NotFoundException(
        `Audio file not found: ${path.basename(candidate)}`,
      );
    }
    return candidate;
  }

  private resolveSafeVideoOutputPath(input: string): string {
    const candidate = path.resolve(input);
    const root = path.resolve(this.outputDir());
    const relative = path.relative(root, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new BadRequestException(
        'videoPath must stay within uploads/output.',
      );
    }
    if (!existsSync(candidate)) {
      throw new NotFoundException(
        `Video file not found: ${path.basename(candidate)}`,
      );
    }
    return candidate;
  }

  private resolveOutputPathFromPublicUrl(url: string): string | null {
    const encoded = '/output/';
    const idx = url.indexOf(encoded);
    if (idx < 0) return null;
    const fileName = decodeURIComponent(
      url.slice(idx + encoded.length).split(/[?#]/, 1)[0],
    );
    if (!fileName) return null;
    const safe = path.basename(fileName);
    if (safe !== fileName) return null;
    return path.join(this.outputDir(), safe);
  }

  private async publishOutput(
    localPath: string,
    fileName: string,
  ): Promise<{ storage: 'local' | 'oss'; url: string }> {
    if (this.renderOutputStorage() === 'local') {
      return { storage: 'local', url: this.toOutputPublicUrl(fileName) };
    }
    const datePrefix = new Date().toISOString().slice(0, 10);
    const basePrefix =
      this.config.get<string>('RENDER_OUTPUT_OSS_PREFIX')?.trim() ||
      this.config.get<string>('ALI_OSS_UPLOAD_PREFIX')?.trim() ||
      'runtime-assets/result';
    const objectKey = `${basePrefix.replace(/^\/+|\/+$/g, '')}/${datePrefix}/${fileName}`;
    const client = this.getRenderOutputOssClient();
    await client.put(objectKey, localPath, {
      headers: { 'Content-Type': 'video/mp4' },
    });
    const publicBase = this.config
      .get<string>('RENDER_OUTPUT_OSS_PUBLIC_BASE_URL')
      ?.trim();
    if (publicBase) {
      return {
        storage: 'oss',
        url: `${publicBase.replace(/\/+$/, '')}/${encodeURIComponent(objectKey)}`,
      };
    }
    const signedTtl = Math.max(
      60,
      this.readPositiveInt(
        this.config.get('RENDER_OUTPUT_OSS_SIGNED_URL_TTL_SECONDS'),
        7 * 24 * 60 * 60,
      ),
    );
    return {
      storage: 'oss',
      url: client.signatureUrl(objectKey, {
        method: 'GET',
        expires: signedTtl,
      }),
    };
  }

  private renderOutputStorage(): 'local' | 'oss' {
    const mode =
      this.config.get<string>('RENDER_OUTPUT_STORAGE')?.trim().toLowerCase() ||
      'local';
    return mode === 'oss' ? 'oss' : 'local';
  }

  private getRenderOutputOssClient(): OssClient {
    if (this.renderOutputOssClient) return this.renderOutputOssClient;

    const OSS = requireFromService('ali-oss') as new (
      options: Record<string, unknown>,
    ) => OssClient;
    const accessKeyId = this.config
      .get<string>('ALI_OSS_ACCESS_KEY_ID')
      ?.trim();
    const accessKeySecret = this.config
      .get<string>('ALI_OSS_ACCESS_KEY_SECRET')
      ?.trim();
    const bucket = this.config.get<string>('ALI_OSS_BUCKET')?.trim();
    const endpoint = this.config.get<string>('ALI_OSS_ENDPOINT')?.trim();
    const region = this.config.get<string>('ALI_OSS_REGION')?.trim();
    if (!accessKeyId || !accessKeySecret || !bucket) {
      throw new BadRequestException(
        'RENDER_OUTPUT_STORAGE=oss requires ALI_OSS_ACCESS_KEY_ID/ALI_OSS_ACCESS_KEY_SECRET/ALI_OSS_BUCKET',
      );
    }
    this.renderOutputOssClient = new OSS({
      accessKeyId,
      accessKeySecret,
      bucket,
      ...(endpoint ? { endpoint } : {}),
      ...(region ? { region } : {}),
    });
    return this.renderOutputOssClient;
  }

  private getVoiceSampleOssClient(): OssClient {
    if (this.voiceSampleOssClient) return this.voiceSampleOssClient;

    const OSS = requireFromService('ali-oss') as new (
      options: Record<string, unknown>,
    ) => OssClient;
    const accessKeyId = this.config
      .get<string>('ALI_OSS_ACCESS_KEY_ID')
      ?.trim();
    const accessKeySecret = this.config
      .get<string>('ALI_OSS_ACCESS_KEY_SECRET')
      ?.trim();
    const bucket = this.config.get<string>('ALI_OSS_BUCKET')?.trim();
    const endpoint = this.config.get<string>('ALI_OSS_ENDPOINT')?.trim();
    const region = this.config.get<string>('ALI_OSS_REGION')?.trim();
    if (!accessKeyId || !accessKeySecret || !bucket) {
      throw new BadRequestException(
        'ALI_OSS_ACCESS_KEY_ID/ALI_OSS_ACCESS_KEY_SECRET/ALI_OSS_BUCKET are required for OSS object access.',
      );
    }
    this.voiceSampleOssClient = new OSS({
      accessKeyId,
      accessKeySecret,
      bucket,
      ...(endpoint ? { endpoint } : {}),
      ...(region ? { region } : {}),
    });
    return this.voiceSampleOssClient;
  }

  private headerString(
    headers: Record<string, string | string[] | undefined> | undefined,
    name: string,
  ): string | undefined {
    if (!headers) return undefined;
    const key = name.toLowerCase();
    const value =
      headers[name] ??
      headers[key] ??
      Object.entries(headers).find(([k]) => k.toLowerCase() === key)?.[1];
    return Array.isArray(value) ? value[0] : value;
  }

  private uploadRoot(): string {
    return path.resolve(
      this.config.get<string>('UPLOAD_DIR')?.trim() || 'uploads',
    );
  }

  private uploadAudioDir(): string {
    return path.join(this.uploadRoot(), 'audio');
  }

  private outputDir(): string {
    return path.join(this.uploadRoot(), 'output');
  }

  private runtimeTempDir(): string {
    return path.resolve(
      this.config.get<string>('TEMP_DIR')?.trim() ||
        this.config.get<string>('TMP_DIR')?.trim() ||
        path.join(this.uploadRoot(), 'tmp'),
    );
  }

  private async createRuntimeTempDir(prefix: string): Promise<string> {
    const tempRoot = this.runtimeTempDir();
    await fs.mkdir(tempRoot, { recursive: true });
    return fs.mkdtemp(path.join(tempRoot, prefix));
  }

  private toAudioPublicUrl(fileName: string): string {
    const base =
      this.config.get<string>('PUBLIC_UPLOAD_BASE_URL')?.trim() ||
      `http://localhost:${this.config.get<string>('PORT')?.trim() || process.env.PORT || '3000'}/uploads`;
    return `${base.replace(/\/+$/, '')}/audio/${encodeURIComponent(fileName)}`;
  }

  private toOutputPublicUrl(fileName: string): string {
    const base =
      this.config.get<string>('PUBLIC_UPLOAD_BASE_URL')?.trim() ||
      `http://localhost:${this.config.get<string>('PORT')?.trim() || process.env.PORT || '3000'}/uploads`;
    return `${base.replace(/\/+$/, '')}/output/${encodeURIComponent(fileName)}`;
  }

  private normalizeName(raw: unknown, fallbackName: string): string {
    const name =
      typeof raw === 'string' && raw.trim() ? raw.trim() : fallbackName.trim();
    return name.slice(0, 120) || 'audio';
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim();
  }

  private readPatchNullableString(
    source: Record<string, unknown>,
    key: string,
    maxLength: number,
  ): { has: boolean; value: string | null } {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      return { has: false, value: null };
    }
    const value = source[key];
    if (value === null || value === undefined) {
      return { has: true, value: null };
    }
    if (typeof value !== 'string') {
      throw new BadRequestException(`${key} is invalid.`);
    }
    const normalized = value.trim();
    if (!normalized) {
      return { has: true, value: null };
    }
    if (normalized.length > maxLength) {
      throw new BadRequestException(`${key} is too long.`);
    }
    return { has: true, value: normalized };
  }

  private readPatchRenderMode(source: Record<string, unknown>): {
    has: boolean;
    value: '1080x1920' | 'adaptive' | 'preserveSourceAspect' | null;
  } {
    if (!Object.prototype.hasOwnProperty.call(source, 'renderMode')) {
      return { has: false, value: null };
    }
    const value = source.renderMode;
    if (value === null || value === undefined) {
      return { has: true, value: null };
    }
    const mode = this.normalizeRenderMode(value);
    if (!mode) {
      throw new BadRequestException('renderMode is invalid.');
    }
    return { has: true, value: mode };
  }

  private normalizeProjectIdOrLegacy(value: unknown): string {
    const projectId = this.optionalString(value);
    return projectId ?? LEGACY_PROJECT_ID;
  }

  private isLegacyProjectId(projectId: string): boolean {
    return projectId === LEGACY_PROJECT_ID;
  }

  private normalizeAssetProjectId(value: string | null): string {
    return value?.trim() ? value.trim() : LEGACY_PROJECT_ID;
  }

  private async resolveProjectIdForWrite(
    userId: string,
    value: unknown,
  ): Promise<string> {
    const projectId = this.normalizeProjectIdOrLegacy(value);
    await this.assertProjectAccess(userId, projectId);
    return projectId;
  }

  private async assertProjectAccess(
    userId: string,
    projectIdRaw: string,
  ): Promise<void> {
    const projectId = this.requiredString(projectIdRaw, 'projectId');
    if (this.isLegacyProjectId(projectId)) {
      return;
    }
    const project = await this.db.queryOne<{ id: string }>(
      `SELECT id FROM video_projects WHERE id = ? AND user_id = ? LIMIT 1`,
      [projectId, userId],
    );
    if (!project) {
      throw new NotFoundException('Project not found.');
    }
  }

  private assertAssetProjectMatch(
    fieldName: string,
    assetProjectId: string | null,
    projectId: string,
  ): void {
    if (
      this.normalizeAssetProjectId(assetProjectId) !==
      this.normalizeAssetProjectId(projectId)
    ) {
      throw new BadRequestException(
        `${fieldName} does not belong to current project.`,
      );
    }
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private optionalNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    return Number(value);
  }

  private audioExtensionForMime(mimeType: string): string {
    const mime = mimeType.split(';', 1)[0]?.trim().toLowerCase();
    switch (mime) {
      case 'audio/wav':
      case 'audio/x-wav':
        return '.wav';
      case 'audio/mp4':
      case 'audio/aac':
        return '.m4a';
      case 'audio/ogg':
        return '.ogg';
      case 'audio/flac':
        return '.flac';
      case 'audio/webm':
        return '.webm';
      default:
        return '.mp3';
    }
  }

  private guessMimeFromFilename(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const map: Record<string, string> = {
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.webm': 'audio/webm',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  private readNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private roundSeconds(value: number): number {
    return Number(Math.max(0, value).toFixed(3));
  }

  private isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }

  private isSafeColor(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) return true;
    return /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|0?\.\d+|1))?\s*\)$/.test(
      text,
    );
  }

  private buildTtsDedupeKey(
    userId: string,
    payload: Record<string, unknown>,
  ): string {
    const idempotencyKey = this.optionalString(payload.idempotencyKey);
    if (idempotencyKey) {
      return `idemp:${userId}:${idempotencyKey.slice(0, 120)}`;
    }
    const normalized = this.normalizeForDedupe({
      projectId: this.normalizeProjectIdOrLegacy(payload.projectId),
      text: this.requiredString(payload.text, 'text'),
      voiceResourceId: this.optionalString(payload.voiceResourceId),
      voiceTuning: normalizeVoiceTuning(payload),
    });
    const raw = JSON.stringify(normalized);
    const hash = createHash('sha256').update(raw).digest('hex');
    return `auto:${userId}:${hash}`;
  }

  private normalizeForDedupe(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeForDedupe(item));
    }
    if (!value || typeof value !== 'object') return value;
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of keys) {
      normalized[key] = this.normalizeForDedupe(source[key]);
    }
    return normalized;
  }

  private assertUserTtsConcurrency(userId: string): void {
    const limit = this.readPositiveInt(
      this.config.get('TTS_TASK_PER_USER_CONCURRENCY'),
      1,
    );
    const active = this.ttsActiveCountByUser.get(userId) ?? 0;
    if (active >= limit) {
      throw new BadRequestException(
        `Too many active TTS tasks for current user. Please wait and retry. active=${active}, limit=${limit}`,
      );
    }
  }

  private incrementUserTtsActive(userId: string): void {
    this.ttsActiveCountByUser.set(
      userId,
      (this.ttsActiveCountByUser.get(userId) ?? 0) + 1,
    );
  }

  private decrementUserTtsActive(userId: string): void {
    const current = this.ttsActiveCountByUser.get(userId) ?? 0;
    if (current <= 1) {
      this.ttsActiveCountByUser.delete(userId);
      return;
    }
    this.ttsActiveCountByUser.set(userId, current - 1);
  }

  private assertObjectPayloadBudget(
    value: unknown,
    field: string,
    maxBytes: number,
    maxNodes: number,
    maxDepth: number,
  ): void {
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
      if (nodes > maxNodes) {
        throw new BadRequestException(
          `${field} is too complex, maxNodes=${maxNodes}`,
        );
      }
      if (depth > maxDepth) {
        throw new BadRequestException(
          `${field} is too deep, maxDepth=${maxDepth}`,
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
    if (bytes > maxBytes) {
      throw new BadRequestException(
        `${field} is too large, maxBytes=${maxBytes}`,
      );
    }
  }

  private readPositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : fallback;
  }
}
