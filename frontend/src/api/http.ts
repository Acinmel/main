import axios from 'axios'

const apiBase =
  typeof import.meta.env.VITE_API_BASE_URL === 'string' &&
  import.meta.env.VITE_API_BASE_URL.length > 0
    ? import.meta.env.VITE_API_BASE_URL
    : '/api'

/**
 * Axios 实例：统一前缀、鉴权头、错误占位
 * 生产 Docker：默认 /api，由 Nginx 反代到 api 容器；前后端分离部署时可设 VITE_API_BASE_URL。
 * 注：鉴权直接从 localStorage 读取，避免 Pinia 尚未挂载时的循环依赖问题
 */
export const http = axios.create({
  baseURL: apiBase,
  timeout: 30_000,
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('kb_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err?.response?.status
    if (status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('kb_token')
      const path = window.location.pathname + window.location.search
      if (!path.startsWith('/login') && !path.startsWith('/register')) {
        const q = new URLSearchParams({ redirect: path })
        window.location.assign(`/login?${q.toString()}`)
      }
    }
    return Promise.reject(err)
  },
)
