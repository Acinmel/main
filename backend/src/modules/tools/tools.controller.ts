import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
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
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express, Request, Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { getTranscribeMediaMaxBytes } from '../../common/media.constants';
import { normalizeSourceVideoUrl } from '../../common/douyin-share-url.util';
import { resolveConfiguredDir } from '../../common/resource-paths.util';
import { RewriteAiService } from '../../integrations/ai/rewrite-ai.service';
import { DigitalHumanImageService } from '../../integrations/ai/digital-human-image.service';
import { VideoGenerateLlmService } from '../../integrations/ai/video-generate-llm.service';
import {
  SeedanceI2vService,
  type SeedanceI2vSubmitBody,
} from '../../integrations/ai/seedance-i2v.service';
import {
  ArkI2vVideoService,
  type ArkI2vTaskSubmitBody,
} from '../../integrations/ai/ark-i2v-video.service';
import { AliLipSyncService } from '../../integrations/ai/ali-lip-sync.service';
import {
  SpeechAiService,
  type VoiceTuningOptions,
} from '../../integrations/ai/speech-ai.service';
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

class SourceVideoUrlDto {
  /** 支持抖音整段分享文案或纯 URL */
  sourceVideoUrl!: string;
}

class DouyinTranscribeRewriteDto extends SourceVideoUrlDto {
  /** 与任务改写风格一致；默认 conservative */
  rewriteStyle?: RewriteStyle;
}

class DouyinHomepageLearnDto {
  homepageUrl!: string;
}

class SourceVideoFileDto {
  /** 支持抖音整段分享文案或纯 URL */
  sourceVideoUrl!: string;
  /**
   * 默认 true。为 false 时仅下载并保存到本机目录，不调用 ASR；
   * 前端可随后调用 `transcribe-saved-video` 以展示分阶段进度。
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
}

class VoicePreviewDto extends VoiceTuningDto {
  script!: string;
  voiceResourceId!: string;
}

class SubtitleWorkflowPreviewDto extends LipSyncPreviewDto {
  subtitleTemplateId!: string;
  previewSeconds?: number;
  voiceLanguage?: string;
  voiceEmotion?: string;
  voiceEmotionIntensity?: number;
  voiceRate?: number;
  voiceVolume?: number;
}

class SubtitleWorkflowFinalizeDto {
  draftId!: string;
}

const LIP_SYNC_MAX_DURATION_SECONDS = 5 * 60;

function getLipSyncVideoMaxBytes(): number {
  const v = process.env.ALI_LIP_SYNC_VIDEO_MAX_BYTES?.trim();
  if (v && /^\d+$/.test(v)) return parseInt(v, 10);
  return 300 * 1024 * 1024;
}

/** 默认保存到项目内 backend/data/download-video；可用 VIDEO_SAVE_DIR 覆盖。 */
function getVideoSaveDir(config: ConfigService): string {
  return resolveConfiguredDir(config.get<string>('VIDEO_SAVE_DIR'), 'download-video');
}

function getPreviewVideoSaveDir(config: ConfigService): string {
  return resolveConfiguredDir(config.get<string>('PREVIEW_VIDEO_SAVE_DIR'), 'preview-videos');
}

function getPreviewAudioSaveDir(config: ConfigService): string {
  return resolveConfiguredDir(config.get<string>('PREVIEW_AUDIO_SAVE_DIR'), 'preview-audios');
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampNumber(value: unknown, min: number, max: number): number | null {
  const parsed = readFiniteNumber(value);
  if (parsed === null) return null;
  return Math.min(max, Math.max(min, Number(parsed.toFixed(2))));
}

function cleanShortText(value: unknown, maxLength = 32): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function buildVoiceTuning(body: VoiceTuningDto): VoiceTuningOptions {
  return {
    language: cleanShortText(body.voiceLanguage),
    emotion: cleanShortText(body.voiceEmotion),
    emotionIntensity: clampNumber(body.voiceEmotionIntensity, 0.6, 1.5),
    speechRate: clampNumber(body.voiceRate, 0.5, 1.5),
    volume: clampNumber(body.voiceVolume, 0.5, 1.5),
  };
}

function getLipSyncPublicMediaDir(config: ConfigService, kind: 'videos' | 'audios'): string {
  const root = resolveConfiguredDir(
    config.get<string>('LIP_SYNC_PUBLIC_MEDIA_DIR'),
    'lip-sync-public',
  );
  return path.join(root, kind);
}

function sanitizeFilenameForDisk(name: string): string {
  const base = path
    .basename(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
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
      return Array.isArray(m) ? m.join('；') : String(m);
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

/** 仅允许单层文件名，防路径穿越 */
function assertSafeSavedBasename(name: string): string {
  const t = name.trim();
  if (!t) {
    throw new BadRequestException('fileName 不能为空');
  }
  const base = path.basename(t);
  if (base !== t || /[\\/]/.test(t) || t.includes('..')) {
    throw new BadRequestException('只允许保存目录下的文件名，不能包含路径');
  }
  return base;
}

/**
 * 工具类接口：不创建任务即可预览「解析后的口播文案」（当前为 ASR 占位实现）
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
    private readonly videoGenerateLlm: VideoGenerateLlmService,
    private readonly digitalHumanImage: DigitalHumanImageService,
    private readonly douyinBenchmark: DouyinBenchmarkService,
    private readonly digitalHumanPersistence: DigitalHumanPersistenceService,
    private readonly seedanceI2v: SeedanceI2vService,
    private readonly arkI2vVideo: ArkI2vVideoService,
    private readonly aliLipSync: AliLipSyncService,
    private readonly speechAi: SpeechAiService,
    private readonly resources: ResourcesService,
    private readonly subtitleWorkflow: SubtitleWorkflowService,
  ) {}

  /**
   * 第二步「生成视频」：大模型优化口播稿；若配置 ARK_API_KEY 且传入参考图，则走火山方舟图生视频并轮询成片，否则回退演示 MP4。
   */
  @Post('generate-video-preview')
  async generateVideoPreview(
    @Body()
    body: {
      script?: string;
      sourceVideoUrl?: string;
      /** 公网可访问的参考图 URL */
      imageUrl?: string;
      /** 数字人参考图 data URL（推荐，与专属数字人联调） */
      imageDataUrl?: string;
    },
  ): Promise<{
    optimizedScript: string;
    llmUsed: boolean;
    estimatedTotalSeconds: number;
    videoUrl: string | null;
    hint: string;
  }> {
    const script = body.script?.trim() ?? '';
    if (script.length < 2) {
      throw new BadRequestException('口播文案过短或为空');
    }
    const max = 50_000;
    if (script.length > max) {
      throw new BadRequestException(`口播文案过长（>${max}）`);
    }

    const { text, usedLlm } = await this.videoGenerateLlm.optimizeScriptForVideo(
      script,
      body.sourceVideoUrl?.trim(),
    );

    const promptSuffix = '  --duration 12 --camerafixed false --watermark true';
    /** 方舟图生视频默认提示：纯口播 + 文案驱动音频；允许手势，禁止物品/商品展示类画面 */
    const i2vAudioFromScriptPrefix =
      '【口播成片】纯口播视频：请严格依据下方口播文案生成口播音频与人像口型（勿编造或大幅偏离台词）。允许自然手势与表情；不要出现手持或展示物品、商品特写、陈列道具、桌面好物等展示类元素。口播全文如下：\n\n';
    const fullPrompt = `${i2vAudioFromScriptPrefix}${text}${promptSuffix}`;

    if (this.arkI2vVideo.isConfigured()) {
      const imageRef =
        body.imageDataUrl?.trim() || body.imageUrl?.trim() || '';
      if (!imageRef) {
        throw new BadRequestException(
          '已配置火山方舟图生视频：请提供 imageDataUrl 或 imageUrl 作为首帧参考图（首页请使用当前数字人形象）。',
        );
      }

      const created = await this.arkI2vVideo.createTask({
        prompt: fullPrompt,
        imageUrl: imageRef,
      });
      if (created.status < 200 || created.status >= 300) {
        throw new BadRequestException(
          `方舟创建图生视频任务失败：HTTP ${created.status} ${JSON.stringify(created.data).slice(0, 800)}`,
        );
      }
      const taskId = this.arkI2vVideo.extractTaskIdFromCreateResponse(created.data);
      if (!taskId) {
        throw new BadRequestException(
          `方舟未返回任务 id：${JSON.stringify(created.data).slice(0, 600)}`,
        );
      }

      const videoUrl = await this.arkI2vVideo.pollUntilVideoUrl(taskId);

      return {
        optimizedScript: text,
        llmUsed: usedLlm,
        estimatedTotalSeconds: Math.min(
          600,
          this.videoGenerateLlm.estimateDurationSeconds(script.length) + 120,
        ),
        videoUrl,
        hint:
          '成片由火山方舟图生视频生成，可直接预览；正式任务仍可通过下方「创建任务」继续。',
      };
    }

    const customDemo = this.config.get<string>('GENERATE_VIDEO_DEMO_MP4_URL')?.trim();
    const videoUrl =
      customDemo === 'none' || customDemo === 'off'
        ? null
        : customDemo ||
          'https://www.w3schools.com/html/mov_bbb.mp4';

    return {
      optimizedScript: text,
      llmUsed: usedLlm,
      estimatedTotalSeconds: this.videoGenerateLlm.estimateDurationSeconds(script.length),
      videoUrl,
      hint:
        '未配置 ARK_API_KEY 时使用演示成片；配置后可使用火山方舟图生视频生成真实预览。',
    };
  }

  /**
   * jiekou Seedance 1.5 Pro 图生视频（异步）：参数与官方 curl 一致，详见 `SeedanceI2vService`。
   * 需配置 SEEDANCE_I2V_API_KEY 或 JIEKOU_API_KEY；返回值为网关 JSON（含任务 id 等以文档为准）。
   */
  @Post('seedance-i2v-async')
  async seedanceI2vAsync(@Body() body: SeedanceI2vSubmitBody) {
    return this.seedanceI2v.submitAsync(body);
  }

  /**
   * 火山方舟图生视频：创建异步任务（POST .../contents/generations/tasks）。
   * 需配置 ARK_API_KEY（或单独 ARK_I2V_API_KEY）；可选 ARK_BASE_URL、ARK_I2V_MODEL。
   */
  @Post('ark-i2v-task')
  async arkI2vTask(@Body() body: ArkI2vTaskSubmitBody) {
    return this.arkI2vVideo.createTask(body);
  }

  /**
   * 视频对口型：前端上传单个视频，后端代理调用阿里接口并返回处理后视频 URL。
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
      throw new BadRequestException('请上传视频文件（multipart 字段名：video）');
    }

    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';
    if (!mime.startsWith('video/') && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(name)) {
      throw new BadRequestException('仅支持上传视频文件');
    }

    const durationSeconds =
      durationSecondsRaw !== undefined && durationSecondsRaw !== ''
        ? Number(durationSecondsRaw)
        : undefined;
    if (durationSeconds !== undefined) {
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new BadRequestException('视频时长无效');
      }
      if (durationSeconds > LIP_SYNC_MAX_DURATION_SECONDS) {
        throw new BadRequestException('视频长度不能超过 5 分钟');
      }
    }

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
        hint: '当前环境未配置对口型 API，已直接返回上传视频用于流程联调。',
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
  async createLipSyncPreview(@Req() req: Request, @Body() body: LipSyncPreviewDto) {
    const script = body.script?.trim() ?? '';
    if (script.length < 2) {
      throw new BadRequestException('口播文案过短或为空');
    }
    if (!body.avatarResourceId?.trim()) {
      throw new BadRequestException('avatarResourceId 不能为空');
    }
    if (!body.voiceResourceId?.trim()) {
      throw new BadRequestException('voiceResourceId 不能为空');
    }

    const userId = req.userId!;
    const [avatar, voice] = await Promise.all([
      this.resources.getAvatar(userId, body.avatarResourceId.trim()),
      this.resources.getVoice(userId, body.voiceResourceId.trim()),
    ]);
    if (!avatar.originalVideoUrl?.trim()) {
      throw new BadRequestException('该数字人资源未配置原始视频');
    }

    const videoMedia = await this.readVideoFromSourceRef(avatar.originalVideoUrl);
    this.aliLipSync.ensureConfigured();
    const estimatedTotalSeconds = Math.min(
      180,
      Math.max(15, Math.round(script.length * 0.22)),
    );
    const hintParts: string[] = [];

    const fallbackToPreview = async (
      video: {
        buffer: Buffer;
        originalname: string;
        mimetype?: string;
      },
      reason: string,
      providerResponse: Record<string, unknown>,
    ) => {
      const previewUrl = await this.persistPreviewVideo({
        buffer: video.buffer,
        originalname: video.originalname,
      });
      return {
        optimizedScript: script,
        llmUsed: false,
        estimatedTotalSeconds,
        videoUrl: previewUrl,
        hint: hintParts.join(' '),
        providerResponse: {
          ...providerResponse,
          fallback: true,
          reason,
          previewMimeType: video.mimetype || guessMimeFromFilename(video.originalname),
        },
      };
    };

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
      hintParts.push(`已用「${voice.name}」生成配音音轨。`);
    } catch (e) {
      hintParts.push(
        `当前环境未走通真实 TTS（${toSingleErrorMessage(e)}），已回退为原始出镜视频，便于先联调整体流程。`,
      );
      throw new BadRequestException(`TTS 音频生成失败，无法进入 VideoReTalk：${toSingleErrorMessage(e)}`);
    }

    let workingVideo:
      | {
          buffer: Buffer;
          originalname: string;
          mimetype: string;
        }
      | {
          buffer: Buffer;
          originalname: string;
          mimetype?: string;
        } = videoMedia;
    try {
      workingVideo = await this.ffmpegAudio.replaceVideoAudio({
        video: {
          buffer: videoMedia.buffer,
          originalname: videoMedia.originalname,
        },
        audio: {
          buffer: speech.buffer,
          originalname: `tts${this.audioExtensionForMime(speech.mimeType)}`,
        },
      });
      hintParts.push(`已把配音写入「${avatar.name}」的原始视频。`);
    } catch (e) {
      hintParts.push(
        `音轨替换失败（${toSingleErrorMessage(e)}），已回退为原始出镜视频。`,
      );
      hintParts.push('本地换音轨预览失败不阻断 VideoReTalk，将继续使用原视频和 TTS 音频发起对口型。');
    }

    try {
      const result = await this.aliLipSync.submitLipSync({
        video: {
          buffer: videoMedia.buffer,
          filename: videoMedia.originalname,
          mimeType: videoMedia.mimetype || guessMimeFromFilename(videoMedia.originalname),
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
          `${hintParts.join(' ')} 已使用「${voice.name}」驱动「${avatar.name}」生成对口型预览。`,
        providerResponse: result.providerResponse,
        fallback: false,
        lipSyncApplied: true,
      };
    } catch (e) {
      hintParts.push(
        `对口型接口调用失败（${toSingleErrorMessage(e)}），已回退为换音轨预览。`,
      );
      throw new BadRequestException(`VideoReTalk 对口型失败：${toSingleErrorMessage(e)}`);
    }
  }

  @Get('lip-sync-readiness')
  getLipSyncReadiness() {
    return this.aliLipSync.getReadiness();
  }

  @Post('voice-preview')
  async createVoicePreview(@Req() req: Request, @Body() body: VoicePreviewDto) {
    const script = body.script?.trim() ?? '';
    if (script.length < 2) {
      throw new BadRequestException('口播文案过短或为空');
    }
    if (!body.voiceResourceId?.trim()) {
      throw new BadRequestException('voiceResourceId 不能为空');
    }

    const voice = await this.resources.getVoice(req.userId!, body.voiceResourceId.trim());
    const estimatedDurationSeconds = Math.max(2.8, Math.min(24, script.length * 0.22));
    const voiceTuning = buildVoiceTuning(body);

    if (voice.provider === 'local-upload') {
      const localAudio = await this.resources.readManagedVoiceSample(voice.audioUrl);
      if (!localAudio) {
        throw new BadRequestException('未找到本地上传音频文件，请重新上传音色素材');
      }
      return {
        audioUrl: await this.persistPreviewAudio({
          buffer: localAudio.buffer,
          originalname: localAudio.originalname,
        }),
        hint: `已使用「${voice.name}」本地上传音频作为试听音轨。本地音频不会重新应用情绪/强度，需使用 TTS 音色才能动态生成。`,
        ttsMode: 'provider' as const,
        voiceLabel: voice.name,
        durationSeconds: voice.sampleDurationMs
          ? Math.round(voice.sampleDurationMs / 1000)
          : estimatedDurationSeconds,
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
        audioUrl: await this.persistPreviewAudio({
          buffer: speech.buffer,
          originalname: `tts-preview${this.audioExtensionForMime(speech.mimeType)}`,
        }),
        hint: [`已用「${voice.name}」生成可试听的配音音轨。`, speech.styleHint]
          .filter(Boolean)
          .join(' '),
        ttsMode: 'provider' as const,
        voiceLabel: voice.name,
        durationSeconds: estimatedDurationSeconds,
      };
    } catch (e) {
      const fallbackAudio = this.buildSilentWav(estimatedDurationSeconds);
      return {
        audioUrl: await this.persistPreviewAudio({
          buffer: fallbackAudio,
          originalname: 'tts-preview-fallback.wav',
        }),
        hint: `当前环境未走通真实 TTS（${toSingleErrorMessage(
          e,
        )}），已回退为静音占位音频，方便继续联调第二步流程。`,
        ttsMode: 'mock' as const,
        voiceLabel: voice.name,
        durationSeconds: estimatedDurationSeconds,
      };
    }
  }

  /** 数字人风格列表（id + 中文名；具体提示词仅服务端在调用时使用） */
  @Post('subtitle-workflow-preview')
  async createSubtitleWorkflowPreview(
    @Req() req: Request,
    @Body() body: SubtitleWorkflowPreviewDto,
  ) {
    if (!body.subtitleTemplateId?.trim()) {
      throw new BadRequestException('subtitleTemplateId 不能为空');
    }
    return this.subtitleWorkflow.createPreview(req.userId!, {
      script: body.script,
      avatarResourceId: body.avatarResourceId,
      voiceResourceId: body.voiceResourceId,
      subtitleTemplateId: body.subtitleTemplateId,
      previewSeconds: body.previewSeconds,
      voiceTuning: buildVoiceTuning(body),
    });
  }

  @Post('subtitle-workflow-finalize')
  async finalizeSubtitleWorkflow(@Req() req: Request, @Body() body: SubtitleWorkflowFinalizeDto) {
    return this.subtitleWorkflow.finalizeDraft(req.userId!, {
      draftId: body.draftId,
    });
  }

  @Get('digital-human-styles')
  digitalHumanStyles() {
    return this.digitalHumanImage.listStyles();
  }

  /**
   * 当前用户是否已有数字人模板（每人最多 1 个；再次生成会覆盖）。
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
      /** 需带 Authorization 的 GET，前端请用 axios blob 拉取后 createObjectURL */
      imageFetchPath: 'v1/tools/digital-human-image',
    };
  }

  /**
   * 流式返回当前用户已保存的数字人输出图（本地磁盘）。
   */
  @Get('digital-human-image')
  async digitalHumanImageFile(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const userId = req.userId!;
    const row = await this.digitalHumanPersistence.findByUserId(userId);
    if (!row) {
      throw new NotFoundException('暂无已保存的数字人形象');
    }
    const abs = this.digitalHumanPersistence.absolutePathForOutput(row);
    if (!existsSync(abs)) {
      throw new NotFoundException('数字人形象文件不存在或已被清理');
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return new StreamableFile(createReadStream(abs));
  }

  /**
   * 删除当前用户的数字人模板与本地文件（每人最多 1 个）。
   */
  @Delete('digital-human-template')
  async deleteDigitalHumanTemplate(@Req() req: Request) {
    const userId = req.userId!;
    const deleted = await this.digitalHumanPersistence.deleteByUserId(userId);
    return { ok: true as const, deleted };
  }

  /**
   * 自拍照 + 风格 → 调用配置的大模型接口（JSON：content、image_base64、mime_type、style_id）。
   * multipart 字段：selfie（文件）、styleId（与 digital-human-styles 返回的 id 一致）。
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
      throw new BadRequestException('请上传自拍照');
    }
    const mime = file.mimetype;
    if (mime !== 'image/jpeg' && mime !== 'image/png') {
      throw new BadRequestException('自拍照仅支持 JPG/PNG');
    }
    if (!styleId?.trim()) {
      throw new BadRequestException('请选择数字人风格（styleId）');
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
      const fetched = await this.digitalHumanImage.fetchRemoteImageBuffer(result.imageUrl);
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
        /** 相对 http baseURL，需 Bearer；展示请 GET blob */
        imageFetchPath: 'v1/tools/digital-human-image' as const,
      },
    };
  }

  /** 下载媒体 → FFmpeg 视频则抽 16k 单声道 WAV → 送 ASR API */
  private async transcribeAfterDownload(
    media: TranscribeMediaInput,
    opts?: { persistedVideoPath?: string },
  ): Promise<TranscribeResultDto> {
    const prepared = await this.ffmpegAudio.prepareForTranscription(media, opts);
    return this.transcription.transcribeMedia(prepared);
  }

  /**
   * 仅从本地磁盘上的已保存文件解析口播（FFmpeg 抽轨 → ASR），不依赖内存中的下载 buffer。
   */
  private async transcribeFromDisk(absPath: string): Promise<TranscribeResultDto> {
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
   * 转写偶发失败（网络/冷启动）时静默重试一次，不改变下载与落盘逻辑。
   */
  private async transcribeFromDiskWithRetry(absPath: string): Promise<TranscribeResultDto> {
    try {
      return await this.transcribeFromDisk(absPath);
    } catch (first: unknown) {
      await new Promise((r) => setTimeout(r, 1200));
      return await this.transcribeFromDisk(absPath);
    }
  }

  private resolveSavedVideoPathOrThrow(config: ConfigService, fileName: string): string {
    const base = assertSafeSavedBasename(fileName);
    const dir = path.resolve(getVideoSaveDir(config));
    const full = path.resolve(path.join(dir, base));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('非法文件路径');
    }
    return full;
  }

  private resolveSavedVideoPathMaybe(sourceRef: string): string | null {
    const ref = sourceRef.trim();
    if (!ref || /^https?:\/\//i.test(ref)) return null;
    const dir = path.resolve(getVideoSaveDir(this.config));
    const basename = path.basename(ref);
    if (!basename || /[\\/]/.test(basename) || basename.includes('..')) {
      throw new BadRequestException('本地视频仅支持 VIDEO_SAVE_DIR 目录下的文件名');
    }
    const full = path.resolve(path.join(dir, basename));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('本地视频路径不合法');
    }
    return full;
  }

  private resolvePreviewVideoPathOrThrow(fileName: string): string {
    const base = assertSafeSavedBasename(fileName);
    const dir = path.resolve(getPreviewVideoSaveDir(this.config));
    const full = path.resolve(path.join(dir, base));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('非法预览文件路径');
    }
    return full;
  }

  private resolvePreviewAudioPathOrThrow(fileName: string): string {
    const base = assertSafeSavedBasename(fileName);
    const dir = path.resolve(getPreviewAudioSaveDir(this.config));
    const full = path.resolve(path.join(dir, base));
    const rel = path.relative(dir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new BadRequestException('非法预览音频路径');
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

  private async persistPreviewAudio(params: {
    buffer: Buffer;
    originalname: string;
  }): Promise<string> {
    const dir = path.resolve(getPreviewAudioSaveDir(this.config));
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(params.originalname || '').toLowerCase() || '.mp3';
    const safeExt = /^\.[a-z0-9]{2,6}$/i.test(ext) ? ext : '.mp3';
    const fileName = `${Date.now()}_${randomUUID().slice(0, 8)}${safeExt}`;
    await fs.writeFile(path.join(dir, fileName), params.buffer);
    return `/api/v1/tools/preview-audios/${encodeURIComponent(fileName)}/stream`;
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

  private buildSilentWav(durationSeconds: number): Buffer {
    const sampleRate = 16_000;
    const channels = 1;
    const bitsPerSample = 16;
    const totalSamples = Math.max(1, Math.round(sampleRate * durationSeconds));
    const dataSize = totalSamples * channels * (bitsPerSample / 8);
    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
    buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    return buffer;
  }

  private async readVideoFromSourceRef(sourceRef: string): Promise<TranscribeMediaInput> {
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
        throw new NotFoundException(`未找到本地视频文件：${path.basename(local)}`);
      }
    }

    const normalized = normalizeSourceVideoUrl(sourceRef) || sourceRef.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      throw new BadRequestException('视频资源需填写可访问的视频 URL，或 VIDEO_SAVE_DIR 下的文件名');
    }

    if (normalized.toLowerCase().includes('douyin.com')) {
      const dl = await this.videoMediaDownload.tryDownloadForTranscription(normalized);
      if (!dl.ok) {
        throw new BadRequestException('抖音视频下载失败，请先确认 Cookie 与链接有效');
      }
      return dl.media;
    }

    const timeoutMs = Number(this.config.get('VIDEO_FETCH_TIMEOUT_MS') ?? 120_000);
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
        throw new BadRequestException(`视频下载失败：HTTP ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (!buffer.length || buffer.length > maxBytes) {
        throw new BadRequestException('视频文件为空或超过上传上限');
      }
      const filename = sanitizeFilenameForDisk(
        path.basename(new URL(res.url || normalized).pathname) || 'avatar-video.mp4',
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
   * 数字人形象：当前进程是否读到 ARK / Seedream / 自建 URL（不返回密钥）。
   * 排障：curl http://127.0.0.1:8080/api/v1/tools/digital-human-env
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
      /** 仅长度，便于确认是否注入成功（勿当密钥用） */
      arkKeyLength: ark?.length ?? 0,
    };
  }

  /** 是否已配置 DY_DOWNLOADER_COOKIE（不返回具体值，供前端展示） */
  @Get('dy-downloader-cookie')
  dyDownloaderCookieStatus() {
    const configured = !!this.config.get<string>('DY_DOWNLOADER_COOKIE')?.trim();
    return { configured };
  }

  @Post('douyin-homepage-learn')
  async learnDouyinHomepage(@Body() body: DouyinHomepageLearnDto) {
    if (!body?.homepageUrl?.trim()) {
      throw new BadRequestException('homepageUrl 不能为空');
    }
    return this.douyinBenchmark.learnHomepage(body.homepageUrl);
  }

  /** 第三步：检查 ASR API 是否可达（不消耗模型推理） */
  @Get('asr-health')
  async asrHealth() {
    return this.transcription.checkHealth();
  }

  /**
   * 口播转写全链路自检：保存目录可写、FFmpeg 可用、ASR HTTP 可达、抖音 Cookie 是否配置（不返回密钥）。
   * 供首页在下载成功后展示「抽音轨 → ASR」前置条件。
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
    const dyCookieConfigured = !!this.config.get<string>('DY_DOWNLOADER_COOKIE')?.trim();

    return {
      videoSaveDir: { path: dir, writable, error: dirError },
      ffmpeg,
      asr,
      dyCookieConfigured,
    };
  }

  /** 取回主后端已保存的某次转写（与 POST /transcribe 返回的 transcriptId 对应） */
  @Get('transcripts/:transcriptId')
  getSavedTranscript(@Param('transcriptId') transcriptId: string) {
    const row = this.transcriptStore.get(transcriptId);
    if (!row) {
      throw new NotFoundException('未找到该 transcriptId，可能已过期或服务已重启');
    }
    return row;
  }

  /**
   * 第四步：接收上传 → ASR HTTP → 归一化 fullText/language/segments → 保存 transcript → 返回
   */
  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: getTranscribeMediaMaxBytes() },
    }),
  )
  async transcribeUpload(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('请上传音视频文件（multipart 字段名：file）');
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
   * 根据作品页链接… 下载字节 → ASR（与 transcribe 同一套归一化与保存）。
   */
  /**
   * 抖音专用流水线：dy-downloader 拉取媒体 → ASR →
   * 拿到全文后再调用改写建议（与任务内 `suggestRewrite` 同源），便于用户直接进入「改写」心智。
   */
  @Post('douyin-transcribe-rewrite')
  async douyinTranscribeRewrite(@Body() body: DouyinTranscribeRewriteDto) {
    if (!body?.sourceVideoUrl?.trim()) {
      throw new BadRequestException('sourceVideoUrl 不能为空');
    }
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '无法识别有效的视频链接，请粘贴含 v.douyin.com 短链或作品页链接的分享文案。',
      );
    }
    let host: string;
    try {
      host = new URL(normalized).hostname.toLowerCase();
    } catch {
      throw new BadRequestException('URL 格式无效');
    }
    if (!host.includes('douyin.com')) {
      throw new BadRequestException('本接口仅支持抖音作品页 / 分享链接（douyin.com）');
    }

    const dl = await this.videoMediaDownload.tryDownloadForTranscription(normalized);
    if (!dl.ok) {
      if (dl.failure === 'douyin_no_ytdlp') {
        throw new BadRequestException(
          '未找到可用的抖音下载能力：请配置 DY_DOWNLOADER_COOKIE（仓库内 backend/DY-DOWNLOADER，npm 包 dy-downloader）。详见 backend/.env.example。',
        );
      }
      throw new BadRequestException(
        '抖音拉取失败：dy-downloader 未得到可用音视频。可检查 DY_DOWNLOADER_COOKIE 是否有效，并查看后端日志。',
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
      throw new BadRequestException('sourceVideoUrl 不能为空');
    }
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '无法识别有效的视频链接，请粘贴含 v.douyin.com 短链或作品页链接的分享文案。',
      );
    }
    const dl = await this.videoMediaDownload.tryDownloadForTranscription(normalized);
    if (!dl.ok) {
      const isDouyin = normalized.toLowerCase().includes('douyin.com');
      if (isDouyin && dl.failure === 'douyin_no_ytdlp') {
        throw new BadRequestException(
          '抖音链接需要配置 DY_DOWNLOADER_COOKIE（dy-downloader）。见 backend/.env.example。',
        );
      }
      if (isDouyin && dl.failure === 'douyin_ytdlp_failed') {
        throw new BadRequestException(
          '抖音：未下载到可用音视频。可检查 DY_DOWNLOADER_COOKIE 是否有效；详见后端日志。',
        );
      }
      throw new BadRequestException(
        '未能下载到可用音视频：可配置 YTDLP_BIN，或使用 yt-dlp-master（PYTHON_BIN + pip install -e）；非抖音还可依赖页面直链解析。也可使用「本地上传」转写。',
      );
    }
    return this.transcribeAfterDownload(dl.media);
  }

  @Post('transcript-preview')
  async previewTranscript(@Body() body: SourceVideoUrlDto) {
    if (!body?.sourceVideoUrl?.trim()) {
      throw new BadRequestException('sourceVideoUrl 不能为空');
    }
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '无法识别有效的视频链接，请粘贴含 v.douyin.com 短链或作品页链接的分享文案。',
      );
    }
    return this.transcription.transcribe({
      taskId: 'preview',
      sourceVideoUrl: normalized,
    });
  }

  /**
   * 抓取视频页 HTML 并解析 Open Graph 等元信息（不调用 AI；可能被平台反爬限制）
   */
  @Post('optimize-oral-script')
  async optimizeOralScript(@Body() body: OptimizeOralScriptDto) {
    const sourceText = body?.sourceText?.trim() ?? '';
    if (!sourceText) {
      throw new BadRequestException('sourceText 不能为空');
    }
    return this.rewriteAi.optimizeHookedOralScript({
      source: sourceText,
      sourceVideoUrl: body?.sourceVideoUrl?.trim(),
    });
  }

  @Post('video-meta')
  async fetchVideoMeta(@Body() body: SourceVideoUrlDto) {
    if (!body?.sourceVideoUrl?.trim()) {
      throw new BadRequestException('sourceVideoUrl 不能为空');
    }
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '无法识别有效的视频链接，请粘贴含 v.douyin.com 短链或作品页链接的分享文案。',
      );
    }
    return this.videoMeta.fetchMeta(normalized);
  }

  /**
   * 下载源视频并保存到项目内资源目录（默认 backend/data/download-video；见 VIDEO_SAVE_DIR），
   * 并以同一份媒体调用 ASR，供首页「口播文案」使用。
   * 抖音侧仅 dy-downloader + DY_DOWNLOADER_COOKIE。
   */
  @Post('source-video-file')
  async downloadSourceVideoFile(
    @Body() body: SourceVideoFileDto,
  ): Promise<{
    ok: true;
    savedPath: string;
    message: string;
    transcript: TranscribeResultDto | null;
    transcriptionError?: string;
  }> {
    if (!body?.sourceVideoUrl?.trim()) {
      throw new BadRequestException('sourceVideoUrl 不能为空');
    }
    const shouldTranscribe = body.transcribe !== false;
    const normalized = normalizeSourceVideoUrl(body.sourceVideoUrl);
    if (!normalized) {
      throw new BadRequestException(
        '无法识别有效的视频链接，请粘贴含 v.douyin.com 短链或作品页链接的分享文案。',
      );
    }
    const dl = await this.videoMediaDownload.tryDownloadForTranscription(normalized);
    if (!dl.ok) {
      if (dl.failure === 'douyin_no_ytdlp') {
        throw new BadRequestException(
          '无法下载源视频（抖音）：请配置 DY_DOWNLOADER_COOKIE。详见 backend/.env.example。',
        );
      }
      if (dl.failure === 'douyin_ytdlp_failed') {
        throw new BadRequestException(
          '源视频下载失败（抖音）。可检查 DY_DOWNLOADER_COOKIE 是否有效及后端日志。',
        );
      }
      throw new BadRequestException(
        '未能从该链接下载源视频；非抖音可配置 yt-dlp，抖音请配置 DY_DOWNLOADER_COOKIE。',
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
      message: shouldTranscribe
        ? `视频已保存到：${savedPath}`
        : `视频已保存到：${savedPath}（未转写；可调用 transcribe-saved-video）`,
      transcript,
      transcriptionError,
    };
  }

  /**
   * 列出保存目录中的视频文件（VIDEO_SAVE_DIR / 默认 backend/data/download-video），供「从本地文件转写口播」选择。
   */
  @Get('saved-videos')
  async listSavedVideos() {
    const dir = path.resolve(getVideoSaveDir(this.config));
    await fs.mkdir(dir, { recursive: true });
    const names = await fs.readdir(dir);
    const items: { name: string; size: number; mtime: string; mtimeMs: number }[] = [];
    for (const n of names) {
      if (n.startsWith('.')) continue;
      const p = path.join(dir, n);
      try {
        const st = await fs.stat(p);
        if (!st.isFile()) continue;
        items.push({
          name: n,
          size: st.size,
          mtime: new Date(st.mtimeMs).toISOString(),
          mtimeMs: st.mtimeMs,
        });
      } catch {
        /* skip */
      }
    }
    items.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return {
      directory: dir,
      files: items.slice(0, 200).map(({ name, size, mtime }) => ({ name, size, mtime })),
    };
  }

  /**
   * 对已保存到本地目录的视频文件做 FFmpeg 抽音轨 + ASR，返回口播全文（与 source-video-file 转写环节一致）。
   */
  @Get('saved-videos/:fileName/stream')
  async streamSavedVideo(
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const full = this.resolveSavedVideoPathOrThrow(this.config, fileName);
    try {
      await fs.access(full);
    } catch {
      throw new NotFoundException(`未找到文件：${path.basename(full)}`);
    }
    res.setHeader('Content-Type', guessMimeFromFilename(full));
    res.setHeader('Cache-Control', 'private, max-age=60');
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
      throw new NotFoundException(`未找到预览文件：${path.basename(full)}`);
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
      throw new NotFoundException(`lip-sync public media not found: ${path.basename(full)}`);
    }
    res.setHeader('Content-Type', guessMimeFromFilename(full));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return new StreamableFile(createReadStream(full));
  }

  @Get('preview-audios/:fileName/stream')
  async streamPreviewAudio(
    @Param('fileName') fileName: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const full = this.resolvePreviewAudioPathOrThrow(fileName);
    try {
      await fs.access(full);
    } catch {
      throw new NotFoundException(`未找到预览音频：${path.basename(full)}`);
    }
    res.setHeader('Content-Type', guessMimeFromFilename(full));
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(createReadStream(full));
  }

  @Post('transcribe-saved-video')
  async transcribeSavedVideo(@Body() body: { fileName?: string }): Promise<{
    transcript: TranscribeResultDto | null;
    transcriptionError?: string;
  }> {
    if (!body?.fileName?.trim()) {
      throw new BadRequestException('fileName 不能为空（保存目录下的文件名，含扩展名）');
    }
    const full = this.resolveSavedVideoPathOrThrow(this.config, body.fileName);
    try {
      await fs.access(full);
    } catch {
      throw new NotFoundException(`未找到文件：${path.basename(full)}`);
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
