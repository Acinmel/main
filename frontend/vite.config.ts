import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

/** 与 Nest（默认 3000）对齐；用 127.0.0.1 减少 Windows 上 localhost→IPv6 解析异常 */
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:3000',
    changeOrigin: true,
    /** 视频页抓取 / 链接转写可能很慢，避免代理过早断开 */
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('naive-ui')) {
            if (
              id.includes('/data-table') ||
              id.includes('/pagination') ||
              id.includes('/scrollbar')
            ) {
              return 'vendor-naive-data'
            }
            if (
              id.includes('/upload') ||
              id.includes('/modal') ||
              id.includes('/dialog') ||
              id.includes('/message') ||
              id.includes('/notification') ||
              id.includes('/tooltip') ||
              id.includes('/popover')
            ) {
              return 'vendor-naive-overlay'
            }
            if (
              id.includes('/input') ||
              id.includes('/form') ||
              id.includes('/select') ||
              id.includes('/radio') ||
              id.includes('/checkbox') ||
              id.includes('/tabs') ||
              id.includes('/button')
            ) {
              return 'vendor-naive-form'
            }
            return 'vendor-naive-core'
          }
          if (id.includes('@vicons')) {
            return 'vendor-icons'
          }
          if (
            id.includes('date-fns') ||
            id.includes('seemly') ||
            id.includes('vooks') ||
            id.includes('vueuc') ||
            id.includes('css-render') ||
            id.includes('treemate') ||
            id.includes('async-validator')
          ) {
            return 'vendor-ui-support'
          }
          if (id.includes('vue') || id.includes('pinia')) {
            return 'vendor-vue'
          }
          if (id.includes('axios')) {
            return 'vendor-http'
          }
          return 'vendor'
        },
      },
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
