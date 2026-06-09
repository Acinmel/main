/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 生产环境 API 前缀或绝对地址，默认 /api（与 Nginx 反代一致） */
  readonly VITE_API_BASE_URL?: string
  /** 仅用于 QA 受控验收：启用 /studio 进度态夹具（默认关闭） */
  readonly VITE_STUDIO_QA_PROGRESS_FIXTURE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
