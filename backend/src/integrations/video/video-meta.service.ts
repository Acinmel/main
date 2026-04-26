import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { load } from 'cheerio';
import { assertUrlSafeForServerFetch } from '../../common/url-safety.util';
import type { VideoMetaDto, VideoPlatform } from './video-meta.types';

/**
 * 视频页元信息抓取：纯 HTTP + HTML 解析（Open Graph / title），不调用 AI。
 *
 * 说明：
 * - 抖音等平台常对「数据中心 IP / 无 Cookie 请求」返回验证页或精简 HTML，导致解析不到 og 标签；
 *   此时 `warnings` 会说明情况，后续可改为官方/第三方解析 API 或带 Cookie 的受控抓取。
 */
@Injectable()
export class VideoMetaService {
  private readonly logger = new Logger(VideoMetaService.name);

  constructor(private readonly config: ConfigService) {}

  async fetchMeta(canonicalUrl: string): Promise<VideoMetaDto> {
    const warnings: string[] = [];
    const started = new Date().toISOString();

    let urlObj: URL;
    try {
      urlObj = new URL(canonicalUrl);
    } catch {
      throw new BadRequestException('URL 格式无效');
    }

    assertUrlSafeForServerFetch(urlObj);

    const ua =
      this.config.get<string>('VIDEO_FETCH_USER_AGENT')?.trim() ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    const timeoutMs = Number(this.config.get('VIDEO_FETCH_TIMEOUT_MS') ?? 45_000);

    let resolvedUrl = canonicalUrl;
    let html = '';

    try {
      const pull = await this.pullHtml(canonicalUrl, ua, timeoutMs);
      resolvedUrl = pull.resolvedUrl;
      html = pull.html;
      warnings.push(...pull.warnings);
      if (!pull.ok) {
        return this.emptyResult(canonicalUrl, resolvedUrl, started, warnings);
      }

      /** 抖音：若桌面 UA 未拿到有效 OG，再尝试移动端 UA（仍可能被风控，仅提高成功率） */
      const platformGuess = this.detectPlatform(resolvedUrl);
      let metaProbe = this.safeParseHtmlMeta(html);
      if (
        platformGuess === 'douyin' &&
        !this.hasAnyMeta(metaProbe) &&
        html.length > 200
      ) {
        const mobileUa =
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
        try {
          const second = await this.pullHtml(canonicalUrl, mobileUa, timeoutMs);
          warnings.push(...second.warnings.map((w) => `[移动端重试] ${w}`));
          if (second.ok) {
            const m2 = this.safeParseHtmlMeta(second.html);
            if (
              second.html.length > html.length ||
              this.hasAnyMeta(m2)
            ) {
              resolvedUrl = second.resolvedUrl;
              html = second.html;
              warnings.push('已使用移动端 UA 重试抓取');
            }
          }
        } catch (e2) {
          const m2 = e2 instanceof Error ? e2.message : String(e2);
          warnings.push(`移动端 UA 重试失败：${m2}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`fetch failed ${canonicalUrl}: ${msg}`);
      warnings.push(`请求失败：${msg}`);
      return this.emptyResult(canonicalUrl, resolvedUrl, started, warnings);
    }

    const platform = this.detectPlatform(resolvedUrl);
    if (platform === 'douyin' && html.length < 800) {
      warnings.push(
        '抖音返回的 HTML 过短，可能是反爬验证页；后续请接入官方/第三方视频解析 API。',
      );
    }

    const meta = this.safeParseHtmlMeta(html);
    if (!meta.title && !meta.description && !meta.coverImageUrl) {
      warnings.push(
        '未解析到 og:title / og:description / og:image，页面结构可能已变更或需登录态。',
      );
    }

    const likeCount =
      platform === 'douyin'
        ? this.extractDouyinLikeCount(html)
        : this.extractGenericLikeCount(html);
    const playCount =
      platform === 'douyin' ? this.extractDouyinPlayCount(html) : null;
    const content = this.resolveVideoContent(html, platform, meta.description);
    const tags =
      platform === 'douyin' ? this.extractDouyinHashtags(html) : [];
    const videoAssetDetected = this.detectVideoAssetInPage(
      html,
      platform,
      meta.videoUrl,
    );
    const dyCookieConfigured = !!this.config
      .get<string>('DY_DOWNLOADER_COOKIE')
      ?.trim();
    const sourceDownloadHint = this.buildSourceDownloadHint({
      platform,
      videoAssetDetected,
      dyCookieConfigured,
      hasOgVideo: !!meta.videoUrl,
    });

    const hasUsefulMeta = Boolean(
      meta.title ||
        content ||
        meta.description ||
        meta.coverImageUrl ||
        meta.videoUrl ||
        likeCount != null ||
        playCount != null ||
        tags.length > 0,
    );

    return {
      platform,
      canonicalUrl,
      resolvedUrl,
      title: meta.title,
      description: meta.description,
      content,
      likeCount,
      playCount,
      tags,
      videoAssetDetected,
      dyCookieConfigured,
      sourceDownloadHint,
      coverImageUrl: meta.coverImageUrl,
      videoUrl: meta.videoUrl,
      fetchedAt: started,
      warnings,
      hasUsefulMeta,
    };
  }

  /** 抖音：从内嵌 JSON 抽取话题名（字段名随版本可能变化） */
  private extractDouyinHashtags(html: string): string[] {
    const seen = new Set<string>();
    const patterns = [
      /"hashtag_name"\s*:\s*"([^"\\]*)"/g,
      /"hashtagName"\s*:\s*"([^"\\]*)"/g,
      /"cha_name"\s*:\s*"([^"\\]*)"/g,
    ];
    for (const re of patterns) {
      for (const m of html.matchAll(re)) {
        const t = m[1]?.trim();
        if (t && t.length <= 80) seen.add(t);
      }
    }
    return [...seen].slice(0, 24);
  }

  /** 页面是否出现典型「可拉流」线索（非严格校验） */
  private detectVideoAssetInPage(
    html: string,
    platform: VideoPlatform,
    ogVideoUrl: string | null,
  ): boolean {
    if (ogVideoUrl) return true;
    if (platform !== 'douyin') return false;
    return (
      /douyinvod\.com/i.test(html) ||
      /play_addr|playAddr|"video":\s*\{/.test(html) ||
      /\/aweme\/v\d+\/play\//i.test(html)
    );
  }

  private buildSourceDownloadHint(p: {
    platform: VideoPlatform;
    videoAssetDetected: boolean;
    dyCookieConfigured: boolean;
    hasOgVideo: boolean;
  }): string {
    if (p.platform === 'douyin') {
      if (p.dyCookieConfigured && p.videoAssetDetected) {
        return '已检测到页面内视频相关数据，且服务端已配置抖音 Cookie，可尝试下载源视频。';
      }
      if (p.dyCookieConfigured) {
        return '服务端已配置抖音 Cookie，可通过 dy-downloader 尝试拉取；页面内未解析到明显直链线索。';
      }
      if (p.videoAssetDetected) {
        return '页面内存在疑似视频资源线索，但未配置 DY_DOWNLOADER_COOKIE 时，抖音源视频下载通常会失败。';
      }
      return '未在页面中解析到明显视频线索，且未配置 DY_DOWNLOADER_COOKIE，暂无法下载抖音源视频。';
    }
    if (p.hasOgVideo || p.videoAssetDetected) {
      return '页面包含视频相关元信息，具体能否拉取取决于平台与链接有效性。';
    }
    return '未在页面中解析到 og:video 等视频元信息。';
  }

  /** 从页面 HTML 中尝试读取抖音点赞数（字段名随版本可能变化） */
  private extractDouyinLikeCount(html: string): number | null {
    const patterns = [
      /"digg_count"\s*:\s*(\d+)/,
      /"diggCount"\s*:\s*(\d+)/,
      /"like_count"\s*:\s*(\d+)/,
      /"praise_count"\s*:\s*(\d+)/,
      /"admire_count"\s*:\s*(\d+)/,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n) && n >= 0) return n;
      }
    }
    return null;
  }

  /** 抖音：尝试从 HTML 内嵌 JSON 读取播放量（字段名随版本可能变化） */
  private extractDouyinPlayCount(html: string): number | null {
    const patterns = [
      /"play_count"\s*:\s*(\d+)/,
      /"playCount"\s*:\s*(\d+)/,
      /"view_count"\s*:\s*(\d+)/,
      /"viewCount"\s*:\s*(\d+)/,
      /"read_count"\s*:\s*(\d+)/,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const n = parseInt(m[1], 10);
        if (!Number.isNaN(n) && n >= 0) return n;
      }
    }
    return null;
  }

  /** 非抖音页：暂不猜获赞字段 */
  private extractGenericLikeCount(_html: string): number | null {
    return null;
  }

  /**
   * 展示用「内容」：优先 OG 描述；抖音可再尝试内嵌 JSON 的 desc 字段
   */
  private resolveVideoContent(
    html: string,
    platform: VideoPlatform,
    ogDescription: string | null,
  ): string | null {
    const og = ogDescription?.trim();
    if (og) return og;
    if (platform !== 'douyin') return null;
    const embedded = this.extractQuotedJsonStringField(html, 'desc');
    return embedded?.trim() || null;
  }

  /**
   * 从 HTML 中取 `"fieldName":"...value..."` 形式的字符串（处理常见转义）
   */
  private extractQuotedJsonStringField(
    html: string,
    fieldName: string,
  ): string | null {
    const needle = `"${fieldName}":"`;
    const idx = html.indexOf(needle);
    if (idx === -1) return null;
    let i = idx + needle.length;
    let out = '';
    while (i < html.length) {
      const c = html[i];
      if (c === '\\' && i + 1 < html.length) {
        const n = html[i + 1];
        if (n === 'n') {
          out += '\n';
          i += 2;
          continue;
        }
        if (n === 'r') {
          out += '\r';
          i += 2;
          continue;
        }
        if (n === 't') {
          out += '\t';
          i += 2;
          continue;
        }
        if (n === 'u' && i + 5 < html.length) {
          const hex = html.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
        }
        out += n;
        i += 2;
        continue;
      }
      if (c === '"') break;
      out += c;
      i++;
    }
    return out || null;
  }

  private hasAnyMeta(meta: {
    title: string | null;
    description: string | null;
    coverImageUrl: string | null;
    videoUrl: string | null;
  }): boolean {
    return Boolean(
      meta.title || meta.description || meta.coverImageUrl || meta.videoUrl,
    );
  }

  private buildBrowserHeaders(targetUrl: string, userAgent: string): Record<string, string> {
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
      headers['Sec-Fetch-Dest'] = 'document';
      headers['Sec-Fetch-Mode'] = 'navigate';
      headers['Sec-Fetch-Site'] = 'none';
      headers['Upgrade-Insecure-Requests'] = '1';
    }
    return headers;
  }

  private async pullHtml(
    url: string,
    userAgent: string,
    timeoutMs: number,
  ): Promise<{
    resolvedUrl: string;
    html: string;
    ok: boolean;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    let resolvedUrl = url;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: this.buildBrowserHeaders(url, userAgent),
      signal: ac.signal,
    });
    clearTimeout(timer);

    resolvedUrl = res.url || url;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.toLowerCase().includes('text/html')) {
      warnings.push(`响应 Content-Type 非 HTML：${ct.slice(0, 120)}`);
    }
    if (!res.ok) {
      warnings.push(`HTTP 状态 ${res.status}`);
      return { resolvedUrl, html: '', ok: false, warnings };
    }

    const buf = await res.text();
    const max = 2_500_000;
    const html = buf.length > max ? buf.slice(0, max) : buf;
    if (buf.length > max) {
      warnings.push(`HTML 超过 ${max} 字符已截断，Open Graph 可能不完整`);
    }
    return { resolvedUrl, html, ok: true, warnings };
  }

  private safeParseHtmlMeta(html: string): {
    title: string | null;
    description: string | null;
    coverImageUrl: string | null;
    videoUrl: string | null;
  } {
    try {
      return this.parseHtmlMeta(html);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`cheerio parse failed: ${msg}`);
      return {
        title: null,
        description: null,
        coverImageUrl: null,
        videoUrl: null,
      };
    }
  }

  private detectPlatform(url: string): VideoPlatform {
    try {
      const h = new URL(url).hostname.toLowerCase();
      if (h.includes('douyin.com')) return 'douyin';
    } catch {
      // ignore
    }
    return 'unknown';
  }

  private parseHtmlMeta(html: string): {
    title: string | null;
    description: string | null;
    coverImageUrl: string | null;
    videoUrl: string | null;
  } {
    const $ = load(html);

    const metaContent = (prop: string): string | undefined =>
      $(`meta[property="${prop}"]`).attr('content') ??
      $(`meta[name="${prop}"]`).attr('content');

    const title =
      metaContent('og:title')?.trim() ||
      $('meta[name="twitter:title"]').attr('content')?.trim() ||
      $('title').first().text()?.trim() ||
      null;

    const description =
      metaContent('og:description')?.trim() ||
      $('meta[name="twitter:description"]').attr('content')?.trim() ||
      $('meta[name="description"]').attr('content')?.trim() ||
      null;

    const coverImageUrl =
      metaContent('og:image')?.trim() ||
      $('meta[name="twitter:image"]').attr('content')?.trim() ||
      null;

    const videoUrl =
      metaContent('og:video')?.trim() ||
      metaContent('og:video:url')?.trim() ||
      $('meta[name="twitter:player"]').attr('content')?.trim() ||
      null;

    return { title, description, coverImageUrl, videoUrl };
  }

  private emptyResult(
    canonicalUrl: string,
    resolvedUrl: string,
    fetchedAt: string,
    warnings: string[],
  ): VideoMetaDto {
    const platform = this.detectPlatform(resolvedUrl);
    const dyCookieConfigured = !!this.config
      .get<string>('DY_DOWNLOADER_COOKIE')
      ?.trim();
    return {
      platform,
      canonicalUrl,
      resolvedUrl,
      title: null,
      description: null,
      content: null,
      likeCount: null,
      playCount: null,
      tags: [],
      videoAssetDetected: false,
      dyCookieConfigured,
      sourceDownloadHint: this.buildSourceDownloadHint({
        platform,
        videoAssetDetected: false,
        dyCookieConfigured,
        hasOgVideo: false,
      }),
      coverImageUrl: null,
      videoUrl: null,
      fetchedAt,
      warnings,
      hasUsefulMeta: false,
    };
  }
}
