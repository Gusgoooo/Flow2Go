/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Routify OpenAI 兼容网关 API Key（浏览器构建注入，对应服务端 `ROUTIFY_API_KEY`） */
  readonly VITE_ROUTIFY_API_KEY?: string
  /** 自定义网关 base（如生产环境自有反代）；不设时本地 localhost 走 Vite 代理路径 */
  readonly VITE_ROUTIFY_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
