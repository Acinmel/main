/** 用于获赞、播放量等统计数字展示 */
export function formatStatCount(n: number | null | undefined): string {
  if (n == null || n < 0) return '—'
  return n.toLocaleString('zh-CN')
}
