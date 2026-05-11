import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeSourceVideoUrl } from '../../common/douyin-share-url.util';
import { AliLipSyncService } from '../../integrations/ai/ali-lip-sync.service';
import { SpeechAiService } from '../../integrations/ai/speech-ai.service';
import { TranscriptionAiService } from '../../integrations/ai/transcription-ai.service';
import type { TranscriptSegmentDto } from '../../integrations/transcription/transcript.types';
import {
  FfmpegAudioService,
  type TranscribeMediaInput,
} from '../../integrations/media/ffmpeg-audio.service';
import { VideoMediaDownloadService } from '../../integrations/video/video-media-download.service';
import { ResourcesService } from '../resources/resources.service';
import type { SubtitleTemplateResourceDto } from '../resources/resources.types';

type TimelineSource = 'asr-fallback' | 'local-estimate';
type TtsMode = 'provider' | 'mock';

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
  muxedVideoFileName: string;
  subtitleAssFileName: string;
  previewFileName: string;
  finalFileName?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function getVideoSaveDir(config: ConfigService): string {
  const fromEnv = config.get<string>('VIDEO_SAVE_DIR')?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return process.platform === 'win32'
    ? 'C:\\downloadVideo'
    : path.join(os.homedir(), 'downloadVideo');
}

function getPreviewVideoSaveDir(config: ConfigService): string {
  const fromEnv = config.get<string>('PREVIEW_VIDEO_SAVE_DIR')?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(getVideoSaveDir(config), 'preview-videos');
}

function sanitizeFilenameForDisk(name: string, fallback = 'video.mp4'): string {
  const base = path
    .basename(name)
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

  constructor(
    private readonly config: ConfigService,
    private readonly resources: ResourcesService,
    private readonly speechAi: SpeechAiService,
    private readonly transcription: TranscriptionAiService,
    private readonly ffmpegAudio: FfmpegAudioService,
    private readonly aliLipSync: AliLipSyncService,
    private readonly videoMediaDownload: VideoMediaDownloadService,
  ) {}

  async createPreview(
    userId: string,
    body: {
      script: string;
      avatarResourceId: string;
      voiceResourceId: string;
      subtitleTemplateId: string;
      previewSeconds?: number;
    },
  ): Promise<{
    draftId: string;
    previewUrl: string;
    subtitleJson: SubtitleJsonDto;
    hint: string;
    ttsMode: TtsMode;
    timelineSource: TimelineSource;
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

    const previewSeconds = Math.min(8, Math.max(3, Math.round(body.previewSeconds ?? 5)));
    const [avatar, voice, subtitleTemplate] = await Promise.all([
      this.resources.getAvatar(userId, body.avatarResourceId.trim()),
      this.resources.getVoice(userId, body.voiceResourceId.trim()),
      this.resources.getSubtitleTemplate(userId, body.subtitleTemplateId.trim()),
    ]);

    if (!avatar.originalVideoUrl?.trim()) {
      throw new BadRequestException('当前数字人视频没有绑定原始视频素材');
    }

    const hints: string[] = [];
    const sourceVideo = await this.readVideoFromSourceRef(avatar.originalVideoUrl);
    const speech = await this.buildSpeechAudio(script, {
      id: voice.id,
      name: voice.name,
      provider: voice.provider,
      providerVoice: voice.providerVoice,
      providerModel: voice.providerModel,
    });
    if (speech.ttsMode === 'mock') {
      hints.push('当前未走通真实 TTS，已自动生成本地占位音轨用于联调。');
    } else {
      hints.push(`已按“${voice.name}”生成 TTS 音轨。`);
    }

    const timeline = await this.buildSubtitleTimeline(
      script,
      speech,
      body.avatarResourceId.trim(),
      body.voiceResourceId.trim(),
      subtitleTemplate,
    );
    if (timeline.timelineSource === 'asr-fallback') {
      hints.push('TTS 未提供时间戳，已通过 ASR 对音频回填字幕时间轴。');
    } else {
      hints.push('当前环境未接入可用时间戳服务，已用本地估时生成 subtitle.json。');
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
    await Promise.all([
      fs.writeFile(path.join(draftDir, sourceVideoFileName), sourceVideo.buffer),
      fs.writeFile(path.join(draftDir, speechAudioFileName), speech.buffer),
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
      this.logger.warn(`Mux source video with TTS failed: ${e instanceof Error ? e.message : String(e)}`);
      await fs.writeFile(muxedVideoPath, sourceVideo.buffer);
      hints.push('音轨替换失败，预览阶段已先回退到原始视频继续联调。');
    }

    const subtitleAssFileName = `subtitle_${Date.now()}_${randomUUID().slice(0, 8)}.ass`;
    const subtitleAssPath = path.join(draftDir, subtitleAssFileName);
    await fs.writeFile(subtitleAssPath, this.buildAssScript(timeline.subtitleJson), 'utf8');

    const previewFileName = this.outputFileName('subtitle-preview', '.mp4');
    const previewPath = path.join(this.outputDir(), previewFileName);
    await fs.mkdir(this.outputDir(), { recursive: true });

    try {
      await this.ffmpegAudio.burnAssSubtitles({
        inputVideoPath: muxedVideoPath,
        subtitleAssPath,
        outputVideoPath: previewPath,
        clipSeconds: previewSeconds,
      });
      hints.push('已生成 5 秒字幕预览，可先确认节奏、样式和断句。');
    } catch (e) {
      this.logger.warn(`Burn preview subtitles failed: ${e instanceof Error ? e.message : String(e)}`);
      await fs.copyFile(muxedVideoPath, previewPath);
      hints.push('字幕预览合成失败，已回退为 5 秒视频预览，请优先检查 FFmpeg 字幕滤镜。');
    }

    const meta: DraftMeta = {
      id: draftId,
      userId,
      createdAt: nowIso(),
      avatarResourceId: body.avatarResourceId.trim(),
      voiceResourceId: body.voiceResourceId.trim(),
      subtitleTemplateId: body.subtitleTemplateId.trim(),
      script,
      previewSeconds,
      ttsMode: speech.ttsMode,
      timelineSource: timeline.timelineSource,
      avatarLabel: avatar.name,
      voiceLabel: voice.name,
      subtitleJson: timeline.subtitleJson,
      sourceVideoFileName,
      sourceVideoMimeType: sourceVideo.mimetype || guessMimeFromFilename(sourceVideo.originalname),
      speechAudioFileName,
      speechAudioMimeType: speech.mimeType,
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
    };
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

    if (this.aliLipSync.isConfigured()) {
      try {
        if (!speechAudioPath || !existsSync(speechAudioPath)) {
          throw new BadRequestException('lip-sync audio input is missing from the draft');
        }
        const [videoBuffer, audioBuffer] = await Promise.all([
          fs.readFile(sourceVideoPath),
          fs.readFile(speechAudioPath),
        ]);
        const result = await this.aliLipSync.submitLipSync({
          video: {
            buffer: videoBuffer,
            filename: meta.sourceVideoFileName || 'lip-sync-source.mp4',
            mimeType:
              meta.sourceVideoMimeType ||
              guessMimeFromFilename(meta.sourceVideoFileName || meta.muxedVideoFileName),
          },
          audio: {
            buffer: audioBuffer,
            filename: meta.speechAudioFileName || 'lip-sync-speech.mp3',
            mimeType:
              meta.speechAudioMimeType ||
              guessMimeFromFilename(meta.speechAudioFileName || 'speech.mp3'),
          },
        });
        providerResponse = result.providerResponse;
        if (result.videoUrl?.trim()) {
          workingVideoPath = await this.persistResultVideoToDraft(result.videoUrl, draftDir);
          fallback = false;
          hints.push(result.hint || '已完成 GPU 对口型。');
        } else {
          hints.push('对口型服务未返回视频地址，已回退到换音轨版本继续出片。');
        }
      } catch (e) {
        hints.push(
          `GPU 对口型调用失败，已回退到换音轨版本继续合成。${e instanceof Error ? e.message : String(e)}`,
        );
      }
    } else {
      hints.push('当前环境未配置 GPU 对口型服务，已直接使用换音轨版本继续合成。');
    }

    const finalFileName = this.outputFileName('subtitle-final', '.mp4');
    const finalPath = path.join(this.outputDir(), finalFileName);
    await fs.mkdir(this.outputDir(), { recursive: true });

    try {
      await this.ffmpegAudio.burnAssSubtitles({
        inputVideoPath: workingVideoPath,
        subtitleAssPath,
        outputVideoPath: finalPath,
      });
      hints.push('已完成字幕、音频、视频的最终合成。');
    } catch (e) {
      this.logger.warn(`Burn final subtitles failed: ${e instanceof Error ? e.message : String(e)}`);
      await fs.copyFile(workingVideoPath, finalPath);
      hints.push('最终字幕烧录失败，已回退输出无字幕视频，请检查 FFmpeg 字幕滤镜。');
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

  private async buildSpeechAudio(
    script: string,
    voice: {
      id: string;
      name: string;
      provider: string | null;
      providerVoice: string | null;
      providerModel: string | null;
    },
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    originalname: string;
    ttsMode: TtsMode;
  }> {
    try {
      const speech = await this.speechAi.synthesizeAudio({
        text: script,
        voiceStyleId: voice.id,
        voiceName: voice.name,
        provider: voice.provider,
        providerVoice: voice.providerVoice,
        providerModel: voice.providerModel,
      });
      return {
        buffer: speech.buffer,
        mimeType: speech.mimeType,
        originalname: this.audioFileNameForMime(speech.mimeType),
        ttsMode: 'provider',
      };
    } catch (e) {
      this.logger.warn(`TTS fallback to mock audio: ${e instanceof Error ? e.message : String(e)}`);
      return {
        buffer: this.buildSilentWav(Math.max(2.8, Math.min(24, script.length * 0.22))),
        mimeType: 'audio/wav',
        originalname: 'tts-mock.wav',
        ttsMode: 'mock',
      };
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
          if (transcript.segments.length > 0) {
            segments = transcript.segments;
            language = transcript.language || 'zh-CN';
            timelineSource = 'asr-fallback';
          }
        } catch (e) {
          this.logger.warn(`ASR fallback timeline failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    const cues = this.normalizeCues(segments, script, subtitleTemplate.styleJson);
    const durationMs = cues[cues.length - 1]?.endMs ?? Math.max(3_000, script.length * 220);

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
    const lineChars = this.clampNumber(this.readNumber(styleJson.lineChars, 14), 8, 16);
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
        const chunkStartMs = startMs + Math.floor((span * chunkIndex) / chunks.length);
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
    const source = chunks.length > 0 ? chunks : (script.match(/.{1,16}/g) ?? [script]);
    let cursor = 0;
    return source.map((text) => {
      const duration = Math.max(1_000, Math.min(7_000, Math.round(text.length * 210)));
      const segment = {
        startMs: cursor,
        endMs: cursor + duration,
        text,
      };
      cursor += duration;
      return segment;
    });
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
    return this.sanitizeUserScript(text)
      .replace(/\s+/g, ' ')
      .trim();
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
      (normalized.includes('FFmpeg') && normalized.includes('ASR') && normalized.includes('回填')) ||
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
    return '.mp3';
  }

  private draftMediaFileName(prefix: string, originalname: string, fallbackExt: string): string {
    const ext = path.extname(originalname || '').toLowerCase() || fallbackExt;
    const safeExt = /^\.[a-z0-9]{2,6}$/i.test(ext) ? ext : fallbackExt;
    return `${prefix}_${Date.now()}_${randomUUID().slice(0, 8)}${safeExt}`;
  }

  private buildAssScript(subtitleJson: SubtitleJsonDto): string {
    const style = subtitleJson.template.styleJson || {};
    const fontFamily = this.readString(style.fontFamily, 'Microsoft YaHei');
    const fontSize = this.clampNumber(this.readNumber(style.size, 38), 24, 42);
    const outline = this.clampNumber(this.readNumber(style.strokeWidth, 2.2), 1.2, 3.2);
    const marginBottom = this.clampNumber(this.readNumber(style.marginBottom, 72), 42, 118);
    const spacing = this.clampNumber(this.readNumber(style.letterSpacing, 0), 0, 2);
    const weight = this.readNumber(style.weight, 700);
    const position = this.readString(style.position, 'bottom');
    const hasBackground = typeof style.background === 'string' && style.background.trim().length > 0;
    const alignment = position === 'top' ? 8 : position === 'middle' ? 5 : 2;

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
          this.readString(style.highlightColor, this.readString(style.color, '#FFFFFF')),
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
          `Dialogue: 0,${this.toAssTime(cue.startMs)},${this.toAssTime(cue.endMs)},Default,,0,0,0,,${this.escapeAssText(cue.lines.join('\\N'))}`,
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

  private parseColor(input: string): { r: number; g: number; b: number; a: number } {
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
        a: rgbaMatch[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(rgbaMatch[4]))),
      };
    }

    return { r: 255, g: 255, b: 255, a: 1 };
  }

  private hexByte(value: number): string {
    return Math.max(0, Math.min(255, value)).toString(16).toUpperCase().padStart(2, '0');
  }

  private readNumber(value: unknown, fallback: number): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  private clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private readString(value: unknown, fallback: string, fallback2?: string): string {
    if (typeof value === 'string' && value.trim()) return value.trim();
    return fallback2 ?? fallback;
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
      throw new BadRequestException('数字人视频需要绑定可访问的原始视频地址，或本地保存文件名');
    }

    if (normalized.toLowerCase().includes('douyin.com')) {
      const dl = await this.videoMediaDownload.tryDownloadForTranscription(normalized);
      if (!dl.ok) {
        throw new BadRequestException('抖音视频下载失败，请先确认 Cookie 与链接有效');
      }
      return dl.media;
    }

    return this.fetchRemoteVideo(normalized);
  }

  private async fetchRemoteVideo(url: string): Promise<TranscribeMediaInput> {
    const controller = new AbortController();
    const timeoutMs = Number(this.config.get('VIDEO_FETCH_TIMEOUT_MS') ?? 120_000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new BadRequestException(`远程视频拉取失败：HTTP ${res.status}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
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
    if (!trimmed || /^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('data:')) return null;
    const base = path.basename(trimmed);
    if (base !== trimmed || /[\\/]/.test(trimmed) || trimmed.includes('..')) return null;
    const dir = path.resolve(getVideoSaveDir(this.config));
    const full = path.resolve(path.join(dir, base));
    const relative = path.relative(dir, full);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(full)) return null;
    return full;
  }

  private async persistResultVideoToDraft(videoUrl: string, draftDir: string): Promise<string> {
    const outPath = path.join(draftDir, `lip-synced_${Date.now()}_${randomUUID().slice(0, 8)}.mp4`);
    if (videoUrl.startsWith('data:')) {
      const match = videoUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
      if (!match?.[3]) {
        throw new BadRequestException('对口型结果 data URL 无效');
      }
      const buffer = Buffer.from(match[3], match[2] ? 'base64' : 'utf8');
      await fs.writeFile(outPath, buffer);
      return outPath;
    }

    const res = await fetch(videoUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(Number(this.config.get('LIP_SYNC_FETCH_TIMEOUT_MS') ?? 300_000)),
    });
    if (!res.ok) {
      throw new BadRequestException(`拉取对口型结果失败：HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(outPath, buffer);
    return outPath;
  }

  private outputDir(): string {
    return path.resolve(getPreviewVideoSaveDir(this.config));
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

  private async saveDraftMeta(meta: DraftMeta): Promise<void> {
    await fs.mkdir(this.draftDir(meta.id), { recursive: true });
    await fs.writeFile(this.metaPath(meta.id), JSON.stringify(meta, null, 2), 'utf8');
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
