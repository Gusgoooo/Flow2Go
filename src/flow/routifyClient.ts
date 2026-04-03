/**
 * Routify OpenAI-compatible 统一网关（所有模型相关 HTTP 调用应经此出口）。
 *
 * Base: https://routify.alibaba-inc.com/protocol/openai/v1
 * 典型路径：chat/completions、images/generations、embeddings 等（与 OpenAI API 路径一致）
 *
 * 鉴权：Authorization: Bearer <key>
 * - 浏览器：`import.meta.env.VITE_ROUTIFY_API_KEY`
 * - Node：`process.env.ROUTIFY_API_KEY`
 *
 * 浏览器注意：直连 `https://routify...` 仍可能受 CORS 限制（表现为 Failed to fetch）。
 * 本地开发/预览（localhost）默认使用同源路径 `/protocol/openai/v1`，由 Vite 代理到 Routify。
 * 生产环境可设置 `VITE_ROUTIFY_BASE_URL` 指向自有反代；未设置则直连官方地址（需网关放行 CORS 或同域部署）。
 */

const ROUTIFY_OPENAI_BASE_REMOTE = 'https://routify.alibaba-inc.com/protocol/openai/v1'

/**
 * 当前应使用的 OpenAI 兼容 base（含本地代理路径或远程 URL）。
 */
export function getRoutifyOpenAIBase(): string {
  try {
    const explicit = import.meta.env.VITE_ROUTIFY_BASE_URL
    if (typeof explicit === 'string' && explicit.trim()) {
      return explicit.replace(/\/+$/, '')
    }
  } catch {
    /* ignore */
  }
  // 本地开发/预览：走同源路径交给 Vite 代理，避免 CORS
  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
      return '/protocol/openai/v1'
    }
  }
  return ROUTIFY_OPENAI_BASE_REMOTE
}

/** 兼容旧名：远程网关 base（不随本地代理变化） */
export const ROUTIFY_OPENAI_BASE = ROUTIFY_OPENAI_BASE_REMOTE

export const ROUTIFY_CHAT_COMPLETIONS_URL = `${ROUTIFY_OPENAI_BASE_REMOTE}/chat/completions`

/**
 * 读取 Routify API Key（优先环境变量，不写死）。
 */
export function getRoutifyApiKey(): string {
  try {
    const vite = (import.meta as { env?: { VITE_ROUTIFY_API_KEY?: string } }).env?.VITE_ROUTIFY_API_KEY
    if (typeof vite === 'string' && vite.trim()) return vite.trim()
  } catch {
    /* ignore */
  }
  if (typeof process !== 'undefined' && process.env?.ROUTIFY_API_KEY) {
    return String(process.env.ROUTIFY_API_KEY).trim()
  }
  return ''
}

function resolveBearer(bearerFallback?: string): string {
  return getRoutifyApiKey() || String(bearerFallback ?? '').trim()
}

export type RoutifyOpenAIPostOptions = {
  /** 请求 JSON body（OpenAI 兼容）；GET 时可省略 */
  body?: unknown
  signal?: AbortSignal
  method?: 'POST' | 'GET'
  /**
   * 环境变量未配置时的 Bearer 回退（如 UI 中用户填写的 key）。
   */
  bearerFallback?: string
  /** 额外头（会与 Authorization、Content-Type 合并） */
  headers?: Record<string, string>
}

/**
 * 向 Routify 网关发起请求：`POST ${BASE}/${path}`（路径不含前导斜杠亦可）。
 * 涵盖 chat、图像、向量等所有 OpenAI 兼容端点。
 */
export async function routifyOpenAICompatiblePost(
  path: string,
  opts: RoutifyOpenAIPostOptions = {},
): Promise<Response> {
  const clean = path.replace(/^\/+/, '')
  const token = resolveBearer(opts.bearerFallback)
  if (!token) {
    throw new Error(
      '未配置 Routify API Key：请设置环境变量 VITE_ROUTIFY_API_KEY（前端构建）或 ROUTIFY_API_KEY（Node）',
    )
  }
  const url = `${getRoutifyOpenAIBase()}/${clean}`
  const method = opts.method ?? 'POST'
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...opts.headers,
  }
  const hasBody = opts.body !== undefined && method !== 'GET'
  if (hasBody) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }

  try {
    return await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e: unknown) {
    // 浏览器 CORS/预检失败时，fetch 往往直接抛 TypeError: Failed to fetch（没有 status / response）
    if (e instanceof TypeError) {
      throw new Error(
        [
          '网络请求失败（可能是 CORS 预检被拦截）。',
          `当前请求地址：${url}`,
          '解决方式（二选一）：',
          '1) 让 Routify 网关侧为你的线上域名放行 CORS（允许 OPTIONS 预检，允许 Authorization / Content-Type 头）。',
          '2) 在生产环境设置 VITE_ROUTIFY_BASE_URL 指向你自己的同源反代/外部代理（例如 Cloudflare Worker / Vercel）。',
        ].join('\n'),
      )
    }
    throw e
  }
}

export type RoutifyChatCompletionsOptions = {
  body: Record<string, unknown>
  signal?: AbortSignal
  bearerFallback?: string
}

/** Chat Completions（messages 多模态等） */
export async function routifyChatCompletions(opts: RoutifyChatCompletionsOptions): Promise<Response> {
  return routifyOpenAICompatiblePost('chat/completions', {
    body: opts.body,
    signal: opts.signal,
    bearerFallback: opts.bearerFallback,
  })
}

/** Images Generations（若网关支持 OpenAI images 协议） */
export async function routifyImagesGenerations(opts: {
  body: Record<string, unknown>
  signal?: AbortSignal
  bearerFallback?: string
}): Promise<Response> {
  return routifyOpenAICompatiblePost('images/generations', {
    body: opts.body,
    signal: opts.signal,
    bearerFallback: opts.bearerFallback,
  })
}

/** Embeddings */
export async function routifyEmbeddings(opts: {
  body: Record<string, unknown>
  signal?: AbortSignal
  bearerFallback?: string
}): Promise<Response> {
  return routifyOpenAICompatiblePost('embeddings', {
    body: opts.body,
    signal: opts.signal,
    bearerFallback: opts.bearerFallback,
  })
}

/** 统一 provider（业务与工具层优先从此对象取方法） */
export const routifyOpenAICompatible = {
  get baseUrl() {
    return getRoutifyOpenAIBase()
  },
  get chatCompletionsUrl() {
    return `${getRoutifyOpenAIBase()}/chat/completions`
  },
  getApiKey: getRoutifyApiKey,
  /** 通用入口：任意 OpenAI 兼容子路径 */
  post: routifyOpenAICompatiblePost,
  chatCompletions: routifyChatCompletions,
  imagesGenerations: routifyImagesGenerations,
  embeddings: routifyEmbeddings,
}
