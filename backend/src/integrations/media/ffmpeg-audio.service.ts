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
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
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
  }): Promise<void> {
    const bin = this.resolveFfmpegBinary();
    const normalizedClipSeconds =
      typeof params.clipSeconds === 'number' && params.clipSeconds > 0
        ? params.clipSeconds
        : null;
    const normalizedTargetSeconds =
      typeof params.targetSeconds === 'number' && params.targetSeconds > 0
        ? params.targetSeconds
        : null;
    const outputSeconds = normalizedClipSeconds ?? normalizedTargetSeconds;
    const args = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...(normalizedTargetSeconds && !normalizedClipSeconds
        ? ['-stream_loop', '-1']
        : []),
      '-i',
      params.inputVideoPath,
    ];
    if (outputSeconds) {
      args.push('-t', String(outputSeconds));
    }
    args.push(
      '-an',
      '-vf',
      "scale=w=2048:h=2048:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=w='max(iw,640)':h='max(ih,640)':x='(ow-iw)/2':y='(oh-ih)/2':color=black,setsar=1",
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
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
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '20',
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
