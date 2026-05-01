import axios from 'axios'

/**
 * 将 fetch/axios 类错误整理为单行中文说明（首页等轻量场景用）
 */
export function describeHttpOrNetworkError(error: unknown): string {
  const err = error as {
    response?: { status?: number; data?: { message?: string | string[] } }
    message?: string
    code?: string
  }
  const body = err.response?.data?.message
  const detail = Array.isArray(body) ? body.join('；') : body
  const status = err.response?.status
  const net =
    err.code === 'ECONNREFUSED' ||
    err.code === 'ERR_NETWORK' ||
    err.message?.includes('Network Error') ||
    (!err.response && err.message?.includes('timeout'))
      ? '无法连接后端或请求超时（请确认 backend 已启动且 Vite 代理 /api 正确）'
      : ''
  /** Nginx/反代常见：上游 api 未监听、容器反复退出、MySQL 连不上导致进程挂掉 */
  const gateway =
    status === 502 || status === 503 || status === 504
      ? '网关无可用后端（HTTP ' +
        String(status) +
        '）：Docker 请执行 docker compose ps 与 docker compose logs api；核对 .env 中 MySQL 密码与库是否一致。本地开发请单独启动 backend（如监听 3000）并确认可访问 /api'
      : ''
  return (
    [gateway, net, detail, err.message, status ? `HTTP ${status}` : '']
      .filter(Boolean)
      .join(' · ') || '获取视频信息失败'
  )
}

/** 若为 blob 响应体（常见于下载接口返回的 JSON 错误），解析 Nest 的 message */
export async function describeHttpOrNetworkErrorMaybeBlob(error: unknown): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const text = await error.response.data.text()
      const j = JSON.parse(text) as { message?: string | string[] }
      const m = j.message
      if (m) return Array.isArray(m) ? m.join('；') : m
    } catch {
      // fallthrough
    }
  }
  return describeHttpOrNetworkError(error)
}
