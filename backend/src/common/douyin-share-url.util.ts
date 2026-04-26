/**
 * 抖音分享文案 → 规范化视频 URL（与前端 `frontend/src/utils/douyinShareUrl.ts` 保持同一规则）
 *
 * 典型粘贴示例结构：
 * `…文案… https://v.douyin.com/8g9SnSf08Ds/ …后缀乱码…`
 *
 * 后端在创建任务时必须再次归一化，防止绕过前端校验。
 */

const RE_DOUYIN_SHORT = /https?:\/\/v\.douyin\.com\/([A-Za-z0-9._~-]{4,32})\/?(?:\?[^\s]*)?/i
const RE_DOUYIN_WEB = /https?:\/\/(www\.)?douyin\.com\/(video|note)\/(\d{8,30})/i
const RE_FIRST_HTTP = /https?:\/\/[^\s<>"'()（）【】]+/i

function stripTrailingNoise(url: string): string {
  return url.replace(/[),.;，。！!？、]+$/g, '')
}

export function normalizeSourceVideoUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  const short = s.match(RE_DOUYIN_SHORT)
  if (short?.[1]) {
    return `https://v.douyin.com/${short[1]}/`
  }

  const web = s.match(RE_DOUYIN_WEB)
  if (web?.[3]) {
    return `https://www.douyin.com/video/${web[3]}`
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
