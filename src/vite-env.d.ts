/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Routify OpenAI 兼容网关 API Key（浏览器构建注入，对应服务端 `ROUTIFY_API_KEY`） */
  readonly VITE_ROUTIFY_API_KEY?: string
  /** 自定义网关 base（如生产环境自有反代）；不设时本地 localhost 走 Vite 代理路径 */
  readonly VITE_ROUTIFY_BASE_URL?: string
  /** 本地变量注入代理（server.ts），如 http://localhost:3001 */
  readonly VITE_ROUTIFY_LOCAL_PROXY_URL?: string
  /** PPT Runtime 生图模式：local | routify（默认 routify） */
  readonly VITE_PPT_IMAGE_GEN_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
