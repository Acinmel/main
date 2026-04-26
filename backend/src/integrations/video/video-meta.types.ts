export type VideoPlatform = 'douyin' | 'unknown';

export interface VideoMetaDto {
  platform: VideoPlatform;
  /** 归一化后的入口链接（短链等），仅服务端使用，前端可不展示 */
  canonicalUrl: string;
  /** 跟随重定向后的最终页面 URL，仅服务端使用 */
  resolvedUrl: string;
  title: string | null;
  /** Open Graph 描述（原始） */
  description: string | null;
  /** 展示用「内容」：优先 OG，其次尝试从内嵌 JSON 取 desc 等 */
  content: string | null;
  /** 获赞数：抖音页内嵌 JSON 中常见 digg_count，解析不到则为 null */
  likeCount: number | null;
  /** 播放量：抖音内嵌 JSON 中常见 play_count / view_count，解析不到则为 null */
  playCount: number | null;
  /** 话题/标签（抖音页内嵌 JSON 中 hashtag_name 等，去重后最多返回若干条） */
  tags: string[];
  /** 页面 HTML 中是否出现疑似视频资源（og:video、play_addr、douyinvod 等） */
  videoAssetDetected: boolean;
  /** 服务端是否已配置 DY_DOWNLOADER_COOKIE（抖音源下载用） */
  dyCookieConfigured: boolean;
  /** 面向用户的一句话：是否具备/尝试下载源视频的条件 */
  sourceDownloadHint: string;
  coverImageUrl: string | null;
  /** 若页面提供 og:video / twitter:player 等 */
  videoUrl: string | null;
  fetchedAt: string;
  warnings: string[];
  /** 是否至少拿到一项对用户有用的信息 */
  hasUsefulMeta: boolean;
}
