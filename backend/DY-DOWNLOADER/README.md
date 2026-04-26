# dy-downloader

抖音视频/图集下载器 - Node.js/TypeScript 实现

基于 [Johnserf-Seed/f2](https://github.com/Johnserf-Seed/f2) Python 项目重写的 Node.js 版本。

## 功能特性

- 单个作品下载（视频/图集）
- 用户主页作品批量下载
- 支持下载封面、音乐、文案、歌词
- 直播流下载（FLV/M3U8）
- 并发下载控制
- 自定义文件命名模板
- CLI 命令行工具
- 完整的 TypeScript 类型支持

## 安装

```bash
# npm 安装
npm install dy-downloader

# 全局安装 CLI
npm install -g dy-downloader
```

开发模式：

```bash
git clone https://github.com/Everless321/dyDownloader.git
cd dyDownloader
npm install
npm run build
```

## CLI 使用

```bash
# 下载单个作品
dy download "https://v.douyin.com/xxx" -c "your_cookie" -o ./downloads

# 下载用户主页作品
dy user "https://www.douyin.com/user/xxx" -c "your_cookie" -n 10

# 查看帮助
dy --help
dy download --help
dy user --help
```

### 命令选项

| 选项 | 说明 |
|------|------|
| `-o, --output <path>` | 下载目录 (默认: ./downloads) |
| `-c, --cookie <cookie>` | Cookie (必需) |
| `-n, --number <count>` | 下载数量，0表示全部 (仅 user 命令) |
| `--cover` | 下载封面 |
| `--music` | 下载音乐 |
| `--desc` | 下载文案 |

## 程序化调用

### 下载单个作品

```typescript
import { DouyinHandler, DouyinDownloader } from 'dy-downloader'

const cookie = 'your_cookie'
const videoUrl = 'https://v.douyin.com/xxx'

// 获取作品详情（支持短链接和长链接）
const handler = new DouyinHandler({ cookie })
const postDetail = await handler.fetchOneVideo(videoUrl)

console.log('作品ID:', postDetail.awemeId)
console.log('作者:', postDetail.nickname)
console.log('描述:', postDetail.desc)

// 下载
const downloader = new DouyinDownloader({
  cookie,
  downloadPath: './downloads',
  naming: '{nickname}_{aweme_id}',
  cover: true,
  music: true,
  desc: true,
})

await downloader.createDownloadTasks(postDetail.toAwemeData(), './downloads')
```

### 批量下载用户作品

```typescript
import { getSecUserId, DouyinHandler, DouyinDownloader } from 'dy-downloader'

const cookie = 'your_cookie'
const userUrl = 'https://www.douyin.com/user/xxx'

// 解析用户 ID
const secUserId = await getSecUserId(userUrl)

const handler = new DouyinHandler({ cookie })
const downloader = new DouyinDownloader({
  cookie,
  downloadPath: './downloads',
  naming: '{nickname}_{aweme_id}',
})

// 遍历用户作品
for await (const postFilter of handler.fetchUserPostVideos(secUserId, { maxCounts: 10 })) {
  const awemeList = postFilter.toAwemeDataList()

  for (const awemeData of awemeList) {
    await downloader.createDownloadTasks(awemeData, './downloads')
  }
}
```

### 获取用户资料

```typescript
import { getSecUserId, DouyinHandler } from 'dy-downloader'

const handler = new DouyinHandler({ cookie: 'SEARCH_RESULT_LIST_TYPE=%22single%22; hevc_supported=true; is_dash_user=1; bd_ticket_guard_client_web_domain=2; passport_csrf_token=094cdb17a725b14b94600acbb7954eeb; passport_csrf_token_default=094cdb17a725b14b94600acbb7954eeb; n_mh=EoZgMXq6cFOD8BX8TjbWFR6TFbUvPfgKaJ2m7cIq6Y0; is_staff_user=false; use_biz_token=true; _bd_ticket_crypt_doamin=2; __security_server_data_status=1; enter_pc_once=1; UIFID=ed3eadd74fe8fd7fe8cc39b2f8425a87324d41d3f6a0cfdc014da4c26c654051eaf20c7235cdc9a2289d07509ea525f9dc92436d787c9736694eab1bf78c669d2274d3bbfc9ff462b355daf577a1acda971fe76271e152b6c231e79f492de8fb32cf3c2194a3f6b323b3bdb12312449bd44be5e63390db2c2dbd74abdce7a13f4fc3330d24609751fc3ff9e4749f7ae54c2945b80f33300f4fc0b61cdc8effc8; passport_assist_user=CkSEVIQpaK03JD6tHfiEZe70ErwTtSEJZa-186tOqfwUFXN79UY2oVV3erFd_FxJO75G5-0h4xMzXA9YEFha57Dx5J2_fBpKCjwAAAAAAAAAAAAAUDtzAUsKEAnEOAwI3WTFO3BNVo0wxZeAG4wNNv67IG3IqAW1uvW-55T5J2trl5yffbIQrZ-NDhiJr9ZUIAEiAQMyqva_; sid_guard=ecfc02dc224e9043885b825b9a12e523%7C1774647078%7C5184000%7CTue%2C+26-May-2026+21%3A31%3A18+GMT; uid_tt=4cc218b51481a95b6c1cd4a40be59633b434b71f044dd6d033bfe587521bf619; uid_tt_ss=4cc218b51481a95b6c1cd4a40be59633b434b71f044dd6d033bfe587521bf619; sid_tt=ecfc02dc224e9043885b825b9a12e523; sessionid=ecfc02dc224e9043885b825b9a12e523; sessionid_ss=ecfc02dc224e9043885b825b9a12e523; session_tlb_tag=sttt%7C15%7C7PwC3CJOkEOIW4JbmhLlI__________vPbH6lpO7uc4kOgainxwwxFgpLVCoWhu0kNY61IM_kjo%3D; sid_ucp_v1=1.0.0-KDNhOWZhYmIxYjg4NjIwNTM3NGU4MzllZWQ1MGRiN2VkYjYzM2I5NWMKIgixiL_O-IDZ3mkQpu6bzgYY2hYgDDDt2fXNBjgHQPQHSAQaAmxmIiBlY2ZjMDJkYzIyNGU5MDQzODg1YjgyNWI5YTEyZTUyMw; ssid_ucp_v1=1.0.0-KDNhOWZhYmIxYjg4NjIwNTM3NGU4MzllZWQ1MGRiN2VkYjYzM2I5NWMKIgixiL_O-IDZ3mkQpu6bzgYY2hYgDDDt2fXNBjgHQPQHSAQaAmxmIiBlY2ZjMDJkYzIyNGU5MDQzODg1YjgyNWI5YTEyZTUyMw; _bd_ticket_crypt_cookie=8f85688ae60222332a6822dad1efb1c4; __security_mc_1_s_sdk_crypt_sdk=92c9cabe-4b1c-8672; __security_mc_1_s_sdk_cert_key=c4df4dc7-443f-a852; __security_mc_1_s_sdk_sign_data_key_web_protect=43ad0f21-4100-b80f; publish_badge_show_info=%220%2C0%2C0%2C1775667383443%22; download_guide=%223%2F20260409%2F0%22; volume_info=%7B%22isUserMute%22%3Afalse%2C%22isMute%22%3Afalse%2C%22volume%22%3A0.708%7D; strategyABtestKey=%221776188574.077%22; SelfTabRedDotControl=%5B%7B%22id%22%3A%227627962176259262479%22%2C%22u%22%3A4%2C%22c%22%3A0%7D%2C%7B%22id%22%3A%227570397642539141147%22%2C%22u%22%3A33%2C%22c%22%3A0%7D%5D; ttwid=1%7CGpGPGry-mMxRwudQIUq4LFln_nvavA-ipowtHTyUC90%7C1776188574%7Ceb8effea865b8cca56c2ae4aed985bb3a47ef4ddd0507866f0537cb334f4674a; PhoneResumeUidCacheV1=%7B%227619356128120390705%22%3A%7B%22time%22%3A1776188574155%2C%22noClick%22%3A1%7D%7D; stream_recommend_feed_params=%22%7B%5C%22cookie_enabled%5C%22%3Atrue%2C%5C%22screen_width%5C%22%3A400%2C%5C%22screen_height%5C%22%3A855%2C%5C%22browser_online%5C%22%3Atrue%2C%5C%22cpu_core_num%5C%22%3A24%2C%5C%22device_memory%5C%22%3A8%2C%5C%22downlink%5C%22%3A10%2C%5C%22effective_type%5C%22%3A%5C%224g%5C%22%2C%5C%22round_trip_time%5C%22%3A0%7D%22; bd_ticket_guard_client_data=eyJiZC10aWNrZXQtZ3VhcmQtdmVyc2lvbiI6MiwiYmQtdGlja2V0LWd1YXJkLWl0ZXJhdGlvbi12ZXJzaW9uIjoxLCJiZC10aWNrZXQtZ3VhcmQtcmVlLXB1YmxpYy1rZXkiOiJCTm9ndUhMV3oyZWxiWVhSb2xzSzhnNkI5OVN6TG9sU3YyNjJ6cEdrN1gwSU5rbWhLYU9OdGZMVm94Tk56dmM4NUtsa1A4R0oySjJHSWhkcU5HSThNQlk9IiwiYmQtdGlja2V0LWd1YXJkLXdlYi12ZXJzaW9uIjoyfQ%3D%3D; home_can_add_dy_2_desktop=%221%22; biz_trace_id=5c1c69a2; sdk_source_info=7e276470716a68645a606960273f276364697660272927676c715a6d6069756077273f276364697660272927666d776a68605a607d71606b766c6a6b5a7666776c7571273f275e58272927666a6b766a69605a696c6061273f27636469766027292762696a6764695a7364776c6467696076273f275e582729277672715a646971273f2763646976602729277f6b5a666475273f2763646976602729276d6a6e5a6b6a716c273f2763646976602729276c6b6f5a7f6367273f27636469766027292771273f27373533343c31343c3433323234272927676c715a75776a716a666a69273f2763646976602778; bit_env=YAJsik3_Xo3beJneYAVYQPk9iy-A9bVNqi2WMrPFKhI2zJ6ratGPS9gRf3QgQ4RAJfcq34KlWyzeUbFYZ1KBzuI-SK8tiFjMS71m7MxkmfoNIOo9sejATn2dWKGex9AYseBoiXSUPvXy19s8K-pVXNbn5kS5NdQBc3pFYaL5ftioBjiykVq71XE-C2iezDHYqp1XzGpG_F5cmGRmRXc9BcMYpoASL1XVOJ2Q9iQhiqiGtBbvckuf0UYIJg4-N8VFIztJ0kClSyqaBQ6YQCZSl2T-nG49xo4ohOzOLSDxS_J_7gNP35nnrUT5nvSI4x-Igry1xkSH5UxiTyL78c4YQR-4GwWA86iGZe6QT2cwPCc8TjEg4xY9hReiqgqmrOLLTNVmOJpQvjvMXqWZFbMtM3wJ_eObYVVbK8LJXq0SaUKXSeCqdadRR4GgkBepesanq5hiXQZwtiTDrR87QGOn-nhUWHlKxM2Oz6g4V8j6aux3YZiXx9Erq4Ph2dvQwX7t; gulu_source_res=eyJwX2luIjoiNzBkYjdhNGExYTY1YmE2OGQ2ZWFlY2Q5MDJmODJiOTRjOTFjZjU4ZTEyZTZlN2VlNTk4OGM2YzllMWNiOWE0NSJ9; passport_auth_mix_state=9fyjdur4xe8fbxtdtug5850299a5z98oxjgum4hmkzqxfnlm; bd_ticket_guard_client_data_v2=eyJyZWVfcHVibGljX2tleSI6IkJOb2d1SExXejJlbGJZWFJvbHNLOGc2Qjk5U3pMb2xTdjI2MnpwR2s3WDBJTmttaEthT050ZkxWb3hOTnp2Yzg1S2xrUDhHSjJKMkdJaGRxTkdJOE1CWT0iLCJ0c19zaWduIjoidHMuMi5kZDc4OTMyZmZkOWEwNTI5NDFiOWYxMzYwYzI0MDViMDBkZWU5MjFmZDMyODg3YmI3M2Q5ZDExMzgxZmE3ODAwYzRmYmU4N2QyMzE5Y2YwNTMxODYyNGNlZGExNDkxMWNhNDA2ZGVkYmViZWRkYjJlMzBmY2U4ZDRmYTAyNTc1ZCIsInJlcV9jb250ZW50Ijoic2VjX3RzIiwicmVxX3NpZ24iOiJXUkQ1WHNyTC9XaGEzUFNWbzJxODNDcnZOWUZWUnpNYXNWMk1qM29xbXNBPSIsInNlY190cyI6IiM5RzJTRGVGVVdGSWlnN1g5RnhHd0xrY2N0bTBtWTZORThRUzZDZ0l6TzN2UnBWOU04dE4zd2J0VzNvdDIifQ%3D%3D; playRecommendGuideTagCount=3; totalRecommendGuideTagCount=25; IsDouyinActive=false; odin_tt=6a5290e586cccf0d430941c4596078580c5c09fc9039a9ddad0305039b95c38974e2b0deecbd2f922f56ab7b0450da7fea82d7c49c8981fa034509d1f6f53121; douyin_search_screen=400*855; pre_reload_logid=20260415023233726E61CF6B6055929641; ttwid=1%7CGpGPGry-mMxRwudQIUq4LFln_nvavA-ipowtHTyUC90%7C1776188574%7Ceb8effea865b8cca56c2ae4aed985bb3a47ef4ddd0507866f0537cb334f4674a; tti_opt_long_task=1; inline_source_cdn=1; search_webid=7619324255835276809; __tea_cache_tokens_581610={%22_type_%22:%22default%22%2C%22user_unique_id%22:%227619324255835276809%22%2C%22timestamp%22:1776191555173}; move_all_preload_after_fs=0; x-use-dcz=0; use-esr=0; is-repeat-user=1; browser_font_scale=1; gfkadpd=581610,29095' })
const secUserId = await getSecUserId('https://www.douyin.com/user/xxx')
const profile = await handler.fetchUserProfile(secUserId)

console.log(profile.nickname)
console.log(profile.followerCount)
console.log(profile.totalFavorited)
```

## 下载配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `cookie` | string | - | Cookie (必需) |
| `downloadPath` | string | `'./downloads'` | 下载目录 |
| `maxConcurrency` | number | `3` | 最大并发数 |
| `timeout` | number | `30000` | 超时时间 (ms) |
| `retries` | number | `3` | 重试次数 |
| `naming` | string | `'{create}_{desc}'` | 文件命名模板 |
| `folderize` | boolean | `false` | 按作品分文件夹 |
| `music` | boolean | `false` | 下载音乐 |
| `cover` | boolean | `false` | 下载封面 |
| `desc` | boolean | `false` | 下载文案 |
| `lyric` | boolean | `false` | 下载歌词 |

### 命名模板变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `{create}` | 创建时间 | `2024-01-15_12-30-00` |
| `{nickname}` | 作者昵称 | `小白兔奶糖ovo` |
| `{aweme_id}` | 作品 ID | `7597330590627487921` |
| `{desc}` | 作品描述 (截断) | `今天天气真好` |
| `{caption}` | 标题 | `标题文字` |
| `{uid}` | 用户 ID | `123456789` |

### 下载文件类型

| 类型 | 后缀 | 说明 |
|------|------|------|
| 视频 | `.mp4` | 普通视频作品 |
| 图集 | `.webp` | 图文作品的图片 |
| 封面 | `.webp` / `.jpeg` | 动态封面/静态封面 |
| 音乐 | `.mp3` | 背景音乐 |
| 文案 | `.txt` | 作品描述 |
| 歌词 | `.lrc` | 音乐歌词 |

## API 参考

### DouyinHandler

| 方法 | 说明 |
|------|------|
| `fetchUserProfile(secUserId)` | 获取用户资料 |
| `fetchOneVideo(urlOrAwemeId)` | 获取单个作品详情 (支持链接或ID) |
| `fetchUserPostVideos(secUserId, options)` | 获取用户作品列表 (生成器) |
| `fetchUserLikeVideos(secUserId, options)` | 获取用户喜欢列表 (生成器) |
| `fetchUserCollectionVideos(options)` | 获取用户收藏 (生成器) |
| `fetchUserCollects(options)` | 获取用户收藏夹列表 (生成器) |
| `fetchUserCollectsVideos(collectsId, options)` | 获取收藏夹作品 (生成器) |
| `fetchUserMixVideos(mixId, options)` | 获取合集作品 (生成器) |
| `fetchUserMusicCollection(options)` | 获取用户音乐收藏 (生成器) |
| `fetchRelatedVideos(awemeId, options)` | 获取相关推荐作品 (生成器) |
| `fetchFriendFeedVideos(options)` | 获取朋友作品 (生成器) |
| `fetchPostComment(awemeId, options)` | 获取作品评论 (生成器) |
| `fetchPostCommentReply(itemId, commentId, options)` | 获取评论回复 (生成器) |
| `fetchUserFollowing(secUserId, userId, options)` | 获取关注列表 (生成器) |
| `fetchUserFollower(userId, secUserId, options)` | 获取粉丝列表 (生成器) |
| `fetchUserLiveVideos(webRid, roomIdStr)` | 获取用户直播信息 |
| `fetchUserLiveVideos2(roomId)` | 获取用户直播信息2 |
| `fetchUserLiveStatus(userIds)` | 获取用户直播状态 |
| `fetchFollowingUserLive()` | 获取关注用户直播列表 |
| `fetchHomePostSearch(keyword, fromUser, options)` | 主页作品搜索 (生成器) |
| `fetchSuggestWords(query, count)` | 搜索建议词 |
| `fetchQueryUser(secUserIds)` | 查询用户 |
| `fetchPostStats(itemId, awemeType, playDelta)` | 获取作品统计 |

### DouyinDownloader

| 方法 | 说明 |
|------|------|
| `createDownloadTasks(awemeData, path)` | 创建作品下载任务 |
| `createMusicDownloadTasks(musicData, path)` | 创建音乐下载任务 |
| `createStreamTasks(webcastData, path)` | 创建直播流下载任务 |

### 工具函数

| 函数 | 说明 |
|------|------|
| `getAwemeId(url)` | 从链接解析作品 ID |
| `getSecUserId(url)` | 从链接解析用户 ID |
| `getMixId(url)` | 从链接解析合集 ID |
| `getWebcastId(url)` | 从链接解析直播间 ID |
| `getRoomId(url)` | 从链接解析房间 ID |
| `resolveDouyinUrl(url)` | 统一解析链接 (自动识别类型) |
| `getAllAwemeId(urls)` | 批量解析作品 ID |
| `getAllSecUserId(urls)` | 批量解析用户 ID |

## 获取 Cookie

1. 打开浏览器访问 [抖音网页版](https://www.douyin.com/)
2. 登录账号
3. 打开开发者工具 (F12)
4. 切换到 Network 标签
5. 刷新页面，找到任意请求
6. 复制请求头中的 Cookie 值

## 开发

```bash
# 开发模式
npm run dev

# 构建
npm run build

# 类型检查
npm run typecheck

# 代码格式化
npm run format

# 运行测试
npm run test
```

## 注意事项

- 请遵守抖音的使用条款
- 本项目仅供学习交流使用
- 请勿用于商业用途
- Cookie 请妥善保管，不要泄露

## License

MIT
