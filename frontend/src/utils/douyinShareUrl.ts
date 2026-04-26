/**
 * 抖音分享链接 / 分享文案解析与校验
 *
 * ## 典型粘贴形态（用户从抖音「复制链接」得到的一整段文案）
 *
 * 示例（结构说明用，非推广）：
 * ```
 * 3.87 复制打开抖音，看看【某某的作品】标题… #话题 https://v.douyin.com/8g9SnSf08Ds/ N@W.Zz 10/21 TYm:/
 * ```
 *
 * 要点：
 * - 真正可用的是其中的 **短链**：`https://v.douyin.com/{短码}/`
 * - 短码一般为字母数字组合，长度不固定（常见约 6～20 位）
 * - 前后可能夹杂版本号、口令、话题、乱码、日期等；不能要求用户只粘贴「纯 URL」
 * - 也可能出现长链：`https://www.douyin.com/video/{数字作品ID}`
 *
 * ## 本模块策略
 * 1. 优先从整段文案中 **提取** `v.douyin.com` 短链并规范化为 `https://v.douyin.com/{code}/`
 * 2. 其次匹配 `www.douyin.com/video|note/{id}`
 * 3. 再退化为「文案中出现的第一个 http(s) URL」（便于后续扩展其它平台）
 */

/** 抖音短链：v.douyin.com/<code>/ */
const RE_DOUYIN_SHORT = /https?:\/\/v\.douyin\.com\/([A-Za-z0-9._~-]{4,32})\/?(?:\?[^\s]*)?/i

/** 抖音 Web 作品页 */
const RE_DOUYIN_WEB = /https?:\/\/(www\.)?douyin\.com\/(video|note)\/(\d{8,30})/i

/** 宽松提取首个 http(s) 片段（用于非抖音或未知格式兜底） */
const RE_FIRST_HTTP = /https?:\/\/[^\s<>"'()（）【】]+/i

function stripTrailingNoise(url: string): string {
  return url.replace(/[),.;，。！!？、]+$/g, '')
}

/**
 * 从任意分享文案中提取并规范化「源视频 URL」
 * @returns 规范化后的 URL；无法识别时返回 null
 */
export function normalizeSourceVideoUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  const short = s.match(RE_DOUYIN_SHORT)
  if (short?.[1]) {
    const code = short[1]
    return `https://v.douyin.com/${code}/`
  }

  const web = s.match(RE_DOUYIN_WEB)
  if (web?.[3]) {
    const id = web[3]
    return `https://www.douyin.com/video/${id}`
  }

  try {
    const direct = new URL(s)
    if (direct.protocol === 'http:' || direct.protocol === 'https:') {
      return direct.toString()
    }
  } catch {
    // ignore
  }

  const loose = s.match(RE_FIRST_HTTP)
  if (loose?.[0]) {
    const cleaned = stripTrailingNoise(loose[0])
    try {
      const u = new URL(cleaned)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString()
    } catch {
      return null
    }
  }

  return null
}

export type SourceVideoValidation = {
  ok: boolean
  normalizedUrl?: string
  message?: string
  /** 识别来源，便于埋点 / 调试 */
  kind?: 'douyin_short' | 'douyin_web' | 'generic_url' | 'none'
}

/**
 * 校验用户输入：支持「整段抖音分享文案」或「纯 URL」
 */
export function validateSourceVideoInput(raw: string): SourceVideoValidation {
  const s = raw.trim()
  if (!s) {
    return { ok: false, message: '请粘贴视频链接或抖音分享全文', kind: 'none' }
  }

  const normalized = normalizeSourceVideoUrl(s)
  if (!normalized) {
    return {
      ok: false,
      message:
        '未识别到有效链接。抖音请使用「复制链接」并整段粘贴（需包含 v.douyin.com 短链或 www.douyin.com/video 长链）。',
      kind: 'none',
    }
  }

  let kind: NonNullable<SourceVideoValidation['kind']> = 'generic_url'
  if (normalized.startsWith('https://v.douyin.com/') || normalized.startsWith('http://v.douyin.com/')) {
    kind = 'douyin_short'
  } else if (/^https?:\/\/(www\.)?douyin\.com\/(video|note)\//i.test(normalized)) {
    kind = 'douyin_web'
  }

  return { ok: true, normalizedUrl: normalized, kind }
}

/** 归一化后的链接是否指向抖音域名（用于选择 yt-dlp + Whisper + 改写流水线） */
export function isDouyinNormalizedUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().includes('douyin.com')
  } catch {
    return false
  }
}
