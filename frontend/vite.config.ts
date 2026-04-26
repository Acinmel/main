import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

/** 与 Nest（默认 3000）对齐；用 127.0.0.1 减少 Windows 上 localhost→IPv6 解析异常 */
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:3000',
    changeOrigin: true,
    /** 视频页抓取 / 链接 Whisper 转写可能很慢，避免代理过早断开 */
    timeout: 620_000,
  },
} as const

/**
 * Vite 配置：Vue3 + 路径别名 @ -> src
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    /** 默认只绑 [::1] 时，http://127.0.0.1:5173 会连不上，代理与 curl 自检也会失败 */
    host: true,
    port: 5173,
    proxy: { ...apiProxy },
  },
  /** npm run preview 时也必须配置，否则 /api 不会转发到 Nest，浏览器会报 Network Error */
  preview: {
    host: true,
    port: 4173,
    proxy: { ...apiProxy },
  },
})
