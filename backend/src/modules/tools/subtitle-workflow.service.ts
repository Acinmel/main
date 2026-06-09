import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream, existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { normalizeSourceVideoUrl } from '../../common/douyin-share-url.util';
import { resolveConfiguredDir } from '../../common/resource-paths.util';
import { assertUrlSafeForServerFetch } from '../../common/url-safety.util';
import {
  AliLipSyncService,
  type AliLipSyncProviderState,
} from '../../integrations/ai/ali-lip-sync.service';
import {
  SpeechAiService,
  type VoiceTuningOptions,
} from '../../integrations/ai/speech-ai.service';
import { TranscriptionAiService } from '../../integrations/ai/transcription-ai.service';
import type { TranscriptSegmentDto } from '../../integrations/transcription/transcript.types';
import {
  FfmpegAudioService,
  type MediaProbeSummary,
  type VideoFormatContract,
  type TranscribeMediaInput,
  type SilenceSegment,
  type VideoCutRange,
} from '../../integrations/media/ffmpeg-audio.service';
import { VideoMediaDownloadService } from '../../integrations/video/video-media-download.service';
import { ResourcesService } from '../resources/resources.service';
import type { SubtitleTemplateResourceDto } from '../resources/resources.types';
import {
  CUT_MODE_CONFIGS,
  type CreateLipSyncTaskBody,
  type CutDetectionConfig,
  type CutMode,
  type CutPointDto,
  type CutSummaryDto,
  type DetectCutPointsBody,
  type FinalRenderResult,
  type HighlightRangeDto,
  type RenderFinalBody,
  type RenderSubtitleDto,
  type SubtitleVisualStyleDto,
  type VisualOverlayAnchor,
  type VisualOverlayLayoutDto,
} from './video-project-render.types';
import { normalizeVoiceTuning } from './voice-tuning.util';
import {
  normalizeScriptHighlights,
  projectHighlightsToSubtitle,
  type ScriptHighlightRange,
  type SubtitleHighlightRange,
} from './highlight-range-utils';
import { TitleAssetsService } from './title-assets.service';

type TimelineSource = 'asr-fallback' | 'local-estimate';
type TtsMode = 'provider' | 'mock';
type OssClient = {
  put: (...args: unknown[]) => Promise<unknown>;
  signatureUrl: (name: string, options?: Record<string, unknown>) => string;
};

const ASS_CANVAS_WIDTH = 720;
const ASS_CANVAS_HEIGHT = 1280;

type NormalizedVisualLayout = {
  xPct: number;
  yPct: number;
  anchor: VisualOverlayAnchor;
  safeAreaPct: number;
};

export interface SubtitleCueDto {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  lines: string[];
}

export interface SubtitleJsonDto {
  version: 1;
  language: string;
  durationMs: number;
  generatedAt: string;
  source: {
    script: string;
    avatarResourceId: string;
    voiceResourceId: string;
    subtitleTemplateId: string;
  };
  template: {
    id: string;
    name: string;
    styleJson: Record<string, unknown>;
  };
  cues: SubtitleCueDto[];
}

type DraftMeta = {
  id: string;
  userId: string;
  createdAt: string;
  avatarResourceId: string;
  voiceResourceId: string;
  subtitleTemplateId: string;
  script: string;
  previewSeconds: number;
  ttsMode: TtsMode;
  timelineSource: TimelineSource;
  avatarLabel: string;
  voiceLabel: string;
  subtitleJson: SubtitleJsonDto;
  sourceVideoFileName?: string;
  sourceVideoMimeType?: string;
  speechAudioFileName?: string;
  speechAudioMimeType?: string;
  subtitlesEnabled?: boolean;
  muxedVideoFileName: string;
  subtitleAssFileName: string;
  previewFileName: string;
  finalFileName?: string;
};

type LipSyncFormatContractTrace = {
  renderMode: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
  source: VideoFormatContract | null;
  preparedInput: VideoFormatContract | null;
  providerOutput: VideoFormatContract | null;
  finalOutput: VideoFormatContract | null;
  restored: boolean;
};

type LipSyncMediaPreflightTrace = {
  sourceVideo: Record<string, unknown>;
  preparedVideo: Record<string, unknown>;
  audioInput: Record<string, unknown>;
  normalizedAudio: {
    converted: boolean;
    reason: string | null;
    mimeType: string;
    fileName: string;
  };
  limits: Record<string, unknown>;
};

const NO_SUBTITLE_TEMPLATE: SubtitleTemplateResourceDto = {
  id: 'no-subtitle',
  name: '无字幕',
  owner: 'recommended',
  recommended: true,
  editable: false,
  baseTemplateId: null,
  coverUrl: '',
  previewCoverUrl: '',
  styleJson: {},
  styleConfig: {},
  createdAt: '',
  updatedAt: '',
};

function nowIso(): string {
  return new Date().toISOString();
}

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

function getUploadRoot(config: ConfigService): string {
  return path.resolve(config.get<string>('UPLOAD_DIR')?.trim() || 'uploads');
}

function getUploadOutputDir(config: ConfigService): string {
  return path.join(getUploadRoot(config), 'output');
}

function sanitizeFilenameForDisk(name: string, fallback = 'video.mp4'): string {
  const base = path
    .basename(name)
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim();
  return base || fallback;
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
    '.json': 'application/json',
    '.ass': 'text/plain; charset=utf-8',
  };
  return map[ext] ?? 'application/octet-stream';
}

@Injectable()
export class SubtitleWorkflowService {
  private readonly logger = new Logger(SubtitleWorkflowService.name);
  private renderOutputOssClient: OssClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly resources: ResourcesService,
    private readonly speechAi: SpeechAiService,
    private readonly transcription: TranscriptionAiService,
    private readonly ffmpegAudio: FfmpegAudioService,
    private readonly aliLipSync: AliLipSyncService,
    private readonly videoMediaDownload: VideoMediaDownloadService,
    private readonly titleAssets: TitleAssetsService,
  ) {}

  async detectCutPoints(
    userId: string,
    body: DetectCutPointsBody,
  ): Promise<{ cutPoints: CutPointDto[]; summary: CutSummaryDto }> {
    const mode = this.normalizeCutMode(body.mode);
    const cutConfig = this.resolveCutConfig(mode, body.config);
    await fs.mkdir(this.draftRootDir(), { recursive: true });
    const tmpDir = await fs.mkdtemp(
      path.join(this.draftRootDir(), 'cut-detect-'),
    );
    try {
      const sourceVideo = await this.resolveRenderVideoSource(
        userId,
        body.avatarResourceId,
        body.sourceVideoUrl,
      );
      const sourcePath = path.join(
        tmpDir,
        this.draftMediaFileName(
          'source-video',
          sourceVideo.originalname,
          '.mp4',
        ),
      );
      await fs.writeFile(sourcePath, sourceVideo.buffer);
      const [durationSeconds, silences] = await Promise.all([
        this.ffmpegAudio.probeFileDurationSeconds(sourcePath),
        this.ffmpegAudio.detectSilences({
          inputPath: sourcePath,
          noiseDb: cutConfig.silenceThreshold,
          minSilenceDuration: cutConfig.minSilenceDuration,
        }),
      ]);
      const originalDuration = durationSeconds ?? 0;
      const cutPoints = this.buildCutPointsFromSilences(
        silences,
        cutConfig,
        originalDuration,
      );
      return {
        cutPoints,
        summary: this.summarizeCutPoints(cutPoints, originalDuration),
      };
    } finally {
      await fs
        .rm(tmpDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  async createLipSyncAsset(
    userId: string,
    body: CreateLipSyncTaskBody,
    opts: {
      onProgress?: (progress: number) => void;
      onProviderEvent?: (state: AliLipSyncProviderState) => void;
    } = {},
  ): Promise<{
    videoUrl: string;
    duration: number;
    hint: string;
    metadataJson?: Record<string, unknown>;
  }> {
    const avatarResourceId =
      body.avatarResourceId?.trim() || body.digitalHumanId?.trim() || '';
    if (!avatarResourceId) {
      throw new BadRequestException('avatarResourceId/digitalHumanId 不能为空');
    }
    const report = (progress: number) => opts.onProgress?.(progress);
    const effectiveRenderMode = body.renderMode ?? 'preserveSourceAspect';
    report(8);

    const avatar = await this.resources.getAvatar(userId, avatarResourceId);
    if (!avatar.originalVideoUrl?.trim()) {
      throw new BadRequestException('当前数字人视频未绑定可用源视频');
    }
    const sourceVideo = await this.readVideoFromSourceRef(
      avatar.originalVideoUrl,
    );
    this.aliLipSync.ensureConfigured();

    const voiceResourceId =
      body.voiceResourceId?.trim() || body.inputVoiceId?.trim() || '';
    const hasCustomAudio = Boolean(
      body.inputAudioPath?.trim() || body.inputAudioUrl?.trim(),
    );
    if (!hasCustomAudio && !voiceResourceId) {
      throw new BadRequestException(
        'voiceResourceId/inputVoiceId 或 inputAudioPath/inputAudioUrl 至少提供一项',
      );
    }

    const speechResolved = hasCustomAudio
      ? await this.readAudioFromSource({
          inputAudioPath: body.inputAudioPath,
          inputAudioUrl: body.inputAudioUrl,
        })
      : await (async () => {
          if (!voiceResourceId) {
            throw new BadRequestException(
              'voiceResourceId/inputVoiceId 不能为空',
            );
          }
          const script = this.sanitizeUserScript(body.script?.trim() || '');
          if (!script) {
            throw new BadRequestException(
              '未提供 inputAudio 时，script 不能为空',
            );
          }
          const voice = await this.resources.getVoice(userId, voiceResourceId);
          return this.buildSpeechAudio(
            script,
            {
              id: voice.id,
              name: voice.name,
              cloneStatus: voice.cloneStatus,
              canUseForRender: voice.canUseForRender,
              renderUnavailableReason: voice.renderUnavailableReason,
              provider: voice.provider,
              providerVoice: voice.providerVoice,
              providerModel: voice.providerModel,
              audioUrl: voice.audioUrl,
            },
            normalizeVoiceTuning(body),
          );
        })();

    const draftId = randomUUID();
    const draftDir = this.draftDir(draftId);
    await fs.mkdir(draftDir, { recursive: true });
    const sourceVideoPath = path.join(
      draftDir,
      this.draftMediaFileName(
        'lipsync-source',
        sourceVideo.originalname,
        '.mp4',
      ),
    );
    const speechAudioPath = path.join(
      draftDir,
      this.draftMediaFileName(
        'lipsync-audio',
        speechResolved.originalname,
        this.audioExtensionForMime(speechResolved.mimeType),
      ),
    );
    await Promise.all([
      fs.writeFile(sourceVideoPath, sourceVideo.buffer),
      fs.writeFile(speechAudioPath, speechResolved.buffer),
    ]);
    report(24);

    const durationPlan = await this.resolveFinalDurationPlan({
      sourceVideoPath,
      speechAudioPath,
      subtitleJson: {
        version: 1,
        language: 'zh-CN',
        durationMs: 0,
        generatedAt: nowIso(),
        source: {
          script: '',
          avatarResourceId,
          voiceResourceId,
          subtitleTemplateId: 'no-subtitle',
        },
        template: { id: 'no-subtitle', name: 'no-subtitle', styleJson: {} },
        cues: [],
      },
    });
    const aliSourceVideoPath = path.join(
      draftDir,
      `ali-lipsync-source_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`,
    );
    await this.ffmpegAudio.prepareVideoForAliLipSync({
      inputVideoPath: sourceVideoPath,
      outputVideoPath: aliSourceVideoPath,
      targetSeconds: durationPlan.targetSeconds,
      renderMode: effectiveRenderMode,
    });
    const {
      audioPath: providerAudioPath,
      audioMimeType: providerAudioMimeType,
      audioFileName: providerAudioFileName,
      preflightTrace,
    } = await this.runLipSyncMediaPreflight({
      sourceVideoPath,
      preparedVideoPath: aliSourceVideoPath,
      speechAudioPath,
      speechAudioMimeType: speechResolved.mimeType,
      speechAudioOriginalName: speechResolved.originalname,
      draftDir,
      renderMode: effectiveRenderMode,
    });
    const [videoBuffer, audioBuffer] = await Promise.all([
      fs.readFile(aliSourceVideoPath),
      fs.readFile(providerAudioPath),
    ]);
    const [sourceContract, preparedContract] = await Promise.all([
      this.ffmpegAudio.probeVideoFormatContract(sourceVideoPath),
      this.ffmpegAudio.probeVideoFormatContract(aliSourceVideoPath),
    ]);
    const providerInputMeta: Record<string, unknown> = {
      avatarResourceId,
      audioAssetId: body.audioAssetId?.trim() || null,
      voiceResourceId: voiceResourceId || null,
      renderMode: effectiveRenderMode,
    };
    report(52);

    const lipSyncResult = await this.aliLipSync.submitLipSync({
      video: {
        buffer: videoBuffer,
        filename: path.basename(aliSourceVideoPath),
        mimeType: 'video/mp4',
      },
      audio: {
        buffer: audioBuffer,
        filename: providerAudioFileName,
        mimeType: providerAudioMimeType,
      },
      videoExtension: durationPlan.shouldExtendVideo ? true : undefined,
      onProviderEvent: (state) =>
        opts.onProviderEvent?.({
          ...state,
          inputMeta: state.inputMeta ?? providerInputMeta,
          sourceContract:
            state.sourceContract ??
            this.formatContractLogSummary(sourceContract),
          preparedContract:
            state.preparedContract ??
            this.formatContractLogSummary(preparedContract),
          audioContract: state.audioContract ?? preflightTrace.audioInput,
        }),
    });
    if (!lipSyncResult.videoUrl?.trim()) {
      throw new BadRequestException('VideoReTalk 未返回成片地址');
    }
    const providerVideoPath = await this.persistResultVideoToDraft(
      lipSyncResult.videoUrl,
      draftDir,
    );
    const { finalPath: workingVideoPath, trace: contractTrace } =
      await this.applyLipSyncSourceFormatContract({
        sourceVideoPath,
        preparedVideoPath: aliSourceVideoPath,
        providerVideoPath,
        draftDir,
        renderMode: effectiveRenderMode,
        context: 'createLipSyncAsset',
      });
    report(78);

    const finalFileName = this.outputFileName('lipsync-final', '.mp4');
    const finalPath = path.join(this.finalOutputDir(), finalFileName);
    await fs.mkdir(this.finalOutputDir(), { recursive: true });
    await fs.copyFile(workingVideoPath, finalPath);
    const duration =
      (await this.ffmpegAudio.probeFileDurationSeconds(finalPath)) ?? 0;
    const published = await this.publishRenderOutput(finalPath, finalFileName);
    report(100);
    return {
      videoUrl: published.url,
      duration: Number(duration.toFixed(2)),
      metadataJson: this.buildLipSyncAssetMetadata(
        contractTrace,
        preflightTrace,
      ),
      hint:
        published.storage === 'oss'
          ? '口型同步已完成并上传 OSS'
          : '口型同步已完成并保存本地 output 目录',
    };
  }

  async recoverLipSyncAsset(
    userId: string,
    params: {
      avatarResourceId: string;
      providerTaskId: string;
      recoverUntil?: string | null;
      renderMode?: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
    },
    opts: {
      onProgress?: (progress: number) => void;
      onProviderEvent?: (state: AliLipSyncProviderState) => void;
    } = {},
  ): Promise<{
    videoUrl: string;
    duration: number;
    hint: string;
    metadataJson?: Record<string, unknown>;
    providerState?: AliLipSyncProviderState;
  }> {
    const avatarResourceId = params.avatarResourceId?.trim();
    const providerTaskId = params.providerTaskId?.trim();
    if (!avatarResourceId) {
      throw new BadRequestException('avatarResourceId 涓嶈兘涓虹┖');
    }
    if (!providerTaskId) {
      throw new BadRequestException('providerTaskId 涓嶈兘涓虹┖');
    }

    const report = (progress: number) => opts.onProgress?.(progress);
    const effectiveRenderMode = params.renderMode ?? 'preserveSourceAspect';
    report(8);

    const avatar = await this.resources.getAvatar(userId, avatarResourceId);
    if (!avatar.originalVideoUrl?.trim()) {
      throw new BadRequestException(
        'Current avatar is missing original source video.',
      );
    }
    this.aliLipSync.ensureConfigured();
    const sourceVideo = await this.readVideoFromSourceRef(
      avatar.originalVideoUrl,
    );

    const draftId = randomUUID();
    const draftDir = this.draftDir(draftId);
    await fs.mkdir(draftDir, { recursive: true });
    const sourceVideoPath = path.join(
      draftDir,
      this.draftMediaFileName(
        'lipsync-recover-source',
        sourceVideo.originalname,
        '.mp4',
      ),
    );
    await fs.writeFile(sourceVideoPath, sourceVideo.buffer);
    report(26);

    const sourceContract =
      await this.ffmpegAudio.probeVideoFormatContract(sourceVideoPath);
    const recoverResult = await this.aliLipSync.recoverAliyunTask({
      taskId: providerTaskId,
      recoverUntil: params.recoverUntil ?? null,
      onProviderEvent: (state) =>
        opts.onProviderEvent?.({
          ...state,
          inputMeta: state.inputMeta ?? {
            avatarResourceId,
            renderMode: effectiveRenderMode,
          },
          sourceContract:
            state.sourceContract ??
            this.formatContractLogSummary(sourceContract),
        }),
    });
    if (!recoverResult.videoUrl?.trim()) {
      throw new BadRequestException(
        'VideoReTalk 鎭㈠鎴愬姛浣嗘湭杩斿洖瑙嗛鍦板潃',
      );
    }
    report(62);

    const providerVideoPath = await this.persistResultVideoToDraft(
      recoverResult.videoUrl,
      draftDir,
    );
    const { finalPath, trace } = await this.applyLipSyncSourceFormatContract({
      sourceVideoPath,
      preparedVideoPath: sourceVideoPath,
      providerVideoPath,
      draftDir,
      renderMode: effectiveRenderMode,
      context: 'recoverLipSyncAsset',
    });
    report(84);

    const finalFileName = this.outputFileName('lipsync-final', '.mp4');
    const finalPathAbs = path.join(this.finalOutputDir(), finalFileName);
    await fs.mkdir(this.finalOutputDir(), { recursive: true });
    await fs.copyFile(finalPath, finalPathAbs);
    const duration =
      (await this.ffmpegAudio.probeFileDurationSeconds(finalPathAbs)) ?? 0;
    const published = await this.publishRenderOutput(
      finalPathAbs,
      finalFileName,
    );
    report(100);
    return {
      videoUrl: published.url,
      duration: Number(duration.toFixed(2)),
      metadataJson: this.buildLipSyncAssetMetadata(trace),
      providerState: recoverResult.providerState,
      hint:
        published.storage === 'oss'
          ? '鍙ｅ瀷鎭㈠宸插畬鎴愬苟涓婁紶 OSS'
          : '鍙ｅ瀷鎭㈠宸插畬鎴愬苟淇濆瓨鏈湴 output 鐩綍',
    };
  }

  async renderFinalSmartClip(
    userId: string,
    body: RenderFinalBody,
    opts: { onProgress?: (progress: number) => void } = {},
  ): Promise<FinalRenderResult> {
    const script = this.sanitizeUserScript(
      body.script?.trim() ||
        body.subtitles
          ?.map((subtitle) => subtitle.text?.trim())
          .filter(Boolean)
          .join('\n') ||
        '',
    );
    if (script.length < 2) {
      throw new BadRequestException('口播文案不能为空');
    }
    if (!body.avatarResourceId?.trim()) {
      throw new BadRequestException('请先选择数字人视频');
    }
    if (!body.voiceResourceId?.trim()) {
      throw new BadRequestException('请先选择配音音色');
    }

    const burnSubtitles = body.renderOptions?.burnSubtitles !== false;
    if (burnSubtitles && !body.subtitleTemplateId?.trim()) {
      throw new BadRequestException('请先选择字幕模板');
    }

    const report = (progress: number) => opts.onProgress?.(progress);
    report(8);

    const [avatar, voice, subtitleTemplate] = await Promise.all([
      this.resources.getAvatar(userId, body.avatarResourceId.trim()),
      this.resources.getVoice(userId, body.voiceResourceId.trim()),
      burnSubtitles && body.subtitleTemplateId?.trim()
        ? this.resources.getSubtitleTemplate(
            userId,
            body.subtitleTemplateId.trim(),
          )
        : Promise.resolve(NO_SUBTITLE_TEMPLATE),
    ]);
    const effectiveSubtitleTemplate = this.applySubtitleVisualStyleToTemplate(
      subtitleTemplate,
      body.subtitleVisualStyle,
    );
    if (!avatar.originalVideoUrl?.trim()) {
      throw new BadRequestException('当前数字人视频没有绑定原始视频素材');
    }

    const sourceVideo = await this.readVideoFromSourceRef(
      avatar.originalVideoUrl,
    );
    this.aliLipSync.ensureConfigured();
    const voiceTuning = normalizeVoiceTuning(body);
    const speech = await this.buildSpeechAudio(
      script,
      {
        id: voice.id,
        name: voice.name,
        cloneStatus: voice.cloneStatus,
        canUseForRender: voice.canUseForRender,
        renderUnavailableReason: voice.renderUnavailableReason,
        provider: voice.provider,
        providerVoice: voice.providerVoice,
        providerModel: voice.providerModel,
        audioUrl: voice.audioUrl,
      },
      voiceTuning,
    );
    if (speech.ttsMode === 'mock') {
      throw new BadRequestException('TTS 未生成真实音频，无法进入最终成片生成');
    }
    report(20);

    const draftId = randomUUID();
    const draftDir = this.draftDir(draftId);
    await fs.mkdir(draftDir, { recursive: true });
    const sourceVideoFileName = this.draftMediaFileName(
      'source-video',
      sourceVideo.originalname,
      '.mp4',
    );
    const speechAudioFileName = this.draftMediaFileName(
      'speech-audio',
      speech.originalname,
      this.audioExtensionForMime(speech.mimeType),
    );
    const sourceVideoPath = path.join(draftDir, sourceVideoFileName);
    const speechAudioPath = path.join(draftDir, speechAudioFileName);
    await Promise.all([
      fs.writeFile(sourceVideoPath, sourceVideo.buffer),
      fs.writeFile(speechAudioPath, speech.buffer),
    ]);

    let subtitles = this.normalizeRenderSubtitles(
      body.subtitles,
      script,
      effectiveSubtitleTemplate.styleJson,
    );
    const scriptHighlights = this.normalizeScriptHighlightsForRender(
      body.highlights,
      script,
      effectiveSubtitleTemplate.styleJson,
    );
    subtitles = this.applyScriptHighlightsToSubtitles(
      subtitles,
      script,
      scriptHighlights,
    );
    let subtitleJson = this.buildSubtitleJsonFromRenderSubtitles({
      script,
      avatarResourceId: avatar.id,
      voiceResourceId: voice.id,
      subtitleTemplate: effectiveSubtitleTemplate,
      subtitles,
    });

    const durationPlan = await this.resolveFinalDurationPlan({
      sourceVideoPath,
      speechAudioPath,
      subtitleJson,
    });
    const aliSourceVideoPath = path.join(
      draftDir,
      `ali-lipsync-source_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`,
    );
    const effectiveRenderMode =
      body.renderOptions?.renderMode ?? 'preserveSourceAspect';
    await this.ffmpegAudio.prepareVideoForAliLipSync({
      inputVideoPath: sourceVideoPath,
      outputVideoPath: aliSourceVideoPath,
      targetSeconds: durationPlan.targetSeconds,
      renderMode: effectiveRenderMode,
    });
    const [videoBuffer, audioBuffer] = await Promise.all([
      fs.readFile(aliSourceVideoPath),
      fs.readFile(speechAudioPath),
    ]);
    report(38);

    const lipSyncResult = await this.aliLipSync.submitLipSync({
      video: {
        buffer: videoBuffer,
        filename: path.basename(aliSourceVideoPath),
        mimeType: 'video/mp4',
      },
      audio: {
        buffer: audioBuffer,
        filename: speechAudioFileName,
        mimeType: speech.mimeType,
      },
      videoExtension: durationPlan.shouldExtendVideo ? true : undefined,
    });
    if (!lipSyncResult.videoUrl?.trim()) {
      throw new BadRequestException('VideoReTalk 服务未返回视频地址');
    }
    const providerVideoPath = await this.persistResultVideoToDraft(
      lipSyncResult.videoUrl,
      draftDir,
    );
    let workingVideoPath = (
      await this.applyLipSyncSourceFormatContract({
        sourceVideoPath,
        preparedVideoPath: aliSourceVideoPath,
        providerVideoPath,
        draftDir,
        renderMode: effectiveRenderMode,
        context: 'renderFinalSmartClip',
      })
    ).finalPath;
    report(58);

    const cutMode = this.normalizeCutMode(body.cutConfig?.mode);
    const cutConfig = this.resolveCutConfig(cutMode, body.cutConfig?.config);
    let cutPoints = this.normalizeIncomingCutPoints(body.cutConfig?.cutPoints);
    if (body.cutConfig?.enabled) {
      const workingDuration =
        (await this.ffmpegAudio.probeFileDurationSeconds(workingVideoPath)) ??
        0;
      if (!cutPoints.length) {
        const silences = await this.ffmpegAudio.detectSilences({
          inputPath: workingVideoPath,
          noiseDb: cutConfig.silenceThreshold,
          minSilenceDuration: cutConfig.minSilenceDuration,
        });
        cutPoints = this.buildCutPointsFromSilences(
          silences,
          cutConfig,
          workingDuration,
        );
      }
      if (cutPoints.length) {
        const cutVideoPath = path.join(
          draftDir,
          `smart-cut_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`,
        );
        await this.ffmpegAudio.cutVideoByRanges({
          inputVideoPath: workingVideoPath,
          outputVideoPath: cutVideoPath,
          cuts: cutPoints.map<VideoCutRange>((cut) => ({
            startTime: cut.suggestCutStart,
            endTime: cut.suggestCutEnd,
            enabled: cut.enabled,
          })),
        });
        workingVideoPath = cutVideoPath;
        subtitles = this.remapRenderSubtitles(subtitles, cutPoints);
        subtitleJson = this.buildSubtitleJsonFromRenderSubtitles({
          script,
          avatarResourceId: avatar.id,
          voiceResourceId: voice.id,
          subtitleTemplate: effectiveSubtitleTemplate,
          subtitles,
        });
      }
    }
    report(74);

    const finalFileName = this.outputFileName('smart-clip-final', '.mp4');
    const finalPath = path.join(this.finalOutputDir(), finalFileName);
    await fs.mkdir(this.finalOutputDir(), { recursive: true });

    if (burnSubtitles) {
      const subtitleAssPath = path.join(
        draftDir,
        `smart-subtitle_${Date.now()}_${randomUUID().slice(0, 8)}.ass`,
      );
      await fs.writeFile(
        subtitleAssPath,
        this.buildAssScriptFromRenderSubtitles(subtitleJson, subtitles),
        'utf8',
      );
      await this.ffmpegAudio.burnAssSubtitles({
        inputVideoPath: workingVideoPath,
        subtitleAssPath,
        outputVideoPath: finalPath,
      });
    } else {
      await fs.copyFile(workingVideoPath, finalPath);
    }

    if (body.includeTitleAssets) {
      try {
        const overlays = await this.titleAssets.listActiveSuccessAssetsForVideo(
          userId,
          body.videoId ?? '',
        );
        if (overlays.length > 0) {
          const overlaidPath = path.join(
            this.finalOutputDir(),
            this.outputFileName('smart-clip-final-title-overlay', '.mp4'),
          );
          await this.titleAssets.overlayAssetsOnVideo({
            inputVideoPath: finalPath,
            outputVideoPath: overlaidPath,
            overlays,
          });
          await fs.rename(overlaidPath, finalPath);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Overlay title assets failed: ${message}`);
      }
    }
    report(94);

    const duration =
      (await this.ffmpegAudio.probeFileDurationSeconds(finalPath)) ?? 0;
    const hints = ['成片已生成，可以下载使用'];
    if (body.includeTitleAssets) {
      hints.push(
        'includeTitleAssets 已接收；标题素材由 title-asset-render 队列处理后参与最终叠加。',
      );
    }
    if (body.backgroundMusic?.enabled) {
      hints.push(
        '背景音乐配置已记录，当前未绑定可混音的音乐素材时会跳过混音。',
      );
    }
    if (body.pipMaterials?.enabled) {
      hints.push('画中画素材配置已记录，当前未上传分镜素材时会跳过叠加。');
    }

    const published = await this.publishRenderOutput(finalPath, finalFileName);
    report(100);
    return {
      videoUrl: published.url,
      duration: Number(duration.toFixed(2)),
      hint: `${hints.join(' ')} ${published.storage === 'oss' ? '成片已上传 OSS。' : '成片已保存本地 output。'}`.trim(),
    };
  }

  async createPreview(
    userId: string,
    body: {
      script: string;
      avatarResourceId: string;
      voiceResourceId: string;
      subtitleTemplateId?: string;
      subtitlesEnabled?: boolean;
      previewSeconds?: number;
      subtitleVisualStyle?: SubtitleVisualStyleDto;
      subtitles?: RenderSubtitleDto[];
      highlights?: unknown;
      voiceTuning?: VoiceTuningOptions;
    },
  ): Promise<{
    draftId: string;
    previewUrl: string;
    subtitleJson: SubtitleJsonDto;
    hint: string;
    ttsMode: TtsMode;
    timelineSource: TimelineSource;
    lipSyncApplied: boolean;
    providerResponse?: unknown;
  }> {
    const rawScript = body.script?.trim() ?? '';
    const script = this.sanitizeUserScript(rawScript);
    if (script.length < 2) {
      throw new BadRequestException(
        rawScript
          ? '当前文案像是系统占位提示，请先转写或填写真实口播文案'
          : '口播文案过短或为空',
      );
    }

    const previewSeconds = Math.min(
      8,
      Math.max(3, Math.round(body.previewSeconds ?? 5)),
    );
    const subtitlesEnabled = body.subtitlesEnabled !== false;
    const [avatar, voice, subtitleTemplate] = await Promise.all([
      this.resources.getAvatar(userId, body.avatarResourceId.trim()),
      this.resources.getVoice(userId, body.voiceResourceId.trim()),
      subtitlesEnabled && body.subtitleTemplateId?.trim()
        ? this.resources.getSubtitleTemplate(
            userId,
            body.subtitleTemplateId.trim(),
          )
        : Promise.resolve(NO_SUBTITLE_TEMPLATE),
    ]);
    const effectiveSubtitleTemplate = this.applySubtitleVisualStyleToTemplate(
      subtitleTemplate,
      body.subtitleVisualStyle,
    );

    if (!avatar.originalVideoUrl?.trim()) {
      throw new BadRequestException('当前数字人视频没有绑定原始视频素材');
    }

    const hints: string[] = [];
    const sourceVideo = await this.readVideoFromSourceRef(
      avatar.originalVideoUrl,
    );
    this.aliLipSync.ensureConfigured();
    const speech = await this.buildSpeechAudio(
      script,
      {
        id: voice.id,
        name: voice.name,
        cloneStatus: voice.cloneStatus,
        canUseForRender: voice.canUseForRender,
        renderUnavailableReason: voice.renderUnavailableReason,
        provider: voice.provider,
        providerVoice: voice.providerVoice,
        providerModel: voice.providerModel,
        audioUrl: voice.audioUrl,
      },
      body.voiceTuning,
    );
    if (speech.ttsMode === 'mock') {
      throw new BadRequestException(
        'TTS 未生成真实音频，无法进入 5 秒 VideoReTalk 口型预览',
      );
      hints.push('当前未走通真实 TTS，已自动生成本地占位音轨用于联调。');
    } else {
      hints.push(`已按“${voice.name}”生成 TTS 音轨。`);
      if (speech.styleHint) hints.push(speech.styleHint);
    }

    let timeline = await this.buildSubtitleTimeline(
      script,
      speech,
      body.avatarResourceId.trim(),
      body.voiceResourceId.trim(),
      effectiveSubtitleTemplate,
    );
    const payloadSubtitles = this.normalizeRenderSubtitles(
      body.subtitles,
      script,
      effectiveSubtitleTemplate.styleJson,
    );
    if (payloadSubtitles.length > 0) {
      const scriptHighlights = this.normalizeScriptHighlightsForRender(
        body.highlights,
        script,
        effectiveSubtitleTemplate.styleJson,
      );
      const mergedSubtitles = this.applyScriptHighlightsToSubtitles(
        payloadSubtitles,
        script,
        scriptHighlights,
      );
      timeline = {
        subtitleJson: this.buildSubtitleJsonFromRenderSubtitles({
          script,
          avatarResourceId: body.avatarResourceId.trim(),
          voiceResourceId: body.voiceResourceId.trim(),
          subtitleTemplate: effectiveSubtitleTemplate,
          subtitles: mergedSubtitles,
        }),
        timelineSource: 'local-estimate',
      };
    }
    if (!subtitlesEnabled) {
      hints.push('当前已关闭字幕叠加，只生成无字幕对口型视频。');
    } else if (timeline.timelineSource === 'asr-fallback') {
      hints.push('TTS 未提供时间戳，已通过 ASR 对音频回填字幕时间轴。');
    } else {
      hints.push(
        '当前环境未接入可用时间戳服务，已用本地估时生成 subtitle.json。',
      );
    }

    const draftId = randomUUID();
    const draftDir = this.draftDir(draftId);
    await fs.mkdir(draftDir, { recursive: true });

    const sourceVideoFileName = this.draftMediaFileName(
      'source-video',
      sourceVideo.originalname,
      '.mp4',
    );
    const speechAudioFileName = this.draftMediaFileName(
      'speech-audio',
      speech.originalname,
      this.audioExtensionForMime(speech.mimeType),
    );
    const sourceVideoPath = path.join(draftDir, sourceVideoFileName);
    const speechAudioPath = path.join(draftDir, speechAudioFileName);
    await Promise.all([
      fs.writeFile(sourceVideoPath, sourceVideo.buffer),
      fs.writeFile(speechAudioPath, speech.buffer),
    ]);

    const muxedVideoFileName = `muxed_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`;
    const muxedVideoPath = path.join(draftDir, muxedVideoFileName);
    try {
      const muxed = await this.ffmpegAudio.replaceVideoAudio({
        video: {
          buffer: sourceVideo.buffer,
          originalname: sourceVideo.originalname,
        },
        audio: {
          buffer: speech.buffer,
          originalname: speech.originalname,
        },
      });
      await fs.writeFile(muxedVideoPath, muxed.buffer);
    } catch (e) {
      this.logger.warn(
        `Mux source video with TTS failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      await fs.writeFile(muxedVideoPath, sourceVideo.buffer);
      hints.push('音轨替换失败，预览阶段已先回退到原始视频继续联调。');
    }

    const subtitleAssFileName = `subtitle_${Date.now()}_${randomUUID().slice(0, 8)}.ass`;
    const subtitleAssPath = path.join(draftDir, subtitleAssFileName);
    await fs.writeFile(
      subtitleAssPath,
      this.buildAssScript(timeline.subtitleJson),
      'utf8',
    );

    const previewFileName = this.outputFileName('subtitle-preview', '.mp4');
    const previewPath = path.join(this.outputDir(), previewFileName);
    await fs.mkdir(this.outputDir(), { recursive: true });

    const lipSyncedPreview = await this.buildLipSyncedPreviewVideo({
      draftDir,
      sourceVideoPath,
      speechAudioPath,
      previewSeconds,
    });
    hints.push(lipSyncedPreview.hint || '已生成 5 秒 VideoReTalk 对口型预览。');

    if (subtitlesEnabled) {
      try {
        await this.ffmpegAudio.burnAssSubtitles({
          inputVideoPath: lipSyncedPreview.videoPath,
          subtitleAssPath,
          outputVideoPath: previewPath,
          clipSeconds: previewSeconds,
        });
        hints.push('已生成 5 秒字幕预览，可先确认节奏、样式和断句。');
      } catch (e) {
        this.logger.warn(
          `Burn preview subtitles failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        await fs.copyFile(muxedVideoPath, previewPath);
        hints.push(
          '字幕预览合成失败，已回退为 5 秒视频预览，请优先检查 FFmpeg 字幕滤镜。',
        );
      }
    } else {
      await this.ffmpegAudio.clipVideo({
        inputVideoPath: lipSyncedPreview.videoPath,
        outputVideoPath: previewPath,
        clipSeconds: previewSeconds,
      });
      hints.push('已生成 5 秒无字幕预览。');
    }

    const meta: DraftMeta = {
      id: draftId,
      userId,
      createdAt: nowIso(),
      avatarResourceId: body.avatarResourceId.trim(),
      voiceResourceId: body.voiceResourceId.trim(),
      subtitleTemplateId: subtitleTemplate.id,
      script,
      previewSeconds,
      ttsMode: speech.ttsMode,
      timelineSource: timeline.timelineSource,
      avatarLabel: avatar.name,
      voiceLabel: voice.name,
      subtitleJson: timeline.subtitleJson,
      sourceVideoFileName,
      sourceVideoMimeType:
        sourceVideo.mimetype || guessMimeFromFilename(sourceVideo.originalname),
      speechAudioFileName,
      speechAudioMimeType: speech.mimeType,
      subtitlesEnabled,
      muxedVideoFileName,
      subtitleAssFileName,
      previewFileName,
    };
    await this.saveDraftMeta(meta);

    return {
      draftId,
      previewUrl: this.toPreviewUrl(previewFileName),
      subtitleJson: timeline.subtitleJson,
      hint: hints.join(' '),
      ttsMode: speech.ttsMode,
      timelineSource: timeline.timelineSource,
      lipSyncApplied: true,
      providerResponse: lipSyncedPreview.providerResponse,
    };
  }

  private async buildLipSyncedPreviewVideo(params: {
    draftDir: string;
    sourceVideoPath: string;
    speechAudioPath: string;
    previewSeconds: number;
  }): Promise<{ videoPath: string; providerResponse: unknown; hint?: string }> {
    const sourcePreviewPath = path.join(
      params.draftDir,
      `preview-source_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`,
    );
    const speechPreviewPath = path.join(
      params.draftDir,
      `preview-speech_${Date.now()}_${randomUUID().slice(0, 8)}.wav`,
    );

    try {
      await Promise.all([
        this.ffmpegAudio.prepareVideoForAliLipSync({
          inputVideoPath: params.sourceVideoPath,
          outputVideoPath: sourcePreviewPath,
          clipSeconds: params.previewSeconds,
          renderMode: 'preserveSourceAspect',
        }),
        this.ffmpegAudio.clipAudio({
          inputAudioPath: params.speechAudioPath,
          outputAudioPath: speechPreviewPath,
          clipSeconds: params.previewSeconds,
        }),
      ]);

      const [videoBuffer, audioBuffer] = await Promise.all([
        fs.readFile(sourcePreviewPath),
        fs.readFile(speechPreviewPath),
      ]);
      const result = await this.aliLipSync.submitLipSync({
        video: {
          buffer: videoBuffer,
          filename: path.basename(sourcePreviewPath),
          mimeType: 'video/mp4',
        },
        audio: {
          buffer: audioBuffer,
          filename: path.basename(speechPreviewPath),
          mimeType: 'audio/wav',
        },
        videoExtension: false,
      });
      if (!result.videoUrl?.trim()) {
        throw new Error('VideoReTalk 服务未返回预览视频地址');
      }
      const providerVideoPath = await this.persistResultVideoToDraft(
        result.videoUrl,
        params.draftDir,
      );
      const { finalPath: videoPath } =
        await this.applyLipSyncSourceFormatContract({
          sourceVideoPath: params.sourceVideoPath,
          preparedVideoPath: sourcePreviewPath,
          providerVideoPath,
          draftDir: params.draftDir,
          renderMode: 'preserveSourceAspect',
          context: 'buildLipSyncedPreviewVideo',
        });
      return {
        videoPath,
        providerResponse: result.providerResponse,
        hint: result.hint,
      };
    } catch (e) {
      throw new BadRequestException(
        `5 秒 VideoReTalk 口型预览失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async finalizeDraft(
    userId: string,
    body: { draftId: string },
  ): Promise<{
    draftId: string;
    videoUrl: string;
    subtitleJson: SubtitleJsonDto;
    hint: string;
    fallback: boolean;
    providerResponse?: unknown;
  }> {
    const draftId = body.draftId?.trim() ?? '';
    if (!draftId) {
      throw new BadRequestException('draftId 不能为空');
    }

    const meta = await this.loadDraftMeta(draftId);
    if (meta.userId !== userId) {
      throw new NotFoundException('未找到当前用户对应的预览草稿');
    }

    const draftDir = this.draftDir(draftId);
    const muxedVideoPath = path.join(draftDir, meta.muxedVideoFileName);
    const subtitleAssPath = path.join(draftDir, meta.subtitleAssFileName);
    const sourceVideoPath = meta.sourceVideoFileName
      ? path.join(draftDir, meta.sourceVideoFileName)
      : muxedVideoPath;
    const speechAudioPath = meta.speechAudioFileName
      ? path.join(draftDir, meta.speechAudioFileName)
      : null;
    const hints: string[] = [];

    let workingVideoPath = muxedVideoPath;
    let providerResponse: unknown;
    let fallback = true;

    this.aliLipSync.ensureConfigured();
    if (this.aliLipSync.isConfigured()) {
      try {
        if (!speechAudioPath || !existsSync(speechAudioPath)) {
          throw new BadRequestException(
            'lip-sync audio input is missing from the draft',
          );
        }
        const durationPlan = await this.resolveFinalDurationPlan({
          sourceVideoPath,
          speechAudioPath,
          subtitleJson: meta.subtitleJson,
        });
        const aliSourceVideoPath = path.join(
          draftDir,
          `ali-lipsync-source_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`,
        );
        await this.ffmpegAudio.prepareVideoForAliLipSync({
          inputVideoPath: sourceVideoPath,
          outputVideoPath: aliSourceVideoPath,
          targetSeconds: durationPlan.targetSeconds,
          renderMode: 'preserveSourceAspect',
        });
        const [videoBuffer, audioBuffer] = await Promise.all([
          fs.readFile(aliSourceVideoPath),
          fs.readFile(speechAudioPath),
        ]);
        const result = await this.aliLipSync.submitLipSync({
          video: {
            buffer: videoBuffer,
            filename: path.basename(aliSourceVideoPath),
            mimeType: 'video/mp4',
          },
          audio: {
            buffer: audioBuffer,
            filename: meta.speechAudioFileName || 'lip-sync-speech.mp3',
            mimeType:
              meta.speechAudioMimeType ||
              guessMimeFromFilename(meta.speechAudioFileName || 'speech.mp3'),
          },
          videoExtension: durationPlan.shouldExtendVideo ? true : undefined,
        });
        providerResponse = result.providerResponse;
        if (!result.videoUrl?.trim()) {
          throw new Error('VideoReTalk 服务未返回视频地址');
        }
        const providerVideoPath = await this.persistResultVideoToDraft(
          result.videoUrl,
          draftDir,
        );
        workingVideoPath = (
          await this.applyLipSyncSourceFormatContract({
            sourceVideoPath,
            preparedVideoPath: aliSourceVideoPath,
            providerVideoPath,
            draftDir,
            renderMode: 'preserveSourceAspect',
            context: 'finalizeDraft',
          })
        ).finalPath;
        fallback = false;
        if (durationPlan.shouldExtendVideo) {
          hints.push(
            `数字人视频约 ${durationPlan.sourceSeconds?.toFixed(1)} 秒，音轨约 ${durationPlan.targetSeconds?.toFixed(1)} 秒，已先把视频延展到完整音轨长度，避免最终成片被截短。`,
          );
        }
        hints.push(result.hint || '已完成 GPU 对口型。');
      } catch (e) {
        throw new BadRequestException(
          `VideoReTalk 对口型失败，已停止最终合成：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      hints.push(
        '当前环境未配置 GPU 对口型服务，已直接使用换音轨版本继续合成。',
      );
    }

    const finalFileName = this.outputFileName('subtitle-final', '.mp4');
    const finalPath = path.join(this.outputDir(), finalFileName);
    await fs.mkdir(this.outputDir(), { recursive: true });

    if (meta.subtitlesEnabled === false) {
      await fs.copyFile(workingVideoPath, finalPath);
      hints.push('已输出无字幕最终视频。');
    } else {
      try {
        await this.ffmpegAudio.burnAssSubtitles({
          inputVideoPath: workingVideoPath,
          subtitleAssPath,
          outputVideoPath: finalPath,
        });
        hints.push('已完成字幕、音频、视频的最终合成。');
      } catch (e) {
        this.logger.warn(
          `Burn final subtitles failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        await fs.copyFile(workingVideoPath, finalPath);
        hints.push(
          '最终字幕烧录失败，已回退输出无字幕视频，请检查 FFmpeg 字幕滤镜。',
        );
      }
    }

    meta.finalFileName = finalFileName;
    await this.saveDraftMeta(meta);

    return {
      draftId,
      videoUrl: this.toPreviewUrl(finalFileName),
      subtitleJson: meta.subtitleJson,
      hint: hints.join(' '),
      fallback,
      providerResponse,
    };
  }

  private async resolveFinalDurationPlan(params: {
    sourceVideoPath: string;
    speechAudioPath: string;
    subtitleJson: SubtitleJsonDto;
  }): Promise<{
    targetSeconds?: number;
    sourceSeconds?: number;
    shouldExtendVideo: boolean;
  }> {
    const [audioSeconds, sourceSeconds] = await Promise.all([
      this.ffmpegAudio.probeFileDurationSeconds(params.speechAudioPath),
      this.ffmpegAudio.probeFileDurationSeconds(params.sourceVideoPath),
    ]);
    const subtitleSeconds =
      params.subtitleJson.durationMs > 0
        ? params.subtitleJson.durationMs / 1000
        : null;
    const rawTargetSeconds = audioSeconds ?? subtitleSeconds ?? undefined;
    const targetSeconds =
      typeof rawTargetSeconds === 'number' && Number.isFinite(rawTargetSeconds)
        ? Math.min(600, Math.max(1, rawTargetSeconds))
        : undefined;
    const shouldExtendVideo =
      typeof targetSeconds === 'number' &&
      typeof sourceSeconds === 'number' &&
      targetSeconds > sourceSeconds + 0.5;

    return {
      targetSeconds,
      sourceSeconds: sourceSeconds ?? undefined,
      shouldExtendVideo,
    };
  }

  private async resolveRenderVideoSource(
    userId: string,
    avatarResourceId?: string,
    sourceVideoUrl?: string,
  ): Promise<TranscribeMediaInput> {
    const avatarId = avatarResourceId?.trim();
    if (avatarId) {
      const avatar = await this.resources.getAvatar(userId, avatarId);
      if (!avatar.originalVideoUrl?.trim()) {
        throw new BadRequestException('当前数字人视频没有绑定原始视频素材');
      }
      return this.readVideoFromSourceRef(avatar.originalVideoUrl);
    }
    const sourceRef = sourceVideoUrl?.trim();
    if (!sourceRef) {
      throw new BadRequestException('请先选择数字人视频或提供视频地址');
    }
    return this.readVideoFromSourceRef(sourceRef);
  }

  private normalizeCutMode(mode?: string): CutMode {
    if (mode === 'light' || mode === 'strong' || mode === 'standard')
      return mode;
    return 'standard';
  }

  private resolveCutConfig(
    mode: CutMode,
    config?: Partial<CutDetectionConfig>,
  ): CutDetectionConfig {
    const base = CUT_MODE_CONFIGS[mode];
    return {
      silenceThreshold: this.clampNumber(
        this.readNumber(config?.silenceThreshold, base.silenceThreshold),
        -60,
        -20,
      ),
      minSilenceDuration: this.clampNumber(
        this.readNumber(config?.minSilenceDuration, base.minSilenceDuration),
        0.1,
        2,
      ),
      keepPause: this.clampNumber(
        this.readNumber(config?.keepPause, base.keepPause),
        0,
        1,
      ),
    };
  }

  private buildCutPointsFromSilences(
    silences: SilenceSegment[],
    config: CutDetectionConfig,
    originalDuration: number,
  ): CutPointDto[] {
    return silences
      .map((silence, index) => {
        const startTime = this.roundSeconds(silence.startTime);
        const endTime = this.roundSeconds(
          originalDuration > 0
            ? Math.min(silence.endTime, originalDuration)
            : silence.endTime,
        );
        const duration = this.roundSeconds(Math.max(0, endTime - startTime));
        const keepDuration = this.roundSeconds(
          Math.min(config.keepPause, duration),
        );
        const suggestCutStart = this.roundSeconds(startTime + keepDuration);
        const suggestCutEnd = endTime;
        const cutDuration = this.roundSeconds(
          Math.max(0, suggestCutEnd - suggestCutStart),
        );
        const confidence = this.clampNumber(
          0.76 +
            Math.min(
              0.2,
              duration / Math.max(1, config.minSilenceDuration * 8),
            ),
          0.72,
          0.98,
        );
        return {
          id: `cut_${String(index + 1).padStart(3, '0')}`,
          type: 'silence' as const,
          startTime,
          endTime,
          duration,
          suggestCutStart,
          suggestCutEnd,
          cutDuration,
          keepDuration,
          enabled: cutDuration > 0.05,
          confidence: Number(confidence.toFixed(2)),
        };
      })
      .filter((cut) => cut.enabled);
  }

  private summarizeCutPoints(
    cutPoints: CutPointDto[],
    originalDuration: number,
  ): CutSummaryDto {
    const totalCutDuration = this.roundSeconds(
      cutPoints
        .filter((cut) => cut.enabled)
        .reduce((sum, cut) => sum + Math.max(0, cut.cutDuration), 0),
    );
    const sourceDuration = this.roundSeconds(Math.max(0, originalDuration));
    return {
      totalCount: cutPoints.filter((cut) => cut.enabled).length,
      totalCutDuration,
      originalDuration: sourceDuration,
      estimatedDuration: this.roundSeconds(
        Math.max(0, sourceDuration - totalCutDuration),
      ),
    };
  }

  private normalizeIncomingCutPoints(
    cutPoints?: Partial<CutPointDto>[],
  ): CutPointDto[] {
    if (!Array.isArray(cutPoints)) return [];
    return cutPoints
      .map((cut, index) => {
        const startTime = this.readFiniteSeconds(cut.startTime);
        const endTime = this.readFiniteSeconds(cut.endTime);
        if (startTime === null || endTime === null || endTime <= startTime)
          return null;
        const suggestCutStart =
          this.readFiniteSeconds(cut.suggestCutStart) ??
          startTime + (cut.keepDuration ?? 0);
        const suggestCutEnd =
          this.readFiniteSeconds(cut.suggestCutEnd) ?? endTime;
        if (suggestCutEnd <= suggestCutStart) return null;
        const duration = this.roundSeconds(endTime - startTime);
        const cutDuration = this.roundSeconds(suggestCutEnd - suggestCutStart);
        return {
          id: cut.id?.trim() || `cut_${String(index + 1).padStart(3, '0')}`,
          type: 'silence' as const,
          startTime: this.roundSeconds(startTime),
          endTime: this.roundSeconds(endTime),
          duration,
          suggestCutStart: this.roundSeconds(suggestCutStart),
          suggestCutEnd: this.roundSeconds(suggestCutEnd),
          cutDuration,
          keepDuration: this.roundSeconds(Math.max(0, duration - cutDuration)),
          enabled: cut.enabled !== false,
          confidence: this.clampNumber(
            this.readNumber(cut.confidence, 0.88),
            0,
            1,
          ),
        };
      })
      .filter((cut): cut is CutPointDto => Boolean(cut));
  }

  private applySubtitleVisualStyleToTemplate(
    template: SubtitleTemplateResourceDto,
    input: SubtitleVisualStyleDto | undefined,
  ): SubtitleTemplateResourceDto {
    if (!input) return template;
    const nextStyle: Record<string, unknown> = {
      ...(template.styleJson || {}),
    };
    if (
      typeof input.normalColor === 'string' &&
      this.isSafeColor(input.normalColor)
    ) {
      nextStyle.color = input.normalColor.trim();
    }
    if (
      typeof input.highlightColor === 'string' &&
      this.isSafeColor(input.highlightColor)
    ) {
      nextStyle.highlightColor = input.highlightColor.trim();
    }
    if (
      typeof input.strokeColor === 'string' &&
      this.isSafeColor(input.strokeColor)
    ) {
      nextStyle.stroke = input.strokeColor.trim();
    }
    if (
      typeof input.backgroundColor === 'string' &&
      this.isSafeColor(input.backgroundColor)
    ) {
      nextStyle.background = input.backgroundColor.trim();
    }
    const fontSize = this.readFiniteSeconds(input.fontSize as number);
    if (fontSize !== null) {
      nextStyle.size = this.clampNumber(fontSize, 20, 96);
    }
    const strokeWidth = this.readFiniteSeconds(input.strokeWidth as number);
    if (strokeWidth !== null) {
      nextStyle.strokeWidth = this.clampNumber(strokeWidth, 0, 12);
    }
    const fontWeight = this.readFiniteSeconds(input.fontWeight as number);
    if (fontWeight !== null) {
      nextStyle.weight = this.clampNumber(fontWeight, 300, 900);
    }
    const lineHeight = this.readFiniteSeconds(input.lineHeight as number);
    if (lineHeight !== null) {
      nextStyle.lineHeight = this.clampNumber(lineHeight, 1, 2.2);
    }
    const layout = this.normalizeVisualLayout(input.layout);
    if (layout) {
      nextStyle.layout = layout;
    }
    return { ...template, styleJson: nextStyle };
  }

  private normalizeVisualLayout(
    layout: VisualOverlayLayoutDto | undefined,
  ): VisualOverlayLayoutDto | undefined {
    if (!layout) return undefined;
    const x = Number(layout.xPct);
    const y = Number(layout.yPct);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    const anchor = this.normalizeVisualAnchor(layout.anchor);
    const safeAreaPct = this.clampNumber(
      Number.isFinite(Number(layout.safeAreaPct))
        ? Number(layout.safeAreaPct)
        : 6,
      0,
      24,
    );
    const scale = this.clampNumber(
      Number.isFinite(Number(layout.scale)) ? Number(layout.scale) : 1,
      0.7,
      1.8,
    );
    const maxWidthPct = this.clampNumber(
      Number.isFinite(Number(layout.maxWidthPct))
        ? Number(layout.maxWidthPct)
        : 82,
      20,
      100,
    );
    const minPct = safeAreaPct;
    const maxPct = 100 - safeAreaPct;
    return {
      xPct: this.clampNumber(x, minPct, maxPct),
      yPct: this.clampNumber(y, minPct, maxPct),
      anchor,
      safeAreaPct,
      scale,
      maxWidthPct,
    };
  }

  private normalizeVisualAnchor(anchor: unknown): VisualOverlayAnchor {
    if (typeof anchor !== 'string') return 'bottom-center';
    const value = anchor.trim().toLowerCase();
    switch (value) {
      case 'center':
      case 'top-center':
      case 'bottom-center':
      case 'top-left':
      case 'top-right':
      case 'bottom-left':
      case 'bottom-right':
      case 'left-center':
      case 'right-center':
        return value;
      default:
        return 'bottom-center';
    }
  }

  private isSafeColor(value: string): boolean {
    const text = value.trim();
    if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) return true;
    return /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|0?\.\d+|1))?\s*\)$/.test(
      text,
    );
  }

  private normalizeRenderSubtitles(
    subtitles: RenderSubtitleDto[] | undefined,
    script: string,
    styleJson: Record<string, unknown>,
  ): RenderSubtitleDto[] {
    const fromPayload: RenderSubtitleDto[] = Array.isArray(subtitles)
      ? subtitles.flatMap((item, index) => {
          const text = this.sanitizeCueText(item.text || '');
          const startTime = this.readFiniteSeconds(item.startTime);
          const endTime = this.readFiniteSeconds(item.endTime);
          if (!text || startTime === null || endTime === null) return [];
          return [
            {
              id:
                item.id?.trim() || `sub_${String(index + 1).padStart(3, '0')}`,
              startTime: this.roundSeconds(Math.max(0, startTime)),
              endTime: this.roundSeconds(Math.max(startTime + 0.25, endTime)),
              text,
              highlightRanges: this.normalizeHighlightRanges(
                item.highlightRanges,
                text,
              ),
            },
          ];
        })
      : [];

    const sourceLength = this.normalizedTextLength(script);
    const payloadLength = this.normalizedTextLength(
      fromPayload.map((item) => item.text).join(''),
    );
    if (
      fromPayload.length > 0 &&
      (payloadLength >= sourceLength * 0.9 ||
        sourceLength - payloadLength <= 24)
    ) {
      return fromPayload.sort((a, b) => a.startTime - b.startTime);
    }

    return this.normalizeCues(
      this.buildEstimatedSegments(script),
      script,
      styleJson,
    ).map((cue, index) => ({
      id: `sub_${String(index + 1).padStart(3, '0')}`,
      startTime: this.roundSeconds(cue.startMs / 1000),
      endTime: this.roundSeconds(cue.endMs / 1000),
      text: cue.text,
      highlightRanges: [],
    }));
  }

  private buildSubtitleJsonFromRenderSubtitles(params: {
    script: string;
    avatarResourceId: string;
    voiceResourceId: string;
    subtitleTemplate: SubtitleTemplateResourceDto;
    subtitles: RenderSubtitleDto[];
  }): SubtitleJsonDto {
    const lineChars = this.clampNumber(
      this.readNumber(params.subtitleTemplate.styleJson.lineChars, 14),
      8,
      18,
    );
    const cues = params.subtitles.map<SubtitleCueDto>((subtitle, index) => {
      const startMs = Math.max(0, Math.round(subtitle.startTime * 1000));
      const endMs = Math.max(
        startMs + 250,
        Math.round(subtitle.endTime * 1000),
      );
      return {
        id: subtitle.id || `cue-${index + 1}`,
        startMs,
        endMs,
        text: subtitle.text,
        lines: this.wrapCueText(subtitle.text, lineChars),
      };
    });

    return {
      version: 1,
      language: 'zh-CN',
      durationMs:
        cues[cues.length - 1]?.endMs ??
        Math.max(3_000, params.script.length * 220),
      generatedAt: nowIso(),
      source: {
        script: params.script,
        avatarResourceId: params.avatarResourceId,
        voiceResourceId: params.voiceResourceId,
        subtitleTemplateId: params.subtitleTemplate.id,
      },
      template: {
        id: params.subtitleTemplate.id,
        name: params.subtitleTemplate.name,
        styleJson: params.subtitleTemplate.styleJson,
      },
      cues,
    };
  }

  private remapRenderSubtitles(
    subtitles: RenderSubtitleDto[],
    cuts: CutPointDto[],
  ): RenderSubtitleDto[] {
    return subtitles.map((subtitle) => {
      const startTime = this.remapTimeSeconds(subtitle.startTime, cuts);
      const endTime = Math.max(
        startTime + 0.25,
        this.remapTimeSeconds(subtitle.endTime, cuts),
      );
      return {
        ...subtitle,
        startTime: this.roundSeconds(startTime),
        endTime: this.roundSeconds(endTime),
      };
    });
  }

  private remapTimeSeconds(originalTime: number, cuts: CutPointDto[]): number {
    let removed = 0;
    for (const cut of cuts) {
      if (!cut.enabled) continue;
      if (cut.suggestCutEnd <= originalTime) {
        removed += Math.max(0, cut.suggestCutEnd - cut.suggestCutStart);
      }
    }
    return Math.max(0, originalTime - removed);
  }

  private legacyPositionToAnchor(position: string): VisualOverlayAnchor {
    const value = (position || '').trim().toLowerCase();
    if (value === 'top') return 'top-center';
    if (value === 'middle') return 'center';
    return 'bottom-center';
  }

  private resolveNormalizedSubtitleLayout(
    layoutRaw: unknown,
  ): NormalizedVisualLayout | null {
    if (!layoutRaw || typeof layoutRaw !== 'object') return null;
    const data = layoutRaw as Record<string, unknown>;
    const normalized = this.normalizeVisualLayout({
      xPct: Number(data.xPct),
      yPct: Number(data.yPct),
      anchor: data.anchor as VisualOverlayAnchor | undefined,
      safeAreaPct: Number(data.safeAreaPct),
      scale: Number(data.scale),
      maxWidthPct: Number(data.maxWidthPct),
    });
    if (!normalized) return null;
    return {
      xPct: normalized.xPct,
      yPct: normalized.yPct,
      anchor: normalized.anchor ?? 'bottom-center',
      safeAreaPct: normalized.safeAreaPct ?? 6,
    };
  }

  private anchorToAssAlignment(anchor: VisualOverlayAnchor): number {
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

  private buildAssPositionTag(layout: NormalizedVisualLayout | null): string {
    if (!layout) return '';
    const safe = this.clampNumber(layout.safeAreaPct, 0, 24);
    const minPct = safe;
    const maxPct = 100 - safe;
    const xPct = this.clampNumber(layout.xPct, minPct, maxPct);
    const yPct = this.clampNumber(layout.yPct, minPct, maxPct);
    const x = Math.round((xPct / 100) * ASS_CANVAS_WIDTH);
    const y = Math.round((yPct / 100) * ASS_CANVAS_HEIGHT);
    const an = this.anchorToAssAlignment(layout.anchor);
    return `{\\an${an}\\pos(${x},${y})}`;
  }

  private buildAssScriptFromRenderSubtitles(
    subtitleJson: SubtitleJsonDto,
    subtitles: RenderSubtitleDto[],
  ): string {
    const style = subtitleJson.template.styleJson || {};
    const fontFamily = this.readString(style.fontFamily, 'Noto Sans CJK SC');
    const fontSize = this.clampNumber(this.readNumber(style.size, 38), 24, 42);
    const outline = this.clampNumber(
      this.readNumber(style.strokeWidth, 2.2),
      1.2,
      3.2,
    );
    const marginBottom = this.clampNumber(
      this.readNumber(style.marginBottom, 72),
      42,
      118,
    );
    const spacing = this.clampNumber(
      this.readNumber(style.letterSpacing, 0),
      0,
      2,
    );
    const weight = this.readNumber(style.weight, 700);
    const position = this.readString(style.position, 'bottom');
    const hasBackground =
      typeof style.background === 'string' &&
      style.background.trim().length > 0;
    const resolvedLayout = this.resolveNormalizedSubtitleLayout(style.layout);
    const fallbackAnchor = this.legacyPositionToAnchor(position);
    const alignment = this.anchorToAssAlignment(
      resolvedLayout?.anchor ?? fallbackAnchor,
    );
    const subtitleById = new Map(
      subtitles.map((subtitle) => [subtitle.id, subtitle]),
    );

    const header = [
      '[Script Info]',
      'ScriptType: v4.00+',
      'PlayResX: 720',
      'PlayResY: 1280',
      'WrapStyle: 2',
      'ScaledBorderAndShadow: yes',
      'YCbCr Matrix: TV.601',
      '',
      '[V4+ Styles]',
      'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
      [
        'Style: Default',
        fontFamily,
        fontSize,
        this.toAssColor(this.readString(style.color, '#FFFFFF')),
        this.toAssColor(
          this.readString(
            style.highlightColor,
            this.readString(style.color, '#FFFFFF'),
          ),
        ),
        this.toAssColor(this.readString(style.stroke, '#111827')),
        this.toAssColor(this.readString(style.background, '#00000000')),
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
        marginBottom,
        1,
      ].join(','),
      '',
      '[Events]',
      'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
    ].join('\n');

    const events = subtitleJson.cues
      .map((cue) => {
        const subtitle = subtitleById.get(cue.id);
        const text = this.buildAssDialogueText(cue, subtitle, style, fontSize);
        const withPos = `${this.buildAssPositionTag(resolvedLayout)}${text}`;
        return `Dialogue: 0,${this.toAssTime(cue.startMs)},${this.toAssTime(cue.endMs)},Default,,0,0,0,,${withPos}`;
      })
      .join('\n');

    return `${header}\n${events}\n`;
  }

  private buildAssDialogueText(
    cue: SubtitleCueDto,
    subtitle: RenderSubtitleDto | undefined,
    style: Record<string, unknown>,
    baseFontSize: number,
  ): string {
    const ranges = subtitle?.highlightRanges ?? [];
    if (!ranges.length) return this.escapeAssText(cue.lines.join('\\N'));

    const normalColor = this.toAssOverrideColor(
      this.readString(style.color, '#FFFFFF'),
    );
    const defaultHighlightColor = this.readString(
      style.highlightColor,
      '#FFD94A',
    );
    const sorted = ranges
      .map((range) => ({
        start: Math.max(0, Math.min(cue.text.length, Math.floor(range.start))),
        end: Math.max(0, Math.min(cue.text.length, Math.ceil(range.end))),
        color: range.color || defaultHighlightColor,
        fontWeight: range.fontWeight ?? 900,
        fontSizeScale: this.clampNumber(
          this.readNumber(
            range.fontSizeScale,
            this.readNumber(style.highlightFontSizeScale, 1.18),
          ),
          1,
          1.6,
        ),
      }))
      .filter((range) => range.end > range.start)
      .sort((a, b) => a.start - b.start);

    let cursor = 0;
    let output = '';
    for (const range of sorted) {
      if (range.start > cursor) {
        output += `{\\c${normalColor}\\fs${Math.round(baseFontSize)}\\b0}${this.escapeAssSegment(cue.text.slice(cursor, range.start))}`;
      }
      const highlightFs = Math.round(baseFontSize * range.fontSizeScale);
      output += `{\\c${this.toAssOverrideColor(range.color)}\\fs${highlightFs}\\b${range.fontWeight >= 700 ? 1 : 0}}${this.escapeAssSegment(cue.text.slice(range.start, range.end))}`;
      cursor = Math.max(cursor, range.end);
    }
    if (cursor < cue.text.length) {
      output += `{\\c${normalColor}\\fs${Math.round(baseFontSize)}\\b0}${this.escapeAssSegment(cue.text.slice(cursor))}`;
    }
    return output || this.escapeAssText(cue.lines.join('\\N'));
  }

  private normalizeHighlightRanges(
    ranges: HighlightRangeDto[] | undefined,
    text: string,
  ): HighlightRangeDto[] {
    if (!Array.isArray(ranges)) return [];
    return ranges
      .map((range) => ({
        start: Math.max(
          0,
          Math.min(text.length, Math.floor(this.readNumber(range.start, 0))),
        ),
        end: Math.max(
          0,
          Math.min(text.length, Math.ceil(this.readNumber(range.end, 0))),
        ),
        color:
          typeof range.color === 'string' && range.color.trim()
            ? range.color.trim()
            : '#FFD94A',
        fontWeight: this.clampNumber(
          this.readNumber(range.fontWeight, 900),
          400,
          900,
        ),
        fontSizeScale: this.clampNumber(
          this.readNumber(range.fontSizeScale, 1.18),
          1,
          1.6,
        ),
      }))
      .filter((range) => range.end > range.start);
  }

  private normalizeScriptHighlightsForRender(
    highlightsRaw: unknown,
    script: string,
    styleJson: Record<string, unknown>,
  ): ScriptHighlightRange[] {
    return normalizeScriptHighlights({
      highlights: highlightsRaw,
      scriptText: script,
      defaultColor: this.readString(styleJson.highlightColor, '#FFD400'),
      defaultFontSizeScale: this.clampNumber(
        this.readNumber(styleJson.highlightFontSizeScale, 1.18),
        1,
        1.6,
      ),
      defaultFontWeight: this.clampNumber(
        this.readNumber(styleJson.highlightFontWeight, 900),
        400,
        900,
      ),
    });
  }

  private applyScriptHighlightsToSubtitles(
    subtitles: RenderSubtitleDto[],
    script: string,
    highlights: ScriptHighlightRange[],
  ): RenderSubtitleDto[] {
    if (!highlights.length) return subtitles;
    let searchCursor = 0;
    return subtitles.map((subtitle, index) => {
      const scriptStart = this.findSubtitleTextStart(
        script,
        subtitle.text,
        searchCursor,
      );
      if (scriptStart >= 0) {
        searchCursor = scriptStart + subtitle.text.length;
      }
      const fromScript =
        scriptStart >= 0
          ? projectHighlightsToSubtitle({
              subtitleText: subtitle.text,
              subtitleScriptStart: scriptStart,
              highlights,
            })
          : this.estimateSubtitleHighlightsByOrder(
              subtitle,
              subtitles,
              highlights,
              script.length,
              index,
            );
      const fromPayload = this.normalizeHighlightRanges(
        subtitle.highlightRanges,
        subtitle.text,
      );
      const merged = this.mergeSubtitleHighlightRanges(
        [...fromPayload, ...fromScript],
        subtitle.text.length,
      );
      return {
        ...subtitle,
        highlightRanges: merged,
      };
    });
  }

  private estimateSubtitleHighlightsByOrder(
    subtitle: RenderSubtitleDto,
    allSubtitles: RenderSubtitleDto[],
    highlights: ScriptHighlightRange[],
    scriptLength: number,
    index: number,
  ): SubtitleHighlightRange[] {
    if (!subtitle.text || scriptLength <= 0) return [];
    const totalChars = allSubtitles.reduce(
      (sum, item) => sum + Math.max(0, item.text.length),
      0,
    );
    if (totalChars <= 0) return [];
    const charsBefore = allSubtitles
      .slice(0, index)
      .reduce((sum, item) => sum + Math.max(0, item.text.length), 0);
    const start = Math.floor((charsBefore / totalChars) * scriptLength);
    return projectHighlightsToSubtitle({
      subtitleText: subtitle.text,
      subtitleScriptStart: start,
      highlights,
    });
  }

  private findSubtitleTextStart(
    script: string,
    subtitleText: string,
    from: number,
  ): number {
    const text = subtitleText.trim();
    if (!text) return -1;
    const primary = script.indexOf(text, Math.max(0, from));
    if (primary >= 0) return primary;
    return script.indexOf(text);
  }

  private mergeSubtitleHighlightRanges(
    ranges: HighlightRangeDto[],
    textLength: number,
  ): HighlightRangeDto[] {
    const normalized = ranges
      .map((range) => ({
        start: Math.max(0, Math.min(textLength, Math.floor(range.start))),
        end: Math.max(0, Math.min(textLength, Math.ceil(range.end))),
        color: range.color,
        fontWeight: range.fontWeight,
        fontSizeScale: range.fontSizeScale,
      }))
      .filter((range) => range.end > range.start)
      .sort((a, b) =>
        a.start === b.start ? a.end - b.end : a.start - b.start,
      );
    if (!normalized.length) return [];
    const merged: HighlightRangeDto[] = [];
    for (const current of normalized) {
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push(current);
        continue;
      }
      if (current.start <= last.end) {
        last.end = Math.max(last.end, current.end);
        last.color = current.color || last.color;
        last.fontWeight = Math.max(
          this.readNumber(last.fontWeight, 900),
          this.readNumber(current.fontWeight, 900),
        );
        last.fontSizeScale = Math.max(
          this.readNumber(last.fontSizeScale, 1.18),
          this.readNumber(current.fontSizeScale, 1.18),
        );
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  private escapeAssSegment(text: string): string {
    return text
      .replace(/\r\n|\r|\n/g, '\\N')
      .replace(/[{}]/g, '')
      .trim();
  }

  private toAssOverrideColor(input: string): string {
    const { r, g, b } = this.parseColor(input);
    return `&H${this.hexByte(b)}${this.hexByte(g)}${this.hexByte(r)}&`;
  }

  private readFiniteSeconds(value: unknown): number | null {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
  }

  private roundSeconds(value: number): number {
    return Number(Math.max(0, value).toFixed(3));
  }

  private async buildSpeechAudio(
    script: string,
    voice: {
      id: string;
      name: string;
      cloneStatus: 'ready' | 'processing' | 'failed';
      canUseForRender: boolean;
      renderUnavailableReason: string | null;
      provider: string | null;
      providerVoice: string | null;
      providerModel: string | null;
      audioUrl: string | null;
    },
    voiceTuning?: VoiceTuningOptions,
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    originalname: string;
    ttsMode: TtsMode;
    styleHint?: string;
  }> {
    if (!voice.canUseForRender) {
      throw new BadRequestException(
        voice.renderUnavailableReason || '当前音色暂不可用，请稍后重试',
      );
    }

    if (voice.provider === 'local-upload') {
      const localAudio = await this.resources.readManagedVoiceSample(
        voice.audioUrl,
      );
      if (!localAudio) {
        throw new BadRequestException(
          '未找到本地上传音频文件，请重新上传音色素材',
        );
      }
      return {
        buffer: localAudio.buffer,
        mimeType: localAudio.mimetype,
        originalname: localAudio.originalname,
        ttsMode: 'provider',
        styleHint:
          '当前使用本地上传音频，不会重新应用情绪/强度；如需动态配音，请选择 TTS 音色。',
      };
    }

    try {
      const speech = await this.speechAi.synthesizeAudio({
        text: script,
        voiceStyleId: voice.id,
        voiceName: voice.name,
        provider: voice.provider,
        providerVoice: voice.providerVoice,
        providerModel: voice.providerModel,
        voiceTuning,
      });
      return {
        buffer: speech.buffer,
        mimeType: speech.mimeType,
        originalname: this.audioFileNameForMime(speech.mimeType),
        ttsMode: 'provider',
        styleHint: speech.styleHint,
      };
    } catch (e) {
      throw new BadRequestException(
        `TTS 调用失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async buildSubtitleTimeline(
    script: string,
    audio: {
      buffer: Buffer;
      mimeType: string;
      originalname: string;
      ttsMode: TtsMode;
    },
    avatarResourceId: string,
    voiceResourceId: string,
    subtitleTemplate: SubtitleTemplateResourceDto,
  ): Promise<{
    subtitleJson: SubtitleJsonDto;
    timelineSource: TimelineSource;
  }> {
    let segments = this.buildEstimatedSegments(script);
    let language = 'zh-CN';
    let timelineSource: TimelineSource = 'local-estimate';

    if (audio.ttsMode === 'provider') {
      const health = await this.transcription.checkHealth().catch(() => null);
      if (health?.transcribeUrlConfigured) {
        try {
          const transcript = await this.transcription.transcribeMedia({
            buffer: audio.buffer,
            originalname: audio.originalname,
            mimetype: audio.mimeType,
            size: audio.buffer.length,
          });
          if (
            transcript.segments.length > 0 &&
            this.isTimelineTranscriptCompleteEnough(script, transcript.fullText)
          ) {
            segments = transcript.segments;
            language = transcript.language || 'zh-CN';
            timelineSource = 'asr-fallback';
          } else if (transcript.segments.length > 0) {
            this.logger.warn(
              `ASR fallback timeline ignored because transcript is shorter than source script: source=${this.normalizedTextLength(
                script,
              )}, transcript=${this.normalizedTextLength(transcript.fullText)}`,
            );
          }
        } catch (e) {
          this.logger.warn(
            `ASR fallback timeline failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    const cues = this.normalizeCues(
      segments,
      script,
      subtitleTemplate.styleJson,
    );
    const durationMs =
      cues[cues.length - 1]?.endMs ?? Math.max(3_000, script.length * 220);

    return {
      timelineSource,
      subtitleJson: {
        version: 1,
        language,
        durationMs,
        generatedAt: nowIso(),
        source: {
          script,
          avatarResourceId,
          voiceResourceId,
          subtitleTemplateId: subtitleTemplate.id,
        },
        template: {
          id: subtitleTemplate.id,
          name: subtitleTemplate.name,
          styleJson: subtitleTemplate.styleJson,
        },
        cues,
      },
    };
  }

  private normalizeCues(
    segments: TranscriptSegmentDto[],
    script: string,
    styleJson: Record<string, unknown>,
  ): SubtitleCueDto[] {
    const fallback = this.buildEstimatedSegments(script);
    const source = segments.length > 0 ? segments : fallback;
    const lineChars = this.clampNumber(
      this.readNumber(styleJson.lineChars, 14),
      8,
      16,
    );
    const maxCueChars = lineChars * 2;
    const cues: SubtitleCueDto[] = [];

    for (const [segmentIndex, segment] of source.entries()) {
      const text = this.sanitizeCueText(segment.text || '');
      if (!text) continue;
      const startMs = Math.max(0, Math.round(segment.startMs));
      const endMs = Math.max(startMs + 600, Math.round(segment.endMs));
      const chunks = this.chunkTextForCue(text, maxCueChars);
      const span = endMs - startMs;

      chunks.forEach((chunk, chunkIndex) => {
        const chunkStartMs =
          startMs + Math.floor((span * chunkIndex) / chunks.length);
        const chunkEndMs =
          chunkIndex === chunks.length - 1
            ? endMs
            : startMs + Math.floor((span * (chunkIndex + 1)) / chunks.length);
        cues.push({
          id: `cue-${segmentIndex + 1}-${chunkIndex + 1}`,
          startMs: chunkStartMs,
          endMs: Math.max(chunkStartMs + 500, chunkEndMs),
          text: chunk,
          lines: this.wrapCueText(chunk, lineChars),
        });
      });
    }

    return cues.length > 0
      ? cues
      : [
          {
            id: 'cue-1',
            startMs: 0,
            endMs: Math.max(3_000, script.length * 220),
            text: script,
            lines: this.wrapCueText(script, lineChars),
          },
        ];
  }

  private buildEstimatedSegments(script: string): TranscriptSegmentDto[] {
    const chunks = script
      .split(/(?<=[。！？!?；;])|\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const source =
      chunks.length > 0 ? chunks : (script.match(/.{1,16}/g) ?? [script]);
    let cursor = 0;
    return source.map((text) => {
      const duration = Math.max(
        1_000,
        Math.min(7_000, Math.round(text.length * 210)),
      );
      const segment = {
        startMs: cursor,
        endMs: cursor + duration,
        text,
      };
      cursor += duration;
      return segment;
    });
  }

  private isTimelineTranscriptCompleteEnough(
    script: string,
    transcriptText: string,
  ): boolean {
    const sourceLength = this.normalizedTextLength(script);
    const transcriptLength = this.normalizedTextLength(transcriptText);
    if (sourceLength <= 0) return true;
    if (transcriptLength <= 0) return false;
    return (
      transcriptLength >= sourceLength * 0.9 ||
      sourceLength - transcriptLength <= 24
    );
  }

  private normalizedTextLength(value: string): number {
    return value.replace(/\s+/g, '').trim().length;
  }

  private wrapCueText(text: string, lineChars: number): string[] {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    if (normalized.length <= lineChars) return [normalized];

    const parts: string[] = [];
    let cursor = 0;
    while (cursor < normalized.length && parts.length < 2) {
      parts.push(normalized.slice(cursor, cursor + lineChars).trim());
      cursor += lineChars;
    }
    return parts.filter(Boolean);
  }

  private chunkTextForCue(text: string, maxChars: number): string[] {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    if (normalized.length <= maxChars) return [normalized];

    const chunks: string[] = [];
    let cursor = 0;
    while (cursor < normalized.length) {
      chunks.push(normalized.slice(cursor, cursor + maxChars).trim());
      cursor += maxChars;
    }
    return chunks.filter(Boolean);
  }

  private sanitizeCueText(text: string): string {
    return this.sanitizeUserScript(text).replace(/\s+/g, ' ').trim();
  }

  private sanitizeUserScript(value: string): string {
    return value
      .split(/\r\n|\n|\r/)
      .map((line) => line.trim())
      .filter((line) => line && !this.isInternalPipelineLine(line))
      .join('\n')
      .trim();
  }

  private isInternalPipelineLine(line: string): boolean {
    const normalized = line.replace(/\s+/g, ' ').trim();
    if (!normalized) return false;
    return (
      normalized.includes('模拟口播原文稿') ||
      normalized.includes('原视频链接占位') ||
      normalized.includes('真实链路') ||
      (normalized.includes('FFmpeg') &&
        normalized.includes('ASR') &&
        normalized.includes('回填')) ||
      /^https?:\/\/\S+$/i.test(normalized)
    );
  }

  private audioFileNameForMime(mimeType: string): string {
    if (mimeType === 'audio/wav') return 'tts.wav';
    if (mimeType === 'audio/mp4') return 'tts.m4a';
    return 'tts.mp3';
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

  private draftMediaFileName(
    prefix: string,
    originalname: string,
    fallbackExt: string,
  ): string {
    const ext = path.extname(originalname || '').toLowerCase() || fallbackExt;
    const safeExt = /^\.[a-z0-9]{2,6}$/i.test(ext) ? ext : fallbackExt;
    return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}${safeExt}`;
  }

  private buildAssScript(subtitleJson: SubtitleJsonDto): string {
    const style = subtitleJson.template.styleJson || {};
    const fontFamily = this.readString(style.fontFamily, 'Noto Sans CJK SC');
    const fontSize = this.clampNumber(this.readNumber(style.size, 38), 24, 42);
    const outline = this.clampNumber(
      this.readNumber(style.strokeWidth, 2.2),
      1.2,
      3.2,
    );
    const marginBottom = this.clampNumber(
      this.readNumber(style.marginBottom, 72),
      42,
      118,
    );
    const spacing = this.clampNumber(
      this.readNumber(style.letterSpacing, 0),
      0,
      2,
    );
    const weight = this.readNumber(style.weight, 700);
    const position = this.readString(style.position, 'bottom');
    const hasBackground =
      typeof style.background === 'string' &&
      style.background.trim().length > 0;
    const resolvedLayout = this.resolveNormalizedSubtitleLayout(style.layout);
    const fallbackAnchor = this.legacyPositionToAnchor(position);
    const alignment = this.anchorToAssAlignment(
      resolvedLayout?.anchor ?? fallbackAnchor,
    );

    const header = [
      '[Script Info]',
      'ScriptType: v4.00+',
      'PlayResX: 720',
      'PlayResY: 1280',
      'WrapStyle: 2',
      'ScaledBorderAndShadow: yes',
      'YCbCr Matrix: TV.601',
      '',
      '[V4+ Styles]',
      'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
      [
        'Style: Default',
        fontFamily,
        fontSize,
        this.toAssColor(this.readString(style.color, '#FFFFFF')),
        this.toAssColor(
          this.readString(
            style.highlightColor,
            this.readString(style.color, '#FFFFFF'),
          ),
        ),
        this.toAssColor(this.readString(style.stroke, '#111827')),
        this.toAssColor(this.readString(style.background, '#00000000')),
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
        marginBottom,
        1,
      ].join(','),
      '',
      '[Events]',
      'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
    ].join('\n');

    const events = subtitleJson.cues
      .map(
        (cue) =>
          `Dialogue: 0,${this.toAssTime(cue.startMs)},${this.toAssTime(cue.endMs)},Default,,0,0,0,,${this.buildAssPositionTag(resolvedLayout)}${this.escapeAssText(cue.lines.join('\\N'))}`,
      )
      .join('\n');

    return `${header}\n${events}\n`;
  }

  private toAssTime(ms: number): string {
    const total = Math.max(0, Math.round(ms));
    const hours = Math.floor(total / 3_600_000);
    const minutes = Math.floor((total % 3_600_000) / 60_000);
    const seconds = Math.floor((total % 60_000) / 1_000);
    const centiseconds = Math.floor((total % 1_000) / 10);
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
  }

  private escapeAssText(text: string): string {
    return text
      .replace(/\r\n|\r|\n/g, '\\N')
      .replace(/[{}]/g, '')
      .trim();
  }

  private toAssColor(input: string): string {
    const { r, g, b, a } = this.parseColor(input);
    const alpha = Math.round((1 - a) * 255);
    return `&H${this.hexByte(alpha)}${this.hexByte(b)}${this.hexByte(g)}${this.hexByte(r)}&`;
  }

  private parseColor(input: string): {
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
        r: Math.max(0, Math.min(255, Number(rgbaMatch[1]))),
        g: Math.max(0, Math.min(255, Number(rgbaMatch[2]))),
        b: Math.max(0, Math.min(255, Number(rgbaMatch[3]))),
        a:
          rgbaMatch[4] === undefined
            ? 1
            : Math.max(0, Math.min(1, Number(rgbaMatch[4]))),
      };
    }

    return { r: 255, g: 255, b: 255, a: 1 };
  }

  private hexByte(value: number): string {
    return Math.max(0, Math.min(255, value))
      .toString(16)
      .toUpperCase()
      .padStart(2, '0');
  }

  private readNumber(value: unknown, fallback: number): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private readString(
    value: unknown,
    fallback: string,
    fallback2?: string,
  ): string {
    if (typeof value === 'string' && value.trim()) return value.trim();
    return fallback2 ?? fallback;
  }

  private async readVideoFromSourceRef(
    sourceRef: string,
  ): Promise<TranscribeMediaInput> {
    const local = this.resolveSavedVideoPathMaybe(sourceRef);
    if (local) {
      const buffer = await fs.readFile(local);
      return {
        buffer,
        originalname: path.basename(local),
        mimetype: guessMimeFromFilename(local),
        size: buffer.length,
      };
    }

    const normalized = normalizeSourceVideoUrl(sourceRef) || sourceRef.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      throw new BadRequestException(
        '数字人视频需要绑定可访问的原始视频地址，或本地保存文件名',
      );
    }

    if (normalized.toLowerCase().includes('douyin.com')) {
      const dl =
        await this.videoMediaDownload.tryDownloadForTranscription(normalized);
      if (!dl.ok) {
        throw new BadRequestException(
          '抖音视频下载失败，请先确认 Cookie 与链接有效',
        );
      }
      return dl.media;
    }

    return this.fetchRemoteVideo(normalized);
  }

  private async fetchRemoteVideo(url: string): Promise<TranscribeMediaInput> {
    const remoteUrl = new URL(url);
    assertUrlSafeForServerFetch(remoteUrl);
    const controller = new AbortController();
    const timeoutMs = Number(
      this.config.get('VIDEO_FETCH_TIMEOUT_MS') ?? 120_000,
    );
    const maxBytes = Number(
      this.config.get('VIDEO_FETCH_MAX_BYTES') ??
        this.config.get('TRANSCRIBE_MEDIA_MAX_BYTES') ??
        200 * 1024 * 1024,
    );
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(remoteUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new BadRequestException(`远程视频拉取失败：HTTP ${res.status}`);
      }
      const contentLength = Number(res.headers.get('content-length') ?? 0);
      if (contentLength > maxBytes) {
        throw new BadRequestException(
          `远程视频过大，最大允许 ${maxBytes} 字节`,
        );
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw new BadRequestException(
          `远程视频过大，最大允许 ${maxBytes} 字节`,
        );
      }
      if (!buffer.length) {
        throw new BadRequestException('远程视频内容为空');
      }
      const filename = sanitizeFilenameForDisk(
        path.basename(new URL(res.url || url).pathname) || 'avatar-video.mp4',
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

  private resolveSavedVideoPathMaybe(sourceRef: string): string | null {
    const trimmed = sourceRef.trim();
    if (
      !trimmed ||
      /^(https?:)?\/\//i.test(trimmed) ||
      trimmed.startsWith('data:')
    )
      return null;
    const base = path.basename(trimmed);
    if (base !== trimmed || /[\\/]/.test(trimmed) || trimmed.includes('..'))
      return null;
    const dir = path.resolve(getVideoSaveDir(this.config));
    const full = path.resolve(path.join(dir, base));
    const relative = path.relative(dir, full);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !existsSync(full)
    )
      return null;
    return full;
  }

  private async applyLipSyncSourceFormatContract(params: {
    sourceVideoPath: string;
    preparedVideoPath: string;
    providerVideoPath: string;
    draftDir: string;
    renderMode: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
    context: string;
  }): Promise<{ finalPath: string; trace: LipSyncFormatContractTrace }> {
    const sourceContract = await this.ffmpegAudio.probeVideoFormatContract(
      params.sourceVideoPath,
    );
    const preparedContract = await this.ffmpegAudio.probeVideoFormatContract(
      params.preparedVideoPath,
    );
    const providerContract = await this.ffmpegAudio.probeVideoFormatContract(
      params.providerVideoPath,
    );
    const trace: LipSyncFormatContractTrace = {
      renderMode: params.renderMode,
      source: sourceContract,
      preparedInput: preparedContract,
      providerOutput: providerContract,
      finalOutput: providerContract,
      restored: false,
    };
    if (params.renderMode !== 'preserveSourceAspect') {
      return { finalPath: params.providerVideoPath, trace };
    }
    if (!sourceContract?.video || !providerContract?.video) {
      throw new BadRequestException(
        'Unable to validate lip-sync output against source video format contract.',
      );
      /*
      throw new BadRequestException(
        '鏃犳硶鏍￠獙鍙ｅ瀷杈撳嚭涓庢簮瑙嗛鏍煎紡鍚堝悓锛岃绋嶅悗閲嶈瘯',
      );
      */
    }
    if (this.isVideoResolutionAligned(sourceContract, providerContract)) {
      return { finalPath: params.providerVideoPath, trace };
    }

    const restoredPath = path.join(
      params.draftDir,
      `lip-sync-contract-restored_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`,
    );
    await this.ffmpegAudio.restoreVideoToSourceContract({
      inputVideoPath: params.providerVideoPath,
      outputVideoPath: restoredPath,
      sourceContract,
    });
    const restoredContract =
      await this.ffmpegAudio.probeVideoFormatContract(restoredPath);
    trace.restored = true;
    trace.finalOutput = restoredContract;
    if (
      !restoredContract ||
      !this.isVideoResolutionAligned(sourceContract, restoredContract)
    ) {
      this.logger.warn(
        `[${params.context}] lip-sync resolution mismatch after restore: source=${JSON.stringify(
          this.formatContractLogSummary(sourceContract),
        )} provider=${JSON.stringify(this.formatContractLogSummary(providerContract))} final=${JSON.stringify(this.formatContractLogSummary(restoredContract))}`,
      );
      throw new BadRequestException(
        'Lip-sync output resolution could not be aligned to source video.',
      );
      /*
      throw new BadRequestException(
        '鍙ｅ瀷杈撳嚭鏈繚鎸佹簮瑙嗛鏍煎紡锛岃鏇存崲绱犳潗鎴栫◢鍚庨噸璇?,
      );
      */
    }
    return { finalPath: restoredPath, trace };
  }

  private isVideoResolutionAligned(
    source: VideoFormatContract,
    target: VideoFormatContract,
  ): boolean {
    if (!source.video || !target.video) return false;
    const sourceVideo = source.video;
    const targetVideo = target.video;
    const eqNumber = (a: number | null, b: number | null): boolean =>
      a === b || (a === null && b === null);
    return (
      eqNumber(sourceVideo.width, targetVideo.width) &&
      eqNumber(sourceVideo.height, targetVideo.height)
    );
  }

  private formatContractLogSummary(
    contract: VideoFormatContract | null,
  ): Record<string, unknown> {
    return {
      formatName: contract?.formatName ?? null,
      durationSeconds: contract?.durationSeconds ?? null,
      video: contract?.video
        ? {
            width: contract.video.width,
            height: contract.video.height,
            codedWidth: contract.video.codedWidth,
            codedHeight: contract.video.codedHeight,
            sar: contract.video.sampleAspectRatio,
            dar: contract.video.displayAspectRatio,
            fps: contract.video.avgFrameRate,
            pixFmt: contract.video.pixFmt,
            colorRange: contract.video.colorRange,
            colorSpace: contract.video.colorSpace,
            colorTransfer: contract.video.colorTransfer,
            colorPrimaries: contract.video.colorPrimaries,
          }
        : null,
      audioStreamCount: contract?.audioStreams.length ?? 0,
      audioStreams:
        contract?.audioStreams.map((stream) => ({
          codecName: stream.codecName,
          sampleRate: stream.sampleRate,
          channels: stream.channels,
          channelLayout: stream.channelLayout,
          isDefault: stream.isDefault,
        })) ?? [],
    };
  }

  private async runLipSyncMediaPreflight(params: {
    sourceVideoPath: string;
    preparedVideoPath: string;
    speechAudioPath: string;
    speechAudioMimeType: string;
    speechAudioOriginalName: string;
    draftDir: string;
    renderMode: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
  }): Promise<{
    audioPath: string;
    audioMimeType: string;
    audioFileName: string;
    preflightTrace: LipSyncMediaPreflightTrace;
  }> {
    const limits = this.readLipSyncPreflightLimits();
    const [sourceSummary, preparedSummary] = await Promise.all([
      this.ffmpegAudio.probeMediaSummary(params.sourceVideoPath),
      this.ffmpegAudio.probeMediaSummary(params.preparedVideoPath),
    ]);
    if (!sourceSummary) {
      throw new BadRequestException(
        '口型任务提交前体检失败：无法读取源视频媒体信息',
      );
    }
    if (!preparedSummary) {
      throw new BadRequestException(
        '口型任务提交前体检失败：无法读取预处理视频媒体信息',
      );
    }

    this.assertLipSyncMediaThreshold('源视频', sourceSummary, {
      maxDurationSeconds: limits.maxSourceDurationSeconds,
      maxSizeBytes: limits.maxSourceSizeBytes,
    });
    this.assertLipSyncMediaThreshold('预处理视频', preparedSummary, {
      maxDurationSeconds: limits.maxPreparedDurationSeconds,
      maxSizeBytes: limits.maxPreparedSizeBytes,
      maxWidth: limits.maxPreparedWidth,
      maxHeight: limits.maxPreparedHeight,
    });

    const preparedPixFmt = preparedSummary.video?.pixFmt?.toLowerCase() || null;
    if (
      preparedPixFmt &&
      limits.allowedPreparedPixFmts.size > 0 &&
      !limits.allowedPreparedPixFmts.has(preparedPixFmt)
    ) {
      throw new BadRequestException(
        `预处理视频像素格式不支持：pix_fmt=${preparedPixFmt}，允许=${Array.from(
          limits.allowedPreparedPixFmts,
        ).join(',')}`,
      );
    }

    const normalizedAudio = await this.normalizeLipSyncAudioInput({
      audioPath: params.speechAudioPath,
      mimeType: params.speechAudioMimeType,
      originalName: params.speechAudioOriginalName,
      draftDir: params.draftDir,
    });
    this.assertLipSyncMediaThreshold('输入音频', normalizedAudio.summary, {
      maxDurationSeconds: limits.maxAudioDurationSeconds,
      maxSizeBytes: limits.maxAudioSizeBytes,
    });

    const trace: LipSyncMediaPreflightTrace = {
      sourceVideo: this.formatMediaSummaryLog(sourceSummary),
      preparedVideo: this.formatMediaSummaryLog(preparedSummary),
      audioInput: this.formatMediaSummaryLog(normalizedAudio.summary),
      normalizedAudio: {
        converted: normalizedAudio.converted,
        reason: normalizedAudio.reason,
        mimeType: normalizedAudio.mimeType,
        fileName: normalizedAudio.fileName,
      },
      limits: {
        maxSourceDurationSeconds: limits.maxSourceDurationSeconds,
        maxSourceSizeBytes: limits.maxSourceSizeBytes,
        maxPreparedDurationSeconds: limits.maxPreparedDurationSeconds,
        maxPreparedSizeBytes: limits.maxPreparedSizeBytes,
        maxPreparedWidth: limits.maxPreparedWidth,
        maxPreparedHeight: limits.maxPreparedHeight,
        allowedPreparedPixFmts: Array.from(limits.allowedPreparedPixFmts),
        maxAudioDurationSeconds: limits.maxAudioDurationSeconds,
        maxAudioSizeBytes: limits.maxAudioSizeBytes,
      },
    };
    this.logger.log(
      `[lipsync-preflight] mode=${params.renderMode} source=${JSON.stringify(
        trace.sourceVideo,
      )} prepared=${JSON.stringify(trace.preparedVideo)} audio=${JSON.stringify(
        trace.audioInput,
      )} normalized=${JSON.stringify(trace.normalizedAudio)}`,
    );
    return {
      audioPath: normalizedAudio.audioPath,
      audioMimeType: normalizedAudio.mimeType,
      audioFileName: normalizedAudio.fileName,
      preflightTrace: trace,
    };
  }

  private readLipSyncPreflightLimits(): {
    maxSourceDurationSeconds: number;
    maxSourceSizeBytes: number;
    maxPreparedDurationSeconds: number;
    maxPreparedSizeBytes: number;
    maxPreparedWidth: number;
    maxPreparedHeight: number;
    allowedPreparedPixFmts: Set<string>;
    maxAudioDurationSeconds: number;
    maxAudioSizeBytes: number;
  } {
    const readInt = (key: string, fallback: number): number => {
      const raw = this.config.get<string>(key);
      if (!raw?.trim()) return fallback;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return fallback;
      return Math.floor(n);
    };
    // VideoRetalk documented limits:
    // - video: <=300MB, duration 2-120s, side length <=2048
    // - audio: <=30MB, duration 2-120s
    const VIDEO_MAX_DURATION_SECONDS = 120;
    const VIDEO_MAX_SIZE_BYTES = 300 * 1024 * 1024;
    const VIDEO_MAX_SIDE_PX = 2048;
    const AUDIO_MAX_DURATION_SECONDS = 120;
    const AUDIO_MAX_SIZE_BYTES = 30 * 1024 * 1024;
    const allowedPixFmtsRaw =
      this.config.get<string>('ALI_VIDEORETALK_MEDIA_ALLOWED_PIX_FMTS') || '';
    const allowedPreparedPixFmts = new Set(
      allowedPixFmtsRaw
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );
    return {
      maxSourceDurationSeconds: readInt(
        'ALI_VIDEORETALK_MEDIA_MAX_SOURCE_DURATION_SECONDS',
        VIDEO_MAX_DURATION_SECONDS,
      ),
      maxSourceSizeBytes: readInt(
        'ALI_VIDEORETALK_MEDIA_MAX_SOURCE_SIZE_BYTES',
        VIDEO_MAX_SIZE_BYTES,
      ),
      maxPreparedDurationSeconds: readInt(
        'ALI_VIDEORETALK_MEDIA_MAX_PREPARED_DURATION_SECONDS',
        VIDEO_MAX_DURATION_SECONDS,
      ),
      maxPreparedSizeBytes: readInt(
        'ALI_VIDEORETALK_MEDIA_MAX_PREPARED_SIZE_BYTES',
        VIDEO_MAX_SIZE_BYTES,
      ),
      maxPreparedWidth: readInt(
        'ALI_VIDEORETALK_MEDIA_MAX_PREPARED_WIDTH',
        VIDEO_MAX_SIDE_PX,
      ),
      maxPreparedHeight: readInt(
        'ALI_VIDEORETALK_MEDIA_MAX_PREPARED_HEIGHT',
        VIDEO_MAX_SIDE_PX,
      ),
      allowedPreparedPixFmts,
      maxAudioDurationSeconds: readInt(
        'ALI_VIDEORETALK_MEDIA_MAX_AUDIO_DURATION_SECONDS',
        AUDIO_MAX_DURATION_SECONDS,
      ),
      maxAudioSizeBytes: readInt(
        'ALI_VIDEORETALK_MEDIA_MAX_AUDIO_SIZE_BYTES',
        AUDIO_MAX_SIZE_BYTES,
      ),
    };
  }

  private assertLipSyncMediaThreshold(
    label: string,
    summary: MediaProbeSummary,
    limits: {
      maxDurationSeconds?: number;
      maxSizeBytes?: number;
      maxWidth?: number;
      maxHeight?: number;
    },
  ): void {
    const duration = summary.durationSeconds ?? null;
    if (
      duration !== null &&
      limits.maxDurationSeconds &&
      duration > limits.maxDurationSeconds
    ) {
      throw new BadRequestException(
        `${label}时长过长：${duration.toFixed(2)}s，最大允许 ${limits.maxDurationSeconds}s`,
      );
    }
    const sizeBytes = summary.sizeBytes ?? null;
    if (
      sizeBytes !== null &&
      limits.maxSizeBytes &&
      sizeBytes > limits.maxSizeBytes
    ) {
      throw new BadRequestException(
        `${label}体积过大：${this.formatBytes(sizeBytes)}，最大允许 ${this.formatBytes(
          limits.maxSizeBytes,
        )}`,
      );
    }
    if (summary.video && limits.maxWidth && summary.video.width) {
      if (summary.video.width > limits.maxWidth) {
        throw new BadRequestException(
          `${label}宽度过大：${summary.video.width}px，最大允许 ${limits.maxWidth}px`,
        );
      }
    }
    if (summary.video && limits.maxHeight && summary.video.height) {
      if (summary.video.height > limits.maxHeight) {
        throw new BadRequestException(
          `${label}高度过大：${summary.video.height}px，最大允许 ${limits.maxHeight}px`,
        );
      }
    }
  }

  private resolveSummaryBitRate(summary: MediaProbeSummary): number | null {
    if (summary.bitRate && summary.bitRate > 0) return summary.bitRate;
    if (
      !summary.sizeBytes ||
      !summary.durationSeconds ||
      summary.durationSeconds <= 0
    ) {
      return null;
    }
    const estimated = Math.round(
      (summary.sizeBytes * 8) / summary.durationSeconds,
    );
    return Number.isFinite(estimated) && estimated > 0 ? estimated : null;
  }

  private formatBytes(bytes: number): string {
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  private formatMediaSummaryLog(
    summary: MediaProbeSummary,
  ): Record<string, unknown> {
    return {
      formatName: summary.formatName,
      durationSeconds: summary.durationSeconds,
      sizeBytes: summary.sizeBytes,
      bitRate: this.resolveSummaryBitRate(summary),
      video: summary.video,
      audio: summary.audio,
    };
  }

  private parseContainerFromFormatName(
    formatName: string | null,
  ): string | null {
    if (!formatName) return null;
    const first = formatName
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .find(Boolean);
    if (!first) return null;
    if (first === 'mov') return 'mp4';
    return first;
  }

  private containerToMime(container: string): string | null {
    if (container === 'wav') return 'audio/wav';
    if (container === 'aac') return 'audio/aac';
    if (container === 'mp4' || container === 'm4a') return 'audio/mp4';
    return null;
  }

  private containerToExtension(container: string): string | null {
    if (container === 'wav') return '.wav';
    if (container === 'aac') return '.aac';
    if (container === 'mp4' || container === 'm4a') return '.m4a';
    return null;
  }

  private async normalizeLipSyncAudioInput(params: {
    audioPath: string;
    mimeType: string;
    originalName: string;
    draftDir: string;
  }): Promise<{
    audioPath: string;
    mimeType: string;
    fileName: string;
    summary: MediaProbeSummary;
    converted: boolean;
    reason: string | null;
  }> {
    const summary = await this.ffmpegAudio.probeMediaSummary(params.audioPath);
    if (!summary) {
      throw new BadRequestException(
        '口型任务提交前体检失败：无法读取输入音频媒体信息',
      );
    }
    const detectedContainer = this.parseContainerFromFormatName(
      summary.formatName,
    );
    const expectedExt = detectedContainer
      ? this.containerToExtension(detectedContainer)
      : null;
    const expectedMime = detectedContainer
      ? this.containerToMime(detectedContainer)
      : null;
    const actualExt = path.extname(params.audioPath).toLowerCase();
    const normalizedMime = (params.mimeType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const supportedContainer =
      detectedContainer === 'wav' || detectedContainer === 'aac';
    const extMatched =
      expectedExt !== null ? expectedExt === actualExt : actualExt.length > 0;
    const mimeMatched =
      expectedMime !== null
        ? normalizedMime === expectedMime
        : normalizedMime.startsWith('audio/');

    if (supportedContainer && extMatched) {
      return {
        audioPath: params.audioPath,
        mimeType: expectedMime || params.mimeType || 'audio/wav',
        fileName: path.basename(params.audioPath),
        summary,
        converted: false,
        reason: mimeMatched ? null : 'mime-normalized',
      };
    }

    const normalizedPath = path.join(
      params.draftDir,
      `lipsync-audio-normalized_${Date.now()}_${randomUUID().slice(0, 8)}.wav`,
    );
    await this.ffmpegAudio.clipAudio({
      inputAudioPath: params.audioPath,
      outputAudioPath: normalizedPath,
    });
    const normalizedSummary =
      await this.ffmpegAudio.probeMediaSummary(normalizedPath);
    if (!normalizedSummary) {
      throw new BadRequestException('输入音频规范化后无法读取媒体信息');
    }
    return {
      audioPath: normalizedPath,
      mimeType: 'audio/wav',
      fileName: path.basename(normalizedPath),
      summary: normalizedSummary,
      converted: true,
      reason: supportedContainer
        ? 'extension-mismatch'
        : 'unsupported-container',
    };
  }

  private buildLipSyncAssetMetadata(
    trace: LipSyncFormatContractTrace,
    preflightTrace?: LipSyncMediaPreflightTrace,
  ): Record<string, unknown> {
    return {
      formatContract: {
        renderMode: trace.renderMode,
        restored: trace.restored,
        source: this.formatContractLogSummary(trace.source),
        preparedInput: this.formatContractLogSummary(trace.preparedInput),
        providerOutput: this.formatContractLogSummary(trace.providerOutput),
        finalOutput: this.formatContractLogSummary(trace.finalOutput),
      },
      ...(preflightTrace ? { mediaPreflight: preflightTrace } : {}),
    };
  }

  private async persistResultVideoToDraft(
    videoUrl: string,
    draftDir: string,
  ): Promise<string> {
    const outPath = path.join(
      draftDir,
      `lip-synced_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`,
    );
    if (videoUrl.startsWith('data:')) {
      const match = videoUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
      if (!match?.[3]) {
        throw new BadRequestException('对口型结果 data URL 无效');
      }
      const buffer = Buffer.from(match[3], match[2] ? 'base64' : 'utf8');
      await fs.writeFile(outPath, buffer);
      return outPath;
    }

    const remoteUrl = new URL(videoUrl);
    assertUrlSafeForServerFetch(remoteUrl);
    const timeoutMs = Number(
      this.config.get('LIP_SYNC_FETCH_TIMEOUT_MS') ?? 300_000,
    );
    const maxBytes = Number(
      this.config.get('LIP_SYNC_RESULT_MAX_BYTES') ?? 500 * 1024 * 1024,
    );
    const res = await fetch(remoteUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new BadRequestException(`拉取对口型结果失败：HTTP ${res.status}`);
    }
    const contentLength = Number(res.headers.get('content-length') ?? 0);
    if (contentLength > maxBytes) {
      throw new BadRequestException(
        `对口型结果视频过大，最大允许 ${maxBytes} 字节`,
      );
    }
    if (!res.body) {
      throw new BadRequestException('对口型结果视频响应为空');
    }
    await pipeline(
      Readable.fromWeb(res.body as unknown as NodeReadableStream<Uint8Array>),
      createWriteStream(outPath),
    );
    return outPath;
  }

  private async readAudioFromSource(params: {
    inputAudioPath?: string;
    inputAudioUrl?: string;
  }): Promise<{
    buffer: Buffer;
    mimeType: string;
    originalname: string;
    ttsMode: TtsMode;
  }> {
    const directPath = params.inputAudioPath?.trim();
    if (directPath) {
      const resolved = path.resolve(directPath);
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat?.isFile()) {
        throw new BadRequestException('inputAudioPath 文件不存在');
      }
      const buffer = await fs.readFile(resolved);
      return {
        buffer,
        mimeType: guessMimeFromFilename(resolved),
        originalname: path.basename(resolved),
        ttsMode: 'provider',
      };
    }

    const inputAudioUrl = params.inputAudioUrl?.trim();
    if (!inputAudioUrl) {
      throw new BadRequestException(
        '请提供 inputAudioPath 或 inputAudioUrl，或改用 voiceResourceId + script',
      );
    }
    if (inputAudioUrl.startsWith('data:')) {
      const match = inputAudioUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
      if (!match?.[3]) {
        throw new BadRequestException('inputAudioUrl data URL 无效');
      }
      const buffer = Buffer.from(match[3], match[2] ? 'base64' : 'utf8');
      return {
        buffer,
        mimeType: match[1] || 'audio/mpeg',
        originalname: 'input-audio',
        ttsMode: 'provider',
      };
    }

    const localMatch = inputAudioUrl.match(
      /\/uploads\/audio\/([^/?#]+)(?:[?#].*)?$/i,
    );
    if (localMatch?.[1]) {
      const fileName = decodeURIComponent(localMatch[1]);
      const localPath = path.join(
        getUploadRoot(this.config),
        'audio',
        fileName,
      );
      const stat = await fs.stat(localPath).catch(() => null);
      if (stat?.isFile()) {
        const buffer = await fs.readFile(localPath);
        return {
          buffer,
          mimeType: guessMimeFromFilename(localPath),
          originalname: fileName,
          ttsMode: 'provider',
        };
      }
    }

    const remoteUrl = new URL(inputAudioUrl);
    assertUrlSafeForServerFetch(remoteUrl);
    const timeoutMs = Number(
      this.config.get('AUDIO_FETCH_TIMEOUT_MS') ??
        this.config.get('REMOTE_MEDIA_FETCH_TIMEOUT_MS') ??
        120_000,
    );
    const maxBytes = Number(
      this.config.get('AUDIO_FETCH_MAX_BYTES') ?? 100 * 1024 * 1024,
    );
    const res = await fetch(remoteUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      throw new BadRequestException(`远程音频拉取失败: HTTP ${res.status}`);
    }
    const contentLength = Number(res.headers.get('content-length') ?? 0);
    if (contentLength > maxBytes) {
      throw new BadRequestException(`远程音频过大，超过 ${maxBytes} 字节限制`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) {
      throw new BadRequestException('远程音频内容为空');
    }
    if (buffer.length > maxBytes) {
      throw new BadRequestException(`远程音频过大，超过 ${maxBytes} 字节限制`);
    }
    const fileName = sanitizeFilenameForDisk(
      path.basename(new URL(res.url || inputAudioUrl).pathname) ||
        'input-audio.wav',
    );
    return {
      buffer,
      mimeType: guessMimeFromFilename(fileName),
      originalname: fileName,
      ttsMode: 'provider',
    };
  }

  private renderOutputStorage(): 'local' | 'oss' {
    const mode =
      this.config.get<string>('RENDER_OUTPUT_STORAGE')?.trim().toLowerCase() ||
      'local';
    return mode === 'oss' ? 'oss' : 'local';
  }

  private async publishRenderOutput(
    localPath: string,
    fileName: string,
  ): Promise<{ storage: 'local' | 'oss'; url: string }> {
    if (this.renderOutputStorage() === 'local') {
      return { storage: 'local', url: this.toOutputUrl(fileName) };
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
      Number(this.config.get('RENDER_OUTPUT_OSS_SIGNED_URL_TTL_SECONDS')) ||
        7 * 24 * 60 * 60,
    );
    return {
      storage: 'oss',
      url: client.signatureUrl(objectKey, {
        method: 'GET',
        expires: signedTtl,
      }),
    };
  }

  private getRenderOutputOssClient(): OssClient {
    if (this.renderOutputOssClient) return this.renderOutputOssClient;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const OSS = require('ali-oss') as new (
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

  private outputDir(): string {
    return path.resolve(getPreviewVideoSaveDir(this.config));
  }

  private finalOutputDir(): string {
    return getUploadOutputDir(this.config);
  }

  private draftRootDir(): string {
    return path.join(this.outputDir(), 'subtitle-workflow-drafts');
  }

  private draftDir(draftId: string): string {
    return path.join(this.draftRootDir(), draftId);
  }

  private metaPath(draftId: string): string {
    return path.join(this.draftDir(draftId), 'meta.json');
  }

  private outputFileName(prefix: string, ext: string): string {
    return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
  }

  private toPreviewUrl(fileName: string): string {
    return `/api/v1/tools/preview-videos/${encodeURIComponent(fileName)}/stream`;
  }

  private toOutputUrl(fileName: string): string {
    const configuredBase = this.config
      .get<string>('PUBLIC_UPLOAD_BASE_URL')
      ?.trim();
    const base =
      configuredBase ||
      `http://localhost:${this.config.get<string>('PORT')?.trim() || process.env.PORT || '3000'}/uploads`;
    return `${base.replace(/\/+$/, '')}/output/${encodeURIComponent(fileName)}`;
  }

  private async saveDraftMeta(meta: DraftMeta): Promise<void> {
    await fs.mkdir(this.draftDir(meta.id), { recursive: true });
    await fs.writeFile(
      this.metaPath(meta.id),
      JSON.stringify(meta, null, 2),
      'utf8',
    );
  }

  private async loadDraftMeta(draftId: string): Promise<DraftMeta> {
    const p = this.metaPath(draftId);
    if (!existsSync(p)) {
      throw new NotFoundException('未找到字幕预览草稿');
    }
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as DraftMeta;
  }
}
