import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express, Request, Response } from 'express';
import { createReadStream, existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { getTranscribeMediaMaxBytes } from '../../common/media.constants';
import { normalizeSourceVideoUrl } from '../../common/douyin-share-url.util';
import { resolveConfiguredDir } from '../../common/resource-paths.util';
import { RewriteAiService } from '../../integrations/ai/rewrite-ai.service';
import { DigitalHumanImageService } from '../../integrations/ai/digital-human-image.service';
import { AliLipSyncService } from '../../integrations/ai/ali-lip-sync.service';
import { SpeechAiService } from '../../integrations/ai/speech-ai.service';
import { TranscriptionAiService } from '../../integrations/ai/transcription-ai.service';
import {
  FfmpegAudioService,
  type TranscribeMediaInput,
} from '../../integrations/media/ffmpeg-audio.service';
import { DouyinBenchmarkService } from '../../integrations/video/douyin-benchmark.service';
import { VideoMediaDownloadService } from '../../integrations/video/video-media-download.service';
import { VideoMetaService } from '../../integrations/video/video-meta.service';
import { TranscriptStore } from '../../integrations/transcription/transcript.store';
import type { TranscribeResultDto } from '../../integrations/transcription/transcript.types';
import type { RewriteStyle } from '../tasks/tasks.types';
import { DigitalHumanPersistenceService } from '../digital-human/digital-human-persistence.service';
import { ResourcesService } from '../resources/resources.service';
import { Public } from '../auth/public.decorator';
import { SubtitleWorkflowService } from './subtitle-workflow.service';
import { RecentExtractionService } from './recent-extraction.service';
import { VoicePreviewTaskService } from './voice-preview-task.service';
import { SavedVideoService } from './saved-video.service';
import { normalizeVoiceTuning } from './voice-tuning.util';
import { StagedWorkflowService } from './staged-workflow.service';

class SourceVideoUrlDto {
  /** 鏀寔鎶栭煶鏁存鍒嗕韩鏂囨鎴栫函 URL */
  sourceVideoUrl!: string;
}

class DouyinTranscribeRewriteDto extends SourceVideoUrlDto {
  /** 涓庝换鍔℃敼鍐欓鏍间竴鑷达紱榛樿 conservative */
  rewriteStyle?: RewriteStyle;
}

class DouyinHomepageLearnDto {
  homepageUrl!: string;
}

class SourceVideoFileDto {
  /** 鏀寔鎶栭煶鏁存鍒嗕韩鏂囨鎴栫函 URL */
  sourceVideoUrl!: string;
  /**
   * 榛樿 true銆備负 false 鏃朵粎涓嬭浇骞朵繚瀛樺埌鏈満鐩綍锛屼笉璋冪敤 ASR锛?
   * 鍓嶇鍙殢鍚庤皟鐢?`transcribe-saved-video` 浠ュ睍绀哄垎闃舵杩涘害銆?
   */
  transcribe?: boolean;
}

class OptimizeOralScriptDto {
  sourceText!: string;
  sourceVideoUrl?: string;
}

class LipSyncPreviewDto {
  script!: string;
  avatarResourceId!: string;
  voiceResourceId!: string;
}

class VoiceTuningDto {
  voiceLanguage?: string;
  voiceEmotion?: string;
  voiceEmotionIntensity?: number;
  voiceRate?: number;
  voiceVolume?: number;
  voicePitch?: number;
}

class VoicePreviewDto extends VoiceTuningDto {
  script!: string;
  voiceResourceId!: string;
}

class SubtitleWorkflowPreviewDto extends LipSyncPreviewDto {
  subtitleTemplateId?: string;
  previewSeconds?: number;
  subtitlesEnabled?: boolean;
  subtitleVisualStyle?: {
    layout?: {
      xPct: number;
      yPct: number;
      anchor?:
        | 'center'
        | 'top-center'
        | 'bottom-center'
        | 'top-left'
        | 'top-right'
        | 'bottom-left'
        | 'bottom-right'
        | 'left-center'
        | 'right-center';
      safeAreaPct?: number;
      scale?: number;
      maxWidthPct?: number;
    };
    normalColor?: string;
    highlightColor?: string;
    strokeColor?: string;
    backgroundColor?: string;
    fontSize?: number;
    strokeWidth?: number;
    fontWeight?: number;
    lineHeight?: number;
  };
  subtitles?: Array<{
    id?: string;
    startTime: number;
    endTime: number;
    text: string;
    highlightRanges?: Array<{
      start: number;
      end: number;
      color?: string;
      fontWeight?: number;
      fontSizeScale?: number;
    }>;
  }>;
  highlights?: Array<{
    id?: string;
    start: number;
    end: number;
    text?: string;
    style?: {
      color?: string;
      fontWeight?: number;
      fontSizeScale?: number;
    };
  }>;
  voiceLanguage?: string;
  voiceEmotion?: string;
  voiceEmotionIntensity?: number;
  voiceRate?: number;
  voiceVolume?: number;
  voicePitch?: number;
}

class SubtitleWorkflowFinalizeDto {
  draftId!: string;
}

class GenerateTtsAudioDto extends VoiceTuningDto {
  text!: string;
  voiceResourceId?: string;
  projectId?: string;
  idempotencyKey?: string;
  forceRetry?: boolean;
}

class GenerateLipSyncVideoDto {
  videoPath?: string;
  videoUrl?: string;
  audioPath?: string;
  audioUrl?: string;
  videoExtension?: boolean;
}

class RecentExtractionDto {
  sourceUrl!: string;
  platform?: string;
  title?: string;
  summary?: string;
  coverUrl?: string;
  videoUrl?: string;
  extractedAt?: string;
}

class LocalMediaFileNotFoundError extends Error {
  constructor(readonly checkedPath: string) {
    super(`File not found: ${checkedPath}`);
  }
}

const LIP_SYNC_MAX_DURATION_SECONDS = 5 * 60;

function getLipSyncVideoMaxBytes(): number {
  const v = process.env.ALI_LIP_SYNC_VIDEO_MAX_BYTES?.trim();
  if (v && /^\d+$/.test(v)) return parseInt(v, 10);
  return 500 * 1024 * 1024;
}

/** 榛樿淇濆瓨鍒伴」鐩唴 backend/data/download-video锛涘彲鐢?VIDEO_SAVE_DIR 瑕嗙洊銆?*/
function getVideoSaveDir(config: ConfigService): string {
  return resolveConfiguredDir(
    config.get<string>('VIDEO_SAVE_DIR'),
    'download-video',
  );
}

function getPreviewVideoSaveDir(config: ConfigService): string {
  return resolveConfiguredDir(
    config.get<string>('PREVIEW_VIDEO_SAVE_DIR'),
    'preview-videos',
  );
}

function getPreviewAudioSaveDir(config: ConfigService): string {
  return resolveConfiguredDir(
    config.get<string>('PREVIEW_AUDIO_SAVE_DIR'),
    'preview-audios',
  );
}

function getUploadRootFromEnv(): string {
  return path.resolve(process.env.UPLOAD_DIR?.trim() || 'uploads');
}

function getUploadDir(kind: 'video' | 'audio' | 'output'): string {
  return path.join(getUploadRootFromEnv(), kind);
}

function safeUploadExt(originalname: string, fallback: string): string {
  const ext = path.extname(originalname || '').toLowerCase();
  return /^\.[a-z0-9]{2,6}$/i.test(ext) ? ext : fallback;
}

function uploadFileName(
  prefix: string,
  originalname: string,
  fallbackExt: string,
): string {
  return `${prefix}_${Date.now()}_${randomUUID().slice(0, 10)}${safeUploadExt(
    originalname,
    fallbackExt,
  )}`;
}

const uploadVideoStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = getUploadDir('video');
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, uploadFileName('video', file.originalname, '.mp4'));
  },
});

const uploadAudioStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = getUploadDir('audio');
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, uploadFileName('audio', file.originalname, '.mp3'));
  },
});

function getLipSyncPublicMediaDir(
  config: ConfigService,
  kind: 'videos' | 'audios',
): string {
  const root = resolveConfiguredDir(
    config.get<string>('LIP_SYNC_PUBLIC_MEDIA_DIR'),
    'lip-sync-public',
  );
  return path.join(root, kind);
}

function sanitizeFilenameForDisk(name: string): string {
  const blocked = '<>:"/\\|?*';
  const base = [...path.basename(name)]
    .map((ch) => (ch.charCodeAt(0) < 32 || blocked.includes(ch) ? '_' : ch))
    .join('')
    .trim();
  if (!base) return 'video.mp4';
  return base;
}

function toSingleErrorMessage(e: unknown): string {
  if (e instanceof HttpException) {
    const r = e.getResponse();
    if (typeof r === 'string') return r;
    if (r && typeof r === 'object' && 'message' in r) {
      const m = (r as { message: string | string[] }).message;
      return Array.isArray(m) ? m.join('锛?') : String(m);
    }
  }
  return e instanceof Error ? e.message : String(e);
}

function guessMimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.avi': 'video/x-msvideo',
    '.flv': 'video/x-flv',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** 浠呭厑璁稿崟灞傛枃浠跺悕锛岄槻璺緞绌胯秺 */
function assertSafeSavedBasename(name: string): string {
  const t = name.trim();
  if (!t) {
    throw new BadRequestException('fileName 涓嶈兘涓虹┖');
  }
  const base = path.basename(t);
  if (base !== t || /[\\/]/.test(t) || t.includes('..')) {
    throw new BadRequestException('鍙厑璁镐繚瀛樼洰褰曚笅鐨勬枃浠跺悕锛屼笉鑳藉寘鍚矾寰?');
  }
  return base;
}

/**
 * 宸ュ叿绫绘帴鍙ｏ細涓嶅垱寤轰换鍔″嵆鍙瑙堛€岃В鏋愬悗鐨勫彛鎾枃妗堛€嶏紙褰撳墠涓?ASR 鍗犱綅瀹炵幇锛?
 */
@Controller('v1/tools')
export class ToolsController {
  constructor(
    private readonly config: ConfigService,
    private readonly transcription: TranscriptionAiService,
    private readonly videoMeta: VideoMetaService,
    private readonly videoMediaDownload: VideoMediaDownloadService,
    private readonly ffmpegAudio: FfmpegAudioService,
    private readonly transcriptStore: TranscriptStore,
    private readonly rewriteAi: RewriteAiService,
    private readonly digitalHumanImage: DigitalHumanImageService,
    private readonly douyinBenchmark: DouyinBenchmarkService,
    private readonly digitalHumanPersistence: DigitalHumanPersistenceService,
    private readonly aliLipSync: AliLipSyncService,
    private readonly speechAi: SpeechAiService,
    private readonly resources: ResourcesService,
    private readonly subtitleWorkflow: SubtitleWorkflowService,
    private readonly recentExtractions: RecentExtractionService,
    private readonly voicePreviewTasks: VoicePreviewTaskService,
    private readonly savedVideos: SavedVideoService,
    private readonly stagedWorkflow: StagedWorkflowService,
  ) {}

  @Post('upload-video')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadVideoStorage,
      limits: { fileSize: getLipSyncVideoMaxBytes() },
    }),
  )
  async uploadVideoForLipSync(
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.path || !file.size) {
      throw new BadRequestException('璇蜂笂浼犺棰戞枃浠讹紙multipart 瀛楁鍚嶏細file锛?');
    }
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || file.filename || '';
    if (
      !mime.startsWith('video/') &&
      !/\.(mp4|mov|webm|m4v|mkv)$/i.test(name)
    ) {
      await fs.rm(file.path, { force: true }).catch(() => undefined);
      throw new BadRequestException('浠呮敮鎸佷笂浼犺棰戞枃浠?');
    }
    return {
      success: true,
      videoUrl: this.publicUploadUrl('video', file.filename),
      videoPath: file.path,
      fileName: file.filename,
    };
  }

  @Post('upload-audio')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadAudioStorage,
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async uploadAudioForLipSync(
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.path || !file.size) {
      throw new BadRequestException('璇蜂笂浼犻煶棰戞枃浠讹紙multipart 瀛楁鍚嶏細file锛?');
    }
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || file.filename || '';
    if (
      !mime.startsWith('audio/') &&
      !/\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(name)
    ) {
      await fs.rm(file.path, { force: true }).catch(() => undefined);
      throw new BadRequestException('浠呮敮鎸佷笂浼犻煶棰戞枃浠?');
    }
    const duration = await this.ffmpegAudio.probeFileDurationSeconds(file.path);
    return {
      success: true,
      audioUrl: this.publicUploadUrl('audio', file.filename),
      audioPath: file.path,
      fileName: file.filename,
      duration: duration ? Number(duration.toFixed(2)) : null,
    };
  }

  @Post('generate-tts-audio')
  async generateTtsAudio(
    @Req() req: Request,
    @Body() body: GenerateTtsAudioDto,
  ) {
    const text = body.text?.trim() ?? '';
    if (text.length < 1) {
      throw new BadRequestException('text 涓嶈兘涓虹┖');
    }
    const asset = await this.stagedWorkflow.createAudioAssetFromTts(
      req.userId!,
      this.mergeLegacyTtsIdempotencyKey(
        req,
        body as unknown as Record<string, unknown>,
      ),
    );
    return {
      success: true,
      audioAssetId: asset.audioAssetId,
      audioUrl: asset.audioUrl,
      audioPath: null,
      fileName: this.fileNameFromPublicUploadUrl(asset.audioUrl),
      duration: asset.durationSeconds,
      providerVoice: null,
      styleApplied: Boolean(body.voiceRate && Number(body.voiceRate) !== 1),
      hint: 'Use /api/v1/audio-assets/generate as the canonical TTS API.',
    };
  }

  @Post('generate-lip-sync-video')
  async generateLipSyncVideo(@Body() body: GenerateLipSyncVideoDto) {
    try {
      const videoRef = body.videoPath?.trim() || body.videoUrl?.trim();
      const audioRef = body.audioPath?.trim() || body.audioUrl?.trim();
      if (!videoRef) {
        return {
          success: false,
          message: '鏂囦欢涓嶅瓨鍦?',
          path: 'videoPath/videoUrl 涓虹┖',
        };
      }
      if (!audioRef) {
        return {
          success: false,
          message: '鏂囦欢涓嶅瓨鍦?',
          path: 'audioPath/audioUrl 涓虹┖',
        };
      }

      const [video, audio] = await Promise.all([
        this.readUploadOrRemoteMedia(videoRef, 'video'),
        this.readUploadOrRemoteMedia(audioRef, 'audio'),
      ]);
      const result = await this.aliLipSync.submitLipSync({
        video,
        audio,
        videoExtension: body.videoExtension,
      });
      if (!result.videoUrl?.trim()) {
        return {
          success: false,
          message: 'VideoReTalk 璋冪敤澶辫触',
          error: 'VideoReTalk 鏈繑鍥炶緭鍑鸿棰戝湴鍧€',
        };
      }
      const output = await this.saveOutputVideoFromUrl(result.videoUrl);
      return {
        success: true,
        outputVideoUrl: output.url,
        outputVideoPath: output.path,
        fileName: output.fileName,
        providerResponse: result.providerResponse,
        hint: result.hint,
      };
    } catch (error) {
      if (error instanceof LocalMediaFileNotFoundError) {
        return {
          success: false,
          message: '鏂囦欢涓嶅瓨鍦?',
          path: error.checkedPath,
        };
      }
      return {
        success: false,
        message: 'VideoReTalk 璋冪敤澶辫触',
        error: toSingleErrorMessage(error),
      };
    }
  }

  /**
   * 瑙嗛瀵瑰彛鍨嬶細鍓嶇涓婁紶鍗曚釜瑙嗛锛屽悗绔唬鐞嗚皟鐢ㄩ樋閲屾帴鍙ｅ苟杩斿洖澶勭悊鍚庤棰?URL銆?
   */
  @Post('ali-lip-sync')
  @UseInterceptors(
    FileInterceptor('video', {
      limits: { fileSize: getLipSyncVideoMaxBytes() },
    }),
  )
  async aliLipSyncVideo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('durationSeconds') durationSecondsRaw?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        '璇蜂笂浼犺棰戞枃浠讹紙multipart 瀛楁鍚嶏細video锛?',
      );
    }

    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';
    if (
      !mime.startsWith('video/') &&
      !/\.(mp4|mov|webm|m4v|mkv)$/i.test(name)
    ) {
      throw new BadRequestException('浠呮敮鎸佷笂浼犺棰戞枃浠?');
    }

    const durationSeconds =
      durationSecondsRaw !== undefined && durationSecondsRaw !== ''
        ? Number(durationSecondsRaw)
        : undefined;
    if (durationSeconds !== undefined) {
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new BadRequestException('瑙嗛鏃堕暱鏃犳晥');
      }
      if (durationSeconds > LIP_SYNC_MAX_DURATION_SECONDS) {
        throw new BadRequestException('瑙嗛闀垮害涓嶈兘瓒呰繃 5 鍒嗛挓');
      }
    }

    this.aliLipSync.ensureConfigured();
    if (!this.aliLipSync.isConfigured()) {
      const previewUrl = await this.persistPreviewVideo({
        buffer: file.buffer,
        originalname: file.originalname || 'lip-sync-input.mp4',
      });
      return {
        videoUrl: previewUrl,
        providerResponse: {
          fallback: true,
          reason: 'lip-sync-api-unconfigured',
        },
        hint: '褰撳墠鐜鏈厤缃鍙ｅ瀷 API锛屽凡鐩存帴杩斿洖涓婁紶瑙嗛鐢ㄤ簬娴佺▼鑱旇皟銆?',
      };
    }

    return this.aliLipSync.submitVideo({
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
      durationSeconds,
    });
  }

  @Post('lip-sync-preview')
  async createLipSyncPreview(
    @Req() req: Request,
    @Body() body: LipSyncPreviewDto,
  ) {
    const script = body.script?.trim() ?? '';
    if (script.length < 2) {
      throw new BadRequestException('鍙ｆ挱鏂囨杩囩煭鎴栦负绌?');
    }
    if (!body.avatarResourceId?.trim()) {
      throw new BadRequestException('avatarResourceId 涓嶈兘涓虹┖');
    }
    if (!body.voiceResourceId?.trim()) {
      throw new BadRequestException('voiceResourceId 涓嶈兘涓虹┖');
    }

    const userId = req.userId!;
    const [avatar, voice] = await Promise.all([
      this.resources.getAvatar(userId, body.avatarResourceId.trim()),
      this.resources.getVoice(userId, body.voiceResourceId.trim()),
    ]);
    if (!avatar.originalVideoUrl?.trim()) {
      throw new BadRequestException('璇ユ暟瀛椾汉璧勬簮鏈厤缃師濮嬭棰?');
    }

    const videoMedia = await this.readVideoFromSourceRef(
      avatar.originalVideoUrl,
    );
    this.aliLipSync.ensureConfigured();
    const estimatedTotalSeconds = Math.min(
      180,
      Math.max(15, Math.round(script.length * 0.22)),
    );
    const hintParts: string[] = [];

    let speech!: Awaited<ReturnType<SpeechAiService['synthesizeAudio']>>;
    try {
      speech = await this.speechAi.synthesizeAudio({
        text: script,
        voiceStyleId: voice.id,
        voiceName: voice.name,
        provider: voice.provider,
        providerVoice: voice.providerVoice,
        providerModel: voice.providerModel,
      });
      hintParts.push(`TTS generated with voice ${voice.name}.`);
    } catch (e) {
      throw new BadRequestException(
        `TTS generation failed: ${toSingleErrorMessage(e)}`,
      );
    }

    try {
      await this.ffmpegAudio.replaceVideoAudio({
        video: {
          buffer: videoMedia.buffer,
          originalname: videoMedia.originalname,
        },
        audio: {
          buffer: speech.buffer,
          originalname: `tts${this.audioExtensionForMime(speech.mimeType)}`,
        },
      });
      hintParts.push(`Audio replaced for avatar ${avatar.name}.`);
    } catch (e) {
      hintParts.push(
        `Audio replacement failed: ${toSingleErrorMessage(e)}; continue lip-sync.`,
      );
    }

    try {
      const result = await this.aliLipSync.submitLipSync({
        video: {
          buffer: videoMedia.buffer,
          filename: videoMedia.originalname,
          mimeType:
            videoMedia.mimetype ||
            guessMimeFromFilename(videoMedia.originalname),
        },
        audio: {
          buffer: speech.buffer,
          filename: `tts${this.audioExtensionForMime(speech.mimeType)}`,
          mimeType: speech.mimeType,
        },
      });

      return {
        optimizedScript: script,
        llmUsed: false,
        estimatedTotalSeconds,
        videoUrl: result.videoUrl,
        hint:
          result.hint ||
          `${hintParts.join(' ')} Lip-sync preview generated for ${avatar.name}.`,
        providerResponse: result.providerResponse,
        fallback: false,
        lipSyncApplied: true,
      };
    } catch (e) {
      throw new BadRequestException(
        `VideoReTalk lip-sync failed: ${toSingleErrorMessage(e)}`,
      );
    }
  }

  @Get('lip-sync-readiness')
  getLipSyncReadiness() {
    return this.aliLipSync.getReadiness();
  }

  @Post('voice-preview')
  createVoicePreview(@Req() req: Request, @Body() body: VoicePreviewDto) {
    const task = this.voicePreviewTasks.createTask(req.userId!, {
      script: body.script,
      voiceResourceId: body.voiceResourceId,
      voiceTuning: normalizeVoiceTuning(body),
    });
    return {
      ...task,
      pollPath: `/api/v1/tools/voice-preview-tasks/${encodeURIComponent(task.previewTaskId)}`,
      audioUrl: task.audioUrl ?? null,
      durationSeconds: task.durationSeconds ?? null,
      hint:
        task.hint ??
        'Voice preview task accepted and audio is being generated.',
      ttsMode: task.ttsMode ?? null,
      voiceLabel: task.voiceLabel ?? null,
      error: task.error ?? null,
    };
  }

  @Get('voice-preview-tasks/:taskId')
  async getVoicePreviewTask(
    @Req() req: Request,
    @Param('taskId') taskId: string,
  ) {
    const task = await this.voicePreviewTasks.getTask(req.userId!, taskId);
    return {
      ...task,
      audioUrl: task.audioUrl ?? null,
      durationSeconds: task.durationSeconds ?? null,
      hint: task.hint ?? null,
      ttsMode: task.ttsMode ?? null,
      voiceLabel: task.voiceLabel ?? null,
      error: task.error ?? null,
    };
  }

  @Post('subtitle-workflow-preview')
  async createSubtitleWorkflowPreview(
    @Req() req: Request,
    @Body() body: SubtitleWorkflowPreviewDto,
  ) {
    if (body.subtitlesEnabled !== false && !body.subtitleTemplateId?.trim()) {
      throw new BadRequestException('subtitleTemplateId 涓嶈兘涓虹┖');
    }
    return this.subtitleWorkflow.createPreview(req.userId!, {
      script: body.script,
      avatarResourceId: body.avatarResourceId,
      voiceResourceId: body.voiceResourceId,
      subtitleTemplateId: body.subtitleTemplateId,
      subtitlesEnabled: body.subtitlesEnabled,
      previewSeconds: body.previewSeconds,
      subtitleVisualStyle: body.subtitleVisualStyle,
      subtitles: body.subtitles,
      highlights: body.highlights,
      voiceTuning: normalizeVoiceTuning(body),
    });
  }

  @Post('subtitle-workflow-finalize')
  async finalizeSubtitleWorkflow(
    @Req() req: Request,
    @Body() body: SubtitleWorkflowFinalizeDto,
  ) {
    return this.subtitleWorkflow.finalizeDraft(req.userId!, {
      draftId: body.draftId,
    });
  }

  @Get('digital-human-styles')
  digitalHumanStyles() {
    return this.digitalHumanImage.listStyles();
  }

  /**
   * 褰撳墠鐢ㄦ埛鏄惁宸叉湁鏁板瓧浜烘ā鏉匡紙姣忎汉鏈€澶?1 涓紱鍐嶆鐢熸垚浼氳鐩栵級銆?
   */
  @Get('digital-human-template')
  async digitalHumanTemplate(@Req() req: Request) {
    const userId = req.userId!;
    const row = await this.digitalHumanPersistence.findByUserId(userId);
    if (!row) {
      return { hasTemplate: false as const };
    }
    return {
      hasTemplate: true as const,
      styleId: row.style_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      /** 闇€甯?Authorization 鐨?GET锛屽墠绔鐢?axios blob 鎷夊彇鍚?createObjectURL */
      imageFetchPath: 'v1/tools/digital-human-image',
    };
  }

  /**
   * 娴佸紡杩斿洖褰撳墠鐢ㄦ埛宸蹭繚瀛樼殑鏁板瓧浜鸿緭鍑哄浘锛堟湰鍦扮鐩橈級銆?
   */
  @Get('digital-human-image')
  async digitalHumanImageFile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const userId = req.userId!;
    const row = await this.digitalHumanPersistence.findByUserId(userId);
    if (!row) {
      throw new NotFoundException('鏆傛棤宸蹭繚瀛樼殑鏁板瓧浜哄舰璞?');
    }
    const abs = this.digitalHumanPersistence.absolutePathForOutput(row);
    if (!existsSync(abs)) {
      throw new NotFoundException('鏁板瓧浜哄舰璞℃枃浠朵笉瀛樺湪鎴栧凡琚竻鐞?');
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return new StreamableFile(createReadStream(abs));
  }

  /**
   * 鍒犻櫎褰撳墠鐢ㄦ埛鐨勬暟瀛椾汉妯℃澘涓庢湰鍦版枃浠讹紙姣忎汉鏈€澶?1 涓級銆?
   */
  @Delete('digital-human-template')
  async deleteDigitalHumanTemplate(@Req() req: Request) {
    const userId = req.userId!;
    const deleted = await this.digitalHumanPersistence.deleteByUserId(userId);
    return { ok: true as const, deleted };
  }

  /**
   * 鑷媿鐓?+ 椋庢牸 鈫?璋冪敤閰嶇疆鐨勫ぇ妯″瀷鎺ュ彛锛圝SON锛歝ontent銆乮mage_base64銆乵ime_type銆乻tyle_id锛夈€?
   * multipart 瀛楁锛歴elfie锛堟枃浠讹級銆乻tyleId锛堜笌 digital-human-styles 杩斿洖鐨?id 涓€鑷达級銆?
   */
  @Post('digital-human-generate')
  @UseInterceptors(
    FileInterceptor('selfie', { limits: { fileSize: 8 * 1024 * 1024 } }),
  )
  async digitalHumanGenerate(
    @UploadedFile() file: Express.Multer.File,
    @Body('styleId') styleId: string,
    @Req() req: Request,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('璇蜂笂浼犺嚜鎷嶇収');
    }
    const mime = file.mimetype;
    if (mime !== 'image/jpeg' && mime !== 'image/png') {
      throw new BadRequestException('鑷媿鐓т粎鏀寔 JPG/PNG');
    }
    if (!styleId?.trim()) {
      throw new BadRequestException('璇烽€夋嫨鏁板瓧浜洪鏍硷紙styleId锛?');
    }

    const userId = req.userId!;

    const result = await this.digitalHumanImage.generateFromSelfie({
      imageBuffer: file.buffer,
      mimeType: mime,
      styleId: styleId.trim(),
    });

    let outputBuffer: Buffer;
    let outputExt: '.png' | '.jpg';
    if (result.imageUrl) {
      const fetched = await this.digitalHumanImage.fetchRemoteImageBuffer(
        result.imageUrl,
      );
      outputBuffer = fetched.buffer;
      outputExt = fetched.ext;
    } else {
      outputBuffer = file.buffer;
      outputExt = mime === 'image/png' ? '.png' : '.jpg';
    }

    await this.digitalHumanPersistence.saveOrReplace(userId, {
      styleId: result.styleId,
      outputBuffer,
      outputExt,
      selfieBuffer: file.buffer,
      selfieMime: mime,
    });

    return {
      ...result,
      persisted: {
        saved: true,
        /** 鐩稿 http baseURL锛岄渶 Bearer锛涘睍绀鸿 GET blob */
        imageFetchPath: 'v1/tools/digital-human-image' as const,
      },
    };
  }

  /** 涓嬭浇濯掍綋 鈫?FFmpeg 瑙嗛鍒欐娊 16k 鍗曞０閬?WAV 鈫?閫?ASR API */
  private async transcribeAfterDownload(
    media: TranscribeMediaInput,
    opts?: { persistedVideoPath?: string },
  ): Promise<TranscribeResultDto> {
    const prepared = await this.ffmpegAudio.prepareForTranscription(
      media,
      opts,
    );
    return this.transcription.transcribeMedia(prepared);
  }

  /**
   * 浠呬粠鏈湴纾佺洏涓婄殑宸蹭繚瀛樻枃浠惰В鏋愬彛鎾紙FFmpeg 鎶借建 鈫?ASR锛夛紝涓嶄緷璧栧唴瀛樹腑鐨勪笅杞?buffer銆?
   */
  private async transcribeFromDisk(
    absPath: string,
  ): Promise<TranscribeResultDto> {
    const st = await fs.stat(absPath);
    const name = path.basename(absPath);
    const media: TranscribeMediaInput = {
      buffer: Buffer.alloc(0),
      originalname: name,
      mimetype: guessMimeFromFilename(name),
      size: st.size,
    };
    return this.transcribeAfterDownload(media, { persistedVideoPath: absPath });
  }

  /**
   * 杞啓鍋跺彂澶辫触锛堢綉缁?鍐峰惎鍔級鏃堕潤榛橀噸璇曚竴娆★紝涓嶆敼鍙樹笅杞戒笌钀界洏閫昏緫銆?
   */
  private async transcribeFromDiskWithRetry(
    absPath: string,
  ): Promise<TranscribeResultDto> {
    try {
      return await this.transcribeFromDisk(absPath);
    } catch {
      await new Promise((r) => setTimeout(r, 1200));
      return await this.transcribeFromDisk(absPath);
    }
  }

  private resolveSavedVideoPathOrThrow(
    config: ConfigService,
    fileName: string,
  ): string {
    const base = assertSafeSavedBasename(fileName);
    const dir = path.resolve(getVideoSaveDir(config));
    const full = path.resolve(path.join(dir, base));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('闈炴硶鏂囦欢璺緞');
    }
    return full;
  }

  private resolveSavedVideoPathMaybe(sourceRef: string): string | null {
    const ref = sourceRef.trim();
    if (!ref || /^https?:\/\//i.test(ref)) return null;
    const dir = path.resolve(getVideoSaveDir(this.config));
    const basename = path.basename(ref);
    if (!basename || /[\\/]/.test(basename) || basename.includes('..')) {
      throw new BadRequestException(
        '鏈湴瑙嗛浠呮敮鎸?VIDEO_SAVE_DIR 鐩綍涓嬬殑鏂囦欢鍚?',
      );
    }
    const full = path.resolve(path.join(dir, basename));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('鏈湴瑙嗛璺緞涓嶅悎娉?');
    }
    return full;
  }

  private resolvePreviewVideoPathOrThrow(fileName: string): string {
    const base = assertSafeSavedBasename(fileName);
    const dir = path.resolve(getPreviewVideoSaveDir(this.config));
    const full = path.resolve(path.join(dir, base));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('闈炴硶棰勮鏂囦欢璺緞');
    }
    return full;
  }

  private resolvePreviewAudioPathOrThrow(fileName: string): string {
    const base = assertSafeSavedBasename(fileName);
    const dir = path.resolve(getPreviewAudioSaveDir(this.config));
    const full = path.resolve(path.join(dir, base));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('闈炴硶棰勮闊抽璺緞');
    }
    return full;
  }

  private resolveLipSyncPublicMediaPathOrThrow(
    kind: string,
    fileName: string,
  ): { full: string; kind: 'videos' | 'audios' } {
    if (kind !== 'videos' && kind !== 'audios') {
      throw new BadRequestException('invalid lip-sync public media kind');
    }
    const base = assertSafeSavedBasename(fileName);
    const dir = path.resolve(getLipSyncPublicMediaDir(this.config, kind));
    const full = path.resolve(path.join(dir, base));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('invalid lip-sync public media path');
    }
    return { full, kind };
  }

  private mergeLegacyTtsIdempotencyKey(
    req: Request,
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const headerKey = req.get('idempotency-key')?.trim();
    const bodyKey =
      typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (!headerKey || bodyKey) return body;
    return {
      ...body,
      idempotencyKey: headerKey,
    };
  }

  private fileNameFromPublicUploadUrl(url?: string | null): string | null {
    if (!url) return null;
    const value = url.trim();
    if (!value) return null;
    try {
      const parsed = new URL(value, 'http://localhost');
      const base = path.basename(parsed.pathname || '');
      return base || null;
    } catch {
      return null;
    }
  }

  private publicUploadUrl(
    kind: 'video' | 'audio' | 'output',
    fileName: string,
  ): string {
    const configured = this.config
      .get<string>('PUBLIC_UPLOAD_BASE_URL')
      ?.trim();
    const port =
      this.config.get<string>('PORT')?.trim() || process.env.PORT || '3000';
    const base = configured || `http://localhost:${port}/uploads`;
    return `${base.replace(/\/+$/, '')}/${kind}/${encodeURIComponent(fileName)}`;
  }

  private uploadPathFromRef(
    ref: string,
    kind: 'video' | 'audio' | 'output',
  ): string | null {
    const value = ref.trim();
    if (!value) return null;
    const uploadRoot = path.resolve(getUploadRootFromEnv());
    const kindDir = path.resolve(path.join(uploadRoot, kind));

    let candidate: string | null = null;
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      const prefix = `/uploads/${kind}/`;
      if (!url.pathname.startsWith(prefix)) return null;
      candidate = path.join(
        kindDir,
        decodeURIComponent(url.pathname.slice(prefix.length)),
      );
    } else if (value.startsWith('/uploads/')) {
      const prefix = `/uploads/${kind}/`;
      if (!value.startsWith(prefix)) return null;
      candidate = path.join(
        kindDir,
        decodeURIComponent(value.slice(prefix.length)),
      );
    } else if (value.replace(/\\/g, '/').startsWith(`uploads/${kind}/`)) {
      candidate = path.resolve(value);
    } else {
      candidate = path.resolve(value);
    }

    const full = path.resolve(candidate);
    if (
      full.startsWith(kindDir + path.sep) ||
      full === kindDir ||
      path.isAbsolute(value)
    ) {
      return full;
    }
    return null;
  }

  private async readUploadOrRemoteMedia(
    ref: string,
    kind: 'video' | 'audio',
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const localPath = this.uploadPathFromRef(ref, kind);
    if (localPath) {
      if (!existsSync(localPath)) {
        throw new LocalMediaFileNotFoundError(localPath);
      }
      return {
        buffer: await fs.readFile(localPath),
        filename: path.basename(localPath),
        mimeType: guessMimeFromFilename(localPath),
      };
    }

    if (!/^https?:\/\//i.test(ref)) {
      throw new LocalMediaFileNotFoundError(path.resolve(ref));
    }
    const response = await fetch(ref);
    if (!response.ok) {
      throw new Error(`涓嬭浇濯掍綋鏂囦欢澶辫触锛欻TTP ${response.status}`);
    }
    const urlPath = new URL(response.url || ref).pathname;
    const filename =
      path.basename(urlPath) || (kind === 'video' ? 'input.mp4' : 'input.mp3');
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      filename,
      mimeType:
        response.headers.get('content-type') || guessMimeFromFilename(filename),
    };
  }

  private async saveOutputVideoFromUrl(videoUrl: string): Promise<{
    url: string;
    path: string;
    fileName: string;
  }> {
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`涓嬭浇 VideoReTalk 杈撳嚭瑙嗛澶辫触锛欻TTP ${response.status}`);
    }
    const sourceName =
      path.basename(new URL(response.url || videoUrl).pathname) || 'output.mp4';
    const fileName = uploadFileName('output', sourceName, '.mp4');
    const outputPath = path.join(getUploadDir('output'), fileName);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
    return {
      url: this.publicUploadUrl('output', fileName),
      path: outputPath,
      fileName,
    };
  }

  private async persistPreviewVideo(params: {
    buffer: Buffer;
    originalname: string;
  }): Promise<string> {
    const dir = path.resolve(getPreviewVideoSaveDir(this.config));
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(params.originalname || '').toLowerCase() || '.mp4';
    const safeExt = /^\.[a-z0-9]{2,6}$/i.test(ext) ? ext : '.mp4';
    const fileName = `${Date.now()}_${randomUUID().slice(0, 8)}${safeExt}`;
    await fs.writeFile(path.join(dir, fileName), params.buffer);
    return `/api/v1/tools/preview-videos/${encodeURIComponent(fileName)}/stream`;
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

  private async readVideoFromSourceRef(
    sourceRef: string,
  ): Promise<TranscribeMediaInput> {
    const local = this.resolveSavedVideoPathMaybe(sourceRef);
    if (local) {
      try {
        const buffer = await fs.readFile(local);
        return {
          buffer,
          originalname: path.basename(local),
          mimetype: guessMimeFromFilename(local),
          size: buffer.length,
        };
      } catch {
        throw new NotFoundException(
          `鏈壘鍒版湰鍦拌棰戞枃浠讹細${path.basename(local)}`,
        );
      }
    }

    const normalized = normalizeSourceVideoUrl(sourceRef) || sourceRef.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      throw new BadRequestException(
        '瑙嗛璧勬簮闇€濉啓鍙闂殑瑙嗛 URL锛屾垨 VIDEO_SAVE_DIR 涓嬬殑鏂囦欢鍚?',
      );
    }

    if (normalized.toLowerCase().includes('douyin.com')) {
      const dl =
        await this.videoMediaDownload.tryDownloadForTranscription(normalized);
      if (!dl.ok) {
        throw new BadRequestException(
          '鎶栭煶瑙嗛涓嬭浇澶辫触锛岃鍏堢‘璁?Cookie 涓庨摼鎺ユ湁鏁?',
        );
      }
      return dl.media;
    }

    const timeoutMs = Number(
      this.config.get('VIDEO_FETCH_TIMEOUT_MS') ?? 120_000,
    );
    const maxBytes = getLipSyncVideoMaxBytes();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(normalized, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new BadRequestException(`瑙嗛涓嬭浇澶辫触锛欻TTP ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length || buffer.length > maxBytes) {
        throw new BadRequestException('瑙嗛鏂囦欢涓虹┖鎴栬秴杩囦笂浼犱笂闄?');
      }
      const filename = sanitizeFilenameForDisk(
        path.basename(new URL(res.url || normalized).pathname) ||
          'avatar-video.mp4',
      );
      return {
        buffer,
        originalname: filename,
        mimetype: guessMimeFromFilename(filename),
        size: buffer.length,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 鏁板瓧浜哄舰璞★細褰撳墠杩涚▼鏄惁璇诲埌 ARK / Seedream / 鑷缓 URL锛堜笉杩斿洖瀵嗛挜锛夈€?
   * 鎺掗殰锛歝url http://127.0.0.1:8080/api/v1/tools/digital-human-env
   */
  @Public()
  @Get('digital-human-env')
  digitalHumanEnvStatus() {
    const seedreamUrl = this.config.get<string>('SEEDREAM_HTTP_URL')?.trim();
    const seedreamKey = this.config.get<string>('SEEDREAM_API_KEY')?.trim();
    const ark = this.config.get<string>('ARK_API_KEY')?.trim();
    const remote = this.config.get<string>('DIGITAL_HUMAN_API_URL')?.trim();
    return {
      arkConfigured: Boolean(ark),
      seedreamConfigured: Boolean(seedreamUrl && seedreamKey),
      remoteConfigured: Boolean(remote),
      /** 浠呴暱搴︼紝渚夸簬纭鏄惁娉ㄥ叆鎴愬姛锛堝嬁褰撳瘑閽ョ敤锛?*/
    };
  }

  /** 鏄惁宸查厤缃?DY_DOWNLOADER_COOKIE锛堜笉杩斿洖鍏蜂綋鍊硷紝渚涘墠绔睍绀猴級 */
  @Get('dy-downloader-cookie')
  dyDownloaderCookieStatus() {
    const configured = !!this.config
      .get<string>('DY_DOWNLOADER_COOKIE')
      ?.trim();
    return { configured };
  }

  @Get('recent-extractions')
  async listRecentExtractions(
    @Req() req: Request,
    @Query('limit') limitRaw?: string,
  ) {
    const parsedLimit = Number(limitRaw);
    const items = await this.recentExtractions.listByUser(
      req.userId!,
      Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    );
    return { items };
  }

  @Post('recent-extractions')
  async saveRecentExtraction(
    @Req() req: Request,
    @Body() body: RecentExtractionDto,
  ) {
    const item = await this.recentExtractions.upsertForUser(req.userId!, body);
    return { item };
  }

  @Post('douyin-homepage-learn')
  async learnDouyinHomepage(@Body() body: DouyinHomepageLearnDto) {
    if (!body?.homepageUrl?.trim()) {
      throw new BadRequestException('homepageUrl 涓嶈兘涓虹┖');
    }
    return this.douyinBenchmark.learnHomepage(body.homepageUrl);
  }

  /** 绗笁姝ワ細妫€鏌?ASR API 鏄惁鍙揪锛堜笉娑堣€楁ā鍨嬫帹鐞嗭級 */
  @Get('asr-health')
  async asrHealth() {
    return this.transcription.checkHealth();
  }

  /**
   * 鍙ｆ挱杞啓鍏ㄩ摼璺嚜妫€锛氫繚瀛樼洰褰曞彲鍐欍€丗Fmpeg 鍙敤銆丄SR HTTP 鍙揪銆佹姈闊?Cookie 鏄惁閰嶇疆锛堜笉杩斿洖瀵嗛挜锛夈€?
   * 渚涢椤靛湪涓嬭浇鎴愬姛鍚庡睍绀恒€屾娊闊宠建 鈫?ASR銆嶅墠缃潯浠躲€?
   */
  @Get('transcribe-pipeline-health')
  async transcribePipelineHealth() {
    const dir = path.resolve(getVideoSaveDir(this.config));
    let writable = false;
    let dirError: string | undefined;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.access(dir, fsConstants.W_OK);
      writable = true;
    } catch (e) {
      dirError = e instanceof Error ? e.message : String(e);
    }

    const ffmpeg = await this.ffmpegAudio.probeBinary();
    const asr = await this.transcription.checkHealth();
    const dyCookieConfigured = !!this.config
      .get<string>('DY_DOWNLOADER_COOKIE')
      ?.trim();

    return {
      videoSaveDir: { path: dir, writable, error: dirError },
      ffmpeg,
      asr,
      dyCookieConfigured,
    };
  }

  /** 鍙栧洖涓诲悗绔凡淇濆瓨鐨勬煇娆¤浆鍐欙紙涓?POST /transcribe 杩斿洖鐨?transcriptId 瀵瑰簲锛?*/
  @Get('transcripts/:transcriptId')
  getSavedTranscript(@Param('transcriptId') transcriptId: string) {
    const row = this.transcriptStore.get(transcriptId);
    if (!row) {
      throw new NotFoundException(
        '鏈壘鍒拌 transcriptId锛屽彲鑳藉凡杩囨湡鎴栨湇鍔″凡閲嶅惎',
      );
    }
    return row;
  }

  /**
   * 绗洓姝ワ細鎺ユ敹涓婁紶 鈫?ASR HTTP 鈫?褰掍竴鍖?fullText/language/segments 鈫?淇濆瓨 transcript 鈫?杩斿洖
   */
  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: getTranscribeMediaMaxBytes() },
    }),
  )
  async transcribeUpload(
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException(
        '璇蜂笂浼犻煶瑙嗛鏂囦欢锛坢ultipart 瀛楁鍚嶏細file锛?',
      );
    }
    const media: TranscribeMediaInput = {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
    return this.transcribeAfterDownload(media);
  }

  /**
   * 鏍规嵁浣滃搧椤甸摼鎺モ€?涓嬭浇瀛楄妭 鈫?ASR锛堜笌 transcribe 鍚屼竴濂楀綊涓€鍖栦笌淇濆瓨锛夈€?
   */
  /**
   * 鎶栭煶涓撶敤娴佹按绾匡細dy-downloader 鎷夊彇濯掍綋 鈫?ASR 鈫?
   * 鎷垮埌鍏ㄦ枃鍚庡啀璋冪敤鏀瑰啓寤鸿锛堜笌浠诲姟鍐?`suggestRewrite` 鍚屾簮锛夛紝渚夸簬鐢ㄦ埛鐩存帴杩涘叆銆屾敼鍐欍€嶅績鏅恒€?
   */
  @Post('douyin-transcribe-rewrite')
  async douyinTranscribeRewrite(@Body() body: DouyinTranscribeRewriteDto) {
    if (!body?.sourceVideoUrl?.trim()) {
      throw new BadRequestException('sourceVideoUrl 涓嶈兘涓虹┖');
    }
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '鏃犳硶璇嗗埆鏈夋晥鐨勮棰戦摼鎺ワ紝璇风矘璐村惈 v.douyin.com 鐭摼鎴栦綔鍝侀〉閾炬帴鐨勫垎浜枃妗堛€?',
      );
    }
    let host: string;
    try {
      host = new URL(normalized).hostname.toLowerCase();
    } catch {
      throw new BadRequestException('URL 鏍煎紡鏃犳晥');
    }
    if (!host.includes('douyin.com')) {
      throw new BadRequestException(
        '鏈帴鍙ｄ粎鏀寔鎶栭煶浣滃搧椤?/ 鍒嗕韩閾炬帴锛坉ouyin.com锛?',
      );
    }

    const dl =
      await this.videoMediaDownload.tryDownloadForTranscription(normalized);
    if (!dl.ok) {
      if (dl.failure === 'douyin_no_ytdlp') {
        throw new BadRequestException(
          '鏈壘鍒板彲鐢ㄧ殑鎶栭煶涓嬭浇鑳藉姏锛氳閰嶇疆 DY_DOWNLOADER_COOKIE锛堜粨搴撳唴 backend/DY-DOWNLOADER锛宯pm 鍖?dy-downloader锛夈€傝瑙?backend/.env.example銆?',
        );
      }
      throw new BadRequestException(
        '鎶栭煶鎷夊彇澶辫触锛歞y-downloader 鏈緱鍒板彲鐢ㄩ煶瑙嗛銆傚彲妫€鏌?DY_DOWNLOADER_COOKIE 鏄惁鏈夋晥锛屽苟鏌ョ湅鍚庣鏃ュ織銆?',
      );
    }

    const transcribeResult = await this.transcribeAfterDownload(dl.media);
    const style = body.rewriteStyle ?? 'conservative';
    const rewriteSuggestion = await this.rewriteAi.suggest({
      source: transcribeResult.fullText,
      style,
      sourceVideoUrl: normalized,
    });

    return {
      ...transcribeResult,
      rewriteSuggestion,
      rewriteStyle: style,
    };
  }

  @Post('transcribe-url')
  async transcribeFromUrl(@Body() body: SourceVideoUrlDto) {
    if (!body?.sourceVideoUrl?.trim()) {
      throw new BadRequestException('sourceVideoUrl 涓嶈兘涓虹┖');
    }
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '鏃犳硶璇嗗埆鏈夋晥鐨勮棰戦摼鎺ワ紝璇风矘璐村惈 v.douyin.com 鐭摼鎴栦綔鍝侀〉閾炬帴鐨勫垎浜枃妗堛€?',
      );
    }
    const dl =
      await this.videoMediaDownload.tryDownloadForTranscription(normalized);
    if (!dl.ok) {
      const isDouyin = normalized.toLowerCase().includes('douyin.com');
      if (isDouyin && dl.failure === 'douyin_no_ytdlp') {
        throw new BadRequestException(
          '鎶栭煶閾炬帴闇€瑕侀厤缃?DY_DOWNLOADER_COOKIE锛坉y-downloader锛夈€傝 backend/.env.example銆?',
        );
      }
      if (isDouyin && dl.failure === 'douyin_ytdlp_failed') {
        throw new BadRequestException(
          '鎶栭煶锛氭湭涓嬭浇鍒板彲鐢ㄩ煶瑙嗛銆傚彲妫€鏌?DY_DOWNLOADER_COOKIE 鏄惁鏈夋晥锛涜瑙佸悗绔棩蹇椼€?',
        );
      }
      throw new BadRequestException(
        '鏈兘涓嬭浇鍒板彲鐢ㄩ煶瑙嗛锛氬彲閰嶇疆 YTDLP_BIN锛屾垨浣跨敤 yt-dlp-master锛圥YTHON_BIN + pip install -e锛夛紱闈炴姈闊宠繕鍙緷璧栭〉闈㈢洿閾捐В鏋愩€備篃鍙娇鐢ㄣ€屾湰鍦颁笂浼犮€嶈浆鍐欍€?',
      );
    }
    return this.transcribeAfterDownload(dl.media);
  }

  @Post('transcript-preview')
  async previewTranscript(@Body() body: SourceVideoUrlDto) {
    if (!body?.sourceVideoUrl?.trim()) {
      throw new BadRequestException('sourceVideoUrl 涓嶈兘涓虹┖');
    }
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '鏃犳硶璇嗗埆鏈夋晥鐨勮棰戦摼鎺ワ紝璇风矘璐村惈 v.douyin.com 鐭摼鎴栦綔鍝侀〉閾炬帴鐨勫垎浜枃妗堛€?',
      );
    }
    return this.transcription.transcribe({
      taskId: 'preview',
      sourceVideoUrl: normalized,
    });
  }

  /**
   * 鎶撳彇瑙嗛椤?HTML 骞惰В鏋?Open Graph 绛夊厓淇℃伅锛堜笉璋冪敤 AI锛涘彲鑳借骞冲彴鍙嶇埇闄愬埗锛?
   */
  @Post('optimize-oral-script')
  async optimizeOralScript(@Body() body: OptimizeOralScriptDto) {
    const sourceText = body?.sourceText?.trim() ?? '';
    if (!sourceText) {
      throw new BadRequestException('sourceText 涓嶈兘涓虹┖');
    }
    return this.rewriteAi.optimizeHookedOralScript({
      source: sourceText,
      sourceVideoUrl: body?.sourceVideoUrl?.trim(),
    });
  }

  @Post('video-meta')
  async fetchVideoMeta(@Body() body: SourceVideoUrlDto) {
    if (!body?.sourceVideoUrl?.trim()) {
      throw new BadRequestException('sourceVideoUrl 涓嶈兘涓虹┖');
    }
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '鏃犳硶璇嗗埆鏈夋晥鐨勮棰戦摼鎺ワ紝璇风矘璐村惈 v.douyin.com 鐭摼鎴栦綔鍝侀〉閾炬帴鐨勫垎浜枃妗堛€?',
      );
    }
    return this.videoMeta.fetchMeta(normalized);
  }

  /**
   * 涓嬭浇婧愯棰戝苟淇濆瓨鍒伴」鐩唴璧勬簮鐩綍锛堥粯璁?backend/data/download-video锛涜 VIDEO_SAVE_DIR锛夛紝
   * 骞朵互鍚屼竴浠藉獟浣撹皟鐢?ASR锛屼緵棣栭〉銆屽彛鎾枃妗堛€嶄娇鐢ㄣ€?
   * 鎶栭煶渚т粎 dy-downloader + DY_DOWNLOADER_COOKIE銆?
   */
  @Post('source-video-file')
  async downloadSourceVideoFile(
    @Req() req: Request,
    @Body() body: SourceVideoFileDto,
  ): Promise<{
    ok: true;
    savedPath: string;
    fileName: string;
    message: string;
    transcript: TranscribeResultDto | null;
    transcriptionError?: string;
  }> {
    if (!body?.sourceVideoUrl?.trim()) {
      throw new BadRequestException('sourceVideoUrl 涓嶈兘涓虹┖');
    }
    const shouldTranscribe = body.transcribe !== false;
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '鏃犳硶璇嗗埆鏈夋晥鐨勮棰戦摼鎺ワ紝璇风矘璐村惈 v.douyin.com 鐭摼鎴栦綔鍝侀〉閾炬帴鐨勫垎浜枃妗堛€?',
      );
    }
    const dl =
      await this.videoMediaDownload.tryDownloadForTranscription(normalized);
    if (!dl.ok) {
      if (dl.failure === 'douyin_no_ytdlp') {
        throw new BadRequestException(
          '鏃犳硶涓嬭浇婧愯棰戯紙鎶栭煶锛夛細璇烽厤缃?DY_DOWNLOADER_COOKIE銆傝瑙?backend/.env.example銆?',
        );
      }
      if (dl.failure === 'douyin_ytdlp_failed') {
        throw new BadRequestException(
          '婧愯棰戜笅杞藉け璐ワ紙鎶栭煶锛夈€傚彲妫€鏌?DY_DOWNLOADER_COOKIE 鏄惁鏈夋晥鍙婂悗绔棩蹇椼€?',
        );
      }
      throw new BadRequestException(
        '鏈兘浠庤閾炬帴涓嬭浇婧愯棰戯紱闈炴姈闊冲彲閰嶇疆 yt-dlp锛屾姈闊宠閰嶇疆 DY_DOWNLOADER_COOKIE銆?',
      );
    }
    const { buffer, originalname } = dl.media;
    const dir = getVideoSaveDir(this.config);
    const safe = sanitizeFilenameForDisk(originalname);
    const filename = `${Date.now()}_${safe}`;
    const savedPath = path.join(dir, filename);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(savedPath, buffer);
      await this.savedVideos.upsertForUser(req.userId!, {
        fileName: filename,
        fileSize: buffer.length,
        mimeType: guessMimeFromFilename(filename),
        sourceVideoUrl: normalized,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new InternalServerErrorException(
        `保存视频失败（请确认目录可写且权限充足）：${msg}`,
      );
    }

    let transcript: TranscribeResultDto | null = null;
    let transcriptionError: string | undefined;
    if (shouldTranscribe) {
      try {
        transcript = await this.transcribeFromDiskWithRetry(savedPath);
      } catch (e: unknown) {
        transcriptionError = toSingleErrorMessage(e);
      }
    }

    return {
      ok: true,
      savedPath,
      fileName: filename,
      message: shouldTranscribe
        ? `视频已保存到：${savedPath}`
        : `视频已保存到：${savedPath}（未转写；可调用 transcribe-saved-video）`,
      transcript,
      transcriptionError,
    };
  }

  /**
   * 鍒楀嚭淇濆瓨鐩綍涓殑瑙嗛鏂囦欢锛圴IDEO_SAVE_DIR / 榛樿 backend/data/download-video锛夛紝渚涖€屼粠鏈湴鏂囦欢杞啓鍙ｆ挱銆嶉€夋嫨銆?
   */
  @Get('saved-videos')
  async listSavedVideos(@Req() req: Request) {
    const rows = await this.savedVideos.listByUser(req.userId!, 200);
    const files: { name: string; size: number; mtime: string }[] = [];

    for (const row of rows) {
      const full = this.resolveSavedVideoPathOrThrow(this.config, row.fileName);
      try {
        const stat = await fs.stat(full);
        if (!stat.isFile()) continue;
        files.push({
          name: row.fileName,
          size: stat.size,
          mtime: new Date(stat.mtimeMs).toISOString(),
        });
      } catch {
        /* skip deleted files */
      }
    }

    return { files };
  }

  /**
   * 瀵瑰凡淇濆瓨鍒版湰鍦扮洰褰曠殑瑙嗛鏂囦欢鍋?FFmpeg 鎶介煶杞?+ ASR锛岃繑鍥炲彛鎾叏鏂囷紙涓?source-video-file 杞啓鐜妭涓€鑷达級銆?
   */
  @Get('saved-videos/:fileName/stream')
  async streamSavedVideo(
    @Req() req: Request,
    @Param('fileName') fileName: string,
    @Headers('range') rangeHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const safeFileName = assertSafeSavedBasename(fileName);
    await this.savedVideos.assertOwnedByUser(req.userId!, safeFileName);
    const full = this.resolveSavedVideoPathOrThrow(this.config, safeFileName);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(full);
    } catch {
      throw new NotFoundException(`鏈壘鍒版枃浠讹細${path.basename(full)}`);
    }
    if (!stat.isFile()) {
      throw new NotFoundException(`未找到文件：${path.basename(full)}`);
    }

    const size = stat.size;
    res.setHeader('Content-Type', guessMimeFromFilename(full));
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Accept-Ranges', 'bytes');

    if (size <= 0) {
      res.setHeader('Content-Length', '0');
      return new StreamableFile(createReadStream(full));
    }

    const range = this.parseHttpRange(rangeHeader, size);
    if (rangeHeader && !range) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${size}`);
      res.setHeader('Content-Length', '0');
      return new StreamableFile(Readable.from([]));
    }

    if (range) {
      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${size}`,
      );
      res.setHeader('Content-Length', String(range.end - range.start + 1));
      return new StreamableFile(
        createReadStream(full, { start: range.start, end: range.end }),
      );
    }

    res.setHeader('Content-Length', String(size));
    return new StreamableFile(createReadStream(full));
  }

  @Get('preview-videos/:fileName/stream')
  async streamPreviewVideo(
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const full = this.resolvePreviewVideoPathOrThrow(fileName);
    try {
      await fs.access(full);
    } catch {
      throw new NotFoundException(`鏈壘鍒伴瑙堟枃浠讹細${path.basename(full)}`);
    }
    res.setHeader('Content-Type', guessMimeFromFilename(full));
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(createReadStream(full));
  }

  @Public()
  @Get('lip-sync-public/:kind/:fileName/stream')
  async streamLipSyncPublicMedia(
    @Param('kind') kind: string,
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { full } = this.resolveLipSyncPublicMediaPathOrThrow(kind, fileName);
    try {
      await fs.access(full);
    } catch {
      throw new NotFoundException(
        `lip-sync public media not found: ${path.basename(full)}`,
      );
    }
    res.setHeader('Content-Type', guessMimeFromFilename(full));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return new StreamableFile(createReadStream(full));
  }

  @Public()
  @Get('preview-audios/:fileName/stream')
  async streamPreviewAudio(
    @Param('fileName') fileName: string,
    @Query('token') token: string | undefined,
    @Query('expires') expires: string | undefined,
    @Headers('range') rangeHeader: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const safeFileName = assertSafeSavedBasename(fileName);
    await this.voicePreviewTasks.assertSignedAudioFileAccess(
      safeFileName,
      token,
      expires,
    );

    const full = this.resolvePreviewAudioPathOrThrow(safeFileName);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(full);
    } catch {
      throw new NotFoundException(
        `preview audio not found: ${path.basename(full)}`,
      );
    }
    if (!stat.isFile()) {
      throw new NotFoundException(
        `preview audio not found: ${path.basename(full)}`,
      );
    }

    const size = stat.size;
    res.setHeader('Content-Type', guessMimeFromFilename(full));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Accept-Ranges', 'bytes');

    if (size <= 0) {
      res.setHeader('Content-Length', '0');
      return new StreamableFile(createReadStream(full));
    }

    const range = this.parseHttpRange(rangeHeader, size);
    if (rangeHeader && !range) {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${size}`);
      res.setHeader('Content-Length', '0');
      return new StreamableFile(Readable.from([]));
    }

    if (range) {
      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${size}`,
      );
      res.setHeader('Content-Length', String(range.end - range.start + 1));
      return new StreamableFile(
        createReadStream(full, { start: range.start, end: range.end }),
      );
    }

    res.setHeader('Content-Length', String(size));
    return new StreamableFile(createReadStream(full));
  }

  private parseHttpRange(
    rangeHeader: string | undefined,
    size: number,
  ): { start: number; end: number } | null {
    if (!rangeHeader) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) return null;

    const [, startRaw, endRaw] = match;
    if (!startRaw && !endRaw) return null;

    let start: number;
    let end: number;
    if (!startRaw) {
      const suffixLength = Number(endRaw);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
      start = Math.max(0, size - suffixLength);
      end = size - 1;
    } else {
      start = Number(startRaw);
      end = endRaw ? Number(endRaw) : size - 1;
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      start >= size
    ) {
      return null;
    }

    return { start, end: Math.min(end, size - 1) };
  }

  @Post('transcribe-saved-video')
  async transcribeSavedVideo(
    @Req() req: Request,
    @Body() body: { fileName?: string },
  ): Promise<{
    transcript: TranscribeResultDto | null;
    transcriptionError?: string;
  }> {
    if (!body?.fileName?.trim()) {
      throw new BadRequestException(
        'fileName 涓嶈兘涓虹┖锛堜繚瀛樼洰褰曚笅鐨勬枃浠跺悕锛屽惈鎵╁睍鍚嶏級',
      );
    }
    const safeFileName = assertSafeSavedBasename(body.fileName);
    await this.savedVideos.assertOwnedByUser(req.userId!, safeFileName);
    const full = this.resolveSavedVideoPathOrThrow(this.config, safeFileName);
    try {
      await fs.access(full);
    } catch {
      throw new NotFoundException(`鏈壘鍒版枃浠讹細${path.basename(full)}`);
    }
    try {
      const transcript = await this.transcribeFromDiskWithRetry(full);
      return { transcript };
    } catch (e: unknown) {
      return {
        transcript: null,
        transcriptionError: toSingleErrorMessage(e),
      };
    }
  }
}
