/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 生产环境 API 前缀或绝对地址，默认 /api（与 Nginx 反代一致） */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
