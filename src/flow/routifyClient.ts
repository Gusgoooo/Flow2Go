/**
 * Routify OpenAI-compatible 统一网关客户端。
 *
 * 双模式自动切换：
 * 1. 服务端代理模式（推荐）：Express server 运行时，走 `/api/routify/*`，
 *    API Key 由服务端 `process.env.ROUTIFY_API_KEY` 注入，前端零密钥。
 * 2. 直连回退模式：未部署 Express server 时，若构建阶段设置了
 *    `VITE_ROUTIFY_API_KEY`，则直连 Routify 网关（本地开发由 Vite 代理解决 CORS）。
 */

const ROUTIFY_OPENAI_BASE_REMOTE = 'https://routify.alibaba-inc.com/protocol/openai/v1'
const SERVER_PROXY_BASE = '/api/routify'

function getViteRoutifyKey(): string {
  try {
    const v = (import.meta as { env?: { VITE_ROUTIFY_API_KEY?: string } }).env?.VITE_ROUTIFY_API_KEY
    if (typeof v === 'string' && v.trim()) return v.trim()
  } catch { /* ignore */ }
  return ''
}

function isServerProxyAvailable(): boolean {
  const viteKey = getViteRoutifyKey()
  if (viteKey) return false
  return true
}

export function getRoutifyOpenAIBase(): string {
  if (isServerProxyAvailable()) return SERVER_PROXY_BASE
  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') {
      return '/protocol/openai/v1'
    }
  }
  return ROUTIFY_OPENAI_BASE_REMOTE
}

export function getRoutifyApiKey(): string {
  if (isServerProxyAvailable()) return '(server-managed)'
  return getViteRoutifyKey()
}

export const ROUTIFY_OPENAI_BASE = ROUTIFY_OPENAI_BASE_REMOTE
export const ROUTIFY_CHAT_COMPLETIONS_URL = `${ROUTIFY_OPENAI_BASE_REMOTE}/chat/completions`

export type RoutifyOpenAIPostOptions = {
  body?: unknown
  signal?: AbortSignal
  method?: 'POST' | 'GET'
  bearerFallback?: string
  headers?: Record<string, string>
}

export async function routifyOpenAICompatiblePost(
  path: string,
  opts: RoutifyOpenAIPostOptions = {},
): Promise<Response> {
  const clean = path.replace(/^\/+/, '')
  const base = getRoutifyOpenAIBase()
  const url = `${base}/${clean}`
  const method = opts.method ?? 'POST'

  const headers: Record<string, string> = { ...opts.headers }

  if (!isServerProxyAvailable()) {
    const token = getViteRoutifyKey() || (opts.bearerFallback ?? '').trim()
    if (!token) {
      throw new Error(
        '未配置 Routify API Key。请设置环境变量 VITE_ROUTIFY_API_KEY（前端构建），或启动 Express 代理服务器（npm run dev:server）并配置 ROUTIFY_API_KEY。',
      )
    }
    headers['Authorization'] = `Bearer ${token}`
  }

  const hasBody = opts.body !== undefined && method !== 'GET'
  if (hasBody) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }

  return fetch(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  })
}

export type RoutifyChatCompletionsOptions = {
  body: Record<string, unknown>
  signal?: AbortSignal
  bearerFallback?: string
}

export async function routifyChatCompletions(opts: RoutifyChatCompletionsOptions): Promise<Response> {
  return routifyOpenAICompatiblePost('chat/completions', {
    body: opts.body,
    signal: opts.signal,
    bearerFallback: opts.bearerFallback,
  })
}

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

export const routifyOpenAICompatible = {
  get baseUrl() {
    return getRoutifyOpenAIBase()
  },
  get chatCompletionsUrl() {
    return `${getRoutifyOpenAIBase()}/chat/completions`
  },
  getApiKey: getRoutifyApiKey,
  post: routifyOpenAICompatiblePost,
  chatCompletions: routifyChatCompletions,
  imagesGenerations: routifyImagesGenerations,
  embeddings: routifyEmbeddings,
}
