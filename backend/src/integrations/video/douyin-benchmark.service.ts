import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DouyinHomepageLearnedProfile {
  secUserId: string;
  uid: string;
  nickname: string;
  handle: string;
  signature: string;
  avatarUrl: string;
  awemeCount: number;
  followerCount: number;
  followingCount: number;
  totalFavorited: number;
  city: string;
  liveStatus: number;
}

export interface DouyinHomepageLearnedPost {
  awemeId: string;
  title: string;
  coverUrl: string;
  diggCount: number;
  commentCount: number;
  shareCount: number;
  createdAt: string;
}

export interface DouyinHomepageLearnResult {
  sourceUrl: string;
  learnedAt: string;
  hint: string;
  profile: DouyinHomepageLearnedProfile;
  samples: DouyinHomepageLearnedPost[];
  ideaSuggestions: string[];
}

type DouyinRuntime = {
  DouyinHandler: new (config: { cookie: string }) => {
    fetchUserProfile: (secUserId: string) => Promise<{
      secUserId?: string | null;
      uid?: string | null;
      nickname?: string | null;
      uniqueId?: string | null;
      shortId?: string | null;
      signature?: string | null;
      avatarUrl?: string | null;
      awemeCount?: number | null;
      followerCount?: number | null;
      followingCount?: number | null;
      totalFavorited?: number | null;
      city?: string | null;
      ipLocation?: string | null;
      liveStatus?: number | null;
    }>;
    fetchUserPostVideos: (
      secUserId: string,
      options: { maxCounts?: number; pageCounts?: number },
    ) => AsyncGenerator<{
      awemeId?: string[] | null;
      desc?: string[] | null;
      cover?: string[] | null;
      createTime?: string[] | string | null;
    }>;
    fetchOneVideo: (urlOrAwemeId: string) => Promise<{
      awemeId?: string | null;
      desc?: string | null;
      cover?: string | null;
      diggCount?: number | null;
      commentCount?: number | null;
      shareCount?: number | null;
      createTime?: string | null;
    }>;
  };
  getSecUserId: (url: string) => Promise<string>;
};

function firstString(input: unknown): string {
  if (Array.isArray(input)) {
    const first: unknown = input.find(
      (item) => typeof item === 'string' && item.trim().length > 0,
    );
    return typeof first === 'string' ? first.trim() : '';
  }
  if (typeof input === 'string') return input.trim();
  if (input == null) return '';
  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input).trim();
  }
  return '';
}

@Injectable()
export class DouyinBenchmarkService {
  private readonly logger = new Logger(DouyinBenchmarkService.name);

  constructor(private readonly config: ConfigService) {}

  async learnHomepage(homepageUrl: string): Promise<DouyinHomepageLearnResult> {
    const sourceUrl = homepageUrl.trim();
    if (!sourceUrl) {
      throw new BadRequestException('homepageUrl 不能为空');
    }

    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      throw new BadRequestException('请填写完整的抖音主页链接');
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname.includes('douyin.com')) {
      throw new BadRequestException('当前仅支持抖音主页链接');
    }

    const cookie = this.config.get<string>('DY_DOWNLOADER_COOKIE')?.trim();
    if (!cookie) {
      throw new BadRequestException(
        '当前未配置 DY_DOWNLOADER_COOKIE，暂时无法学习抖音主页',
      );
    }

    const dy = await this.loadRuntime();
    const secUserId = await this.resolveSecUserId(dy, sourceUrl);
    const handler = new dy.DouyinHandler({ cookie });

    try {
      const profile = await handler.fetchUserProfile(secUserId);
      const samples = await this.fetchSamplePosts(handler, secUserId);
      const normalizedProfile: DouyinHomepageLearnedProfile = {
        secUserId: profile.secUserId?.trim() || secUserId,
        uid: profile.uid?.trim() || '',
        nickname: profile.nickname?.trim() || '未命名账号',
        handle:
          profile.uniqueId?.trim() ||
          profile.shortId?.trim() ||
          profile.uid?.trim() ||
          profile.secUserId?.trim() ||
          secUserId,
        signature: profile.signature?.trim() || '这个账号还没有公开签名',
        avatarUrl: profile.avatarUrl?.trim() || '',
        awemeCount: this.safeCount(profile.awemeCount),
        followerCount: this.safeCount(profile.followerCount),
        followingCount: this.safeCount(profile.followingCount),
        totalFavorited: this.safeCount(profile.totalFavorited),
        city: profile.city?.trim() || profile.ipLocation?.trim() || '抖音主页',
        liveStatus: Number(profile.liveStatus ?? 0),
      };

      return {
        sourceUrl,
        learnedAt: new Date().toISOString(),
        hint:
          samples.length > 0
            ? '已抓取主页资料和近期作品，可直接在第一步生成选题草稿。'
            : '已抓取主页资料，当前未拿到近期作品列表，仍可先手动整理文案。',
        profile: normalizedProfile,
        samples,
        ideaSuggestions: this.buildIdeaSuggestions(normalizedProfile, samples),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`学习抖音主页失败: ${message}`);
      throw new BadRequestException(`抖音主页抓取失败：${message}`);
    }
  }

  private async loadRuntime(): Promise<DouyinRuntime> {
    try {
      return (await import('dy-downloader')) as DouyinRuntime;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`无法加载 dy-downloader: ${message}`);
      throw new InternalServerErrorException(
        'dy-downloader 未正确安装或构建，请先检查 backend/DY-DOWNLOADER',
      );
    }
  }

  private async resolveSecUserId(
    dy: DouyinRuntime,
    homepageUrl: string,
  ): Promise<string> {
    try {
      const secUserId = await dy.getSecUserId(homepageUrl);
      if (!secUserId?.trim()) {
        throw new Error('未解析到 sec_user_id');
      }
      return secUserId.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`主页链接解析失败：${message}`);
    }
  }

  private async fetchSamplePosts(
    handler: InstanceType<DouyinRuntime['DouyinHandler']>,
    secUserId: string,
  ): Promise<DouyinHomepageLearnedPost[]> {
    let postIds: string[] = [];
    let postTitles: string[] = [];
    let postCovers: string[] = [];
    let postTimes: string[] = [];

    for await (const page of handler.fetchUserPostVideos(secUserId, {
      maxCounts: 3,
      pageCounts: 6,
    })) {
      postIds = (page.awemeId ?? [])
        .slice(0, 3)
        .map((item) => item?.trim())
        .filter(Boolean);
      postTitles = (page.desc ?? [])
        .slice(0, 3)
        .map((item) => item?.trim() || '这条作品没有公开文案');
      postCovers = (page.cover ?? [])
        .slice(0, 3)
        .map((item) => item?.trim() || '');
      const times = page.createTime;
      postTimes = Array.isArray(times)
        ? times.slice(0, 3).map((item) => item?.trim() || '')
        : [];
      break;
    }

    if (postIds.length === 0) return [];

    const detailResults = await Promise.allSettled(
      postIds.map((awemeId) => handler.fetchOneVideo(awemeId)),
    );

    return postIds.map((awemeId, index) => {
      const detail = detailResults[index];
      const detailValue = detail?.status === 'fulfilled' ? detail.value : null;
      const title =
        firstString(detailValue?.desc) ||
        postTitles[index] ||
        `作品 ${index + 1}`;
      return {
        awemeId,
        title,
        coverUrl: firstString(detailValue?.cover) || postCovers[index] || '',
        diggCount: this.safeCount(detailValue?.diggCount),
        commentCount: this.safeCount(detailValue?.commentCount),
        shareCount: this.safeCount(detailValue?.shareCount),
        createdAt:
          firstString(detailValue?.createTime) || postTimes[index] || '',
      };
    });
  }

  private buildIdeaSuggestions(
    profile: DouyinHomepageLearnedProfile,
    samples: DouyinHomepageLearnedPost[],
  ): string[] {
    const suggestions: string[] = [];
    if (samples[0]) {
      suggestions.push(
        `延展「${this.trimForIdea(samples[0].title)}」做一条观点型口播`,
      );
    }
    if (samples[1]) {
      suggestions.push(
        `参考「${this.trimForIdea(samples[1].title)}」改写成你的案例分享`,
      );
    }
    if (samples[2]) {
      suggestions.push(
        `围绕「${this.trimForIdea(samples[2].title)}」做一个反常识开场`,
      );
    }

    const identityBase =
      profile.signature && profile.signature !== '这个账号还没有公开签名'
        ? this.trimForIdea(profile.signature)
        : `${profile.nickname} 的内容定位`;
    suggestions.push(`结合「${identityBase}」整理 5 条适合你账号的对标选题`);

    return suggestions.slice(0, 4);
  }

  private trimForIdea(value: string): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 24) return normalized;
    return `${normalized.slice(0, 24)}...`;
  }

  private safeCount(value: number | null | undefined): number {
    return Number.isFinite(value) ? Number(value) : 0;
  }
}
