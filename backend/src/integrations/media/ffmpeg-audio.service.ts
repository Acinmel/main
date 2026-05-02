import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** 与 VideoMediaDownloadService 下载结果一致 */
export type TranscribeMediaInput = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
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

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-ffmpeg-'));
    const outAudio = path.join(tmpDir, 'for-transcription.mp3');

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
      const base = path.basename(media.originalname, path.extname(media.originalname)) || 'audio';
      return {
        buffer: audio,
        originalname: `${base}.mp3`,
        mimetype: 'audio/mpeg',
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

  private isLikelyVideo(originalname: string, mimetype: string): boolean {
    const m = (mimetype || '').toLowerCase();
    if (m.startsWith('video/')) return true;
    const n = (originalname || '').toLowerCase();
    return /\.(mp4|webm|mov|mkv|mpeg|mpg|avi|flv|m4v|3gp|ts)$/i.test(n);
  }

  private resolveFfmpegBinary(): string {
    const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const fromEnv = this.config.get<string>('FFMPEG_BIN')?.trim();
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
    return exe;
  }

  private async writeTempInput(dir: string, media: TranscribeMediaInput): Promise<string> {
    const ext = path.extname(media.originalname) || '.bin';
    const p = path.join(dir, `input${ext}`);
    await fs.writeFile(p, media.buffer);
    return p;
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
      const { stdout } = await execFileAsync(bin, ['-version'], {
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
      'libmp3lame',
      '-b:a',
      '24k',
      outputAudioPath,
    ];
    await execFileAsync(ffmpegBin, args, {
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  }
}
