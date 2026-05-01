import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { load } from 'cheerio';
import { DEFAULT_TRANSCRIBE_MEDIA_MAX_BYTES } from '../../common/media.constants';
import { assertUrlSafeForServerFetch } from '../../common/url-safety.util';

const execFileAsync = promisify(execFile);

type YtdlpInvoker =
  | { kind: 'binary'; executable: string }
  | { kind: 'python'; python: string; pythonpath: string; pythonPrefixArgs: string[] };

/** 链接拉媒体供口播转写（ASR）；抖音失败码沿用历史命名（douyin_no_ytdlp / douyin_ytdlp_failed） */
export type TranscriptionMediaDownloadOutcome =
  | { ok: true; media: DownloadedMediaBuffer }
  | {
      ok: false;
      failure: 'douyin_no_ytdlp' | 'douyin_ytdlp_failed' | 'no_media';
    };

export interface DownloadedMediaBuffer {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * 为口播转写准备本地媒体字节：
 * 1) **抖音**：仅使用仓库内 **dy-downloader**（backend/DY-DOWNLOADER），需 **DY_DOWNLOADER_COOKIE**；
 * 2) **非抖音**：**YTDLP_BIN** / **yt-dlp-master** 调用 yt-dlp，失败则回退 HTML 直链解析。
 */
@Injectable()
export class VideoMediaDownloadService {
  private readonly logger = new Logger(VideoMediaDownloadService.name);

  constructor(private readonly config: ConfigService) {}

  async tryDownloadForTranscription(
    canonicalUrl: string,
  ): Promise<TranscriptionMediaDownloadOutcome> {
    let pageUrl: URL;
    try {
      pageUrl = new URL(canonicalUrl);
    } catch {
      throw new BadRequestException('URL 格式无效');
    }
    assertUrlSafeForServerFetch(pageUrl);

    const maxBytes = Number(
      this.config.get('VIDEO_MEDIA_MAX_BYTES') ?? DEFAULT_TRANSCRIBE_MEDIA_MAX_BYTES,
    );
    const douyin = this.isDouyinUrl(canonicalUrl);
    const invoker = this.resolveYtdlpInvoker();

    if (douyin) {
      const dyCookie = this.config.get<string>('DY_DOWNLOADER_COOKIE')?.trim();
      if (!dyCookie) {
        this.logger.warn('抖音下载仅走 dy-downloader，请配置 DY_DOWNLOADER_COOKIE，见 backend/.env.example');
        return { ok: false, failure: 'douyin_no_ytdlp' };
      }
      const fromDy = await this.tryDownloadDouyinViaDyDownloader(
        canonicalUrl,
        maxBytes,
        dyCookie,
      );
      if (fromDy) {
        this.logger.log(`dy-downloader 已拉取媒体 ${fromDy.size} 字节`);
        return { ok: true, media: fromDy };
      }
      this.logger.warn('dy-downloader 未取得抖音媒体');
      return { ok: false, failure: 'douyin_ytdlp_failed' };
    }

    if (invoker) {
      const fromYtdlp = await this.tryDownloadViaYtDlp(canonicalUrl, maxBytes, invoker);
      if (fromYtdlp) {
        this.logger.log(`yt-dlp 已下载媒体 ${fromYtdlp.size} 字节`);
        return { ok: true, media: fromYtdlp };
      }
      this.logger.warn('yt-dlp 未得到可用媒体，回退 HTML 直链解析');
    }

    const fromHtml = await this.tryHtmlHeuristicDownload(canonicalUrl, maxBytes);
    if (fromHtml) {
      return { ok: true, media: fromHtml };
    }
    return { ok: false, failure: 'no_media' };
  }

  private isDouyinUrl(url: string): boolean {
    try {
      return new URL(url).hostname.toLowerCase().includes('douyin.com');
    } catch {
      return false;
    }
  }

  /** 自目录向上查找名为 yt-dlp-master 且含 yt_dlp 包的目录（适配任意工作目录深度） */
  private findYtDlpMasterWalkingUp(fromDir: string, maxDepth = 12): string | null {
    let dir = path.resolve(fromDir);
    for (let i = 0; i < maxDepth; i++) {
      const candidate = path.join(dir, 'yt-dlp-master');
      if (this.isYtDlpSourceRoot(candidate)) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
    return null;
  }

  private collectYtDlpSourceCandidateRoots(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (p: string | null | undefined) => {
      if (!p) return;
      const norm = path.resolve(p);
      if (!seen.has(norm)) {
        seen.add(norm);
        out.push(norm);
      }
    };
    const explicit = this.config.get<string>('YT_DLP_SOURCE_DIR')?.trim();
    if (explicit) {
      push(path.isAbsolute(explicit) ? explicit : path.join(process.cwd(), explicit));
    }
    push(this.findYtDlpMasterWalkingUp(process.cwd()));
    push(this.findYtDlpMasterWalkingUp(__dirname));
    return out;
  }

  private isYtDlpSourceRoot(root: string): boolean {
    return existsSync(path.join(root, 'yt_dlp', '__main__.py'));
  }

  /**
   * 优先可执行文件；否则使用仓库内 yt-dlp 源码目录 + `python -m yt_dlp`。
   */
  private resolveYtdlpInvoker(): YtdlpInvoker | null {
    const bin = this.config.get<string>('YTDLP_BIN')?.trim();
    if (bin) {
      return { kind: 'binary', executable: bin };
    }
    const python =
      this.config.get<string>('PYTHON_BIN')?.trim() ||
      (process.platform === 'win32' ? 'python' : 'python3');
    const prefixRaw = this.config.get<string>('YTDLP_PYTHON_ARGS')?.trim();
    const pythonPrefixArgs = prefixRaw ? prefixRaw.split(/\s+/).filter(Boolean) : [];
    for (const root of this.collectYtDlpSourceCandidateRoots()) {
      if (this.isYtDlpSourceRoot(root)) {
        this.logger.log(
          `yt-dlp 使用源码目录: ${root}（解释器: ${python}${pythonPrefixArgs.length ? ` ${pythonPrefixArgs.join(' ')}` : ''}）`,
        );
        return { kind: 'python', python, pythonpath: root, pythonPrefixArgs };
      }
    }
    return null;
  }

  /**
   * 使用仓库内 dy-downloader（backend/DY-DOWNLOADER）解析作品并拉取视频直链到内存（需 Cookie）。
   */
  private async tryDownloadDouyinViaDyDownloader(
    pageUrl: string,
    maxBytes: number,
    cookie: string,
  ): Promise<DownloadedMediaBuffer | null> {
    const timeoutMs = Number(this.config.get('DY_DOWNLOADER_FETCH_TIMEOUT_MS') ?? 120_000);
    const ua =
      this.config.get<string>('VIDEO_FETCH_USER_AGENT')?.trim() ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 动态 import 与包导出类型组合
    let dy: any;
    try {
      dy = await import('dy-downloader');
    } catch (e) {
      this.logger.warn(
        `无法加载 dy-downloader: ${e instanceof Error ? e.message : String(e)}（请在 backend/DY-DOWNLOADER 执行 npm install && npm run build）`,
      );
      return null;
    }

    try {
      const handler = new dy.DouyinHandler({ cookie });
      const postDetail = await handler.fetchOneVideo(pageUrl);

      type AwemeLite = {
        awemeType?: number;
        videoPlayAddr?: string | string[];
      };

      let aweme: AwemeLite;
      if (postDetail instanceof dy.PostDetailFilter) {
        aweme = postDetail.toAwemeData();
      } else {
        const sp = postDetail as {
          images?: { urlList: string[] }[];
          video?: { playAddr: string[] };
        };
        aweme = {
          awemeType: sp.images && sp.images.length > 0 ? 68 : 0,
          videoPlayAddr: sp.video?.playAddr,
        };
      }

      const awemeType = aweme.awemeType ?? 0;
      if (awemeType === 68) {
        this.logger.warn('dy-downloader：当前为图集作品，暂不按图集拉流给转写');
        return null;
      }

      const vpa = aweme.videoPlayAddr;
      const videoUrl = Array.isArray(vpa) ? vpa[0] : vpa;
      if (!videoUrl || typeof videoUrl !== 'string') {
        this.logger.warn('dy-downloader：未解析到视频播放地址');
        return null;
      }

      let mediaUrl: URL;
      try {
        mediaUrl = new URL(videoUrl);
      } catch {
        return null;
      }
      assertUrlSafeForServerFetch(mediaUrl);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(videoUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': ua,
            Referer: 'https://www.douyin.com/',
            Cookie: cookie,
          },
        });
        if (!res.ok) {
          this.logger.warn(`dy-downloader 拉流 HTTP ${res.status}`);
          return null;
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > maxBytes) {
          return null;
        }
        return {
          buffer: buf,
          originalname: 'douyin_dy_video.mp4',
          mimetype: 'video/mp4',
          size: buf.length,
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`dy-downloader 失败: ${msg}`);
      return null;
    }
  }

  /**
   * 调用 yt-dlp：单文件 bestaudio/较小视频流，限制体积。
   */
  private async tryDownloadViaYtDlp(
    pageUrl: string,
    maxBytes: number,
    invoker: YtdlpInvoker,
  ): Promise<DownloadedMediaBuffer | null> {
    const timeoutMs = Number(this.config.get('YTDLP_TIMEOUT_MS') ?? 300_000);
    const ua =
      this.config.get<string>('VIDEO_FETCH_USER_AGENT')?.trim() ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-ytdlp-'));
    const outTemplate = path.join(tmpRoot, 'media.%(ext)s');

    const maxSizeArg =
      maxBytes >= 1024 * 1024
        ? `${Math.max(1, Math.floor(maxBytes / (1024 * 1024)))}M`
        : `${Math.max(1, Math.floor(maxBytes / 1024))}K`;

    const args: string[] = [
      '--no-playlist',
      '--no-warnings',
      '--no-cache-dir',
      '--restrict-filenames',
      '--max-filesize',
      maxSizeArg,
      '--user-agent',
      ua,
      '-f',
      'ba/ba[ext=m4a]/ba[ext=webm]/bestaudio/best',
      '-o',
      outTemplate,
      pageUrl,
    ];

    const cookiesBrowser = this.config.get<string>('YTDLP_COOKIES_FROM_BROWSER')?.trim();
    if (cookiesBrowser) {
      args.unshift('--cookies-from-browser', cookiesBrowser);
    }

    const proxy = this.config.get<string>('YTDLP_PROXY')?.trim();
    if (proxy) {
      args.push('--proxy', proxy);
    }

    const argv =
      invoker.kind === 'binary'
        ? args
        : [...invoker.pythonPrefixArgs, '-m', 'yt_dlp', ...args];
    const executable = invoker.kind === 'binary' ? invoker.executable : invoker.python;
    const env =
      invoker.kind === 'python'
        ? { ...process.env, PYTHONPATH: invoker.pythonpath }
        : { ...process.env };

    try {
      await execFileAsync(executable, argv, {
        timeout: timeoutMs,
        cwd: tmpRoot,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        env,
      });
    } catch (e: unknown) {
      const err = e as { stderr?: Buffer | string; message?: string };
      const stderr = err.stderr?.toString?.() ?? '';
      this.logger.warn(
        `yt-dlp 执行失败: ${err.message ?? String(e)}${stderr ? ` · ${stderr.slice(0, 600)}` : ''}`,
      );
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
      return null;
    }

    try {
      const names = await fs.readdir(tmpRoot);
      const mediaFiles = names.filter((n) =>
        /\.(m4a|webm|opus|mp3|mp4|mkv|mov|mpeg|wav|ogg|flac)$/i.test(n),
      );
      if (mediaFiles.length === 0) {
        this.logger.warn(`yt-dlp 输出目录无媒体文件: ${tmpRoot}`);
        return null;
      }
      const withSizes = await Promise.all(
        mediaFiles.map(async (n) => ({
          n,
          size: (await fs.stat(path.join(tmpRoot, n))).size,
        })),
      );
      withSizes.sort((a, b) => b.size - a.size);
      const pick = withSizes[0]?.n;
      if (!pick) {
        return null;
      }
      const full = path.join(tmpRoot, pick);
      const buf = await fs.readFile(full);
      if (buf.length === 0 || buf.length > maxBytes) {
        return null;
      }
      const { mime } = this.mimeFromFilename(pick);
      return {
        buffer: buf,
        originalname: pick,
        mimetype: mime,
        size: buf.length,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`读取 yt-dlp 输出失败: ${msg}`);
      return null;
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async tryHtmlHeuristicDownload(
    canonicalUrl: string,
    maxBytes: number,
  ): Promise<DownloadedMediaBuffer | null> {
    const ua =
      this.config.get<string>('VIDEO_FETCH_USER_AGENT')?.trim() ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    const timeoutMs = Number(this.config.get('VIDEO_FETCH_TIMEOUT_MS') ?? 45_000);

    const { html, resolvedUrl } = await this.pullHtml(canonicalUrl, ua, timeoutMs);
    if (!html || html.length < 200) {
      this.logger.warn('页面 HTML 过短，跳过媒体下载');
      return null;
    }

    const candidates = this.extractCandidateMediaUrls(html, resolvedUrl);
    if (candidates.length === 0) {
      return null;
    }

    for (const mediaUrl of candidates.slice(0, 12)) {
      const buf = await this.tryDownloadUrl(mediaUrl, ua, maxBytes);
      if (buf) {
        const { name, mime } = this.guessFilenameAndMime(mediaUrl, buf);
        return {
          buffer: buf,
          originalname: name,
          mimetype: mime,
          size: buf.length,
        };
      }
    }
    return null;
  }

  private async pullHtml(
    url: string,
    userAgent: string,
    timeoutMs: number,
  ): Promise<{ html: string; resolvedUrl: string }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: this.buildPageHeaders(url, userAgent),
        signal: ac.signal,
      });
      const resolvedUrl = res.url || url;
      if (!res.ok) {
        return { html: '', resolvedUrl };
      }
      const buf = await res.text();
      const max = 2_500_000;
      const html = buf.length > max ? buf.slice(0, max) : buf;
      return { html, resolvedUrl };
    } finally {
      clearTimeout(timer);
    }
  }

  private buildPageHeaders(targetUrl: string, userAgent: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    };
    let u: URL;
    try {
      u = new URL(targetUrl);
    } catch {
      return headers;
    }
    if (u.hostname.toLowerCase().includes('douyin.com')) {
      headers['Referer'] = 'https://www.douyin.com/';
      headers['Origin'] = 'https://www.douyin.com';
    }
    return headers;
  }

  private extractDouyinUrlListFromAddrBlocks(html: string): string[] {
    const found: string[] = [];
    for (const needle of ['"play_addr"', '"download_addr"']) {
      let pos = 0;
      while ((pos = html.indexOf(needle, pos)) !== -1) {
        const slice = html.slice(pos, Math.min(pos + 12000, html.length));
        const listRe = /"url_list"\s*:\s*\[([\s\S]*?)\]/g;
        let lm: RegExpExecArray | null;
        while ((lm = listRe.exec(slice))) {
          const inner = lm[1];
          const rawUrls = [
            ...inner.matchAll(/https:\\\/\\\/[^"\\\s]+/gi),
            ...inner.matchAll(/https:\/\/[^"\\\s]+/gi),
          ];
          for (const um of rawUrls) {
            const raw = um[0]
              .replace(/\\\//g, '/')
              .replace(/\\u002f/gi, '/')
              .replace(/\\/g, '');
            if (raw.startsWith('http')) found.push(raw);
          }
        }
        pos += needle.length;
      }
    }
    return found;
  }

  private extractCandidateMediaUrls(html: string, pageUrl: string): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();

    const push = (raw: string) => {
      const u = this.normalizeMediaUrl(raw);
      if (!u || seen.has(u)) return;
      try {
        assertUrlSafeForServerFetch(new URL(u));
      } catch {
        return;
      }
      if (!this.looksLikeVideoOrAudioUrl(u)) return;
      seen.add(u);
      ordered.push(u);
    };

    const host = (() => {
      try {
        return new URL(pageUrl).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();

    if (host.includes('douyin.com')) {
      for (const u of this.extractDouyinUrlListFromAddrBlocks(html)) {
        push(u);
      }

      const escaped =
        /https:\\?\/\\?\/[a-zA-Z0-9.-]*douyinvod\.com[^"'\\\s<>]+/gi;
      let m: RegExpExecArray | null;
      while ((m = escaped.exec(html))) {
        push(m[0].replace(/\\\//g, '/').replace(/\\u002f/gi, '/'));
      }
      const plain =
        /https:\/\/[a-zA-Z0-9.-]*douyinvod\.com[^"'\\\s<>]+/gi;
      while ((m = plain.exec(html))) {
        push(m[0]);
      }
    }

    try {
      const $ = load(html);
      const metaContent = (prop: string): string | undefined =>
        $(`meta[property="${prop}"]`).attr('content') ??
        $(`meta[name="${prop}"]`).attr('content');
      const og =
        metaContent('og:video')?.trim() ||
        metaContent('og:video:url')?.trim() ||
        $('meta[name="twitter:player"]').attr('content')?.trim();
      if (og) push(og);
    } catch {
      // ignore cheerio errors
    }

    return ordered;
  }

  private normalizeMediaUrl(raw: string): string | null {
    let s = raw.trim();
    if (!s.startsWith('http')) return null;
    s = s.replace(/\\u002f/gi, '/').replace(/\\\//g, '/');
    try {
      return new URL(s).toString();
    } catch {
      return null;
    }
  }

  private looksLikeVideoOrAudioUrl(u: string): boolean {
    const lower = u.toLowerCase();
    if (lower.includes('douyinpic.com')) return false;
    if (/\.(mp4|m4a|webm|mov|mpeg|mp3|wav|ogg)(\?|$)/i.test(lower)) return true;
    if (
      lower.includes('douyinvod.com') &&
      (lower.includes('/video/') || lower.includes('mime_type=video'))
    ) {
      return true;
    }
    return lower.includes('douyinvod.com');
  }

  private async tryDownloadUrl(
    mediaUrl: string,
    userAgent: string,
    maxBytes: number,
  ): Promise<Buffer | null> {
    let u: URL;
    try {
      u = new URL(mediaUrl);
    } catch {
      return null;
    }
    try {
      assertUrlSafeForServerFetch(u);
    } catch {
      return null;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 180_000);
    try {
      const res = await fetch(mediaUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: this.buildMediaHeaders(mediaUrl, userAgent),
        signal: ac.signal,
      });
      if (!res.ok) return null;
      const cl = res.headers.get('content-length');
      if (cl && Number(cl) > maxBytes) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0 || buf.length > maxBytes) return null;
      return buf;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.debug(`download failed ${mediaUrl.slice(0, 80)}… : ${msg}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildMediaHeaders(mediaUrl: string, userAgent: string): Record<string, string> {
    const h: Record<string, string> = {
      'User-Agent': userAgent,
      Accept: '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };
    if (mediaUrl.toLowerCase().includes('douyinvod.com')) {
      h['Referer'] = 'https://www.douyin.com/';
      h['Origin'] = 'https://www.douyin.com';
    }
    return h;
  }

  private mimeFromFilename(filename: string): { mime: string } {
    const ext = path.extname(filename).toLowerCase();
    const map: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.opus': 'audio/opus',
      '.webm': 'audio/webm',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.mov': 'video/quicktime',
    };
    return { mime: map[ext] || 'application/octet-stream' };
  }

  private guessFilenameAndMime(url: string, buf: Buffer): { name: string; mime: string } {
    let ext = '.mp4';
    try {
      const p = new URL(url).pathname;
      const dot = p.lastIndexOf('.');
      if (dot !== -1) {
        const e = p.slice(dot).toLowerCase();
        if (['.mp4', '.m4a', '.webm', '.mov', '.mp3', '.wav', '.mpeg'].includes(e)) {
          ext = e;
        }
      }
    } catch {
      // ignore
    }
    const sniff = buf.slice(0, 12);
    if (sniff[4] === 0x66 && sniff[5] === 0x74 && sniff[6] === 0x79 && sniff[7] === 0x70) {
      ext = '.mp4';
    }
    const { mime } = this.mimeFromFilename(`x${ext}`);
    return {
      name: `from-url-${Date.now()}${ext}`,
      mime,
    };
  }
}
