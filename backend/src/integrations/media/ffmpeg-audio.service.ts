import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import {
  readPositiveInt,
  runWithRuntimeLimit,
} from '../../common/runtime-limits.util';

const execFileAsync = promisify(execFile);
const requireFromService = createRequire(__filename);
type MediaExecOptions = {
  timeout?: number;
  maxBuffer?: number;
  windowsHide?: boolean;
};

/** 与 VideoMediaDownloadService 下载结果一致 */
export type TranscribeMediaInput = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

export type SilenceSegment = {
  startTime: number;
  endTime: number;
  duration: number;
};

export type VideoCutRange = {
  startTime: number;
  endTime: number;
  enabled?: boolean;
};

export type TimedOverlayAsset = {
  inputPath: string;
  startTime: number;
  endTime: number;
};

export type VideoAlphaProbeResult = {
  pixFmt: string | null;
  alphaMode: string | null;
};

export type VideoFormatContractVideoStream = {
  codecName: string | null;
  width: number | null;
  height: number | null;
  codedWidth: number | null;
  codedHeight: number | null;
  sampleAspectRatio: string | null;
  displayAspectRatio: string | null;
  avgFrameRate: number | null;
  avgFrameRateRaw: string | null;
  rFrameRate: number | null;
  rFrameRateRaw: string | null;
  pixFmt: string | null;
  colorRange: string | null;
  colorSpace: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
};

export type VideoFormatContractAudioStream = {
  codecName: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  isDefault: boolean;
};

export type VideoFormatContract = {
  formatName: string | null;
  durationSeconds: number | null;
  video: VideoFormatContractVideoStream | null;
  audioStreams: VideoFormatContractAudioStream[];
};

export type MediaProbeSummary = {
  formatName: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  bitRate: number | null;
  video: {
    codecName: string | null;
    width: number | null;
    height: number | null;
    pixFmt: string | null;
    avgFrameRate: number | null;
    colorSpace: string | null;
    colorRange: string | null;
  } | null;
  audio: {
    codecName: string | null;
    sampleRate: number | null;
    channels: number | null;
    channelLayout: string | null;
    bitRate: number | null;
  } | null;
};

type VideoEncodingHint = {
  pixFmt: string | null;
  colorRange: string | null;
  colorSpace: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
};

/**
 * 视频 → FFmpeg 抽音轨（16kHz mono MP3）再送 ASR API，减轻上游解码压力、统一格式。
 * 可执行文件：FFMPEG_BIN → backend/ffmpeg/bin（Windows/Linux）→ PATH 中的 ffmpeg。
 */
@Injectable()
export class FfmpegAudioService {
  private readonly logger = new Logger(FfmpegAudioService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * 对疑似视频：抽音轨为低码率 MP3；纯音频或抽轨失败则原样返回。
   * @param persistedVideoPath 若已将视频落盘（如 source-video-file），直接作 FFmpeg 输入，避免再写临时文件。
   */
  async prepareForTranscription(
    media: TranscribeMediaInput,
    opts?: { persistedVideoPath?: string },
  ): Promise<TranscribeMediaInput> {
    // 纯音频等：transcribeFromDisk 时 buffer 为空，需从 persistedVideoPath 读入再送 ASR
    if (!this.isLikelyVideo(media.originalname, media.mimetype)) {
      const loaded = await this.ensureBufferFromDiskIfNeeded(media, opts);
      const buf = loaded.buffer;
      return { ...loaded, size: buf?.length ?? 0 };
    }

    const bin = this.resolveFfmpegBinary();

    const tmpDir = await fs.mkdtemp(
      path.join(this.runtimeTempDir(), 'kb-ffmpeg-'),
    );
    const outAudio = path.join(tmpDir, 'for-transcription.wav');

    try {
      const inputPath =
        opts?.persistedVideoPath && existsSync(opts.persistedVideoPath)
          ? opts.persistedVideoPath
          : await this.writeTempInput(tmpDir, media);

      await this.runExtract(bin, inputPath, outAudio);
      const audio = await fs.readFile(outAudio);
      if (audio.length < 64) {
        this.logger.warn('FFmpeg 输出音轨过小，回退为原媒体直送 ASR');
        return this.ensureBufferFromDiskIfNeeded(media, opts);
      }
      const base =
        path.basename(media.originalname, path.extname(media.originalname)) ||
        'audio';
      return {
        buffer: audio,
        originalname: `${base}.wav`,
        mimetype: 'audio/wav',
        size: audio.length,
      };
    } catch (e) {
      const err = e as Error & { stderr?: Buffer };
      const stderr = err.stderr?.toString?.()?.trim() ?? '';
      this.logger.warn(
        `FFmpeg 抽音轨失败，回退为原媒体直送 ASR：${err.message ?? e}${stderr ? ` | ${stderr.slice(0, 800)}` : ''}`,
      );
      return this.ensureBufferFromDiskIfNeeded(media, opts);
    } finally {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 从磁盘补全 buffer（transcribeFromDisk 初始 buffer 为空；FFmpeg 回退时需整文件上传）。
   */
  private async ensureBufferFromDiskIfNeeded(
    media: TranscribeMediaInput,
    opts?: { persistedVideoPath?: string },
  ): Promise<TranscribeMediaInput> {
    if (media.buffer?.length) return media;
    const p = opts?.persistedVideoPath;
    if (p && existsSync(p)) {
      const buf = await fs.readFile(p);
      const name = path.basename(p);
      return {
        buffer: buf,
        originalname: name,
        mimetype: this.guessMimeFromFilename(name),
        size: buf.length,
      };
    }
    return media;
  }

  private guessMimeFromFilename(filename: string): string {
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

  private guessExtensionFromMime(mimetype?: string): string | null {
    const mt = (mimetype || '').split(';')[0]?.trim().toLowerCase();
    const map: Record<string, string> = {
      'audio/mpeg': '.mp3',
      'audio/mp3': '.mp3',
      'audio/wav': '.wav',
      'audio/wave': '.wav',
      'audio/x-wav': '.wav',
      'audio/mp4': '.m4a',
      'audio/aac': '.aac',
      'audio/ogg': '.ogg',
      'audio/flac': '.flac',
      'audio/webm': '.webm',
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'video/webm': '.webm',
      'video/x-matroska': '.mkv',
    };
    return mt ? (map[mt] ?? null) : null;
  }

  private extensionFromMedia(originalname?: string, mimetype?: string): string {
    const ext = path.extname(originalname || '').toLowerCase();
    return ext || this.guessExtensionFromMime(mimetype) || '.bin';
  }

  private isLikelyVideo(originalname: string, mimetype: string): boolean {
    const m = (mimetype || '').toLowerCase();
    if (m.startsWith('video/')) return true;
    const n = (originalname || '').toLowerCase();
    return /\.(mp4|webm|mov|mkv|mpeg|mpg|avi|flv|m4v|3gp|ts)$/i.test(n);
  }

  private resolveFfmpegBinary(): string {
    const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const fromEnv =
      this.config.get<string>('FFMPEG_BIN')?.trim() ||
      this.config.get<string>('FFMPEG_PATH')?.trim();
    if (fromEnv && existsSync(fromEnv)) return fromEnv;

    // cwd 可能是 backend 或仓库根目录；__dirname 为 dist/integrations/media，可定位到 backend/ffmpeg/bin
    const candidates = [
      path.join(process.cwd(), 'ffmpeg', 'bin', exe),
      path.join(process.cwd(), 'backend', 'ffmpeg', 'bin', exe),
      path.join(__dirname, '..', '..', '..', 'ffmpeg', 'bin', exe),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    const fromPackage = this.resolveFfmpegStaticBinary();
    if (fromPackage) return fromPackage;
    return exe;
  }

  private resolveFfprobeBinary(): string {
    const exe = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const fromEnv = this.config.get<string>('FFPROBE_BIN')?.trim();
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
    const ffmpegFromEnv =
      this.config.get<string>('FFMPEG_BIN')?.trim() ||
      this.config.get<string>('FFMPEG_PATH')?.trim();
    if (ffmpegFromEnv) {
      const alongside = path.join(path.dirname(ffmpegFromEnv), exe);
      if (existsSync(alongside)) return alongside;
    }

    const candidates = [
      path.join(process.cwd(), 'ffmpeg', 'bin', exe),
      path.join(process.cwd(), 'backend', 'ffmpeg', 'bin', exe),
      path.join(__dirname, '..', '..', '..', 'ffmpeg', 'bin', exe),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
    const fromPackage = this.resolveFfprobeStaticBinary();
    if (fromPackage) return fromPackage;
    return exe;
  }

  private async writeTempInput(
    dir: string,
    media: TranscribeMediaInput,
  ): Promise<string> {
    const ext = this.extensionFromMedia(media.originalname, media.mimetype);
    const p = path.join(dir, `input${ext}`);
    await fs.writeFile(p, media.buffer);
    return p;
  }

  private resolveFfmpegStaticBinary(): string | null {
    try {
      const binary = requireFromService('ffmpeg-static') as string | null;
      return binary && existsSync(binary) ? binary : null;
    } catch {
      return null;
    }
  }

  private resolveFfprobeStaticBinary(): string | null {
    try {
      const mod = requireFromService('ffprobe-static') as {
        path?: string;
      } | null;
      return mod?.path && existsSync(mod.path) ? mod.path : null;
    } catch {
      return null;
    }
  }

  /**
   * 探测 FFmpeg 是否可执行（供 /transcribe-pipeline-health），不抽轨。
   */
  async probeBinary(): Promise<{
    ok: boolean;
    path: string;
    versionHint?: string;
    error?: string;
  }> {
    const bin = this.resolveFfmpegBinary();
    try {
      const { stdout } = await this.execMediaTool(bin, ['-version'], {
        timeout: 10_000,
        maxBuffer: 96 * 1024,
        windowsHide: true,
      });
      const first = (stdout?.toString() ?? '').split('\n')[0]?.trim() ?? '';
      return { ok: true, path: bin, versionHint: first.slice(0, 160) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, path: bin, error: msg };
    }
  }

  async probeDurationSeconds(input: {
    buffer: Buffer;
    originalname: string;
    mimetype?: string;
  }): Promise<number | null> {
    const tmpDir = await fs.mkdtemp(
      path.join(this.runtimeTempDir(), 'kb-ffprobe-'),
    );
    const inputPath = path.join(
      tmpDir,
      `input${this.extensionFromMedia(input.originalname, input.mimetype)}`,
    );

    try {
      await fs.writeFile(inputPath, input.buffer);
      return await this.probeFileDurationSeconds(inputPath);
    } catch (error) {
      this.logger.warn(
        `FFprobe duration probe failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    } finally {
      await fs
        .rm(tmpDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  async probeFileDurationSeconds(inputPath: string): Promise<number | null> {
    const bin = this.resolveFfprobeBinary();
    const attempts: string[][] = [
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        inputPath,
      ],
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        inputPath,
      ],
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=duration',
        '-of',
        'csv=p=0',
        inputPath,
      ],
    ];
    let lastError: unknown = null;

    for (const args of attempts) {
      try {
        const { stdout } = await this.execMediaTool(bin, args, {
          timeout: 20_000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        });
        const seconds = this.parseFirstPositiveDuration(stdout);
        if (seconds) return seconds;
      } catch (error) {
        lastError = error;
      }
    }

    const ffmpegDuration = await this.probeDurationWithFfmpeg(inputPath);
    if (ffmpegDuration) return ffmpegDuration;

    if (lastError) {
      this.logger.warn(
        `FFprobe file duration failed for ${path.basename(inputPath)}: ${this.stringifyUnknown(lastError)}`,
      );
    }
    return null;
  }

  async probeVideoFormatContract(
    inputPath: string,
  ): Promise<VideoFormatContract | null> {
    const bin = this.resolveFfprobeBinary();
    try {
      const { stdout } = await this.execMediaTool(
        bin,
        [
          '-v',
          'error',
          '-show_entries',
          'format=format_name,duration:stream=index,codec_type,codec_name,width,height,coded_width,coded_height,sample_aspect_ratio,display_aspect_ratio,avg_frame_rate,r_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries,sample_rate,channels,channel_layout:stream_disposition=default',
          '-of',
          'json',
          inputPath,
        ],
        {
          timeout: 20_000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        },
      );
      const parsed = JSON.parse(stdout.toString()) as {
        format?: Record<string, unknown>;
        streams?: Array<Record<string, unknown>>;
      };
      const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
      const videoStream = streams.find(
        (stream) => String(stream.codec_type || '').toLowerCase() === 'video',
      );
      const audioStreams = streams.filter(
        (stream) => String(stream.codec_type || '').toLowerCase() === 'audio',
      );
      const video: VideoFormatContractVideoStream | null = videoStream
        ? {
            codecName: this.safeString(videoStream.codec_name),
            width: this.safeInt(videoStream.width),
            height: this.safeInt(videoStream.height),
            codedWidth: this.safeInt(videoStream.coded_width),
            codedHeight: this.safeInt(videoStream.coded_height),
            sampleAspectRatio: this.normalizeAspectRatio(
              this.safeString(videoStream.sample_aspect_ratio),
            ),
            displayAspectRatio: this.normalizeAspectRatio(
              this.safeString(videoStream.display_aspect_ratio),
            ),
            avgFrameRate: this.parseFrameRate(videoStream.avg_frame_rate),
            avgFrameRateRaw: this.normalizeFrameRateRaw(
              this.safeString(videoStream.avg_frame_rate),
            ),
            rFrameRate: this.parseFrameRate(videoStream.r_frame_rate),
            rFrameRateRaw: this.normalizeFrameRateRaw(
              this.safeString(videoStream.r_frame_rate),
            ),
            pixFmt: this.safeString(videoStream.pix_fmt),
            colorRange: this.safeString(videoStream.color_range),
            colorSpace: this.safeString(videoStream.color_space),
            colorTransfer: this.safeString(videoStream.color_transfer),
            colorPrimaries: this.safeString(videoStream.color_primaries),
          }
        : null;
      return {
        formatName: this.safeString(parsed.format?.format_name),
        durationSeconds: this.safeNumber(parsed.format?.duration),
        video,
        audioStreams: audioStreams.map((stream) => {
          const disposition =
            stream.disposition && typeof stream.disposition === 'object'
              ? (stream.disposition as Record<string, unknown>)
              : {};
          return {
            codecName: this.safeString(stream.codec_name),
            sampleRate: this.safeInt(stream.sample_rate),
            channels: this.safeInt(stream.channels),
            channelLayout: this.safeString(stream.channel_layout),
            isDefault: Number(disposition.default || 0) === 1,
          };
        }),
      };
    } catch (error) {
      this.logger.warn(
        `FFprobe video format contract failed for ${path.basename(inputPath)}: ${this.stringifyUnknown(error)}`,
      );
      return null;
    }
  }

  async probeMediaSummary(
    inputPath: string,
  ): Promise<MediaProbeSummary | null> {
    const bin = this.resolveFfprobeBinary();
    try {
      const { stdout } = await this.execMediaTool(
        bin,
        [
          '-v',
          'error',
          '-show_entries',
          'format=format_name,duration,size,bit_rate:stream=index,codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,color_range,color_space,sample_rate,channels,channel_layout,bit_rate',
          '-of',
          'json',
          inputPath,
        ],
        {
          timeout: 20_000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        },
      );
      const parsed = JSON.parse(stdout.toString()) as {
        format?: Record<string, unknown>;
        streams?: Array<Record<string, unknown>>;
      };
      const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
      const videoStream = streams.find(
        (stream) => String(stream.codec_type || '').toLowerCase() === 'video',
      );
      const audioStream = streams.find(
        (stream) => String(stream.codec_type || '').toLowerCase() === 'audio',
      );
      return {
        formatName: this.safeString(parsed.format?.format_name),
        durationSeconds: this.safeNumber(parsed.format?.duration),
        sizeBytes: this.safeInt(parsed.format?.size),
        bitRate: this.safeInt(parsed.format?.bit_rate),
        video: videoStream
          ? {
              codecName: this.safeString(videoStream.codec_name),
              width: this.safeInt(videoStream.width),
              height: this.safeInt(videoStream.height),
              pixFmt: this.safeString(videoStream.pix_fmt),
              avgFrameRate: this.parseFrameRate(videoStream.avg_frame_rate),
              colorSpace: this.safeString(videoStream.color_space),
              colorRange: this.safeString(videoStream.color_range),
            }
          : null,
        audio: audioStream
          ? {
              codecName: this.safeString(audioStream.codec_name),
              sampleRate: this.safeInt(audioStream.sample_rate),
              channels: this.safeInt(audioStream.channels),
              channelLayout: this.safeString(audioStream.channel_layout),
              bitRate: this.safeInt(audioStream.bit_rate),
            }
          : null,
      };
    } catch (error) {
      this.logger.warn(
        `FFprobe media summary failed for ${path.basename(inputPath)}: ${this.stringifyUnknown(error)}`,
      );
      return null;
    }
  }

  async restoreVideoToSourceContract(params: {
    inputVideoPath: string;
    outputVideoPath: string;
    sourceContract: VideoFormatContract;
  }): Promise<void> {
    const sourceVideo = params.sourceContract.video;
    if (!sourceVideo?.width || !sourceVideo?.height) {
      throw new Error('source video contract is missing width/height');
    }
    const sourceHasAudio = params.sourceContract.audioStreams.length > 0;
    const frameRateRaw =
      sourceVideo.avgFrameRateRaw ||
      sourceVideo.rFrameRateRaw ||
      (sourceVideo.avgFrameRate
        ? this.formatFrameRate(sourceVideo.avgFrameRate)
        : null);
    const sar = sourceVideo.sampleAspectRatio || '1:1';
    const filter = `scale=${sourceVideo.width}:${sourceVideo.height}:flags=lanczos,setsar=${sar}`;
    const colorArgs = this.buildColorMetadataArgs({
      pixFmt: sourceVideo.pixFmt,
      colorRange: sourceVideo.colorRange,
      colorSpace: sourceVideo.colorSpace,
      colorTransfer: sourceVideo.colorTransfer,
      colorPrimaries: sourceVideo.colorPrimaries,
    });
    const outputPixFmt = this.resolvePreferredOutputPixFmt(sourceVideo.pixFmt);
    const bin = this.resolveFfmpegBinary();
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      params.inputVideoPath,
      '-map',
      '0:v:0',
      '-map_metadata',
      '0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-vf',
      filter,
      ...(frameRateRaw ? ['-r', frameRateRaw] : []),
      ...(outputPixFmt ? ['-pix_fmt', outputPixFmt] : []),
      ...colorArgs,
      ...(sourceHasAudio ? ['-map', '0:a:0?', '-c:a', 'copy'] : ['-an']),
      '-movflags',
      '+faststart',
      params.outputVideoPath,
    ];
    await this.execMediaTool(bin, args, {
      timeout: this.ffmpegTimeoutMs(),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  }

  private parseFirstPositiveDuration(output: unknown): number | null {
    const text = this.stringifyExecOutput(output);
    const parts = text
      .split(/[\s,\r\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (/^(n\/a|nan|inf)$/i.test(part)) continue;
      const seconds = Number(part);
      if (Number.isFinite(seconds) && seconds > 0) return seconds;
    }
    return null;
  }

  private async probeDurationWithFfmpeg(
    inputPath: string,
  ): Promise<number | null> {
    const bin = this.resolveFfmpegBinary();
    try {
      await this.execMediaTool(
        bin,
        ['-nostdin', '-hide_banner', '-i', inputPath],
        {
          timeout: 20_000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        },
      );
    } catch (error) {
      const execError = error as { stdout?: unknown; stderr?: unknown };
      const output = `${this.stringifyExecOutput(execError.stdout)}\n${this.stringifyExecOutput(execError.stderr)}`;
      return this.parseFfmpegDuration(output);
    }
    return null;
  }

  private parseFfmpegDuration(output: string): number | null {
    const match = output.match(
      /Duration:\s*(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/i,
    );
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const duration = hours * 3600 + minutes * 60 + seconds;
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  private stringifyExecOutput(output: unknown): string {
    if (!output) return '';
    if (Buffer.isBuffer(output)) return output.toString();
    if (typeof output === 'string') return output;
    if (typeof output === 'number' || typeof output === 'boolean') {
      return String(output);
    }
    return this.stringifyUnknown(output);
  }

  private stringifyUnknown(value: unknown): string {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserializable]';
    }
  }

  async replaceVideoAudio(params: {
    video: { buffer: Buffer; originalname: string };
    audio: { buffer: Buffer; originalname?: string };
  }): Promise<TranscribeMediaInput> {
    const bin = this.resolveFfmpegBinary();
    const tmpDir = await fs.mkdtemp(
      path.join(this.runtimeTempDir(), 'kb-ffmpeg-mux-'),
    );
    const videoExt = path.extname(params.video.originalname) || '.mp4';
    const audioExt = path.extname(params.audio.originalname || '') || '.mp3';
    const inputVideo = path.join(tmpDir, `input-video${videoExt}`);
    const inputAudio = path.join(tmpDir, `input-audio${audioExt}`);
    const outputVideo = path.join(tmpDir, 'lip-sync-input.mp4');

    try {
      await fs.writeFile(inputVideo, params.video.buffer);
      await fs.writeFile(inputAudio, params.audio.buffer);
      const args = [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        inputVideo,
        '-i',
        inputAudio,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-shortest',
        outputVideo,
      ];
      await this.execMediaTool(bin, args, {
        timeout: this.ffmpegTimeoutMs(),
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
      const buffer = await fs.readFile(outputVideo);
      return {
        buffer,
        originalname: 'lip-sync-input.mp4',
        mimetype: 'video/mp4',
        size: buffer.length,
      };
    } finally {
      await fs
        .rm(tmpDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  async burnAssSubtitles(params: {
    inputVideoPath: string;
    subtitleAssPath: string;
    outputVideoPath: string;
    clipSeconds?: number;
  }): Promise<void> {
    const bin = this.resolveFfmpegBinary();
    const hint = await this.probeVideoEncodingHint(params.inputVideoPath);
    const colorArgs = this.buildColorMetadataArgs(hint);
    const outputPixFmt = this.resolvePreferredOutputPixFmt(hint.pixFmt);
    const filter = `subtitles='${this.escapeFilterPath(params.subtitleAssPath)}'`;
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      params.inputVideoPath,
      '-vf',
      filter,
      '-map_metadata',
      '0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      ...(outputPixFmt ? ['-pix_fmt', outputPixFmt] : []),
      ...colorArgs,
      '-c:a',
      'copy',
    ];
    if (params.clipSeconds && params.clipSeconds > 0) {
      args.push('-t', String(params.clipSeconds));
    }
    args.push(params.outputVideoPath);
    await this.execMediaTool(bin, args, {
      timeout: this.ffmpegTimeoutMs(),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  }

  async probeVideoPixelFormat(inputPath: string): Promise<string | null> {
    const bin = this.resolveFfprobeBinary();
    try {
      const { stdout } = await this.execMediaTool(
        bin,
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=pix_fmt',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          inputPath,
        ],
        {
          timeout: 20_000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        },
      );
      const value = stdout?.toString().trim();
      return value || null;
    } catch {
      return null;
    }
  }

  async probeVideoAlphaInfo(inputPath: string): Promise<VideoAlphaProbeResult> {
    const bin = this.resolveFfprobeBinary();
    try {
      const { stdout } = await this.execMediaTool(
        bin,
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=pix_fmt:stream_tags=alpha_mode',
          '-of',
          'default=noprint_wrappers=1',
          inputPath,
        ],
        {
          timeout: 20_000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        },
      );
      const lines = stdout
        ?.toString()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      let pixFmt: string | null = null;
      let alphaMode: string | null = null;
      for (const line of lines || []) {
        const pixMatch = line.match(/^pix_fmt=(.+)$/i);
        if (pixMatch?.[1]) {
          pixFmt = pixMatch[1].trim();
          continue;
        }
        const alphaMatch = line.match(/^TAG:alpha_mode=(.+)$/i);
        if (alphaMatch?.[1]) {
          alphaMode = alphaMatch[1].trim();
        }
      }
      return { pixFmt, alphaMode };
    } catch {
      return { pixFmt: null, alphaMode: null };
    }
  }

  async renderTransparentTitleCardWebm(params: {
    text: string;
    durationSeconds: number;
    outputWebmPath: string;
    width?: number;
    height?: number;
    fps?: number;
    fontFile?: string | null;
    fontFamily?: string | null;
    fontSize?: number;
    fontColor?: string;
    borderColor?: string;
    borderWidth?: number;
    boxColor?: string;
    boxBorderWidth?: number;
    xExpression?: string;
    yExpression?: string;
    timeoutMs?: number;
  }): Promise<void> {
    const bin = this.resolveFfmpegBinary();
    const width = Math.max(320, Math.floor(params.width ?? 1080));
    const height = Math.max(320, Math.floor(params.height ?? 1920));
    const fps = Math.max(1, Math.floor(params.fps ?? 30));
    const durationSeconds = Math.max(0.2, params.durationSeconds);
    const fontSize = Math.max(18, Math.floor(params.fontSize ?? 62));
    const borderWidth = Math.max(0, Math.floor(params.borderWidth ?? 3));
    const boxBorderWidth = Math.max(0, Math.floor(params.boxBorderWidth ?? 24));
    const xExpression = params.xExpression?.trim() || '(w-text_w)/2';
    const yExpression = params.yExpression?.trim() || '(h-text_h)/2';

    const tmpDir = await fs.mkdtemp(
      path.join(this.runtimeTempDir(), 'kb-title-card-'),
    );
    const textFile = path.join(tmpDir, 'title.txt');
    const safeText = params.text.replace(/\r\n/g, '\n').trim() || ' ';
    await fs.writeFile(textFile, safeText, 'utf8');
    const drawTextParts = [
      `textfile='${this.escapeFilterPath(textFile)}'`,
      `fontsize=${fontSize}`,
      `fontcolor=${params.fontColor || '0xFFFFFF'}`,
      `borderw=${borderWidth}`,
      `bordercolor=${params.borderColor || '0x000000'}`,
      `box=1`,
      `boxcolor=${params.boxColor || '0x00FF66@0.35'}`,
      `boxborderw=${boxBorderWidth}`,
      `x=${xExpression}`,
      `y=${yExpression}`,
      `line_spacing=8`,
      `shadowx=0`,
      `shadowy=0`,
      `alpha=1`,
    ];
    const fontFile = params.fontFile?.trim();
    if (fontFile) {
      drawTextParts.unshift(
        `fontfile='${this.escapeFilterPath(path.resolve(fontFile))}'`,
      );
    } else if (params.fontFamily?.trim()) {
      drawTextParts.unshift(`font='${params.fontFamily.trim()}'`);
    }
    const filter = `format=rgba,drawtext=${drawTextParts.join(':')}`;

    try {
      await this.execMediaTool(
        bin,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          `color=c=black@0.0:s=${width}x${height}:r=${fps}`,
          '-t',
          this.formatSeconds(durationSeconds),
          '-vf',
          filter,
          '-an',
          '-c:v',
          'libvpx-vp9',
          '-pix_fmt',
          'yuva420p',
          '-auto-alt-ref',
          '0',
          '-b:v',
          '0',
          '-crf',
          '26',
          params.outputWebmPath,
        ],
        {
          timeout:
            readPositiveInt(params.timeoutMs, 0) || this.ffmpegTimeoutMs(),
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
        },
      );
    } finally {
      await fs
        .rm(tmpDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  async renderTitleFallbackPngFrame(params: {
    text: string;
    outputPngPath: string;
    width?: number;
    height?: number;
    fontFile?: string | null;
    fontFamily?: string | null;
    fontSize?: number;
    fontColor?: string;
    borderColor?: string;
    borderWidth?: number;
    boxColor?: string;
    boxBorderWidth?: number;
    xExpression?: string;
    yExpression?: string;
    timeoutMs?: number;
  }): Promise<void> {
    const bin = this.resolveFfmpegBinary();
    const width = Math.max(320, Math.floor(params.width ?? 1080));
    const height = Math.max(320, Math.floor(params.height ?? 1920));
    const fontSize = Math.max(18, Math.floor(params.fontSize ?? 62));
    const borderWidth = Math.max(0, Math.floor(params.borderWidth ?? 3));
    const boxBorderWidth = Math.max(0, Math.floor(params.boxBorderWidth ?? 24));
    const xExpression = params.xExpression?.trim() || '(w-text_w)/2';
    const yExpression = params.yExpression?.trim() || '(h-text_h)/2';

    const tmpDir = await fs.mkdtemp(
      path.join(this.runtimeTempDir(), 'kb-title-png-'),
    );
    const textFile = path.join(tmpDir, 'title.txt');
    const safeText = params.text.replace(/\r\n/g, '\n').trim() || ' ';
    await fs.writeFile(textFile, safeText, 'utf8');
    const drawTextParts = [
      `textfile='${this.escapeFilterPath(textFile)}'`,
      `fontsize=${fontSize}`,
      `fontcolor=${params.fontColor || '0xFFFFFF'}`,
      `borderw=${borderWidth}`,
      `bordercolor=${params.borderColor || '0x000000'}`,
      `box=1`,
      `boxcolor=${params.boxColor || '0x00FF66@0.35'}`,
      `boxborderw=${boxBorderWidth}`,
      `x=${xExpression}`,
      `y=${yExpression}`,
      `line_spacing=8`,
      `shadowx=0`,
      `shadowy=0`,
      `alpha=1`,
    ];
    const fontFile = params.fontFile?.trim();
    if (fontFile) {
      drawTextParts.unshift(
        `fontfile='${this.escapeFilterPath(path.resolve(fontFile))}'`,
      );
    } else if (params.fontFamily?.trim()) {
      drawTextParts.unshift(`font='${params.fontFamily.trim()}'`);
    }
    const filter = `format=rgba,drawtext=${drawTextParts.join(':')}`;

    try {
      await this.execMediaTool(
        bin,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          `color=c=black@0.0:s=${width}x${height}:r=1`,
          '-frames:v',
          '1',
          '-vf',
          filter,
          '-c:v',
          'png',
          params.outputPngPath,
        ],
        {
          timeout:
            readPositiveInt(params.timeoutMs, 0) || this.ffmpegTimeoutMs(),
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
        },
      );
    } finally {
      await fs
        .rm(tmpDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  async buildPreviewMp4FromTransparentWebm(params: {
    inputWebmPath: string;
    outputMp4Path: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    timeoutMs?: number;
  }): Promise<void> {
    const bin = this.resolveFfmpegBinary();
    const width = Math.max(320, Math.floor(params.width ?? 1080));
    const height = Math.max(320, Math.floor(params.height ?? 1920));
    const durationSeconds =
      typeof params.durationSeconds === 'number' &&
      Number.isFinite(params.durationSeconds) &&
      params.durationSeconds > 0
        ? params.durationSeconds
        : null;
    await this.execMediaTool(
      bin,
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${width}x${height}:r=30`,
        '-i',
        params.inputWebmPath,
        ...(durationSeconds ? ['-t', this.formatSeconds(durationSeconds)] : []),
        '-filter_complex',
        '[0:v][1:v]overlay=0:0:eof_action=pass:format=auto[vout]',
        '-map',
        '[vout]',
        '-an',
        '-shortest',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        params.outputMp4Path,
      ],
      {
        timeout: readPositiveInt(params.timeoutMs, 0) || this.ffmpegTimeoutMs(),
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
    );
  }

  async overlayTimedVideoAssets(params: {
    inputVideoPath: string;
    outputVideoPath: string;
    overlays: TimedOverlayAsset[];
  }): Promise<void> {
    const validOverlays = params.overlays
      .filter(
        (item) =>
          item &&
          typeof item.inputPath === 'string' &&
          item.inputPath.trim() &&
          Number.isFinite(item.startTime) &&
          Number.isFinite(item.endTime) &&
          item.endTime > item.startTime,
      )
      .map((item) => ({
        inputPath: item.inputPath,
        startTime: Math.max(0, item.startTime),
        endTime: Math.max(0.05, item.endTime),
      }));
    if (!validOverlays.length) {
      await fs.copyFile(params.inputVideoPath, params.outputVideoPath);
      return;
    }

    const bin = this.resolveFfmpegBinary();
    const hint = await this.probeVideoEncodingHint(params.inputVideoPath);
    const colorArgs = this.buildColorMetadataArgs(hint);
    const outputPixFmt = this.resolvePreferredOutputPixFmt(hint.pixFmt);
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      params.inputVideoPath,
      ...validOverlays.flatMap((item) => ['-i', item.inputPath]),
    ];
    const graphParts: string[] = ['[0:v]setpts=PTS-STARTPTS[base0]'];
    validOverlays.forEach((item, index) => {
      const inputLabel = index + 1;
      const delayed = `ov${index + 1}`;
      const baseIn = `base${index}`;
      const baseOut = `base${index + 1}`;
      graphParts.push(
        `[${inputLabel}:v]setpts=PTS-STARTPTS+${this.formatSeconds(item.startTime)}/TB[${delayed}]`,
      );
      graphParts.push(
        `[${baseIn}][${delayed}]overlay=0:0:eof_action=pass:enable='between(t,${this.formatSeconds(item.startTime)},${this.formatSeconds(item.endTime)})'[${baseOut}]`,
      );
    });
    const finalLabel = `base${validOverlays.length}`;

    args.push(
      '-filter_complex',
      graphParts.join(';'),
      '-map',
      `[${finalLabel}]`,
      '-map',
      '0:a?',
      '-map_metadata',
      '0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      ...(outputPixFmt ? ['-pix_fmt', outputPixFmt] : []),
      ...colorArgs,
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      params.outputVideoPath,
    );
    await this.execMediaTool(bin, args, {
      timeout: this.ffmpegTimeoutMs(),
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
  }

  async clipVideo(params: {
    inputVideoPath: string;
    outputVideoPath: string;
    clipSeconds?: number;
  }): Promise<void> {
    const bin = this.resolveFfmpegBinary();
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      params.inputVideoPath,
      '-c',
      'copy',
    ];
    if (params.clipSeconds && params.clipSeconds > 0) {
      args.push('-t', String(params.clipSeconds));
    }
    args.push(params.outputVideoPath);
    await this.execMediaTool(bin, args, {
      timeout: this.ffmpegTimeoutMs(),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  }

  async prepareVideoForAliLipSync(params: {
    inputVideoPath: string;
    outputVideoPath: string;
    clipSeconds?: number;
    targetSeconds?: number;
    renderMode?: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
  }): Promise<void> {
    const bin = this.resolveFfmpegBinary();
    const hint = await this.probeVideoEncodingHint(params.inputVideoPath);
    const colorArgs = this.buildColorMetadataArgs(hint);
    const outputPixFmt = this.resolvePreferredOutputPixFmt(hint.pixFmt);
    const normalizedClipSeconds =
      typeof params.clipSeconds === 'number' && params.clipSeconds > 0
        ? params.clipSeconds
        : null;
    const normalizedTargetSeconds =
      typeof params.targetSeconds === 'number' && params.targetSeconds > 0
        ? params.targetSeconds
        : null;
    const outputSeconds = normalizedClipSeconds ?? normalizedTargetSeconds;
    const renderMode = params.renderMode ?? 'preserveSourceAspect';
    const sourceContract =
      renderMode === 'preserveSourceAspect'
        ? await this.probeVideoFormatContract(params.inputVideoPath)
        : null;
    const preserveScaleFilter =
      this.resolvePreserveSourceScaleFilter(sourceContract);
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...(renderMode === 'preserveSourceAspect' ? ['-noautorotate'] : []),
      ...(normalizedTargetSeconds && !normalizedClipSeconds
        ? ['-stream_loop', '-1']
        : []),
      '-i',
      params.inputVideoPath,
    ];
    if (outputSeconds) {
      args.push('-t', String(outputSeconds));
    }
    const scaleFilter =
      preserveScaleFilter ?? this.resolveRenderModeScaleFilter(renderMode);
    args.push(
      '-an',
      '-map_metadata',
      '0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      ...(scaleFilter ? ['-vf', scaleFilter] : []),
      ...(outputPixFmt ? ['-pix_fmt', outputPixFmt] : []),
      ...colorArgs,
      '-movflags',
      '+faststart',
      params.outputVideoPath,
    );
    await this.execMediaTool(bin, args, {
      timeout: this.ffmpegTimeoutMs(),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  }

  async normalizeVideoForRenderMode(params: {
    inputVideoPath: string;
    outputVideoPath: string;
    renderMode?: '1080x1920' | 'adaptive' | 'preserveSourceAspect';
  }): Promise<void> {
    const bin = this.resolveFfmpegBinary();
    const hint = await this.probeVideoEncodingHint(params.inputVideoPath);
    const colorArgs = this.buildColorMetadataArgs(hint);
    const outputPixFmt = this.resolvePreferredOutputPixFmt(hint.pixFmt);
    const renderMode = params.renderMode ?? 'preserveSourceAspect';
    const sourceContract =
      renderMode === 'preserveSourceAspect'
        ? await this.probeVideoFormatContract(params.inputVideoPath)
        : null;
    const preserveScaleFilter =
      this.resolvePreserveSourceScaleFilter(sourceContract);
    const scaleFilter =
      preserveScaleFilter ?? this.resolveRenderModeScaleFilter(renderMode);
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...(renderMode === 'preserveSourceAspect' ? ['-noautorotate'] : []),
      '-i',
      params.inputVideoPath,
      '-map_metadata',
      '0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      ...(scaleFilter ? ['-vf', scaleFilter] : []),
      ...(outputPixFmt ? ['-pix_fmt', outputPixFmt] : []),
      ...colorArgs,
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      params.outputVideoPath,
    ];
    await this.execMediaTool(bin, args, {
      timeout: this.ffmpegTimeoutMs(),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  }

  private safeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private safeNumber(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private safeInt(value: unknown): number | null {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }

  private parseFrameRate(value: unknown): number | null {
    const raw = this.safeString(value);
    if (!raw) return null;
    if (/^\d+(\.\d+)?$/.test(raw)) {
      const numeric = Number(raw);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
    }
    const match = raw.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    const num = Number(match[1]);
    const den = Number(match[2]);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
    const rate = num / den;
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  private normalizeFrameRateRaw(value: string | null): string | null {
    if (!value) return null;
    if (value === '0/0' || value === 'N/A') return null;
    return value;
  }

  private normalizeAspectRatio(value: string | null): string | null {
    if (!value) return null;
    const normalized = value.trim();
    if (!normalized || normalized === 'N/A' || normalized === '0:1')
      return null;
    return normalized;
  }

  private formatFrameRate(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '';
    return Number(value.toFixed(6)).toString();
  }

  private resolveRenderModeScaleFilter(
    renderMode: '1080x1920' | 'adaptive' | 'preserveSourceAspect',
  ): string | null {
    if (renderMode === '1080x1920') {
      return 'scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1';
    }
    if (renderMode === 'preserveSourceAspect') {
      return null;
    }
    return "scale='trunc(iw/2)*2':'trunc(ih/2)*2':flags=lanczos,setsar=1";
  }

  private resolvePreserveSourceScaleFilter(
    sourceContract: VideoFormatContract | null,
  ): string | null {
    const sourceVideo = sourceContract?.video;
    if (!sourceVideo?.width || !sourceVideo?.height) return null;
    const sar = sourceVideo.sampleAspectRatio || '1:1';
    return `scale=${sourceVideo.width}:${sourceVideo.height}:flags=lanczos,setsar=${sar}`;
  }

  async clipAudio(params: {
    inputAudioPath: string;
    outputAudioPath: string;
    clipSeconds?: number;
  }): Promise<void> {
    const bin = this.resolveFfmpegBinary();
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      params.inputAudioPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
    ];
    if (params.clipSeconds && params.clipSeconds > 0) {
      args.push('-t', String(params.clipSeconds));
    }
    args.push(params.outputAudioPath);
    await this.execMediaTool(bin, args, {
      timeout: this.ffmpegTimeoutMs(),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  }

  async detectSilences(params: {
    inputPath: string;
    noiseDb: number;
    minSilenceDuration: number;
  }): Promise<SilenceSegment[]> {
    const bin = this.resolveFfmpegBinary();
    const args = [
      '-nostdin',
      '-hide_banner',
      '-i',
      params.inputPath,
      '-af',
      `silencedetect=noise=${params.noiseDb}dB:d=${params.minSilenceDuration}`,
      '-f',
      'null',
      '-',
    ];
    const { stdout, stderr } = await this.execMediaTool(bin, args, {
      timeout: 20 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });

    const log = `${stdout?.toString() ?? ''}\n${stderr?.toString() ?? ''}`;
    const silences: SilenceSegment[] = [];
    let currentStart: number | null = null;
    for (const line of log.split(/\r?\n/)) {
      const startMatch = line.match(/silence_start:\s*([0-9.]+)/i);
      if (startMatch) {
        currentStart = Number(startMatch[1]);
        continue;
      }

      const endMatch = line.match(
        /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/i,
      );
      if (!endMatch) continue;
      const endTime = Number(endMatch[1]);
      const duration = Number(endMatch[2]);
      const startTime =
        typeof currentStart === 'number' && Number.isFinite(currentStart)
          ? currentStart
          : endTime - duration;
      currentStart = null;
      if (
        Number.isFinite(startTime) &&
        Number.isFinite(endTime) &&
        Number.isFinite(duration) &&
        endTime > startTime
      ) {
        silences.push({
          startTime: Number(startTime.toFixed(3)),
          endTime: Number(endTime.toFixed(3)),
          duration: Number(duration.toFixed(3)),
        });
      }
    }
    return silences;
  }

  async cutVideoByRanges(params: {
    inputVideoPath: string;
    outputVideoPath: string;
    cuts: VideoCutRange[];
  }): Promise<void> {
    const duration = await this.probeFileDurationSeconds(params.inputVideoPath);
    if (!duration) {
      throw new Error(
        'Unable to probe video duration before applying cut points',
      );
    }

    const normalizedCuts = params.cuts
      .filter((cut) => cut.enabled !== false)
      .map((cut) => ({
        startTime: this.clampSeconds(cut.startTime, 0, duration),
        endTime: this.clampSeconds(cut.endTime, 0, duration),
      }))
      .filter((cut) => cut.endTime - cut.startTime > 0.04)
      .sort((a, b) => a.startTime - b.startTime);

    if (!normalizedCuts.length) {
      await fs.copyFile(params.inputVideoPath, params.outputVideoPath);
      return;
    }

    const keepRanges: { startTime: number; endTime: number }[] = [];
    let cursor = 0;
    for (const cut of normalizedCuts) {
      if (cut.endTime <= cursor) continue;
      const start = Math.max(cursor, cut.startTime);
      if (start - cursor > 0.05) {
        keepRanges.push({ startTime: cursor, endTime: start });
      }
      cursor = Math.max(cursor, cut.endTime);
    }
    if (duration - cursor > 0.05) {
      keepRanges.push({ startTime: cursor, endTime: duration });
    }

    if (!keepRanges.length) {
      await fs.copyFile(params.inputVideoPath, params.outputVideoPath);
      return;
    }

    const bin = this.resolveFfmpegBinary();
    const hint = await this.probeVideoEncodingHint(params.inputVideoPath);
    const colorArgs = this.buildColorMetadataArgs(hint);
    const outputPixFmt = this.resolvePreferredOutputPixFmt(hint.pixFmt);
    const tmpDir = await fs.mkdtemp(
      path.join(this.runtimeTempDir(), 'kb-ffmpeg-cut-'),
    );
    try {
      const segmentPaths: string[] = [];
      for (const [index, range] of keepRanges.entries()) {
        const segmentPath = path.join(
          tmpDir,
          `segment-${String(index).padStart(3, '0')}.mp4`,
        );
        const segmentDuration = Math.max(0.05, range.endTime - range.startTime);
        await this.execMediaTool(
          bin,
          [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-ss',
            range.startTime.toFixed(3),
            '-i',
            params.inputVideoPath,
            '-t',
            segmentDuration.toFixed(3),
            '-map',
            '0:v:0',
            '-map',
            '0:a?',
            '-map_metadata',
            '0',
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '18',
            ...(outputPixFmt ? ['-pix_fmt', outputPixFmt] : []),
            ...colorArgs,
            '-c:a',
            'aac',
            '-movflags',
            '+faststart',
            segmentPath,
          ],
          {
            timeout: 20 * 60_000,
            maxBuffer: 64 * 1024 * 1024,
            windowsHide: true,
          },
        );
        segmentPaths.push(segmentPath);
      }

      if (segmentPaths.length === 1) {
        await fs.copyFile(segmentPaths[0], params.outputVideoPath);
        return;
      }

      const listPath = path.join(tmpDir, 'concat-list.txt');
      const listContent = segmentPaths
        .map(
          (segmentPath) =>
            `file '${segmentPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`,
        )
        .join('\n');
      await fs.writeFile(listPath, listContent, 'utf8');

      await this.execMediaTool(
        bin,
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listPath,
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          params.outputVideoPath,
        ],
        {
          timeout: 20 * 60_000,
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
        },
      );
    } finally {
      await fs
        .rm(tmpDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  private async probeVideoEncodingHint(
    inputPath: string,
  ): Promise<VideoEncodingHint> {
    const fallback: VideoEncodingHint = {
      pixFmt: null,
      colorRange: null,
      colorSpace: null,
      colorTransfer: null,
      colorPrimaries: null,
    };
    const bin = this.resolveFfprobeBinary();
    try {
      const { stdout } = await this.execMediaTool(
        bin,
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=pix_fmt,color_range,color_space,color_transfer,color_primaries',
          '-of',
          'json',
          inputPath,
        ],
        {
          timeout: 20_000,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        },
      );
      const parsed = JSON.parse(stdout.toString()) as {
        streams?: Array<Record<string, unknown>>;
      };
      const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : null;
      if (!stream) return fallback;
      const asText = (value: unknown): string | null =>
        typeof value === 'string' && value.trim() ? value.trim() : null;
      return {
        pixFmt: asText(stream.pix_fmt),
        colorRange: asText(stream.color_range),
        colorSpace: asText(stream.color_space),
        colorTransfer: asText(stream.color_transfer),
        colorPrimaries: asText(stream.color_primaries),
      };
    } catch {
      return fallback;
    }
  }

  private buildColorMetadataArgs(hint: VideoEncodingHint): string[] {
    const args: string[] = [];
    if (hint.colorRange) args.push('-color_range', hint.colorRange);
    if (hint.colorSpace) args.push('-colorspace', hint.colorSpace);
    if (hint.colorTransfer) args.push('-color_trc', hint.colorTransfer);
    if (hint.colorPrimaries) args.push('-color_primaries', hint.colorPrimaries);
    return args;
  }

  private resolvePreferredOutputPixFmt(pixFmt: string | null): string | null {
    if (!pixFmt) return 'yuv420p';
    const normalized = pixFmt.toLowerCase();
    const supported = new Set([
      'yuv420p',
      'yuvj420p',
      'yuv422p',
      'yuvj422p',
      'yuv444p',
      'yuvj444p',
      'nv12',
      'nv16',
      'nv21',
      'yuv420p10le',
      'yuv422p10le',
      'yuv444p10le',
      'nv20le',
      'gray',
      'gray10le',
    ]);
    return supported.has(normalized) ? normalized : 'yuv420p';
  }

  private escapeFilterPath(filePath: string): string {
    return path
      .resolve(filePath)
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");
  }

  private async runExtract(
    ffmpegBin: string,
    inputPath: string,
    outputAudioPath: string,
  ): Promise<void> {
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      outputAudioPath,
    ];
    await this.execMediaTool(ffmpegBin, args, {
      timeout: this.ffmpegTimeoutMs(),
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  }

  private async execMediaTool(
    file: string,
    args: string[],
    options: MediaExecOptions,
  ): Promise<Awaited<ReturnType<typeof execFileAsync>>> {
    return runWithRuntimeLimit(
      'ffmpeg',
      {
        concurrency: readPositiveInt(
          this.config.get('FFMPEG_MAX_CONCURRENCY'),
          2,
        ),
        queueLimit: readPositiveInt(this.config.get('FFMPEG_QUEUE_LIMIT'), 20),
      },
      () =>
        execFileAsync(file, args, {
          timeout: options.timeout ?? this.ffmpegTimeoutMs(),
          maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
          windowsHide: options.windowsHide ?? true,
        }),
    );
  }

  private ffmpegTimeoutMs(): number {
    return readPositiveInt(this.config.get('FFMPEG_TIMEOUT_MS'), 20 * 60_000);
  }

  private formatSeconds(value: number): string {
    return Math.max(0, value)
      .toFixed(3)
      .replace(/\.?0+$/, '');
  }

  private runtimeTempDir(): string {
    return path.resolve(
      this.config.get<string>('TEMP_DIR')?.trim() ||
        this.config.get<string>('TMP_DIR')?.trim() ||
        os.tmpdir(),
    );
  }

  private clampSeconds(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }
}
